// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {
    FHE,
    ebool,
    euint64,
    euint128,
    euint256,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {IVeilpotPrizeReserveFunding} from "./interfaces/IVeilpotPrizeReserveFunding.sol";
import {IVeilpotPrizePoolView} from "./interfaces/IVeilpotPrizePoolView.sol";
import {IVeilpotYieldAdapterView} from "./interfaces/IVeilpotYieldAdapterView.sol";

/* solhint-disable immutable-vars-naming, gas-indexed-events, gas-struct-packing */

/// @title VeilpotPrizeReserve
/// @author Veilpot
/// @notice Isolated confidential reserve holding only realized yield and explicit sponsor funding.
/// @dev The reserve has no pool-principal transfer path and no winner-selection authority.
contract VeilpotPrizeReserve is ZamaEthereumConfig, IVeilpotPrizeReserveFunding {
    /// @notice Public VeilDraw state value required before reserve funding or prize preparation.
    uint8 public constant POOL_DRAW_FINALIZED = 8;

    /// @notice Public adapter state value proving recognized yield finished reserve funding.
    uint8 public constant ADAPTER_FUNDING_FINALIZED = 4;

    /// @notice Maximum frozen participant bound supported by the Veilpot pool.
    uint256 public constant MAX_PARTICIPANTS = 128;

    /// @notice Fixed permissionless entitlement-assignment chunk size.
    uint256 public constant ASSIGNMENT_CHUNK_SIZE = 8;

    /// @notice Maximum supported VeilDraw bucket exponent inherited from the frozen pool envelope.
    uint8 public constant MAX_DRAW_BUCKET_EXPONENT = 69;

    /// @notice Lifetime of one publicly decryptable prize-status proof request.
    uint256 public constant STATUS_PROOF_TTL_SECONDS = 86_400;

    enum PrizeState {
        UNPREPARED,
        STATUS_PROOF_PENDING,
        ASSIGNING,
        CLAIMABLE,
        CLAIMED,
        NO_PRIZE
    }

    struct Prize {
        PrizeState state;
        bool initialized;
        uint256 snapshotId;
        uint256 participantCount;
        uint256 assignmentCursor;
        uint256 statusAttemptNonce;
        uint256 statusProofDeadline;
        euint64 yieldFunding;
        euint64 sponsorFunding;
        euint64 remaining;
        euint128 assignedTotal;
        ebool statusPredicate;
        euint256 proofContext;
    }

    struct PrizeEntitlement {
        bool initialized;
        bool beneficiaryBound;
        address owner;
        uint256 registrationVersion;
        uint256 reservationNonce;
        euint64 amount;
    }

    /// @notice Immutable Veilpot pool whose finalized draws define prize eligibility.
    IVeilpotPrizePoolView public immutable pool;

    /// @notice Immutable yield adapter authorized to report realized non-principal yield.
    IVeilpotYieldAdapterView public immutable adapter;

    /// @notice Confidential ERC-7984 token used exclusively for reserve assets and prize settlement.
    IERC7984 public immutable confidentialToken;

    /// @notice Next application-level sponsor-funding nonce accepted for each funder.
    mapping(address => uint256) public nextSponsorFundingNonce;
    mapping(uint256 => Prize) private _prizes;
    mapping(uint256 => mapping(uint256 => PrizeEntitlement)) private _entitlements;

    euint128 private _accountedReserveAssets;
    euint128 private _outstandingPrizeLiabilities;

    uint256 private _entered;

    error InvalidPool();
    error InvalidAdapter();
    error InvalidToken();
    error InvalidBinding();
    error Reentrancy();
    error OnlyAdapter();
    error MissingYieldAcl();
    error DrawNotFinalized();
    error AdapterFundingNotFinalized();
    error PrizeFundingFrozen();
    error PrizeNotInitialized();
    error InvalidPrizeState(PrizeState expected, PrizeState actual);
    error CallerFunderMismatch();
    error OperatorUnauthorized();
    error SponsorFundingNonceMismatch();
    error StatusAttemptMismatch();
    error StatusProofNotExpired();
    error AssignmentCursorMismatch();
    error AssignmentComplete();
    error EntitlementAlreadyAssigned();
    error MissingEntitlementAcl();
    error InvalidHistoricalBeneficiary();
    error InvalidAssignmentSlot();

    /// @notice Emitted after adapter-originated realized yield is recorded for one draw.
    /// @param drawId Draw whose realized yield funding was recorded.
    event YieldFundingRecorded(uint256 indexed drawId);

    /// @notice Emitted after explicit sponsor funding is successfully pulled into the reserve.
    /// @param drawId Draw receiving the sponsor funding.
    /// @param funder Token holder who supplied the sponsor funding.
    /// @param fundingNonce Application-level sponsor nonce consumed by the successful pull.
    event SponsorFundingRecorded(
        uint256 indexed drawId,
        address indexed funder,
        uint256 indexed fundingNonce
    );

    /// @notice Emitted when one draw's encrypted funding is frozen into a prize liability.
    /// @param drawId Draw whose prize preparation began.
    /// @param statusAttemptNonce Status-proof attempt nonce bound into the proof context.
    /// @param proofDeadline Inclusive deadline after which status evidence may be refreshed.
    event PrizePreparationStarted(
        uint256 indexed drawId,
        uint256 indexed statusAttemptNonce,
        uint256 proofDeadline
    );

    /// @notice Emitted when expired prize-status evidence is replaced without reopening funding.
    /// @param drawId Draw whose status evidence was refreshed.
    /// @param statusAttemptNonce New monotonic proof-attempt nonce.
    /// @param proofDeadline Inclusive deadline for the refreshed proof request.
    event PrizeStatusRefreshed(
        uint256 indexed drawId,
        uint256 indexed statusAttemptNonce,
        uint256 proofDeadline
    );

    /// @notice Emitted after proof-backed settlement of a draw's encrypted zero-prize predicate.
    /// @param drawId Draw whose prize status was settled.
    /// @param statusAttemptNonce Proof-attempt nonce authenticated by the KMS evidence.
    /// @param zeroPrize Whether the encrypted frozen prize proved to equal zero.
    event PrizeStatusSettled(
        uint256 indexed drawId,
        uint256 indexed statusAttemptNonce,
        bool zeroPrize
    );

    /// @notice Emitted after one fixed permissionless entitlement-assignment chunk.
    /// @param drawId Draw whose immutable historical slots were assigned.
    /// @param start Inclusive assignment cursor at transaction start.
    /// @param end Exclusive assignment cursor after the completed chunk.
    event PrizeAssignmentChunkProcessed(
        uint256 indexed drawId,
        uint256 indexed start,
        uint256 indexed end
    );

    modifier nonReentrant() {
        if (_entered != 0) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(IVeilpotPrizePoolView pool_, IVeilpotYieldAdapterView adapter_) {
        if (address(pool_) == address(0)) revert InvalidPool();
        if (address(adapter_) == address(0)) revert InvalidAdapter();

        IERC7984 token = pool_.confidentialToken();

        if (address(token) == address(0)) revert InvalidToken();

        if (
            address(adapter_.confidentialToken()) != address(token) ||
            adapter_.pool() != address(pool_) ||
            adapter_.reserve() != address(this) ||
            pool_.prizeReserve() != address(this)
        ) {
            revert InvalidBinding();
        }

        pool = pool_;
        adapter = adapter_;
        confidentialToken = token;

        _accountedReserveAssets = FHE.asEuint128(0);
        _outstandingPrizeLiabilities = FHE.asEuint128(0);

        FHE.allowThis(_accountedReserveAssets);
        FHE.allowThis(_outstandingPrizeLiabilities);
    }

    /// @inheritdoc IVeilpotPrizeReserveFunding
    function recordYield(
        uint256 drawId,
        euint64 actualTransferred
    ) external nonReentrant returns (bytes4 acknowledgement) {
        if (msg.sender != address(adapter)) revert OnlyAdapter();

        _requireFinalizedDraw(drawId);

        if (!FHE.isAllowed(actualTransferred, address(this))) {
            revert MissingYieldAcl();
        }

        Prize storage prize = _initializePrize(drawId);

        _requireFundingOpen(prize);

        prize.yieldFunding = FHE.add(prize.yieldFunding, actualTransferred);

        _accountedReserveAssets = FHE.add(
            _accountedReserveAssets,
            FHE.asEuint128(actualTransferred)
        );

        FHE.allowThis(prize.yieldFunding);
        FHE.allowThis(_accountedReserveAssets);

        emit YieldFundingRecorded(drawId);

        return IVeilpotPrizeReserveFunding.recordYield.selector;
    }

    /// @notice Pull explicit sponsor funding for an already-finalized draw.
    /// @dev Raw token sends never enter sponsor accounting.
    /// @param drawId Finalized draw receiving the explicit sponsor funding.
    /// @param encryptedAmount Encrypted requested sponsor amount supplied through the FHE input path.
    /// @param inputProof Proof binding the encrypted sponsor input to the caller and contract.
    /// @param funder Token holder supplying the sponsor funding.
    /// @param fundingNonce Expected application-level sponsor nonce for the funder.
    function fundSponsorForDraw(
        uint256 drawId,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof,
        address funder,
        uint256 fundingNonce
    ) external nonReentrant {
        if (msg.sender != funder) revert CallerFunderMismatch();

        if (fundingNonce != nextSponsorFundingNonce[funder]) {
            revert SponsorFundingNonceMismatch();
        }

        _requireFinalizedDraw(drawId);

        Prize storage prize = _initializePrize(drawId);

        _requireFundingOpen(prize);

        if (!confidentialToken.isOperator(funder, address(this))) {
            revert OperatorUnauthorized();
        }

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);

        FHE.allowTransient(requested, address(confidentialToken));

        euint64 actualTransferred = confidentialToken.confidentialTransferFrom(
            funder,
            address(this),
            requested
        );

        prize.sponsorFunding = FHE.add(prize.sponsorFunding, actualTransferred);

        _accountedReserveAssets = FHE.add(
            _accountedReserveAssets,
            FHE.asEuint128(actualTransferred)
        );

        FHE.allowThis(prize.sponsorFunding);
        FHE.allowThis(_accountedReserveAssets);

        nextSponsorFundingNonce[funder] = fundingNonce + 1;

        emit SponsorFundingRecorded(drawId, funder, fundingNonce);
    }

    /// @notice Freeze realized yield and sponsor funding into one encrypted prize liability.
    /// @param drawId Finalized draw whose reserve funding is being frozen into a prize.
    function preparePrize(uint256 drawId) external nonReentrant {
        (uint256 snapshotId, uint256 participantCount) = _requireFinalizedDraw(drawId);

        uint8 adapterState = adapter.drawYieldHandles(drawId);

        if (adapterState != ADAPTER_FUNDING_FINALIZED) {
            revert AdapterFundingNotFinalized();
        }

        Prize storage prize = _initializePrize(drawId);

        _requireFundingOpen(prize);

        euint64 totalPrize = FHE.add(prize.yieldFunding, prize.sponsorFunding);

        prize.remaining = totalPrize;
        prize.snapshotId = snapshotId;
        prize.participantCount = participantCount;
        prize.assignmentCursor = 0;
        prize.statusAttemptNonce = 1;

        prize.statusProofDeadline = block.timestamp + STATUS_PROOF_TTL_SECONDS;

        prize.statusPredicate = FHE.eq(totalPrize, FHE.asEuint64(0));

        prize.proofContext = FHE.asEuint256(_proofContext(1, drawId, prize.statusAttemptNonce));

        prize.state = PrizeState.STATUS_PROOF_PENDING;

        _outstandingPrizeLiabilities = FHE.add(
            _outstandingPrizeLiabilities,
            FHE.asEuint128(totalPrize)
        );

        FHE.allowThis(prize.remaining);
        FHE.allowThis(prize.statusPredicate);
        FHE.allowThis(prize.proofContext);

        FHE.allowThis(_outstandingPrizeLiabilities);

        FHE.makePubliclyDecryptable(prize.statusPredicate);

        FHE.makePubliclyDecryptable(prize.proofContext);

        emit PrizePreparationStarted(drawId, prize.statusAttemptNonce, prize.statusProofDeadline);
    }

    /// @notice Settle the proof-backed encrypted zero/nonzero prize predicate.
    /// @param drawId Draw whose frozen prize status is being settled.
    /// @param statusAttemptNonce Current proof-attempt nonce bound into the expected proof context.
    /// @param clearZeroPrize Clear boolean returned by the public-decryption proof.
    /// @param decryptionProof KMS proof authenticating the clear status and bound proof context.
    function settlePrizeStatus(
        uint256 drawId,
        uint256 statusAttemptNonce,
        bool clearZeroPrize,
        bytes calldata decryptionProof
    ) external nonReentrant {
        Prize storage prize = _prizeExisting(drawId);

        if (prize.state != PrizeState.STATUS_PROOF_PENDING) {
            revert InvalidPrizeState(PrizeState.STATUS_PROOF_PENDING, prize.state);
        }

        if (statusAttemptNonce != prize.statusAttemptNonce) {
            revert StatusAttemptMismatch();
        }

        bytes32[] memory handles = new bytes32[](2);

        handles[0] = FHE.toBytes32(prize.statusPredicate);

        handles[1] = FHE.toBytes32(prize.proofContext);

        FHE.checkSignatures(
            handles,
            abi.encode(clearZeroPrize, _proofContext(1, drawId, statusAttemptNonce)),
            decryptionProof
        );

        prize.state = clearZeroPrize ? PrizeState.NO_PRIZE : PrizeState.ASSIGNING;

        emit PrizeStatusSettled(drawId, statusAttemptNonce, clearZeroPrize);
    }

    /// @notice Assign the next fixed historical entitlement chunk permissionlessly.
    /// @dev Assignment allocates encrypted liability but never settles reserve accounting.
    /// @param drawId Draw whose nonzero frozen prize is in the ASSIGNING state.
    /// @param expectedCursor Caller-observed cursor used to reject stale or replayed transactions.
    function assignPrizeEntitlementChunk(
        uint256 drawId,
        uint256 expectedCursor
    ) external nonReentrant {
        Prize storage prize = _prizeExisting(drawId);

        if (prize.state != PrizeState.ASSIGNING) {
            revert InvalidPrizeState(PrizeState.ASSIGNING, prize.state);
        }

        uint256 start = prize.assignmentCursor;

        if (expectedCursor != start) revert AssignmentCursorMismatch();

        if (start > prize.participantCount || start == prize.participantCount) {
            revert AssignmentComplete();
        }

        uint256 end = start + ASSIGNMENT_CHUNK_SIZE;

        if (end > prize.participantCount) {
            end = prize.participantCount;
        }

        FHE.allowTransient(prize.remaining, address(pool));

        euint128 assignedTotal = prize.assignedTotal;

        for (uint256 slotIndex = start; slotIndex < end; ++slotIndex) {
            assignedTotal = _assignPrizeEntitlementSlot(drawId, prize, slotIndex, assignedTotal);
        }

        prize.assignedTotal = assignedTotal;
        prize.assignmentCursor = end;

        FHE.allowThis(prize.assignedTotal);

        if (end == prize.participantCount) {
            prize.state = PrizeState.CLAIMABLE;
        }

        emit PrizeAssignmentChunkProcessed(drawId, start, end);
    }

    /// @notice Assign one immutable historical slot and add its encrypted entitlement to the running total.
    /// @dev Persist one immutable historical slot and add its encrypted entitlement to the running total.
    /// @param drawId Draw whose entitlement is being assigned.
    /// @param prize Frozen prize state holding the historical snapshot binding.
    /// @param slotIndex Historical slot being assigned.
    /// @param assignedTotal Encrypted sum accumulated before this slot.
    /// @return nextAssignedTotal Encrypted sum including this slot.
    function _assignPrizeEntitlementSlot(
        uint256 drawId,
        Prize storage prize,
        uint256 slotIndex,
        euint128 assignedTotal
    ) internal returns (euint128 nextAssignedTotal) {
        PrizeEntitlement storage record = _entitlements[drawId][slotIndex];

        if (record.initialized) revert EntitlementAlreadyAssigned();

        (
            address owner,
            uint256 registrationVersion,
            uint256 reservationNonce,
            bool beneficiaryBound
        ) = pool.snapshotBeneficiary(prize.snapshotId, slotIndex);

        euint64 entitlement = FHE.asEuint64(0);

        if (beneficiaryBound) {
            if (owner == address(0)) revert InvalidHistoricalBeneficiary();

            entitlement = pool.derivePrizeEntitlement(drawId, slotIndex, prize.remaining);

            if (!FHE.isAllowed(entitlement, address(this))) {
                revert MissingEntitlementAcl();
            }
        }

        record.initialized = true;
        record.beneficiaryBound = beneficiaryBound;
        record.owner = owner;
        record.registrationVersion = registrationVersion;
        record.reservationNonce = reservationNonce;
        record.amount = entitlement;

        FHE.allowThis(record.amount);

        nextAssignedTotal = FHE.add(assignedTotal, FHE.asEuint128(entitlement));
    }

    /// @notice Refresh expired public status evidence without reopening prize funding.
    /// @param drawId Draw whose expired status-proof request is being refreshed.
    function refreshPrizeStatusEvidence(uint256 drawId) external nonReentrant {
        Prize storage prize = _prizeExisting(drawId);

        if (prize.state != PrizeState.STATUS_PROOF_PENDING) {
            revert InvalidPrizeState(PrizeState.STATUS_PROOF_PENDING, prize.state);
        }

        if (
            block.timestamp < prize.statusProofDeadline ||
            block.timestamp == prize.statusProofDeadline
        ) {
            revert StatusProofNotExpired();
        }

        uint256 attemptNonce = ++prize.statusAttemptNonce;

        prize.statusPredicate = FHE.eq(prize.remaining, FHE.asEuint64(0));

        prize.proofContext = FHE.asEuint256(_proofContext(1, drawId, attemptNonce));

        prize.statusProofDeadline = block.timestamp + STATUS_PROOF_TTL_SECONDS;

        FHE.allowThis(prize.statusPredicate);

        FHE.allowThis(prize.proofContext);

        FHE.makePubliclyDecryptable(prize.statusPredicate);

        FHE.makePubliclyDecryptable(prize.proofContext);

        emit PrizeStatusRefreshed(drawId, attemptNonce, prize.statusProofDeadline);
    }

    /// @notice Return encrypted funding, prize-status handles, and public progress metadata for one draw.
    /// @param drawId Draw whose prize state is requested.
    /// @return state Current public prize lifecycle state.
    /// @return yieldFunding Encrypted realized-yield funding recorded for the draw.
    /// @return sponsorFunding Encrypted explicit sponsor funding recorded for the draw.
    /// @return remaining Encrypted prize liability remaining in the reserve.
    /// @return statusPredicate Encrypted zero-prize predicate for the current status-proof attempt.
    /// @return proofContext Publicly decryptable application-domain proof-context handle.
    /// @return participantCount Frozen participant count copied from the finalized draw.
    /// @return assignmentCursor Public assignment progress cursor.
    /// @return statusAttemptNonce Current monotonic prize-status proof-attempt nonce.
    /// @return statusProofDeadline Inclusive expiry of the current status-proof request.
    function prizeHandles(
        uint256 drawId
    )
        external
        view
        returns (
            PrizeState state,
            euint64 yieldFunding,
            euint64 sponsorFunding,
            euint64 remaining,
            ebool statusPredicate,
            bytes32 proofContext,
            uint256 participantCount,
            uint256 assignmentCursor,
            uint256 statusAttemptNonce,
            uint256 statusProofDeadline
        )
    {
        Prize storage prize = _prizeExisting(drawId);

        return (
            prize.state,
            prize.yieldFunding,
            prize.sponsorFunding,
            prize.remaining,
            prize.statusPredicate,
            FHE.toBytes32(prize.proofContext),
            prize.participantCount,
            prize.assignmentCursor,
            prize.statusAttemptNonce,
            prize.statusProofDeadline
        );
    }

    /// @notice Return one encrypted assignment record with its immutable historical identity.
    /// @param drawId Draw whose historical entitlement record is requested.
    /// @param slotIndex Frozen historical slot index.
    /// @return initialized Whether assignment has persisted this slot.
    /// @return beneficiaryBound Whether the frozen snapshot contains a bound beneficiary.
    /// @return owner Historical beneficiary owner.
    /// @return registrationVersion Historical registration version.
    /// @return reservationNonce Historical reservation nonce.
    /// @return amount Encrypted entitlement assigned to the slot.
    function prizeEntitlementRecord(
        uint256 drawId,
        uint256 slotIndex
    )
        external
        view
        returns (
            bool initialized,
            bool beneficiaryBound,
            address owner,
            uint256 registrationVersion,
            uint256 reservationNonce,
            euint64 amount
        )
    {
        Prize storage prize = _prizeExisting(drawId);

        if (slotIndex > prize.participantCount || slotIndex == prize.participantCount) {
            revert InvalidAssignmentSlot();
        }

        PrizeEntitlement storage record = _entitlements[drawId][slotIndex];

        return (
            record.initialized,
            record.beneficiaryBound,
            record.owner,
            record.registrationVersion,
            record.reservationNonce,
            record.amount
        );
    }

    /// @notice Return the encrypted sum allocated across processed historical slots.
    /// @param drawId Draw whose encrypted assigned-total handle is requested.
    /// @return assignedTotal Encrypted sum of every entitlement persisted so far.
    function prizeAssignmentTotalHandle(
        uint256 drawId
    ) external view returns (euint128 assignedTotal) {
        return _prizeExisting(drawId).assignedTotal;
    }
    /// @notice Return encrypted reserve asset and prize-liability accounting handles.
    /// @return accountedReserveAssets Encrypted assets admitted through approved reserve funding paths.
    /// @return outstandingPrizeLiabilities Encrypted frozen prize obligations not yet settled.
    function reserveAccountingHandles()
        external
        view
        returns (euint128 accountedReserveAssets, euint128 outstandingPrizeLiabilities)
    {
        return (_accountedReserveAssets, _outstandingPrizeLiabilities);
    }

    function _requireFinalizedDraw(
        uint256 drawId
    ) internal view returns (uint256 snapshotId, uint256 participantCount) {
        (
            uint8 state,
            uint256 resolvedSnapshotId,
            ,
            uint256 count,
            uint256 batchId,
            uint8 bucketExponent,
            uint256 winnerCursor
        ) = pool.drawMetadata(drawId);

        if (
            state != POOL_DRAW_FINALIZED ||
            resolvedSnapshotId == 0 ||
            count == 0 ||
            count > MAX_PARTICIPANTS ||
            batchId == 0 ||
            bucketExponent > MAX_DRAW_BUCKET_EXPONENT ||
            winnerCursor != count
        ) {
            revert DrawNotFinalized();
        }

        return (resolvedSnapshotId, count);
    }

    function _initializePrize(uint256 drawId) internal returns (Prize storage prize) {
        prize = _prizes[drawId];

        if (prize.initialized) {
            return prize;
        }

        prize.initialized = true;
        prize.state = PrizeState.UNPREPARED;

        prize.yieldFunding = FHE.asEuint64(0);

        prize.sponsorFunding = FHE.asEuint64(0);

        prize.remaining = FHE.asEuint64(0);

        prize.assignedTotal = FHE.asEuint128(0);

        prize.statusPredicate = FHE.asEbool(false);

        prize.proofContext = FHE.asEuint256(0);

        FHE.allowThis(prize.yieldFunding);

        FHE.allowThis(prize.sponsorFunding);

        FHE.allowThis(prize.remaining);

        FHE.allowThis(prize.assignedTotal);

        FHE.allowThis(prize.statusPredicate);

        FHE.allowThis(prize.proofContext);
    }

    function _prizeExisting(uint256 drawId) internal view returns (Prize storage prize) {
        prize = _prizes[drawId];

        if (!prize.initialized) {
            revert PrizeNotInitialized();
        }
    }

    function _requireFundingOpen(Prize storage prize) internal view {
        if (prize.state != PrizeState.UNPREPARED) {
            revert PrizeFundingFrozen();
        }
    }

    function _proofContext(
        uint8 stage,
        uint256 drawId,
        uint256 attemptNonce
    ) internal view returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encode(
                        bytes32("VEILPOT_PRIZE_PROOF_V1"),
                        block.chainid,
                        address(this),
                        address(pool),
                        address(adapter),
                        stage,
                        drawId,
                        attemptNonce
                    )
                )
            );
    }
}
