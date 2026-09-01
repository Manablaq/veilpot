// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {
    FHE,
    ebool,
    euint64,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title IVeilpotAutopilotPool
/// @author Veilpot contributors
/// @notice Minimal immutable Pool surface consumed by the Autopilot Vault.
interface IVeilpotAutopilotPool {
    /// @notice Return the participant metadata required to bind an Autopilot plan.
    /// @param slotIndex Pool registration slot to inspect.
    /// @return state Current participant lifecycle state.
    /// @return owner Current participant owner.
    /// @return registrationVersion Participant registration version.
    /// @return reservationNonce Current reservation nonce.
    /// @return reservationExpiry Reservation expiry timestamp.
    /// @return activationStartedAt Activation start timestamp.
    /// @return activationDeadline Activation deadline timestamp.
    /// @return refundAttemptNonce Current refund-attempt nonce.
    /// @return bondHeld Whether the registration bond is currently held.
    function participantMetadata(
        uint256 slotIndex
    )
        external
        view
        returns (
            uint8 state,
            address owner,
            uint256 registrationVersion,
            uint256 reservationNonce,
            uint256 reservationExpiry,
            uint256 activationStartedAt,
            uint256 activationDeadline,
            uint256 refundAttemptNonce,
            bool bondHeld
        );

    /// @notice Pull one Vault-authorized confidential contribution into the Pool.
    /// @param slotIndex Bound participant slot.
    /// @param reservationNonce Exact reservation nonce bound to the plan.
    /// @param authorizedAmount Encrypted amount authorized by the Vault for this execution.
    /// @return actualTransferred Encrypted amount actually transferred by ERC-7984.
    function pullAutopilotContribution(
        uint256 slotIndex,
        uint256 reservationNonce,
        euint64 authorizedAmount
    ) external returns (euint64 actualTransferred);
}

/// @title VeilpotAutopilotVault
/// @author Veilpot contributors
/// @notice Non-upgradeable confidential custody boundary for recurring Veilpot savings.
/// @dev The user's external wallet never grants ERC-7984 operator authority to this Vault,
///      the Pool, a keeper, scheduler, backend, or any other automation service.
contract VeilpotAutopilotVault is
    ZamaEthereumConfig,
    IERC7984Receiver
{
    /// @notice Maximum number of committed execution windows in one Autopilot plan.
    uint16 public constant MAX_AUTOPILOT_EXECUTIONS = 1_024;

    /// @notice Pool registration version accepted by this Vault implementation.
    uint256 public constant SUPPORTED_REGISTRATION_VERSION = 1;

    uint8 private constant ACTIVE_PARTICIPANT_STATE = 3;

    enum PlanState {
        NONE,
        ACTIVE,
        PAUSED,
        REVOKED,
        COMPLETED
    }

    // The field order mirrors the reviewed authorization model; changing storage layout is deferred.
    // solhint-disable-next-line gas-struct-packing
    struct Plan {
        address owner;
        uint256 slotIndex;
        uint256 registrationVersion;
        uint256 reservationNonce;
        uint256 planNonce;
        bytes32 scheduleRoot;
        uint16 executionCount;
        uint16 nextExecutionIndex;
        uint64 lastWindowNotAfter;
        PlanState state;
        euint64 periodAmount;
        euint64 remainingBudget;
        euint64 funds;
    }

    // Public getter name is frozen for reviewer/API clarity.
    /// @notice Immutable ERC-7984 confidential token held by this Vault.
    IERC7984 public immutable confidentialToken; // solhint-disable-line immutable-vars-naming

    // Public getter name is frozen for reviewer/API clarity.
    /// @notice Immutable Veilpot Pool that is the only Autopilot destination.
    IVeilpotAutopilotPool public immutable pool; // solhint-disable-line immutable-vars-naming

    mapping(bytes32 planId => Plan plan) private _plans;

    /// @notice Next valid plan nonce for each owner.
    mapping(address owner => uint256 nonce) public nextPlanNonce;

    uint256 private _entered;

    error InvalidToken();
    error InvalidPool();
    error InvalidPlan();
    error InvalidOwner();
    error InvalidPlanState();
    error InvalidRegistrationVersion();
    error InvalidParticipantBinding();
    error PlanNonceMismatch();
    error InvalidSchedule();
    error InvalidScheduleProof();
    error InvalidExecutionIndex();
    error ExecutionTooEarly();
    error ExecutionExpired();
    error FundingCallerMismatch();
    error FundingSourceMismatch();
    error InvalidFundingData();
    error Reentrancy();

    /// @notice Emitted when an owner creates a new immutable Autopilot plan.
    /// @param planId Domain-bound plan identifier.
    /// @param owner Plan owner and bound Pool participant.
    /// @param planNonce Owner-scoped nonce consumed by the plan.
    /// @param slotIndex Bound Pool participant slot.
    /// @param registrationVersion Bound Pool registration version.
    /// @param reservationNonce Bound Pool reservation nonce.
    /// @param executionCount Number of committed execution windows.
    /// @param scheduleRoot Merkle root committing the schedule windows.
    event PlanCreated(
        bytes32 indexed planId,
        address indexed owner,
        uint256 indexed planNonce,
        uint256 slotIndex,
        uint256 registrationVersion,
        uint256 reservationNonce,
        uint16 executionCount,
        bytes32 scheduleRoot
    );

    /// @notice Emitted when confidential funds are accepted for a plan.
    /// @param planId Funded plan identifier.
    /// @param owner Immutable plan owner.
    event PlanFunded(
        bytes32 indexed planId,
        address indexed owner
    );

    /// @notice Emitted when the owner pauses future executions.
    /// @param planId Paused plan identifier.
    event PlanPaused(
        bytes32 indexed planId
    );

    /// @notice Emitted when the owner resumes a paused plan.
    /// @param planId Resumed plan identifier.
    event PlanResumed(
        bytes32 indexed planId
    );

    /// @notice Emitted when the owner terminally revokes a plan.
    /// @param planId Revoked plan identifier.
    event PlanRevoked(
        bytes32 indexed planId
    );

    /// @notice Emitted when the owner consumes one committed slot without execution.
    /// @param planId Plan identifier.
    /// @param index Consumed schedule index.
    event PlanSkipped(
        bytes32 indexed planId,
        uint256 indexed index
    );

    /// @notice Emitted when anyone advances an already expired committed slot.
    /// @param planId Plan identifier.
    /// @param index Expired schedule index consumed.
    event MissedWindowAdvanced(
        bytes32 indexed planId,
        uint256 indexed index
    );

    /// @notice Emitted after one committed Autopilot slot executes.
    /// @param planId Plan identifier.
    /// @param index Executed schedule index.
    /// @param executor Permissionless executor that submitted the transaction.
    event PlanExecuted(
        bytes32 indexed planId,
        uint256 indexed index,
        address indexed executor
    );

    /// @notice Emitted after plan funds are withdrawn to the immutable owner.
    /// @param planId Plan identifier.
    /// @param owner Immutable recipient of the withdrawal.
    event PlanFundsWithdrawn(
        bytes32 indexed planId,
        address indexed owner
    );

    modifier nonReentrant() {
        if (_entered != 0) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(
        IERC7984 token,
        IVeilpotAutopilotPool pool_
    ) {
        if (address(token) == address(0)) {
            revert InvalidToken();
        }

        if (address(pool_) == address(0)) {
            revert InvalidPool();
        }

        confidentialToken = token;
        pool = pool_;
    }

    /* solhint-disable function-max-lines */
    /// @notice Create one immutable Autopilot authorization policy.
    /// @dev The plan owner must already be the exact ACTIVE participant occupying the bound Pool slot.
    /// @param slotIndex Pool participant slot bound to the plan.
    /// @param registrationVersion Exact supported participant registration version.
    /// @param reservationNonce Exact current participant reservation nonce.
    /// @param planNonce Exact next owner-scoped plan nonce.
    /// @param scheduleRoot Merkle root committing every execution window.
    /// @param executionCount Number of committed execution windows.
    /// @param encryptedPeriodAmount Encrypted maximum amount for each execution.
    /// @param encryptedLifetimeCap Encrypted lifetime contribution budget.
    /// @param inputProof Shared FHE input proof for both encrypted plan amounts.
    /// @return planId Domain-bound identifier of the created plan.
    function createPlan(
        uint256 slotIndex,
        uint256 registrationVersion,
        uint256 reservationNonce,
        uint256 planNonce,
        bytes32 scheduleRoot,
        uint16 executionCount,
        externalEuint64 encryptedPeriodAmount,
        externalEuint64 encryptedLifetimeCap,
        bytes calldata inputProof
    )
        external
        nonReentrant
        returns (bytes32 planId)
    {
        if (
            registrationVersion !=
            SUPPORTED_REGISTRATION_VERSION
        ) {
            revert InvalidRegistrationVersion();
        }

        if (
            planNonce !=
            nextPlanNonce[msg.sender]
        ) {
            revert PlanNonceMismatch();
        }

        if (
            scheduleRoot == bytes32(0) ||
            executionCount == 0 ||
            executionCount >
            MAX_AUTOPILOT_EXECUTIONS
        ) {
            revert InvalidSchedule();
        }

        (
            uint8 participantState,
            address participantOwner,
            uint256 participantVersion,
            uint256 participantReservationNonce,
            ,
            ,
            ,
            ,

        ) = pool.participantMetadata(
            slotIndex
        );

        if (
            participantState !=
                ACTIVE_PARTICIPANT_STATE ||
            participantOwner !=
                msg.sender ||
            participantVersion !=
                registrationVersion ||
            participantReservationNonce !=
                reservationNonce
        ) {
            revert InvalidParticipantBinding();
        }

        planId = planIdFor(
            msg.sender,
            registrationVersion,
            reservationNonce,
            planNonce
        );

        if (
            _plans[planId].owner !=
            address(0)
        ) {
            revert InvalidPlan();
        }

        euint64 periodAmount =
            FHE.fromExternal(
                encryptedPeriodAmount,
                inputProof
            );

        euint64 lifetimeCap =
            FHE.fromExternal(
                encryptedLifetimeCap,
                inputProof
            );

        Plan storage plan =
            _plans[planId];

        plan.owner = msg.sender;
        plan.slotIndex = slotIndex;
        plan.registrationVersion =
            registrationVersion;
        plan.reservationNonce =
            reservationNonce;
        plan.planNonce = planNonce;
        plan.scheduleRoot =
            scheduleRoot;
        plan.executionCount =
            executionCount;
        plan.state =
            PlanState.ACTIVE;
        plan.periodAmount =
            periodAmount;
        plan.remainingBudget =
            lifetimeCap;
        plan.funds =
            FHE.asEuint64(0);

        FHE.allowThis(
            plan.periodAmount
        );
        FHE.allow(
            plan.periodAmount,
            plan.owner
        );

        FHE.allowThis(
            plan.remainingBudget
        );
        FHE.allow(
            plan.remainingBudget,
            plan.owner
        );

        FHE.allowThis(
            plan.funds
        );
        FHE.allow(
            plan.funds,
            plan.owner
        );

        nextPlanNonce[msg.sender] =
            planNonce + 1;

        emit PlanCreated(
            planId,
            msg.sender,
            planNonce,
            slotIndex,
            registrationVersion,
            reservationNonce,
            executionCount,
            scheduleRoot
        );
    }
    /* solhint-enable function-max-lines */

    /* solhint-disable function-max-lines */
    /// @inheritdoc IERC7984Receiver
    /// @dev Funding is accepted only from the immutable token and only when the exact plan owner
    ///      directly initiated the transfer-and-callback.
    function onConfidentialTransferReceived(
        address operator,
        address from,
        euint64 amount,
        bytes calldata data
    )
        external
        nonReentrant
        returns (ebool)
    {
        if (
            msg.sender !=
            address(confidentialToken)
        ) {
            revert FundingCallerMismatch();
        }

        if (data.length != 32) {
            revert InvalidFundingData();
        }

        bytes32 planId =
            abi.decode(
                data,
                (bytes32)
            );

        Plan storage plan =
            _plan(planId);

        if (
            plan.state ==
                PlanState.REVOKED ||
            plan.state ==
                PlanState.COMPLETED
        ) {
            revert InvalidPlanState();
        }

        if (
            operator != plan.owner ||
            from != plan.owner
        ) {
            revert FundingSourceMismatch();
        }

        plan.funds =
            FHE.add(
                plan.funds,
                amount
            );

        FHE.allowThis(
            plan.funds
        );
        FHE.allow(
            plan.funds,
            plan.owner
        );

        ebool accepted =
            FHE.asEbool(true);

        FHE.allowTransient(
            accepted,
            msg.sender
        );

        emit PlanFunded(
            planId,
            plan.owner
        );

        return accepted;
    }
    /* solhint-enable function-max-lines */

    /// @notice Pause future executions without changing the committed policy.
    /// @param planId Plan to pause.
    function pausePlan(
        bytes32 planId
    ) external {
        Plan storage plan =
            _ownedPlan(
                planId
            );

        if (
            plan.state !=
            PlanState.ACTIVE
        ) {
            revert InvalidPlanState();
        }

        plan.state =
            PlanState.PAUSED;

        emit PlanPaused(
            planId
        );
    }

    /// @notice Resume one paused plan.
    /// @param planId Plan to resume.
    function resumePlan(
        bytes32 planId
    ) external {
        Plan storage plan =
            _ownedPlan(
                planId
            );

        if (
            plan.state !=
            PlanState.PAUSED
        ) {
            revert InvalidPlanState();
        }

        plan.state =
            PlanState.ACTIVE;

        emit PlanResumed(
            planId
        );
    }

    /// @notice Permanently revoke one plan nonce.
    /// @dev Residual accounted Vault funds remain owner-withdrawable after revocation.
    /// @param planId Plan to revoke terminally.
    function revokePlan(
        bytes32 planId
    ) external {
        Plan storage plan =
            _ownedPlan(
                planId
            );

        if (
            plan.state ==
            PlanState.REVOKED
        ) {
            revert InvalidPlanState();
        }

        plan.state =
            PlanState.REVOKED;

        emit PlanRevoked(
            planId
        );
    }

    /// @notice Owner-authorized skip of the exact next committed schedule slot.
    /// @param planId Plan whose next slot is consumed.
    /// @param index Exact next committed schedule index.
    /// @param notBefore Committed execution-window start.
    /// @param notAfter Committed execution-window end.
    /// @param proof Merkle proof for the exact schedule leaf.
    function skipNext(
        bytes32 planId,
        uint256 index,
        uint64 notBefore,
        uint64 notAfter,
        bytes32[] calldata proof
    ) external {
        Plan storage plan =
            _ownedPlan(
                planId
            );

        if (
            plan.state ==
                PlanState.REVOKED ||
            plan.state ==
                PlanState.COMPLETED
        ) {
            revert InvalidPlanState();
        }

        _consumeWindow(
            planId,
            plan,
            index,
            notBefore,
            notAfter,
            proof
        );

        emit PlanSkipped(
            planId,
            index
        );
    }

    /// @notice Permissionlessly advance one expired committed slot without moving value.
    /// @param planId Plan whose expired slot is advanced.
    /// @param index Exact next committed schedule index.
    /// @param notBefore Committed execution-window start.
    /// @param notAfter Committed execution-window end.
    /// @param proof Merkle proof for the exact schedule leaf.
    function advanceMissed(
        bytes32 planId,
        uint256 index,
        uint64 notBefore,
        uint64 notAfter,
        bytes32[] calldata proof
    ) external {
        Plan storage plan =
            _plan(planId);

        if (
            plan.state ==
                PlanState.REVOKED ||
            plan.state ==
                PlanState.COMPLETED
        ) {
            revert InvalidPlanState();
        }

        _validateWindow(
            planId,
            plan,
            index,
            notBefore,
            notAfter,
            proof
        );

        if (
            // Boundary is security-significant: at notAfter the window has not yet missed.
            // solhint-disable-next-line gas-strict-inequalities
            block.timestamp <=
            notAfter
        ) {
            revert ExecutionExpired();
        }

        _consumeValidatedWindow(
            plan,
            index,
            notAfter
        );

        emit MissedWindowAdvanced(
            planId,
            index
        );
    }

    /* solhint-disable function-max-lines */
    /// @notice Execute one exact due schedule slot permissionlessly.
    /// @dev The caller supplies no amount and receives no token or FHE authority.
    /// @param planId Plan to execute.
    /// @param index Exact next committed schedule index.
    /// @param notBefore Committed execution-window start.
    /// @param notAfter Committed execution-window end.
    /// @param proof Merkle proof for the exact schedule leaf.
    /// @return actualTransferred Encrypted amount actually credited by the Pool.
    function execute(
        bytes32 planId,
        uint256 index,
        uint64 notBefore,
        uint64 notAfter,
        bytes32[] calldata proof
    )
        external
        nonReentrant
        returns (euint64 actualTransferred)
    {
        Plan storage plan =
            _plan(planId);

        if (
            plan.state !=
            PlanState.ACTIVE
        ) {
            revert InvalidPlanState();
        }

        _validateWindow(
            planId,
            plan,
            index,
            notBefore,
            notAfter,
            proof
        );

        if (
            block.timestamp <
            notBefore
        ) {
            revert ExecutionTooEarly();
        }

        if (
            block.timestamp >
            notAfter
        ) {
            revert ExecutionExpired();
        }

        euint64 authorizedAmount =
            FHE.min(
                plan.periodAmount,
                plan.remainingBudget
            );

        authorizedAmount =
            FHE.min(
                authorizedAmount,
                plan.funds
            );

        _consumeValidatedWindow(
            plan,
            index,
            notAfter
        );

        confidentialToken.setOperator(
            address(pool),
            uint48(block.timestamp)
        );

        FHE.allowTransient(
            authorizedAmount,
            address(pool)
        );

        actualTransferred =
            pool.pullAutopilotContribution(
                plan.slotIndex,
                plan.reservationNonce,
                authorizedAmount
            );

        confidentialToken.setOperator(
            address(pool),
            0
        );

        plan.funds =
            FHE.sub(
                plan.funds,
                actualTransferred
            );

        plan.remainingBudget =
            FHE.sub(
                plan.remainingBudget,
                actualTransferred
            );

        FHE.allowThis(
            plan.funds
        );
        FHE.allow(
            plan.funds,
            plan.owner
        );

        FHE.allowThis(
            plan.remainingBudget
        );
        FHE.allow(
            plan.remainingBudget,
            plan.owner
        );

        emit PlanExecuted(
            planId,
            index,
            msg.sender
        );
    }
    /* solhint-enable function-max-lines */

    /// @notice Withdraw all currently accounted plan funds to the immutable plan owner.
    /// @dev No caller may choose an arbitrary token recipient.
    /// @param planId Plan whose accounted funds are withdrawn.
    /// @return actualTransferred Encrypted amount actually returned by ERC-7984.
    function withdrawPlanFunds(
        bytes32 planId
    )
        external
        nonReentrant
        returns (euint64 actualTransferred)
    {
        Plan storage plan =
            _ownedPlan(
                planId
            );

        euint64 requested =
            plan.funds;

        FHE.allowTransient(
            requested,
            address(confidentialToken)
        );

        actualTransferred =
            confidentialToken
                .confidentialTransfer(
                    plan.owner,
                    requested
                );

        plan.funds =
            FHE.sub(
                requested,
                actualTransferred
            );

        FHE.allowThis(
            plan.funds
        );
        FHE.allow(
            plan.funds,
            plan.owner
        );

        emit PlanFundsWithdrawn(
            planId,
            plan.owner
        );
    }

    /// @notice Derive the plan domain identity used by schedule commitments and funding callbacks.
    /// @param owner Immutable plan owner.
    /// @param registrationVersion Bound participant registration version.
    /// @param reservationNonce Bound participant reservation nonce.
    /// @param planNonce Owner-scoped plan nonce.
    function planIdFor(
        address owner,
        uint256 registrationVersion,
        uint256 reservationNonce,
        uint256 planNonce
    )
        public
        view
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    address(pool),
                    address(
                        confidentialToken
                    ),
                    owner,
                    registrationVersion,
                    reservationNonce,
                    planNonce
                )
            );
    }

    /// @notice Compute the exact double-hashed schedule leaf expected by OpenZeppelin MerkleProof.
    /// @param planId Domain-bound plan identifier.
    /// @param index Schedule index.
    /// @param notBefore Committed execution-window start.
    /// @param notAfter Committed execution-window end.
    function scheduleLeaf(
        bytes32 planId,
        uint256 index,
        uint64 notBefore,
        uint64 notAfter
    )
        public
        pure
        returns (bytes32)
    {
        return
            keccak256(
                bytes.concat(
                    keccak256(
                        abi.encode(
                            planId,
                            index,
                            notBefore,
                            notAfter
                        )
                    )
                )
            );
    }

    /// @notice Return public authorization metadata without revealing confidential amounts.
    /// @param planId Plan to inspect.
    /// @return state Current plan lifecycle state.
    /// @return owner Immutable plan owner.
    /// @return slotIndex Bound Pool participant slot.
    /// @return registrationVersion Bound Pool registration version.
    /// @return reservationNonce Bound Pool reservation nonce.
    /// @return planNonce Owner-scoped plan nonce.
    /// @return scheduleRoot Merkle root committing the schedule.
    /// @return executionCount Number of committed schedule slots.
    /// @return nextExecutionIndex Next unconsumed schedule index.
    /// @return lastWindowNotAfter End timestamp of the last consumed window.
    function planMetadata(
        bytes32 planId
    )
        external
        view
        returns (
            PlanState state,
            address owner,
            uint256 slotIndex,
            uint256 registrationVersion,
            uint256 reservationNonce,
            uint256 planNonce,
            bytes32 scheduleRoot,
            uint16 executionCount,
            uint16 nextExecutionIndex,
            uint64 lastWindowNotAfter
        )
    {
        Plan storage plan =
            _plan(planId);

        return (
            plan.state,
            plan.owner,
            plan.slotIndex,
            plan.registrationVersion,
            plan.reservationNonce,
            plan.planNonce,
            plan.scheduleRoot,
            plan.executionCount,
            plan.nextExecutionIndex,
            plan.lastWindowNotAfter
        );
    }

    /// @notice Return confidential amount handles. Only ACL-authorized parties can decrypt them.
    /// @param planId Plan to inspect.
    /// @return periodAmount Encrypted per-execution cap.
    /// @return remainingBudget Encrypted remaining lifetime budget.
    /// @return funds Encrypted Vault funds currently accounted to the plan.
    function planAmountHandles(
        bytes32 planId
    )
        external
        view
        returns (
            euint64 periodAmount,
            euint64 remainingBudget,
            euint64 funds
        )
    {
        Plan storage plan =
            _plan(planId);

        return (
            plan.periodAmount,
            plan.remainingBudget,
            plan.funds
        );
    }

    function _validateWindow(
        bytes32 planId,
        Plan storage plan,
        uint256 index,
        uint64 notBefore,
        uint64 notAfter,
        bytes32[] calldata proof
    ) internal view {
        if (
            index != plan.nextExecutionIndex ||
            // Bound is exact: index == executionCount is already outside the committed schedule.
            // solhint-disable-next-line gas-strict-inequalities
            index >= plan.executionCount
        ) {
            revert InvalidExecutionIndex();
        }

        if (
            notBefore >
            notAfter
        ) {
            revert InvalidSchedule();
        }

        if (
            index != 0 &&
            // Equality would overlap/touch the prior committed window and is forbidden.
            // solhint-disable-next-line gas-strict-inequalities
            notBefore <=
                plan.lastWindowNotAfter
        ) {
            revert InvalidSchedule();
        }

        bytes32 leaf =
            scheduleLeaf(
                planId,
                index,
                notBefore,
                notAfter
            );

        if (
            !MerkleProof.verifyCalldata(
                proof,
                plan.scheduleRoot,
                leaf
            )
        ) {
            revert InvalidScheduleProof();
        }
    }

    function _consumeWindow(
        bytes32 planId,
        Plan storage plan,
        uint256 index,
        uint64 notBefore,
        uint64 notAfter,
        bytes32[] calldata proof
    ) internal {
        _validateWindow(
            planId,
            plan,
            index,
            notBefore,
            notAfter,
            proof
        );

        _consumeValidatedWindow(
            plan,
            index,
            notAfter
        );
    }

    function _consumeValidatedWindow(
        Plan storage plan,
        uint256 index,
        uint64 notAfter
    ) internal {
        plan.lastWindowNotAfter =
            notAfter;
        plan.nextExecutionIndex =
            uint16(index + 1);

        if (
            plan.nextExecutionIndex ==
            plan.executionCount
        ) {
            plan.state =
                PlanState.COMPLETED;
        }
    }

    function _ownedPlan(
        bytes32 planId
    )
        internal
        view
        returns (Plan storage plan)
    {
        plan =
            _plan(planId);

        if (
            msg.sender !=
            plan.owner
        ) {
            revert InvalidOwner();
        }
    }

    function _plan(
        bytes32 planId
    )
        internal
        view
        returns (Plan storage plan)
    {
        plan =
            _plans[planId];

        if (
            plan.owner ==
            address(0)
        ) {
            revert InvalidPlan();
        }
    }
}
