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

/* solhint-disable use-natspec, gas-struct-packing, immutable-vars-naming, gas-indexed-events,
   gas-strict-inequalities, function-max-lines, gas-increment-by-one */

/// @title VeilpotPool
/// @notice Veilpot production pool for confidential principal, TWAB snapshots, and VeilDraw selection.
/// @dev Prize reserve, yield recognition, and claims remain intentionally out of scope at Gate 1B.3.
contract VeilpotPool is ZamaEthereumConfig {
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
    mapping(uint256 => Draw) private _draws;
    mapping(uint256 => mapping(uint256 => ebool)) private _drawWinnerPredicates;
    uint256 private _entered;

    error InvalidToken();
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

    constructor(IERC7984 token) {
        if (address(token) == address(0)) revert InvalidToken();
        confidentialToken = token;
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
        if (
            registrationVersion != SUPPORTED_REGISTRATION_VERSION ||
            registrationVersion != participant.registrationVersion
        ) revert RegistrationVersionMismatch();
        if (reservationNonce != participant.reservationNonce) revert ReservationNonceMismatch();
        if (block.timestamp > participant.activationDeadline) revert ActivationProofExpired();
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(participant.thresholdSatisfied);
        FHE.checkSignatures(handles, abi.encode(clearSatisfied), decryptionProof);

        address owner = participant.owner;
        participant.bondHeld = false;
        _creditBond(owner, REGISTRATION_BOND_WEI);
        if (clearSatisfied) {
            euint128 pending128 = FHE.asEuint128(participant.pendingAmount);
            _aggregatePending = FHE.sub(_aggregatePending, pending128);
            _aggregatePrincipal = FHE.add(_aggregatePrincipal, pending128);
            FHE.allowThis(_aggregatePending);
            FHE.allowThis(_aggregatePrincipal);
            participant.principal = FHE.add(participant.principal, participant.pendingAmount);
            FHE.allowThis(participant.principal);
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
        if (
            registrationVersion != SUPPORTED_REGISTRATION_VERSION ||
            registrationVersion != participant.registrationVersion
        ) revert RegistrationVersionMismatch();
        if (reservationNonce != participant.reservationNonce) revert ReservationNonceMismatch();
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
    // Gate 1B.3 production VeilDraw integration
    // ---------------------------------------------------------------------

    /// @notice Bind the next finalized snapshot to exactly one permissionless draw.
    /// @dev The caller cannot select a snapshot: snapshots are consumed monotonically from ID 1.
    function startDraw() external nonReentrant returns (uint256 drawId) {
        uint256 snapshotId = nextDrawSnapshotId;
        if (snapshotId == 0 || snapshotId > nextSnapshotId || !_snapshotFinalized[snapshotId]) {
            revert SnapshotNotReadyForDraw();
        }
        if (snapshotDrawId[snapshotId] != 0) revert SnapshotAlreadyDrawn();

        drawId = ++nextDrawId;
        nextDrawSnapshotId = snapshotId + 1;
        snapshotDrawId[snapshotId] = drawId;

        Draw storage draw = _draws[drawId];
        draw.state = DrawState.BUCKET_DISCOVERY;
        draw.snapshotId = snapshotId;
        draw.snapshotEpoch = _snapshotEpochs[snapshotId];
        draw.participantCount = _snapshotBounds[snapshotId];
        draw.total = _snapshotTotals[snapshotId];
        draw.runningPrefix = FHE.asEuint128(0);
        draw.winnerCount = FHE.asEuint128(0);
        FHE.allowThis(draw.total);
        FHE.allowThis(draw.runningPrefix);
        FHE.allowThis(draw.winnerCount);

        emit DrawStarted(drawId, snapshotId, draw.snapshotEpoch, draw.participantCount);
    }

    /// @notice Compute the fixed minimal power-of-two bucket evidence from the frozen snapshot total.
    /// @dev Only the exponent, zero predicate, and supported-domain predicate are made public.
    function prepareDrawBucketEvidence(uint256 drawId, uint256 snapshotId) external nonReentrant {
        Draw storage draw = _draw(drawId, snapshotId);
        if (draw.state != DrawState.BUCKET_DISCOVERY) {
            revert InvalidDrawState(DrawState.BUCKET_DISCOVERY, draw.state);
        }
        if (draw.bucketEvidencePrepared) revert DrawEvidenceAlreadyPrepared();

        euint128 threshold = FHE.asEuint128(uint128(1) << 63);
        euint8 exponent = FHE.asEuint8(63);
        uint8[6] memory steps = [uint8(32), 16, 8, 4, 2, 1];

        for (uint256 index = 0; index < steps.length; ++index) {
            uint8 step = steps[index];
            ebool totalAtOrBelow = FHE.le(draw.total, threshold);
            euint128 lowerThreshold = FHE.shr(threshold, step);
            euint128 upperThreshold = FHE.shl(threshold, step);
            threshold = FHE.select(totalAtOrBelow, lowerThreshold, upperThreshold);

            euint8 lowerExponent = FHE.sub(exponent, step);
            euint8 upperExponent = FHE.add(exponent, step);
            exponent = FHE.select(totalAtOrBelow, lowerExponent, upperExponent);
        }

        ebool finalAtOrBelow = FHE.le(draw.total, threshold);
        draw.encryptedBucketExponent = FHE.select(finalAtOrBelow, exponent, FHE.add(exponent, 1));
        draw.encryptedTotalIsZero = FHE.eq(draw.total, 0);
        draw.encryptedTotalIsSupported = FHE.le(draw.total, MAX_DRAW_TOTAL);
        draw.bucketProofContext = FHE.asEuint256(_drawProofContext(1, drawId, snapshotId, 0));
        draw.bucketEvidencePrepared = true;

        FHE.allowThis(draw.encryptedBucketExponent);
        FHE.allowThis(draw.encryptedTotalIsZero);
        FHE.allowThis(draw.encryptedTotalIsSupported);
        FHE.allowThis(draw.bucketProofContext);
        FHE.makePubliclyDecryptable(draw.encryptedBucketExponent);
        FHE.makePubliclyDecryptable(draw.encryptedTotalIsZero);
        FHE.makePubliclyDecryptable(draw.encryptedTotalIsSupported);
        FHE.makePubliclyDecryptable(draw.bucketProofContext);
    }

    /// @notice Verify the fixed bucket proof and enter a ready or terminal state.
    function submitDrawBucketEvidence(
        uint256 drawId,
        uint256 snapshotId,
        uint8 clearBucketExponent,
        bool clearTotalIsZero,
        bool clearTotalIsSupported,
        bytes calldata decryptionProof
    ) external nonReentrant {
        Draw storage draw = _draw(drawId, snapshotId);
        if (draw.state != DrawState.BUCKET_DISCOVERY) {
            revert InvalidDrawState(DrawState.BUCKET_DISCOVERY, draw.state);
        }
        if (!draw.bucketEvidencePrepared) revert DrawEvidenceNotPrepared();

        bytes32[] memory handles = new bytes32[](4);
        handles[0] = FHE.toBytes32(draw.encryptedBucketExponent);
        handles[1] = FHE.toBytes32(draw.encryptedTotalIsZero);
        handles[2] = FHE.toBytes32(draw.encryptedTotalIsSupported);
        handles[3] = FHE.toBytes32(draw.bucketProofContext);
        FHE.checkSignatures(
            handles,
            abi.encode(
                clearBucketExponent,
                clearTotalIsZero,
                clearTotalIsSupported,
                _drawProofContext(1, drawId, snapshotId, 0)
            ),
            decryptionProof
        );

        draw.bucketEvidencePrepared = false;
        if (clearTotalIsZero) {
            if (clearBucketExponent != 0 || !clearTotalIsSupported) {
                revert InvalidDrawBucketEvidence();
            }
            draw.state = DrawState.NO_WEIGHT_TERMINAL;
            emit DrawBucketResolved(drawId, snapshotId, 0, draw.state);
            return;
        }
        if (!clearTotalIsSupported) {
            draw.state = DrawState.UNSUPPORTED_TOTAL;
            emit DrawBucketResolved(drawId, snapshotId, clearBucketExponent, draw.state);
            return;
        }
        if (clearBucketExponent > MAX_DRAW_BUCKET_EXPONENT) {
            revert InvalidDrawBucketEvidence();
        }

        draw.bucketExponent = clearBucketExponent;
        draw.state = DrawState.BUCKET_READY;
        emit DrawBucketResolved(drawId, snapshotId, clearBucketExponent, draw.state);
    }

    /// @notice Generate exactly eight fresh protocol-random encrypted candidates for the frozen draw.
    /// @dev No caller-controlled seed, candidate, threshold, bound, or batch size exists.
    function generateDrawCandidateBatch(uint256 drawId, uint256 snapshotId) external nonReentrant {
        Draw storage draw = _draw(drawId, snapshotId);
        bool allowedState =
            draw.state == DrawState.BUCKET_READY ||
                draw.state == DrawState.AWAITING_CANDIDATE_BATCH;
        if (!allowedState) {
            revert InvalidDrawState(DrawState.AWAITING_CANDIDATE_BATCH, draw.state);
        }

        uint128 bound = uint128(1) << draw.bucketExponent;
        uint256 batchId = ++draw.batchId;
        draw.batchProofContext = FHE.asEuint256(_drawProofContext(2, drawId, snapshotId, batchId));
        FHE.allowThis(draw.batchProofContext);
        FHE.makePubliclyDecryptable(draw.batchProofContext);
        for (uint256 index = 0; index < DRAW_BATCH_SIZE; ++index) {
            euint128 candidate = FHE.randEuint128(bound);
            ebool valid = FHE.lt(candidate, draw.total);
            draw.candidates[index] = candidate;
            draw.candidateValid[index] = valid;
            FHE.allowThis(draw.candidates[index]);
            FHE.allowThis(draw.candidateValid[index]);
        }

        draw.state = DrawState.BATCH_REDUCTION_PENDING;
        emit DrawBatchGenerated(drawId, snapshotId, batchId);
    }

    /// @notice Select the first valid candidate with the Gate 0 order-preserving balanced reduction.
    function reduceDrawCandidateBatch(
        uint256 drawId,
        uint256 snapshotId,
        uint256 batchId
    ) external nonReentrant {
        Draw storage draw = _draw(drawId, snapshotId);
        if (draw.state != DrawState.BATCH_REDUCTION_PENDING) {
            revert InvalidDrawState(DrawState.BATCH_REDUCTION_PENDING, draw.state);
        }
        if (batchId != draw.batchId) revert DrawBatchMismatch();

        euint128[8] memory values;
        ebool[8] memory valid;
        for (uint256 index = 0; index < DRAW_BATCH_SIZE; ++index) {
            values[index] = draw.candidates[index];
            valid[index] = draw.candidateValid[index];
        }

        uint256 width = DRAW_BATCH_SIZE;
        while (width > 1) {
            uint256 nextWidth = width / 2;
            for (uint256 pair = 0; pair < nextWidth; ++pair) {
                uint256 leftIndex = pair * 2;
                uint256 rightIndex = leftIndex + 1;
                values[pair] = FHE.select(valid[leftIndex], values[leftIndex], values[rightIndex]);
                valid[pair] = FHE.or(valid[leftIndex], valid[rightIndex]);
            }
            width = nextWidth;
        }

        draw.batchSuccess = valid[0];
        draw.batchTarget = FHE.select(valid[0], values[0], FHE.asEuint128(0));
        FHE.allowThis(draw.batchSuccess);
        FHE.allowThis(draw.batchTarget);
        FHE.makePubliclyDecryptable(draw.batchSuccess);
        draw.state = DrawState.BATCH_PROOF_PENDING;
    }

    /// @notice Verify aggregate batch success; only a proved failure can authorize fresh randomness.
    function submitDrawBatchEvidence(
        uint256 drawId,
        uint256 snapshotId,
        uint256 batchId,
        bool clearSuccess,
        bytes calldata decryptionProof
    ) external nonReentrant {
        Draw storage draw = _draw(drawId, snapshotId);
        if (draw.state != DrawState.BATCH_PROOF_PENDING) {
            revert InvalidDrawState(DrawState.BATCH_PROOF_PENDING, draw.state);
        }
        if (batchId != draw.batchId) revert DrawBatchMismatch();

        bytes32[] memory handles = new bytes32[](2);
        handles[0] = FHE.toBytes32(draw.batchSuccess);
        handles[1] = FHE.toBytes32(draw.batchProofContext);
        FHE.checkSignatures(
            handles,
            abi.encode(clearSuccess, _drawProofContext(2, drawId, snapshotId, batchId)),
            decryptionProof
        );

        if (clearSuccess) {
            draw.acceptedTarget = draw.batchTarget;
            FHE.allowThis(draw.acceptedTarget);
            draw.state = DrawState.CANDIDATE_ACCEPTED;
        } else {
            draw.state = DrawState.AWAITING_CANDIDATE_BATCH;
        }
        emit DrawBatchResolved(drawId, snapshotId, batchId, clearSuccess);
    }

    /// @notice Begin the fixed-order winner scan over the immutable historical snapshot.
    function startWinnerResolution(uint256 drawId, uint256 snapshotId) external nonReentrant {
        Draw storage draw = _draw(drawId, snapshotId);
        if (draw.state != DrawState.CANDIDATE_ACCEPTED) {
            revert InvalidDrawState(DrawState.CANDIDATE_ACCEPTED, draw.state);
        }
        draw.winnerCursor = 0;
        draw.runningPrefix = FHE.asEuint128(0);
        draw.winnerCount = FHE.asEuint128(0);
        FHE.allowThis(draw.runningPrefix);
        FHE.allowThis(draw.winnerCount);
        draw.state = DrawState.WINNER_RESOLUTION;
    }

    /// @notice Process the next fixed eight-slot winner chunk without early winner disclosure.
    function processDrawWinnerChunk(uint256 drawId, uint256 snapshotId) external nonReentrant {
        Draw storage draw = _draw(drawId, snapshotId);
        if (draw.state != DrawState.WINNER_RESOLUTION) {
            revert InvalidDrawState(DrawState.WINNER_RESOLUTION, draw.state);
        }
        uint256 start = draw.winnerCursor;
        if (start >= draw.participantCount) revert DrawWinnerComplete();
        uint256 end = start + WINNER_CHUNK_SIZE;
        if (end > draw.participantCount) end = draw.participantCount;

        euint128 prefix = draw.runningPrefix;
        euint128 winnerCount = draw.winnerCount;
        for (uint256 offset = 0; offset < WINNER_CHUNK_SIZE; ++offset) {
            (prefix, winnerCount) = _processDrawWinnerSlot(
                drawId,
                snapshotId,
                draw,
                start + offset,
                prefix,
                winnerCount
            );
        }

        draw.runningPrefix = prefix;
        draw.winnerCount = winnerCount;
        draw.winnerCursor = end;
        FHE.allowThis(draw.runningPrefix);
        FHE.allowThis(draw.winnerCount);
        emit DrawWinnerChunkProcessed(drawId, snapshotId, start, end);
    }

    /// @dev Process one real or padded snapshot slot while preserving the fixed eight-slot
    ///      winner-resolution shape. Padded slots use encrypted zero weight and never persist
    ///      a winner predicate.
    function _processDrawWinnerSlot(
        uint256 drawId,
        uint256 snapshotId,
        Draw storage draw,
        uint256 index,
        euint128 prefix,
        euint128 winnerCount
    ) internal returns (euint128 nextPrefix, euint128 nextWinnerCount) {
        euint128 weight = FHE.asEuint128(0);

        if (index < draw.participantCount) {
            if (
                _snapshotEligible[snapshotId][index] &&
                !_epochBeneficiaries[draw.snapshotEpoch][index].bound
            ) revert HistoricalBeneficiaryMismatch();

            weight = _snapshotWeights[snapshotId][index];
        }

        nextPrefix = FHE.add(prefix, weight);

        ebool winner = FHE.and(
            FHE.le(prefix, draw.acceptedTarget),
            FHE.lt(draw.acceptedTarget, nextPrefix)
        );

        if (index < draw.participantCount) {
            _drawWinnerPredicates[drawId][index] = winner;
            FHE.allowThis(_drawWinnerPredicates[drawId][index]);
        }

        nextWinnerCount = FHE.add(winnerCount, FHE.asEuint128(winner));
    }

    /// @notice Finalize only after every registered snapshot slot has been processed.
    /// @dev No winner, winner chunk, prefix, or winner-count value is publicly decrypted here.
    function finalizeDraw(uint256 drawId, uint256 snapshotId) external nonReentrant {
        Draw storage draw = _draw(drawId, snapshotId);
        if (draw.state != DrawState.WINNER_RESOLUTION) {
            revert InvalidDrawState(DrawState.WINNER_RESOLUTION, draw.state);
        }
        if (draw.winnerCursor != draw.participantCount) revert DrawWinnerIncomplete();
        draw.state = DrawState.FINALIZED;
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
        if (
            registrationVersion != SUPPORTED_REGISTRATION_VERSION ||
            registrationVersion != participant.registrationVersion
        ) revert RegistrationVersionMismatch();
        if (reservationNonce != participant.reservationNonce) revert ReservationNonceMismatch();
        if (refundAttemptNonce != participant.refundAttemptNonce) revert RefundProofMismatch();
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(participant.refundComplete);
        FHE.checkSignatures(handles, abi.encode(clearComplete), decryptionProof);

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
        Participant storage participant = _participant(slotIndex);
        if (participant.state != ParticipantState.ACTIVE) revert DeregistrationNotActive();
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
        Participant storage participant = _participant(slotIndex);
        if (participant.state != ParticipantState.ACTIVE) revert DeregistrationNotActive();
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(participant.deregistrationZero);
        FHE.checkSignatures(handles, abi.encode(clearZero), decryptionProof);
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

    /// @notice Return public draw lifecycle metadata without exposing encrypted values.
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
        Draw storage draw = _drawExisting(drawId);
        return (
            draw.state,
            draw.snapshotId,
            draw.snapshotEpoch,
            draw.participantCount,
            draw.batchId,
            draw.bucketExponent,
            draw.winnerCursor
        );
    }

    /// @notice Return the pool-owned frozen snapshot total handle for a draw.
    function drawTotalHandle(uint256 drawId) external view returns (euint128) {
        return _drawExisting(drawId).total;
    }

    /// @notice Return fixed bucket evidence plus its public application-domain proof context.
    function drawBucketEvidenceHandles(
        uint256 drawId
    ) external view returns (bytes32, bytes32, bytes32, bytes32) {
        Draw storage draw = _drawExisting(drawId);
        return (
            FHE.toBytes32(draw.encryptedBucketExponent),
            FHE.toBytes32(draw.encryptedTotalIsZero),
            FHE.toBytes32(draw.encryptedTotalIsSupported),
            FHE.toBytes32(draw.bucketProofContext)
        );
    }

    /// @notice Return one protected candidate handle from the fixed m=8 batch.
    function drawCandidateHandle(uint256 drawId, uint256 index) external view returns (euint128) {
        if (index >= DRAW_BATCH_SIZE) revert InvalidDrawIndex();
        return _drawExisting(drawId).candidates[index];
    }

    /// @notice Return the protected target plus public batch-success and proof-context handles.
    function drawBatchHandles(
        uint256 drawId
    ) external view returns (euint128 target, ebool success, bytes32 proofContext) {
        Draw storage draw = _drawExisting(drawId);
        return (draw.batchTarget, draw.batchSuccess, FHE.toBytes32(draw.batchProofContext));
    }

    /// @notice Return the immutable accepted target handle after a successful batch proof.
    function drawAcceptedTargetHandle(uint256 drawId) external view returns (euint128) {
        return _drawExisting(drawId).acceptedTarget;
    }

    /// @notice Return protected prefix and winner-count handles for invariant verification.
    function drawResolutionHandles(
        uint256 drawId
    ) external view returns (euint128 runningPrefix, euint128 winnerCount) {
        Draw storage draw = _drawExisting(drawId);
        return (draw.runningPrefix, draw.winnerCount);
    }

    /// @notice Return one encrypted winner selector paired with its immutable historical beneficiary.
    /// @dev This path never consults the current participant occupying the slot.
    function drawWinnerRecord(
        uint256 drawId,
        uint256 slotIndex
    )
        external
        view
        returns (
            ebool winnerPredicate,
            address owner,
            uint256 registrationVersion,
            uint256 reservationNonce,
            bool beneficiaryBound,
            bool processed
        )
    {
        Draw storage draw = _drawExisting(drawId);
        if (slotIndex >= draw.participantCount) revert InvalidDrawIndex();
        HistoricalBeneficiary storage beneficiary = _epochBeneficiaries[draw.snapshotEpoch][
            slotIndex
        ];
        return (
            _drawWinnerPredicates[drawId][slotIndex],
            beneficiary.owner,
            beneficiary.registrationVersion,
            beneficiary.reservationNonce,
            beneficiary.bound,
            slotIndex < draw.winnerCursor
        );
    }

    /// @notice Return the encrypted zero-balance deregistration predicate handle.
    function deregistrationZeroHandle(uint256 slotIndex) external view returns (ebool) {
        return _participant(slotIndex).deregistrationZero;
    }

    /// @dev Public-only KMS proof domain tag. It binds a proof to this chain,
    ///      pool, stage, draw, snapshot, and (for candidate evidence) batch.
    ///      The tag carries no private state and is never used as randomness.
    function _drawProofContext(
        uint8 stage,
        uint256 drawId,
        uint256 snapshotId,
        uint256 batchId
    ) internal view returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encode(
                        bytes32("VEILPOT_DRAW_PROOF_V1"),
                        block.chainid,
                        address(this),
                        stage,
                        drawId,
                        snapshotId,
                        batchId
                    )
                )
            );
    }

    function _draw(uint256 drawId, uint256 snapshotId) internal view returns (Draw storage draw) {
        draw = _drawExisting(drawId);
        if (draw.snapshotId != snapshotId) revert DrawSnapshotMismatch();
    }

    function _drawExisting(uint256 drawId) internal view returns (Draw storage draw) {
        if (drawId == 0 || drawId > nextDrawId) revert InvalidDraw();
        draw = _draws[drawId];
        if (draw.state == DrawState.NO_DRAW) revert InvalidDraw();
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
