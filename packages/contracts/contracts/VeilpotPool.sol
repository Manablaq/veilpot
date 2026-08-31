// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {FHE, ebool, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/* solhint-disable use-natspec, gas-struct-packing, immutable-vars-naming, gas-indexed-events,
   gas-strict-inequalities, function-max-lines, gas-increment-by-one */

/// @title VeilpotPool
/// @notice Gate 1B.1 production foundation for ERC-7984 pull deposits and participant lifecycle.
/// @dev Draw, TWAB, prize reserve, and yield logic are intentionally not implemented here.
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

    enum ParticipantState {
        FREE,
        RESERVED,
        PENDING_ACTIVATION,
        ACTIVE,
        PENDING_REFUND,
        REFUND_ATTEMPT_PENDING_PROOF,
        TOMBSTONED
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
            participant.twabEpoch = activeEpochId;
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
        _checkpointParticipant(participant);
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
        snapshotParticipantCount = _highestOccupiedSlotPlusOne();
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
        for (uint256 index = start; index < end; ++index) {
            if (_snapshotProcessed[snapshotId][index]) revert SnapshotCursorMismatch();
            Participant storage participant = _participants[index];
            euint128 weight = FHE.asEuint128(0);
            bool eligible =
                _snapshotLocked[snapshotId][index] ||
                    (participant.state == ParticipantState.ACTIVE &&
                        participant.activationStartedAt <= snapshotCutoffTimestamp &&
                        (participant.twabEpoch == activeEpochId - 1 ||
                            (participant.snapshotSealed &&
                                participant.pendingSnapshotEpoch == activeEpochId - 1)));
            _snapshotEligible[snapshotId][index] = eligible;
            if (eligible) {
                _sealParticipantForSnapshot(participant);
                weight = participant.pendingSnapshotWeight;
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
        if (!snapshotInProgress && block.timestamp >= activeEpochEnd) {
            revert DrawDurationExceeded();
        }
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

    function _checkpointParticipant(Participant storage participant) internal {
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
            _sealParticipantAt(participant, activeEpochId, activeEpochId + 1, activeEpochEnd);
        }
        if (
            snapshotInProgress &&
            participant.activationStartedAt != 0 &&
            participant.activationStartedAt <= snapshotCutoffTimestamp &&
            participant.twabEpoch == activeEpochId - 1
        ) {
            _sealParticipantForSnapshot(participant);
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

    function _sealParticipantForSnapshot(Participant storage participant) internal {
        uint256 closedEpoch = activeEpochId - 1;
        if (participant.snapshotSealed && participant.pendingSnapshotEpoch == closedEpoch) return;
        if (participant.twabEpoch != closedEpoch) revert SnapshotCursorMismatch();
        _sealParticipantAt(participant, closedEpoch, activeEpochId, snapshotCutoffTimestamp);
    }

    function _sealParticipantAt(
        Participant storage participant,
        uint256 closedEpoch,
        uint256 nextEpoch,
        uint256 cutoff
    ) internal {
        if (participant.snapshotSealed && participant.pendingSnapshotEpoch == closedEpoch) return;
        if (participant.twabEpoch != closedEpoch) revert SnapshotCursorMismatch();
        uint256 elapsed = cutoff - participant.lastTwabTimestamp;
        euint128 principal128 = FHE.asEuint128(participant.principal);
        euint128 delta = FHE.mul(principal128, uint128(elapsed));
        participant.twabAccumulator = FHE.add(participant.twabAccumulator, delta);
        participant.pendingSnapshotWeight = participant.twabAccumulator;
        participant.pendingSnapshotEpoch = closedEpoch;
        participant.snapshotSealed = true;
        participant.twabAccumulator = FHE.asEuint128(0);
        participant.twabEpoch = nextEpoch;
        participant.lastTwabTimestamp = cutoff;
        FHE.allowThis(participant.pendingSnapshotWeight);
        FHE.allowThis(participant.twabAccumulator);
    }

    function _releaseBond(Participant storage participant, address owner) internal {
        if (!participant.bondHeld) return;
        participant.bondHeld = false;
        _creditBond(owner, REGISTRATION_BOND_WEI);
    }

    function _clearParticipant(uint256 slotIndex, address owner, ParticipantState state) internal {
        if (snapshotInProgress && _participants[slotIndex].state == ParticipantState.ACTIVE) {
            _snapshotLocked[currentSnapshotId][slotIndex] = true;
        }
        if (
            activeParticipantCount > 0 && _participants[slotIndex].state == ParticipantState.ACTIVE
        ) {
            --activeParticipantCount;
        }
        _participantIndexPlusOne[owner] = 0;
        _participants[slotIndex].state = state;
        _participants[slotIndex].owner = address(0);
        _participants[slotIndex].bondHeld = false;
        emit ParticipantStateChanged(owner, slotIndex, state);
    }
}
