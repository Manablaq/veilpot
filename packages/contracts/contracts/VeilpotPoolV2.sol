// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {
    FHE,
    ebool,
    euint8,
    euint64,
    euint128,
    euint256,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {VeilDrawEngineV2} from "./VeilDrawEngineV2.sol";
import {IVeilpotYieldAdapterV2} from "./interfaces/IVeilpotYieldAdapterV2.sol";

/* solhint-disable use-natspec, gas-struct-packing, immutable-vars-naming, gas-indexed-events,
   gas-strict-inequalities, function-max-lines, gas-increment-by-one */

/// @title VeilpotPoolV2
/// @notice Veilpot production pool for confidential principal, TWAB snapshots, and VeilDraw selection.
/// @dev Prize reserve, yield recognition, and claims remain intentionally out of scope at Gate 1B.3.
contract VeilpotPoolV2 is ZamaEthereumConfig {
    uint256 public constant MAX_PARTICIPANTS = 128;
    uint256 public constant REGISTRATION_RESERVATION_TTL_SECONDS = 86_400;
    uint256 public constant REGISTRATION_ACTIVATION_PROOF_TTL_SECONDS = 86_400;
    uint256 public constant REGISTRATION_BOND_WEI = 1_000_000_000_000_000;
    uint64 public constant MIN_REGISTRATION_DEPOSIT_BASE_UNITS = 1_000_000;
    uint64 public constant MAX_USER_PRINCIPAL_BASE_UNITS = 1_000_000_000_000;
    uint256 public constant SUPPORTED_REGISTRATION_VERSION = 1;
    uint256 public constant MAX_DRAW_DURATION_SECONDS = 2_592_000;
    uint256 public constant SNAPSHOT_CHUNK_SIZE = 8;
    uint8 public constant DRAW_BATCH_SIZE = 8;
    uint256 public constant WINNER_CHUNK_SIZE = 8;
    uint8 public constant MAX_DRAW_BUCKET_EXPONENT = 69;
    uint128 public constant MAX_DRAW_TOTAL = uint128(1) << MAX_DRAW_BUCKET_EXPONENT;

    enum ParticipantState {
        FREE,
        RESERVED,
        PENDING_ACTIVATION,
        ACTIVE,
        PENDING_REFUND,
        REFUND_ATTEMPT_PENDING_PROOF,
        TOMBSTONED
    }

    enum DrawState {
        NO_DRAW,
        BUCKET_DISCOVERY,
        BUCKET_READY,
        AWAITING_CANDIDATE_BATCH,
        BATCH_REDUCTION_PENDING,
        BATCH_PROOF_PENDING,
        CANDIDATE_ACCEPTED,
        WINNER_RESOLUTION,
        FINALIZED,
        NO_WEIGHT_TERMINAL,
        UNSUPPORTED_TOTAL
    }

    struct Participant {
        ParticipantState state;
        address owner;
        uint256 registrationVersion;
        uint256 reservationNonce;
        uint256 reservationExpiry;
        uint256 activationStartedAt;
        uint256 activationDeadline;
        uint256 refundAttemptNonce;
        bool bondHeld;
        euint64 pendingAmount;
        ebool thresholdSatisfied;
        euint64 principal;
        ebool deregistrationZero;
        euint64 refundRemaining;
        ebool refundComplete;
        euint128 twabAccumulator;
        euint128 pendingSnapshotWeight;
        uint256 lastTwabTimestamp;
        uint256 twabEpoch;
        uint256 pendingSnapshotEpoch;
        bool snapshotSealed;
    }

    struct HistoricalBeneficiary {
        address owner;
        uint256 registrationVersion;
        uint256 reservationNonce;
        bool bound;
    }

    struct Draw {
        DrawState state;
        uint256 snapshotId;
        uint256 snapshotEpoch;
        uint256 participantCount;
        uint256 batchId;
        uint256 winnerCursor;
        uint8 bucketExponent;
        bool bucketEvidencePrepared;
        euint128 total;
        euint8 encryptedBucketExponent;
        ebool encryptedTotalIsZero;
        ebool encryptedTotalIsSupported;
        euint256 bucketProofContext;
        euint256 batchProofContext;
        euint128[8] candidates;
        ebool[8] candidateValid;
        euint128 batchTarget;
        ebool batchSuccess;
        euint128 acceptedTarget;
        euint128 runningPrefix;
        euint128 winnerCount;
    }

    IERC7984 public immutable confidentialToken;
    address public immutable prizeReserve;
    address private immutable _autopilotVault;

    /// @notice Dedicated non-custodial confidential draw engine.
    /// @dev Created by this Pool so Engine.pool is permanently address(this).
    VeilDrawEngineV2 public immutable veilDrawEngine;

    /// @notice Immutable approved V2 yield adapter; no caller-selected ACL recipient.
    IVeilpotYieldAdapterV2 private immutable _yieldAdapterV2;

    Participant[128] private _participants;
    mapping(address => uint256) private _participantIndexPlusOne;
    mapping(address => uint256) public nextDepositNonce;
    mapping(address => uint256) public nextWithdrawNonce;
    mapping(address => uint256) public pendingBondRefund;
    uint256 public nextReservationNonce;
    uint256 public activeParticipantCount;
    euint128 private _aggregatePrincipal;
    euint128 private _aggregatePending;
    euint128 private _canonicalReceived;
    uint256 public activeEpochId;
    uint256 public activeEpochStart;
    uint256 public activeEpochEnd;
    uint256 public nextSnapshotId;
    uint256 public currentSnapshotId;
    uint256 public snapshotCutoffTimestamp;
    uint256 public snapshotParticipantCount;
    uint256 public snapshotCursor;
    bool public snapshotInProgress;
    bool public snapshotReady;
    mapping(uint256 => mapping(uint256 => bool)) private _snapshotEligible;
    mapping(uint256 => mapping(uint256 => bool)) private _snapshotLocked;
    mapping(uint256 => mapping(uint256 => bool)) private _snapshotProcessed;
    mapping(uint256 => mapping(uint256 => euint128)) private _snapshotWeights;
    mapping(uint256 => euint128) private _snapshotTotals;
    mapping(uint256 => uint256) private _snapshotCutoffs;
    mapping(uint256 => uint256) private _snapshotBounds;
    mapping(uint256 => bool) private _snapshotFinalized;
    mapping(uint256 => mapping(uint256 => HistoricalBeneficiary)) private _epochBeneficiaries;
    mapping(uint256 => mapping(uint256 => euint128)) private _epochSnapshotWeights;
    mapping(uint256 => mapping(uint256 => bool)) private _epochSnapshotWeightBound;
    mapping(uint256 => uint256) private _epochParticipantBounds;
    mapping(uint256 => uint256) private _snapshotEpochs;
    uint256[128] private _slotReusableAfter;
    uint256 public nextDrawId;
    uint256 public nextDrawSnapshotId = 1;
    mapping(uint256 => uint256) public snapshotDrawId;

    /// @notice Exact V2 child draw ID for one snapshot/prize slot.
    mapping(uint256 => mapping(uint256 => uint256)) public snapshotPrizeDrawId;
    mapping(uint256 => Draw) private _draws;
    mapping(uint256 => mapping(uint256 => ebool)) private _drawWinnerPredicates;
    uint256 private _entered;

    error InvalidToken();
    error InvalidPrizeReserve();
    error OnlyPrizeReserve();
    error MissingPrizeAcl();
    error MissingEngineAcl();
    error InvalidYieldAdapter();
    error InvalidBond();
    error AlreadyRegistered();
    error CapacityFull();
    error InvalidParticipant();
    error InvalidState(ParticipantState expected, ParticipantState actual);
    error ReservationExpired();
    error ReservationNotExpired();
    error CallerDepositorMismatch();
    error PoolDomainMismatch();
    error RegistrationVersionMismatch();
    error ReservationNonceMismatch();
    error DepositNonceMismatch();
    error OperatorUnauthorized();
    error ActivationProofExpired();
    error ActivationProofNotExpired();
    error RefundProofMismatch();
    error RefundAttemptPending();
    error Reentrancy();
    error InvalidRecipient();
    error DeregistrationNotActive();
    error WithdrawalNotActive();
    error WithdrawalNonceMismatch();
    error DrawDurationExceeded();
    error SnapshotInProgress();
    error SnapshotNotInProgress();
    error SnapshotCursorMismatch();
    error SnapshotIncomplete();
    error HistoricalBeneficiaryMismatch();
    error SnapshotNotReadyForDraw();
    error SnapshotAlreadyDrawn();
    error InvalidDraw();
    error DrawSnapshotMismatch();
    error InvalidDrawState(DrawState expected, DrawState actual);
    error DrawEvidenceNotPrepared();
    error DrawEvidenceAlreadyPrepared();
    error DrawBatchMismatch();
    error InvalidDrawBucketEvidence();
    error InvalidDrawIndex();
    error DrawWinnerIncomplete();
    error DrawWinnerComplete();

    event ParticipantReserved(
        address indexed participant,
        uint256 indexed slot,
        uint256 reservationNonce,
        uint256 expiry,
        uint256 registrationVersion
    );
    event DepositPending(
        address indexed participant,
        uint256 indexed slot,
        uint256 reservationNonce,
        uint256 depositNonce,
        uint256 activationDeadline
    );
    event ParticipantStateChanged(
        address indexed participant,
        uint256 indexed slot,
        ParticipantState state
    );
    event BondRefundCredited(address indexed participant, uint256 amount);
    event BondWithdrawn(address indexed participant, uint256 amount);
    event RefundAttemptStarted(
        address indexed participant,
        uint256 indexed slot,
        uint256 refundAttemptNonce
    );
    event SnapshotStarted(
        uint256 indexed snapshotId,
        uint256 cutoffTimestamp,
        uint256 participantCount
    );
    event SnapshotChunkProcessed(uint256 indexed snapshotId, uint256 start, uint256 end);
    event SnapshotReady(
        uint256 indexed snapshotId,
        uint256 cutoffTimestamp,
        uint256 participantCount
    );
    event WithdrawalProcessed(address indexed participant, uint256 indexed withdrawalNonce);
    event DrawStarted(
        uint256 indexed drawId,
        uint256 indexed snapshotId,
        uint256 indexed snapshotEpoch,
        uint256 participantCount
    );
    event DrawBucketResolved(
        uint256 indexed drawId,
        uint256 indexed snapshotId,
        uint8 bucketExponent,
        DrawState state
    );
    event DrawBatchGenerated(
        uint256 indexed drawId,
        uint256 indexed snapshotId,
        uint256 indexed batchId
    );
    event DrawBatchResolved(
        uint256 indexed drawId,
        uint256 indexed snapshotId,
        uint256 indexed batchId,
        bool success
    );
    event DrawWinnerChunkProcessed(
        uint256 indexed drawId,
        uint256 indexed snapshotId,
        uint256 start,
        uint256 end
    );
    event DrawFinalized(uint256 indexed drawId, uint256 indexed snapshotId);

    modifier nonReentrant() {
        if (_entered != 0) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(
        IERC7984 token,
        address prizeReserve_,
        address autopilotVault_,
        address yieldAdapterV2_
    ) {
        if (address(token) == address(0)) revert InvalidToken();
        if (prizeReserve_ == address(0)) revert InvalidPrizeReserve();
        if (autopilotVault_ == address(0)) revert InvalidRecipient();
        if (yieldAdapterV2_ == address(0)) revert InvalidYieldAdapter();

        confidentialToken = token;
        prizeReserve = prizeReserve_;
        _autopilotVault = autopilotVault_;
        _yieldAdapterV2 = IVeilpotYieldAdapterV2(yieldAdapterV2_);

        // Separate contract, immutable Pool binding, no mutable post-deploy setter.
        veilDrawEngine = new VeilDrawEngineV2(address(this));

        _aggregatePrincipal = FHE.asEuint128(0);
        _aggregatePending = FHE.asEuint128(0);
        _canonicalReceived = FHE.asEuint128(0);
        activeEpochStart = block.timestamp;
        activeEpochEnd = block.timestamp + MAX_DRAW_DURATION_SECONDS;
        FHE.allowThis(_aggregatePrincipal);
        FHE.allowThis(_aggregatePending);
        FHE.allowThis(_canonicalReceived);
    }

    /// @notice Reserve one bounded participant slot before any confidential token movement.
    function reserveParticipantSlot() external payable nonReentrant returns (uint256 slotIndex) {
        if (msg.value != REGISTRATION_BOND_WEI) revert InvalidBond();
        uint256 existing = _participantIndexPlusOne[msg.sender];
        if (existing != 0) {
            ParticipantState current = _participants[existing - 1].state;
            if (current != ParticipantState.FREE && current != ParticipantState.TOMBSTONED) {
                revert AlreadyRegistered();
            }
        }

        for (uint256 index = 0; index < MAX_PARTICIPANTS; ++index) {
            Participant storage candidate = _participants[index];
            if (snapshotInProgress && _snapshotLocked[currentSnapshotId][index]) continue;
            if (block.timestamp <= _slotReusableAfter[index]) continue;
            if (
                candidate.state != ParticipantState.FREE &&
                candidate.state != ParticipantState.TOMBSTONED
            ) continue;
            slotIndex = index;
            uint256 nonce = ++nextReservationNonce;
            candidate.state = ParticipantState.RESERVED;
            candidate.owner = msg.sender;
            candidate.registrationVersion = SUPPORTED_REGISTRATION_VERSION;
            candidate.reservationNonce = nonce;
            candidate.reservationExpiry = block.timestamp + REGISTRATION_RESERVATION_TTL_SECONDS;
            candidate.activationStartedAt = 0;
            candidate.activationDeadline = 0;
            candidate.refundAttemptNonce = 0;
            candidate.bondHeld = true;
            candidate.pendingAmount = FHE.asEuint64(0);
            candidate.thresholdSatisfied = FHE.asEbool(false);
            candidate.principal = FHE.asEuint64(0);
            candidate.deregistrationZero = FHE.asEbool(false);
            candidate.refundRemaining = FHE.asEuint64(0);
            candidate.refundComplete = FHE.asEbool(false);
            candidate.twabAccumulator = FHE.asEuint128(0);
            candidate.pendingSnapshotWeight = FHE.asEuint128(0);
            candidate.lastTwabTimestamp = block.timestamp;
            candidate.twabEpoch = activeEpochId;
            candidate.pendingSnapshotEpoch = 0;
            candidate.snapshotSealed = false;
            FHE.allowThis(candidate.pendingAmount);
            FHE.allowThis(candidate.thresholdSatisfied);
            FHE.allowThis(candidate.principal);
            FHE.allowThis(candidate.deregistrationZero);
            FHE.allowThis(candidate.refundRemaining);
            FHE.allowThis(candidate.refundComplete);
            FHE.allowThis(candidate.twabAccumulator);
            FHE.allowThis(candidate.pendingSnapshotWeight);
            _participantIndexPlusOne[msg.sender] = index + 1;
            emit ParticipantReserved(
                msg.sender,
                index,
                nonce,
                candidate.reservationExpiry,
                SUPPORTED_REGISTRATION_VERSION
            );
            return slotIndex;
        }
        revert CapacityFull();
    }

    /// @notice Return a reservation bond using pull accounting so recipient fallback cannot block progress.
    function withdrawBond() external nonReentrant {
        uint256 amount = pendingBondRefund[msg.sender];
        if (amount == 0) revert InvalidBond();
        pendingBondRefund[msg.sender] = 0;
        (bool sent, ) = msg.sender.call{value: amount}("");
        if (!sent) {
            pendingBondRefund[msg.sender] = amount;
            revert InvalidRecipient();
        }
        emit BondWithdrawn(msg.sender, amount);
    }

    /// @notice Expire an unused reservation after its inclusive deadline.
    function expireReservation(uint256 slotIndex) external nonReentrant {
        Participant storage participant = _participant(slotIndex);
        if (participant.state != ParticipantState.RESERVED) {
            revert InvalidState(ParticipantState.RESERVED, participant.state);
        }
        if (block.timestamp <= participant.reservationExpiry) revert ReservationNotExpired();
        address owner = participant.owner;
        _releaseBond(participant, owner);
        _clearParticipant(slotIndex, owner, ParticipantState.FREE);
    }

    /// @notice Canonical direct-user ERC-7984 pull deposit; no receiver callback is used.
    function deposit(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof,
        address depositor,
        address claimedPool,
        uint256 claimedVersion,
        uint256 reservationNonce,
        uint256 depositNonce
    ) external nonReentrant {
        if (msg.sender != depositor) revert CallerDepositorMismatch();
        if (claimedPool != address(this)) revert PoolDomainMismatch();
        if (claimedVersion != SUPPORTED_REGISTRATION_VERSION) revert RegistrationVersionMismatch();
        uint256 slotIndex = _participantIndexPlusOne[depositor];
        if (slotIndex == 0) revert InvalidParticipant();
        Participant storage participant = _participants[slotIndex - 1];
        if (participant.state != ParticipantState.RESERVED) {
            revert InvalidState(ParticipantState.RESERVED, participant.state);
        }
        if (block.timestamp > participant.reservationExpiry) revert ReservationExpired();
        if (reservationNonce != participant.reservationNonce) revert ReservationNonceMismatch();
        if (depositNonce != nextDepositNonce[depositor]) revert DepositNonceMismatch();
        if (!confidentialToken.isOperator(depositor, address(this))) revert OperatorUnauthorized();

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        // The pinned ERC-7984 euint64 overload checks the caller (this pool) for ACL access.
        // The token address also receives the transient grant required by the canonical design.
        FHE.allowTransient(requested, address(this));
        FHE.allowTransient(requested, address(confidentialToken));
        euint64 actualTransferred = confidentialToken.confidentialTransferFrom(
            depositor,
            address(this),
            requested
        );
        FHE.allowThis(actualTransferred);

        nextDepositNonce[depositor] = depositNonce + 1;
        _aggregatePending = FHE.add(_aggregatePending, FHE.asEuint128(actualTransferred));
        _canonicalReceived = FHE.add(_canonicalReceived, FHE.asEuint128(actualTransferred));
        FHE.allowThis(_aggregatePending);
        FHE.allowThis(_canonicalReceived);
        participant.pendingAmount = actualTransferred;
        participant.activationStartedAt = block.timestamp;
        participant.activationDeadline =
            block.timestamp + REGISTRATION_ACTIVATION_PROOF_TTL_SECONDS;
        // The public predicate intentionally combines the minimum and maximum
        // registration envelope.  Over-cap deposits are refundable and cannot
        // become ACTIVE principal, while the exact amount remains encrypted.
        ebool meetsMinimum = FHE.ge(actualTransferred, MIN_REGISTRATION_DEPOSIT_BASE_UNITS);
        ebool withinMaximum = FHE.le(actualTransferred, MAX_USER_PRINCIPAL_BASE_UNITS);
        participant.thresholdSatisfied = FHE.and(meetsMinimum, withinMaximum);
        FHE.allowThis(participant.pendingAmount);
        FHE.allowThis(participant.thresholdSatisfied);
        FHE.makePubliclyDecryptable(participant.thresholdSatisfied);
        participant.state = ParticipantState.PENDING_ACTIVATION;
        emit DepositPending(
            depositor,
            slotIndex - 1,
            participant.reservationNonce,
            depositNonce,
            participant.activationDeadline
        );
        emit ParticipantStateChanged(depositor, slotIndex - 1, ParticipantState.PENDING_ACTIVATION);
    }

    /// @notice Settle the encrypted threshold result with a bound KMS public-decryption proof.
    function settleThreshold(
        uint256 slotIndex,
        uint256 registrationVersion,
        uint256 reservationNonce,
        bool clearSatisfied,
        bytes calldata decryptionProof
    ) external nonReentrant {
        Participant storage participant = _participant(slotIndex);
        if (participant.state != ParticipantState.PENDING_ACTIVATION) {
            revert InvalidState(ParticipantState.PENDING_ACTIVATION, participant.state);
        }
        _validateRegistration(participant, registrationVersion, reservationNonce);
        if (block.timestamp > participant.activationDeadline) revert ActivationProofExpired();
        _checkBooleanProof(participant.thresholdSatisfied, clearSatisfied, decryptionProof);

        address owner = participant.owner;
        participant.bondHeld = false;
        _creditBond(owner, REGISTRATION_BOND_WEI);
        if (clearSatisfied) {
            euint128 pending128 = FHE.asEuint128(participant.pendingAmount);
            _aggregatePending = FHE.sub(_aggregatePending, pending128);
            FHE.allowThis(_aggregatePending);
            _creditPrincipal(participant, participant.pendingAmount, pending128);
            participant.pendingAmount = FHE.asEuint64(0);
            FHE.allowThis(participant.pendingAmount);
            participant.twabAccumulator = FHE.asEuint128(0);
            participant.pendingSnapshotWeight = FHE.asEuint128(0);
            participant.lastTwabTimestamp = block.timestamp;
            // Clock A: if snapshot N is late, epoch N+1 still begins at N's
            // immutable cutoff. A post-cutoff activation therefore starts in
            // the logical next epoch even before startSnapshot() advances the
            // public activeEpochId.
            if (!snapshotInProgress && block.timestamp > activeEpochEnd) {
                if (block.timestamp > activeEpochEnd + MAX_DRAW_DURATION_SECONDS) {
                    revert DrawDurationExceeded();
                }
                participant.twabEpoch = activeEpochId + 1;
            } else {
                participant.twabEpoch = activeEpochId;
            }
            participant.pendingSnapshotEpoch = 0;
            participant.snapshotSealed = false;
            FHE.allowThis(participant.twabAccumulator);
            FHE.allowThis(participant.pendingSnapshotWeight);
            participant.state = ParticipantState.ACTIVE;
            ++activeParticipantCount;
            emit ParticipantStateChanged(owner, slotIndex, ParticipantState.ACTIVE);
        } else {
            participant.refundRemaining = participant.pendingAmount;
            FHE.allowThis(participant.refundRemaining);
            participant.state = ParticipantState.PENDING_REFUND;
            emit ParticipantStateChanged(owner, slotIndex, ParticipantState.PENDING_REFUND);
        }
    }

    /// @notice Timeout a pending activation after the strict deadline without learning its threshold.
    function expirePendingActivation(uint256 slotIndex) external nonReentrant {
        Participant storage participant = _participant(slotIndex);
        if (participant.state != ParticipantState.PENDING_ACTIVATION) {
            revert InvalidState(ParticipantState.PENDING_ACTIVATION, participant.state);
        }
        if (block.timestamp <= participant.activationDeadline) revert ActivationProofNotExpired();
        address owner = participant.owner;
        participant.bondHeld = false;
        _creditBond(owner, REGISTRATION_BOND_WEI);
        participant.refundRemaining = participant.pendingAmount;
        FHE.allowThis(participant.refundRemaining);
        participant.state = ParticipantState.PENDING_REFUND;
        emit ParticipantStateChanged(owner, slotIndex, ParticipantState.PENDING_REFUND);
    }

    /// @notice Attempt one fixed-recipient refund; completion proof must settle the returned residual.
    function refundAttempt(uint256 slotIndex) external nonReentrant {
        Participant storage participant = _participant(slotIndex);
        if (participant.state != ParticipantState.PENDING_REFUND) {
            if (participant.state == ParticipantState.REFUND_ATTEMPT_PENDING_PROOF)
                revert RefundAttemptPending();
            revert InvalidState(ParticipantState.PENDING_REFUND, participant.state);
        }
        address owner = participant.owner;
        if (owner == address(0)) revert InvalidParticipant();
        euint64 requestedRefund = participant.refundRemaining;
        FHE.allowThis(requestedRefund);
        FHE.allowTransient(requestedRefund, address(confidentialToken));
        euint64 actualRefunded = confidentialToken.confidentialTransfer(owner, requestedRefund);
        FHE.allowThis(actualRefunded);
        _aggregatePending = FHE.sub(_aggregatePending, FHE.asEuint128(actualRefunded));
        FHE.allowThis(_aggregatePending);
        euint64 newRemaining = FHE.sub(requestedRefund, actualRefunded);
        ebool complete = FHE.eq(newRemaining, FHE.asEuint64(0));
        FHE.allowThis(newRemaining);
        FHE.allowThis(complete);
        FHE.makePubliclyDecryptable(complete);
        participant.refundRemaining = newRemaining;
        participant.refundComplete = complete;
        participant.refundAttemptNonce += 1;
        participant.state = ParticipantState.REFUND_ATTEMPT_PENDING_PROOF;
        emit RefundAttemptStarted(owner, slotIndex, participant.refundAttemptNonce);
        emit ParticipantStateChanged(
            owner,
            slotIndex,
            ParticipantState.REFUND_ATTEMPT_PENDING_PROOF
        );
    }

    /// @notice Withdraw confidential principal to the calling participant.
    /// @dev Withdrawal replay binding is address-scoped and survives slot reuse.
    function withdraw(
        externalEuint64 encryptedRequestedAmount,
        bytes calldata inputProof,
        uint256 registrationVersion,
        uint256 reservationNonce,
        uint256 withdrawalNonce
    ) external nonReentrant {
        uint256 slotIndexPlusOne = _participantIndexPlusOne[msg.sender];
        if (slotIndexPlusOne == 0) revert InvalidParticipant();
        Participant storage participant = _participants[slotIndexPlusOne - 1];
        if (participant.state != ParticipantState.ACTIVE) revert WithdrawalNotActive();
        _validateRegistration(participant, registrationVersion, reservationNonce);
        if (withdrawalNonce != nextWithdrawNonce[msg.sender]) revert WithdrawalNonceMismatch();

        euint64 requested = FHE.fromExternal(encryptedRequestedAmount, inputProof);
        euint64 eligibleRequest = FHE.min(requested, participant.principal);
        FHE.allowThis(eligibleRequest);
        FHE.allowTransient(eligibleRequest, address(confidentialToken));

        // Checkpoint with the old principal before any principal mutation.
        _checkpointParticipant(slotIndexPlusOne - 1, participant);
        euint64 actualWithdrawn = confidentialToken.confidentialTransfer(
            msg.sender,
            eligibleRequest
        );
        FHE.allowThis(actualWithdrawn);

        participant.principal = FHE.sub(participant.principal, actualWithdrawn);
        FHE.allowThis(participant.principal);
        _aggregatePrincipal = FHE.sub(_aggregatePrincipal, FHE.asEuint128(actualWithdrawn));
        FHE.allowThis(_aggregatePrincipal);
        participant.deregistrationZero = FHE.eq(participant.principal, FHE.asEuint64(0));
        FHE.allowThis(participant.deregistrationZero);
        FHE.makePubliclyDecryptable(participant.deregistrationZero);
        nextWithdrawNonce[msg.sender] = withdrawalNonce + 1;
        emit WithdrawalProcessed(msg.sender, withdrawalNonce);
    }

    /// @notice Pull one Vault-authorized confidential contribution into an active participant.
    /// @dev The immutable Vault owns schedule/replay policy. The Pool enforces participant identity,
    ///      encrypted capacity, old-principal TWAB checkpointing, and actual-transfer accounting.
    function pullAutopilotContribution(
        uint256 slotIndex,
        uint256 reservationNonce,
        euint64 authorizedAmount
    ) external nonReentrant returns (euint64 actualTransferred) {
        if (msg.sender != _autopilotVault) revert OperatorUnauthorized();

        Participant storage participant = _participant(slotIndex);

        if (participant.state != ParticipantState.ACTIVE) {
            revert WithdrawalNotActive();
        }

        if (reservationNonce != participant.reservationNonce) {
            revert ReservationNonceMismatch();
        }

        _checkpointParticipant(slotIndex, participant);

        euint64 capacity = FHE.sub(
            FHE.asEuint64(MAX_USER_PRINCIPAL_BASE_UNITS),
            participant.principal
        );

        euint64 eligible = FHE.min(authorizedAmount, capacity);

        FHE.allowTransient(eligible, address(confidentialToken));

        actualTransferred = confidentialToken.confidentialTransferFrom(
            msg.sender,
            address(this),
            eligible
        );

        euint128 actualTransferred128 = FHE.asEuint128(actualTransferred);

        _creditPrincipal(participant, actualTransferred, actualTransferred128);

        _canonicalReceived = FHE.add(_canonicalReceived, actualTransferred128);

        FHE.allowThis(_canonicalReceived);
    }

    /// @notice Start one immutable raw-TWAB snapshot at the configured epoch boundary.
    function startSnapshot() external nonReentrant {
        if (snapshotInProgress) revert SnapshotInProgress();
        // The cutoff is the configured epoch end; the permissionless invocation may be late.
        if (block.timestamp < activeEpochEnd) revert DrawDurationExceeded();

        uint256 snapshotId = ++nextSnapshotId;
        currentSnapshotId = snapshotId;
        snapshotCutoffTimestamp = activeEpochEnd;
        _snapshotEpochs[snapshotId] = activeEpochId;
        uint256 liveBound = _highestOccupiedSlotPlusOne();
        uint256 historicalBound = _epochParticipantBounds[activeEpochId];
        snapshotParticipantCount = liveBound > historicalBound ? liveBound : historicalBound;
        snapshotCursor = 0;
        snapshotInProgress = true;
        snapshotReady = false;
        _snapshotTotals[snapshotId] = FHE.asEuint128(0);
        _snapshotCutoffs[snapshotId] = snapshotCutoffTimestamp;
        _snapshotBounds[snapshotId] = snapshotParticipantCount;
        FHE.allowThis(_snapshotTotals[snapshotId]);
        activeEpochId += 1;
        activeEpochStart = snapshotCutoffTimestamp;
        activeEpochEnd = activeEpochStart + MAX_DRAW_DURATION_SECONDS;
        emit SnapshotStarted(snapshotId, snapshotCutoffTimestamp, snapshotParticipantCount);
    }

    /// @notice Process the next bounded participant snapshot chunk permissionlessly.
    function processSnapshotChunk() external nonReentrant {
        if (!snapshotInProgress || snapshotReady) revert SnapshotNotInProgress();
        uint256 start = snapshotCursor;
        if (start >= snapshotParticipantCount) revert SnapshotIncomplete();
        uint256 end = start + SNAPSHOT_CHUNK_SIZE;
        if (end > snapshotParticipantCount) end = snapshotParticipantCount;
        uint256 snapshotId = currentSnapshotId;
        uint256 closingEpochId = _snapshotEpochs[snapshotId];
        for (uint256 index = start; index < end; ++index) {
            if (_snapshotProcessed[snapshotId][index]) revert SnapshotCursorMismatch();
            Participant storage participant = _participants[index];
            euint128 weight = FHE.asEuint128(0);
            bool preSealed = _epochSnapshotWeightBound[closingEpochId][index];
            bool eligible =
                preSealed ||
                    _snapshotLocked[snapshotId][index] ||
                    (participant.state == ParticipantState.ACTIVE &&
                        participant.activationStartedAt <= snapshotCutoffTimestamp &&
                        (participant.twabEpoch == closingEpochId ||
                            (participant.snapshotSealed &&
                                participant.pendingSnapshotEpoch == closingEpochId)));
            _snapshotEligible[snapshotId][index] = eligible;
            if (eligible) {
                if (!preSealed) {
                    _sealParticipantForSnapshot(index, participant, closingEpochId);
                }
                weight = _epochSnapshotWeights[closingEpochId][index];
            }
            _snapshotWeights[snapshotId][index] = weight;
            FHE.allowThis(_snapshotWeights[snapshotId][index]);
            _snapshotTotals[snapshotId] = FHE.add(_snapshotTotals[snapshotId], weight);
            FHE.allowThis(_snapshotTotals[snapshotId]);
            _snapshotProcessed[snapshotId][index] = true;
        }
        snapshotCursor = end;
        emit SnapshotChunkProcessed(snapshotId, start, end);
    }

    /// @notice Mark an immutable snapshot ready once every bound slot was processed.
    function finalizeSnapshot() external nonReentrant {
        if (!snapshotInProgress || snapshotReady) revert SnapshotNotInProgress();
        if (snapshotCursor != snapshotParticipantCount) revert SnapshotIncomplete();
        snapshotInProgress = false;
        snapshotReady = true;
        _snapshotFinalized[currentSnapshotId] = true;
        emit SnapshotReady(currentSnapshotId, snapshotCutoffTimestamp, snapshotParticipantCount);
    }

    // ---------------------------------------------------------------------
    // Veilpot V2: finalized Pool snapshot -> non-custodial VeilDraw Engine
    // ---------------------------------------------------------------------

    /// @notice Begin copying one already-finalized Pool snapshot into the
    /// Engine. Engine availability cannot block Pool snapshot finalization.
    function beginDrawSnapshotImport(uint256 snapshotId) external nonReentrant {
        if (snapshotId == 0 || snapshotId > nextSnapshotId || !_snapshotFinalized[snapshotId]) {
            revert SnapshotNotReadyForDraw();
        }

        veilDrawEngine.beginSnapshotImport(snapshotId, _snapshotBounds[snapshotId]);
    }

    /// @notice Copy the next fixed eight-seat immutable snapshot chunk.
    /// @dev Pool -> Engine ciphertext access is transaction-scoped only.
    function processDrawSnapshotImportChunk(uint256 snapshotId) external nonReentrant {
        if (snapshotId == 0 || snapshotId > nextSnapshotId || !_snapshotFinalized[snapshotId]) {
            revert SnapshotNotReadyForDraw();
        }

        uint256 participantCount;
        uint256 cursor;
        bool initialized;
        bool isSealed;

        (participantCount, cursor, initialized, isSealed) = veilDrawEngine.snapshotMetadata(
            snapshotId
        );

        if (
            !initialized ||
            isSealed ||
            participantCount != _snapshotBounds[snapshotId] ||
            cursor >= participantCount
        ) {
            revert SnapshotIncomplete();
        }

        euint128[8] memory weights;

        uint256 end = cursor + SNAPSHOT_CHUNK_SIZE;

        if (end > participantCount) {
            end = participantCount;
        }

        for (uint256 offset = 0; offset < SNAPSHOT_CHUNK_SIZE; ++offset) {
            uint256 slotIndex = cursor + offset;

            if (slotIndex < end) {
                euint128 weight = _snapshotWeights[snapshotId][slotIndex];

                FHE.allowTransient(weight, address(veilDrawEngine));

                weights[offset] = weight;
            } else {
                weights[offset] = FHE.asEuint128(0);
            }
        }

        veilDrawEngine.importSnapshotChunk(snapshotId, cursor, weights);
    }

    /// @notice Seal the Engine copy once every real Pool slot has been copied.
    function finalizeDrawSnapshotImport(uint256 snapshotId) external nonReentrant {
        if (snapshotId == 0 || snapshotId > nextSnapshotId || !_snapshotFinalized[snapshotId]) {
            revert SnapshotNotReadyForDraw();
        }

        veilDrawEngine.sealSnapshotImport(snapshotId);
    }

    function drawSnapshotImportMetadata(
        uint256 snapshotId
    )
        external
        view
        returns (uint256 participantCount, uint256 cursor, bool initialized, bool isSealed)
    {
        return veilDrawEngine.snapshotMetadata(snapshotId);
    }

    /// @notice Consume exactly the next finalized+Engine-sealed snapshot.
    /// @dev Preserves the old no-argument startDraw ABI while allocating all
    /// three V2 child draws atomically. The return value remains prize slot 0.
    function startDraw() external nonReentrant returns (uint256 drawId) {
        uint256 snapshotId = nextDrawSnapshotId;

        if (snapshotId == 0 || snapshotId > nextSnapshotId || !_snapshotFinalized[snapshotId]) {
            revert SnapshotNotReadyForDraw();
        }

        if (snapshotDrawId[snapshotId] != 0) {
            revert SnapshotAlreadyDrawn();
        }

        uint256 engineParticipantCount;
        uint256 engineCursor;
        bool engineInitialized;
        bool engineSealed;

        (engineParticipantCount, engineCursor, engineInitialized, engineSealed) = veilDrawEngine
            .snapshotMetadata(snapshotId);

        if (
            !engineInitialized ||
            !engineSealed ||
            engineParticipantCount != _snapshotBounds[snapshotId] ||
            engineCursor != engineParticipantCount
        ) {
            revert SnapshotNotReadyForDraw();
        }

        uint256[3] memory drawIds = veilDrawEngine.startDrawRound(snapshotId);

        drawId = drawIds[0];

        snapshotDrawId[snapshotId] = drawId;

        for (uint256 prizeIndex = 0; prizeIndex < 3; ++prizeIndex) {
            snapshotPrizeDrawId[snapshotId][prizeIndex] = drawIds[prizeIndex];

            emit DrawStarted(
                drawIds[prizeIndex],
                snapshotId,
                _snapshotEpochs[snapshotId],
                _snapshotBounds[snapshotId]
            );
        }

        nextDrawId = drawIds[2];

        nextDrawSnapshotId = snapshotId + 1;
    }

    /// @notice Recognize simulated yield once for one fully finalized three-prize round.
    /// @dev The immutable snapshot total receives only transaction-scoped ACL to the
    /// immutable adapter. Yield cannot be committed before every child reaches finality.
    function recognizeRoundYield(uint256 snapshotId) external nonReentrant {
        if (snapshotId == 0 || snapshotId > nextSnapshotId || !_snapshotFinalized[snapshotId]) {
            revert SnapshotNotReadyForDraw();
        }

        uint256[3] memory drawIds;

        drawIds[0] = snapshotPrizeDrawId[snapshotId][0];
        drawIds[1] = snapshotPrizeDrawId[snapshotId][1];
        drawIds[2] = snapshotPrizeDrawId[snapshotId][2];

        if (
            drawIds[0] == 0 ||
            snapshotDrawId[snapshotId] != drawIds[0] ||
            drawIds[1] != drawIds[0] + 1 ||
            drawIds[2] != drawIds[1] + 1
        ) {
            revert InvalidDraw();
        }

        VeilDrawEngineV2.DrawState engineState;
        uint256 engineSnapshot;
        uint256 ignoredParticipantCount;
        uint256 ignoredBatchId;
        uint8 ignoredBucketExponent;
        uint256 ignoredAttemptNonce;

        for (uint256 index = 0; index < 3; ++index) {
            (
                engineState,
                engineSnapshot,
                ignoredParticipantCount,
                ignoredBatchId,
                ignoredBucketExponent,
                ignoredAttemptNonce
            ) = veilDrawEngine.drawMetadataV2(drawIds[index]);

            if (
                engineState != VeilDrawEngineV2.DrawState.FINALIZED || engineSnapshot != snapshotId
            ) {
                revert InvalidDraw();
            }
        }

        euint128 rawTotalTwab = _snapshotTotals[snapshotId];

        FHE.allowTransient(rawTotalTwab, address(_yieldAdapterV2));

        _yieldAdapterV2.recognizeRoundYield(snapshotId, drawIds, rawTotalTwab);
    }

    function prepareDrawBucketEvidence(uint256 drawId, uint256 snapshotId) external nonReentrant {
        veilDrawEngine.prepareDrawBucketEvidence(drawId, snapshotId);
    }

    function submitDrawBucketEvidence(
        uint256 drawId,
        uint256 snapshotId,
        uint8 clearBucketExponent,
        bool clearTotalIsZero,
        bool clearTotalIsSupported,
        bytes calldata decryptionProof
    ) external nonReentrant {
        veilDrawEngine.submitDrawBucketEvidence(
            drawId,
            snapshotId,
            clearBucketExponent,
            clearTotalIsZero,
            clearTotalIsSupported,
            decryptionProof
        );

        VeilDrawEngineV2.DrawState engineState;
        uint256 ignoredSnapshot;
        uint256 ignoredCount;
        uint256 ignoredBatch;
        uint8 bucketExponent;
        uint256 ignoredAttempt;

        (
            engineState,
            ignoredSnapshot,
            ignoredCount,
            ignoredBatch,
            bucketExponent,
            ignoredAttempt
        ) = veilDrawEngine.drawMetadataV2(drawId);

        emit DrawBucketResolved(drawId, snapshotId, bucketExponent, DrawState(uint8(engineState)));
    }

    function generateDrawCandidateBatch(uint256 drawId, uint256 snapshotId) external nonReentrant {
        veilDrawEngine.generateDrawCandidateBatch(drawId, snapshotId);

        VeilDrawEngineV2.DrawState ignoredState;
        uint256 ignoredSnapshot;
        uint256 ignoredCount;
        uint256 batchId;
        uint8 ignoredExponent;
        uint256 ignoredAttempt;

        (
            ignoredState,
            ignoredSnapshot,
            ignoredCount,
            batchId,
            ignoredExponent,
            ignoredAttempt
        ) = veilDrawEngine.drawMetadataV2(drawId);

        emit DrawBatchGenerated(drawId, snapshotId, batchId);
    }

    function reduceDrawCandidateBatch(
        uint256 drawId,
        uint256 snapshotId,
        uint256 batchId
    ) external nonReentrant {
        veilDrawEngine.reduceDrawCandidateBatch(drawId, snapshotId, batchId);
    }

    function submitDrawBatchEvidence(
        uint256 drawId,
        uint256 snapshotId,
        uint256 batchId,
        bool clearSuccess,
        bytes calldata decryptionProof
    ) external nonReentrant {
        veilDrawEngine.submitDrawBatchEvidence(
            drawId,
            snapshotId,
            batchId,
            clearSuccess,
            decryptionProof
        );

        emit DrawBatchResolved(drawId, snapshotId, batchId, clearSuccess);
    }

    function startWinnerResolution(uint256 drawId, uint256 snapshotId) external nonReentrant {
        veilDrawEngine.startWinnerResolution(drawId, snapshotId);
    }

    /// @notice V2 private stage 1: compute encrypted shard selectors.
    function processDrawShardSelectionChunk(
        uint256 drawId,
        uint256 snapshotId
    ) external nonReentrant {
        veilDrawEngine.processDrawShardSelectionChunk(drawId, snapshotId);
    }

    /// @notice V2 private stage 2: process one fixed encrypted winner shard.
    function processDrawWinnerShard(uint256 drawId, uint256 snapshotId) external nonReentrant {
        veilDrawEngine.processDrawWinnerShard(drawId, snapshotId);
    }

    /// @notice Backward-compatible old method name for one V2 winner shard.
    /// @dev Callers must complete V2 shard selection before this phase.

    function finalizeDraw(uint256 drawId, uint256 snapshotId) external nonReentrant {
        veilDrawEngine.finalizeDraw(drawId, snapshotId);

        emit DrawFinalized(drawId, snapshotId);
    }

    /// @notice Settle one immutable refund-completion handle with a bound KMS proof.
    function settleRefundCompletion(
        uint256 slotIndex,
        uint256 registrationVersion,
        uint256 reservationNonce,
        uint256 refundAttemptNonce,
        bool clearComplete,
        bytes calldata decryptionProof
    ) external nonReentrant {
        Participant storage participant = _participant(slotIndex);
        if (participant.state != ParticipantState.REFUND_ATTEMPT_PENDING_PROOF) {
            revert InvalidState(ParticipantState.REFUND_ATTEMPT_PENDING_PROOF, participant.state);
        }
        _validateRegistration(participant, registrationVersion, reservationNonce);
        if (refundAttemptNonce != participant.refundAttemptNonce) revert RefundProofMismatch();
        _checkBooleanProof(participant.refundComplete, clearComplete, decryptionProof);

        address owner = participant.owner;
        if (clearComplete) {
            _clearParticipant(slotIndex, owner, ParticipantState.FREE);
        } else {
            participant.state = ParticipantState.PENDING_REFUND;
            emit ParticipantStateChanged(owner, slotIndex, ParticipantState.PENDING_REFUND);
        }
    }

    /// @notice Prepare a public zero-balance predicate for an active participant's exit.
    function prepareDeregistration(uint256 slotIndex) external nonReentrant {
        Participant storage participant = _activeDeregistrationParticipant(slotIndex);
        participant.deregistrationZero = FHE.eq(participant.principal, FHE.asEuint64(0));
        FHE.allowThis(participant.deregistrationZero);
        FHE.makePubliclyDecryptable(participant.deregistrationZero);
    }

    /// @notice Settle a bound zero-balance proof and tombstone the participant slot.
    function settleDeregistration(
        uint256 slotIndex,
        bool clearZero,
        bytes calldata decryptionProof
    ) external nonReentrant {
        Participant storage participant = _activeDeregistrationParticipant(slotIndex);
        _checkBooleanProof(participant.deregistrationZero, clearZero, decryptionProof);
        if (!clearZero) revert DeregistrationNotActive();
        address owner = participant.owner;
        _clearParticipant(slotIndex, owner, ParticipantState.TOMBSTONED);
    }

    /// @notice Read public participant metadata; encrypted values are exposed only as handles.
    function participantMetadata(
        uint256 slotIndex
    )
        external
        view
        returns (
            ParticipantState state,
            address owner,
            uint256 registrationVersion,
            uint256 reservationNonce,
            uint256 reservationExpiry,
            uint256 activationStartedAt,
            uint256 activationDeadline,
            uint256 refundAttemptNonce,
            bool bondHeld
        )
    {
        Participant storage participant = _participant(slotIndex);
        return (
            participant.state,
            participant.owner,
            participant.registrationVersion,
            participant.reservationNonce,
            participant.reservationExpiry,
            participant.activationStartedAt,
            participant.activationDeadline,
            participant.refundAttemptNonce,
            participant.bondHeld
        );
    }

    function participantState(uint256 slotIndex) external view returns (ParticipantState) {
        if (slotIndex >= MAX_PARTICIPANTS) revert InvalidParticipant();
        return _participants[slotIndex].state;
    }

    function pendingAmountHandle(uint256 slotIndex) external view returns (euint64) {
        return _participant(slotIndex).pendingAmount;
    }

    function principalHandle(uint256 slotIndex) external view returns (euint64) {
        return _participant(slotIndex).principal;
    }

    function refundRemainingHandle(uint256 slotIndex) external view returns (euint64) {
        return _participant(slotIndex).refundRemaining;
    }

    function thresholdHandle(uint256 slotIndex) external view returns (ebool) {
        return _participant(slotIndex).thresholdSatisfied;
    }

    function refundCompleteHandle(uint256 slotIndex) external view returns (ebool) {
        return _participant(slotIndex).refundComplete;
    }

    function aggregatePrincipalHandle() external view returns (euint128) {
        return _aggregatePrincipal;
    }

    function aggregatePendingHandle() external view returns (euint128) {
        return _aggregatePending;
    }

    function canonicalReceivedHandle() external view returns (euint128) {
        return _canonicalReceived;
    }

    function twabAccumulatorHandle(uint256 slotIndex) external view returns (euint128) {
        return _participant(slotIndex).twabAccumulator;
    }

    function twabMetadata(
        uint256 slotIndex
    )
        external
        view
        returns (
            euint128 accumulator,
            uint256 lastCheckpoint,
            uint256 epoch,
            euint128 pendingWeight,
            uint256 pendingEpoch,
            bool isSealed
        )
    {
        Participant storage participant = _participant(slotIndex);
        return (
            participant.twabAccumulator,
            participant.lastTwabTimestamp,
            participant.twabEpoch,
            participant.pendingSnapshotWeight,
            participant.pendingSnapshotEpoch,
            participant.snapshotSealed
        );
    }

    function snapshotMetadata(
        uint256 snapshotId
    )
        external
        view
        returns (
            uint256 cutoff,
            uint256 participantCount,
            uint256 cursor,
            bool inProgress,
            bool ready
        )
    {
        if (snapshotId == 0 || snapshotId > nextSnapshotId) revert InvalidParticipant();
        return (
            _snapshotCutoffs[snapshotId],
            _snapshotBounds[snapshotId],
            _snapshotFinalized[snapshotId]
                ? _snapshotBounds[snapshotId]
                : (snapshotId == currentSnapshotId ? snapshotCursor : 0),
            snapshotId == currentSnapshotId && snapshotInProgress,
            _snapshotFinalized[snapshotId]
        );
    }

    function snapshotWeightHandle(
        uint256 snapshotId,
        uint256 slotIndex
    ) external view returns (euint128) {
        if (slotIndex >= MAX_PARTICIPANTS || snapshotId == 0) revert InvalidParticipant();
        return _snapshotWeights[snapshotId][slotIndex];
    }

    function snapshotTotalHandle(uint256 snapshotId) external view returns (euint128) {
        if (snapshotId == 0 || snapshotId > nextSnapshotId) revert InvalidParticipant();
        return _snapshotTotals[snapshotId];
    }

    /// @notice Return a pre-snapshot historical encrypted weight handle for reviewability.
    function epochSnapshotWeightHandle(
        uint256 epochId,
        uint256 slotIndex
    ) external view returns (euint128) {
        if (slotIndex >= MAX_PARTICIPANTS) revert InvalidParticipant();
        return _epochSnapshotWeights[epochId][slotIndex];
    }

    /// @notice Return whether a closing epoch slot has an immutable staged weight.
    function epochSnapshotWeightBound(
        uint256 epochId,
        uint256 slotIndex
    ) external view returns (bool) {
        if (slotIndex >= MAX_PARTICIPANTS) revert InvalidParticipant();
        return _epochSnapshotWeightBound[epochId][slotIndex];
    }

    /// @notice Return the immutable high-water participant bound for a closing epoch.
    function epochParticipantBound(uint256 epochId) external view returns (uint256) {
        return _epochParticipantBounds[epochId];
    }

    /// @notice Return the timestamp after which a historically occupied slot may be reused.
    function slotReusableAfter(uint256 slotIndex) external view returns (uint256) {
        if (slotIndex >= MAX_PARTICIPANTS) revert InvalidParticipant();
        return _slotReusableAfter[slotIndex];
    }

    /// @notice Return the immutable historical registration identity for a snapshot slot.
    function snapshotBeneficiary(
        uint256 snapshotId,
        uint256 slotIndex
    )
        external
        view
        returns (address owner, uint256 registrationVersion, uint256 reservationNonce, bool bound)
    {
        if (snapshotId == 0 || snapshotId > nextSnapshotId || slotIndex >= MAX_PARTICIPANTS) {
            revert InvalidParticipant();
        }
        HistoricalBeneficiary storage beneficiary = _epochBeneficiaries[
            _snapshotEpochs[snapshotId]
        ][slotIndex];
        return (
            beneficiary.owner,
            beneficiary.registrationVersion,
            beneficiary.reservationNonce,
            beneficiary.bound
        );
    }

    /// @notice Return the immutable closing epoch consumed by a finalized or active snapshot.
    function snapshotEpoch(uint256 snapshotId) external view returns (uint256) {
        if (snapshotId == 0 || snapshotId > nextSnapshotId) revert InvalidParticipant();
        return _snapshotEpochs[snapshotId];
    }

    /// @notice Return a pre-snapshot historical registration identity for reviewability.
    function epochBeneficiary(
        uint256 epochId,
        uint256 slotIndex
    )
        external
        view
        returns (address owner, uint256 registrationVersion, uint256 reservationNonce, bool bound)
    {
        if (slotIndex >= MAX_PARTICIPANTS) revert InvalidParticipant();
        HistoricalBeneficiary storage beneficiary = _epochBeneficiaries[epochId][slotIndex];
        return (
            beneficiary.owner,
            beneficiary.registrationVersion,
            beneficiary.reservationNonce,
            beneficiary.bound
        );
    }

    /// @notice Preserve the exact Reserve-facing seven-field draw ABI.
    function drawMetadata(
        uint256 drawId
    )
        external
        view
        returns (
            DrawState state,
            uint256 snapshotId,
            uint256 snapshotEpochId,
            uint256 participantCount,
            uint256 batchId,
            uint8 bucketExponent,
            uint256 winnerCursor
        )
    {
        VeilDrawEngineV2.DrawState engineState;
        uint256 bucketAttemptNonce;

        (
            engineState,
            snapshotId,
            participantCount,
            batchId,
            bucketExponent,
            bucketAttemptNonce
        ) = veilDrawEngine.drawMetadataV2(drawId);

        VeilDrawEngineV2.ResolutionPhase resolutionPhase;
        uint256 shardSelectionCursor;
        uint256 winnerShardCursor;

        (resolutionPhase, shardSelectionCursor, winnerShardCursor, winnerCursor) = veilDrawEngine
            .drawResolutionMetadata(drawId);

        // Silence variables that are intentionally not part of the frozen ABI.
        bucketAttemptNonce;
        resolutionPhase;
        shardSelectionCursor;
        winnerShardCursor;

        state = DrawState(uint8(engineState));

        snapshotEpochId = _snapshotEpochs[snapshotId];
    }

    function drawBucketEvidenceHandles(
        uint256 drawId
    ) external view returns (bytes32, bytes32, bytes32, bytes32) {
        return veilDrawEngine.drawBucketEvidenceHandles(drawId);
    }

    function drawBatchHandles(
        uint256 drawId
    ) external view returns (euint128 target, ebool success, bytes32 proofContext) {
        return veilDrawEngine.drawBatchHandles(drawId);
    }

    /// @notice Preserve the old two-handle invariant read surface.

    /// @notice Exact frozen Reserve ABI with the proven three-hop ACL pattern.
    function derivePrizeEntitlement(
        uint256 drawId,
        uint256 slotIndex,
        euint64 prizeAmount
    ) external returns (euint64 entitlement) {
        if (msg.sender != prizeReserve) {
            revert OnlyPrizeReserve();
        }

        if (!FHE.isAllowed(prizeAmount, address(this))) {
            revert MissingPrizeAcl();
        }

        FHE.allowTransient(prizeAmount, address(veilDrawEngine));

        euint64 engineEntitlement = veilDrawEngine.derivePrizeEntitlement(
            drawId,
            slotIndex,
            prizeAmount
        );

        if (!FHE.isAllowed(engineEntitlement, address(this))) {
            revert MissingEngineAcl();
        }

        // Persist nowhere. Produce a fresh Pool-owned derivative and
        // transiently return only that value to the canonical Reserve.
        entitlement = FHE.add(engineEntitlement, FHE.asEuint64(0));

        FHE.allowTransient(entitlement, msg.sender);
    }

    /// @notice Additive V2 proof-context review surface.

    /// @notice Return the encrypted zero-balance deregistration predicate handle.
    function deregistrationZeroHandle(uint256 slotIndex) external view returns (ebool) {
        return _participant(slotIndex).deregistrationZero;
    }

    function _validateRegistration(
        Participant storage participant,
        uint256 registrationVersion,
        uint256 reservationNonce
    ) internal view {
        if (
            registrationVersion != SUPPORTED_REGISTRATION_VERSION ||
            registrationVersion != participant.registrationVersion
        ) revert RegistrationVersionMismatch();

        if (reservationNonce != participant.reservationNonce) revert ReservationNonceMismatch();
    }

    function _checkBooleanProof(
        ebool encryptedValue,
        bool clearValue,
        bytes calldata decryptionProof
    ) internal {
        bytes32[] memory handles = new bytes32[](1);

        handles[0] = FHE.toBytes32(encryptedValue);

        FHE.checkSignatures(handles, abi.encode(clearValue), decryptionProof);
    }

    function _creditPrincipal(
        Participant storage participant,
        euint64 amount,
        euint128 aggregateAmount
    ) internal {
        _aggregatePrincipal = FHE.add(_aggregatePrincipal, aggregateAmount);

        FHE.allowThis(_aggregatePrincipal);

        participant.principal = FHE.add(participant.principal, amount);

        FHE.allowThis(participant.principal);

        participant.deregistrationZero = FHE.eq(participant.principal, FHE.asEuint64(0));
        FHE.allowThis(participant.deregistrationZero);
    }

    function _activeDeregistrationParticipant(
        uint256 slotIndex
    ) internal view returns (Participant storage participant) {
        participant = _participant(slotIndex);

        if (participant.state != ParticipantState.ACTIVE) {
            revert DeregistrationNotActive();
        }
    }

    function _participant(
        uint256 slotIndex
    ) internal view returns (Participant storage participant) {
        if (slotIndex >= MAX_PARTICIPANTS) revert InvalidParticipant();
        participant = _participants[slotIndex];
        if (participant.owner == address(0)) revert InvalidParticipant();
    }

    function _creditBond(address owner, uint256 amount) internal {
        pendingBondRefund[owner] += amount;
        emit BondRefundCredited(owner, amount);
    }

    function _checkpointParticipant(uint256 slotIndex, Participant storage participant) internal {
        // Once the next epoch is open, do not create a valid interval longer
        // than the frozen envelope. Before a late snapshot start, one extra
        // window is allowed so the old epoch can be sealed and the next epoch
        // can accrue up to its own deadline.
        if (
            snapshotInProgress
                ? block.timestamp > activeEpochEnd
                : block.timestamp > activeEpochEnd + MAX_DRAW_DURATION_SECONDS
        ) {
            revert DrawDurationExceeded();
        }
        if (
            !snapshotInProgress &&
            block.timestamp > activeEpochEnd &&
            participant.activationStartedAt != 0 &&
            participant.activationStartedAt <= activeEpochEnd &&
            participant.twabEpoch == activeEpochId
        ) {
            _sealParticipantAt(
                slotIndex,
                participant,
                activeEpochId,
                activeEpochId + 1,
                activeEpochEnd
            );
        }
        if (
            snapshotInProgress &&
            participant.activationStartedAt != 0 &&
            participant.activationStartedAt <= snapshotCutoffTimestamp &&
            participant.twabEpoch == activeEpochId - 1
        ) {
            _sealParticipantForSnapshot(slotIndex, participant, activeEpochId - 1);
        }
        if (participant.twabEpoch < activeEpochId) {
            participant.twabEpoch = activeEpochId;
            participant.twabAccumulator = FHE.asEuint128(0);
            participant.lastTwabTimestamp =
                participant.activationStartedAt > activeEpochStart
                    ? participant.activationStartedAt
                    : activeEpochStart;
            FHE.allowThis(participant.twabAccumulator);
        }
        uint256 elapsed = block.timestamp - participant.lastTwabTimestamp;
        if (elapsed == 0) return;
        euint128 principal128 = FHE.asEuint128(participant.principal);
        euint128 delta = FHE.mul(principal128, uint128(elapsed));
        participant.twabAccumulator = FHE.add(participant.twabAccumulator, delta);
        participant.lastTwabTimestamp = block.timestamp;
        FHE.allowThis(participant.twabAccumulator);
    }

    function _highestOccupiedSlotPlusOne() internal view returns (uint256 bound) {
        for (uint256 index = MAX_PARTICIPANTS; index > 0; --index) {
            if (_participants[index - 1].owner != address(0)) return index;
        }
        return 0;
    }

    function _sealParticipantForSnapshot(
        uint256 slotIndex,
        Participant storage participant,
        uint256 closedEpoch
    ) internal {
        if (participant.snapshotSealed && participant.pendingSnapshotEpoch == closedEpoch) return;
        if (participant.twabEpoch != closedEpoch) revert SnapshotCursorMismatch();
        _sealParticipantAt(
            slotIndex,
            participant,
            closedEpoch,
            activeEpochId,
            snapshotCutoffTimestamp
        );
    }

    function _sealParticipantAt(
        uint256 slotIndex,
        Participant storage participant,
        uint256 closedEpoch,
        uint256 nextEpoch,
        uint256 cutoff
    ) internal {
        if (participant.snapshotSealed && participant.pendingSnapshotEpoch == closedEpoch) return;
        if (participant.twabEpoch != closedEpoch) revert SnapshotCursorMismatch();
        _bindEpochBeneficiary(closedEpoch, slotIndex, participant);
        uint256 elapsed = cutoff - participant.lastTwabTimestamp;
        euint128 principal128 = FHE.asEuint128(participant.principal);
        euint128 delta = FHE.mul(principal128, uint128(elapsed));
        participant.twabAccumulator = FHE.add(participant.twabAccumulator, delta);
        participant.pendingSnapshotWeight = participant.twabAccumulator;
        _stageEpochSnapshotWeight(closedEpoch, slotIndex, participant.twabAccumulator);
        if (cutoff > _slotReusableAfter[slotIndex]) {
            _slotReusableAfter[slotIndex] = cutoff;
        }
        participant.pendingSnapshotEpoch = closedEpoch;
        participant.snapshotSealed = true;
        participant.twabAccumulator = FHE.asEuint128(0);
        participant.twabEpoch = nextEpoch;
        participant.lastTwabTimestamp = cutoff;
        FHE.allowThis(participant.pendingSnapshotWeight);
        FHE.allowThis(participant.twabAccumulator);
    }

    function _bindEpochBeneficiary(
        uint256 closingEpochId,
        uint256 slotIndex,
        Participant storage participant
    ) internal {
        if (participant.owner == address(0)) revert InvalidParticipant();
        HistoricalBeneficiary storage existing = _epochBeneficiaries[closingEpochId][slotIndex];
        if (!existing.bound) {
            existing.owner = participant.owner;
            existing.registrationVersion = participant.registrationVersion;
            existing.reservationNonce = participant.reservationNonce;
            existing.bound = true;
            return;
        }
        if (
            existing.owner != participant.owner ||
            existing.registrationVersion != participant.registrationVersion ||
            existing.reservationNonce != participant.reservationNonce
        ) revert HistoricalBeneficiaryMismatch();
    }

    function _stageEpochSnapshotWeight(
        uint256 closingEpochId,
        uint256 slotIndex,
        euint128 weight
    ) internal {
        if (_epochSnapshotWeightBound[closingEpochId][slotIndex]) return;
        _epochSnapshotWeights[closingEpochId][slotIndex] = weight;
        _epochSnapshotWeightBound[closingEpochId][slotIndex] = true;
        FHE.allowThis(_epochSnapshotWeights[closingEpochId][slotIndex]);
        uint256 requiredBound = slotIndex + 1;
        if (requiredBound > _epochParticipantBounds[closingEpochId]) {
            _epochParticipantBounds[closingEpochId] = requiredBound;
        }
    }

    function _releaseBond(Participant storage participant, address owner) internal {
        if (!participant.bondHeld) return;
        participant.bondHeld = false;
        _creditBond(owner, REGISTRATION_BOND_WEI);
    }

    function _sealParticipantHistoryBeforeClear(
        uint256 slotIndex,
        Participant storage participant
    ) internal {
        if (participant.state != ParticipantState.ACTIVE || participant.activationStartedAt == 0) {
            return;
        }

        if (!snapshotInProgress) {
            // Before a late snapshot starts, activeEpochId still names the
            // unmaterialized closing epoch. The participant may either still
            // be in that epoch, or may already be accruing its logical N+1
            // epoch after a post-cutoff checkpoint.
            if (
                participant.twabEpoch == activeEpochId &&
                participant.activationStartedAt <= activeEpochEnd
            ) {
                _sealParticipantAt(
                    slotIndex,
                    participant,
                    activeEpochId,
                    activeEpochId + 1,
                    activeEpochEnd
                );
                return;
            }

            if (participant.twabEpoch == activeEpochId + 1 && block.timestamp > activeEpochEnd) {
                _sealParticipantAt(
                    slotIndex,
                    participant,
                    activeEpochId + 1,
                    activeEpochId + 2,
                    activeEpochEnd + MAX_DRAW_DURATION_SECONDS
                );
            }
            return;
        }

        uint256 closingEpochId = _snapshotEpochs[currentSnapshotId];
        if (participant.activationStartedAt <= snapshotCutoffTimestamp) {
            if (!_epochSnapshotWeightBound[closingEpochId][slotIndex]) {
                _sealParticipantForSnapshot(slotIndex, participant, closingEpochId);
            }
            _snapshotLocked[currentSnapshotId][slotIndex] = true;
        }

        // Snapshot N may still be processing while the participant is already
        // accruing N+1. Deregistration is proof-gated on zero principal, so
        // sealing N+1 forward to its immutable cutoff adds no phantom area and
        // preserves any area accrued before the balance became zero.
        if (participant.twabEpoch == activeEpochId) {
            _sealParticipantAt(
                slotIndex,
                participant,
                activeEpochId,
                activeEpochId + 1,
                activeEpochEnd
            );
        }
    }

    function _clearParticipant(uint256 slotIndex, address owner, ParticipantState state) internal {
        Participant storage participant = _participants[slotIndex];
        _sealParticipantHistoryBeforeClear(slotIndex, participant);
        if (activeParticipantCount > 0 && participant.state == ParticipantState.ACTIVE) {
            --activeParticipantCount;
        }
        _participantIndexPlusOne[owner] = 0;
        participant.state = state;
        participant.owner = address(0);
        participant.bondHeld = false;
        emit ParticipantStateChanged(owner, slotIndex, state);
    }
}
