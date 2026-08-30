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
    uint256 public constant SUPPORTED_REGISTRATION_VERSION = 1;

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
    }

    IERC7984 public immutable confidentialToken;
    Participant[128] private _participants;
    mapping(address => uint256) private _participantIndexPlusOne;
    mapping(address => uint256) public nextDepositNonce;
    mapping(address => uint256) public pendingBondRefund;
    uint256 public nextReservationNonce;
    uint256 public activeParticipantCount;
    euint128 private _aggregatePrincipal;
    euint128 private _aggregatePending;
    euint128 private _canonicalReceived;
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
            FHE.allowThis(candidate.pendingAmount);
            FHE.allowThis(candidate.thresholdSatisfied);
            FHE.allowThis(candidate.principal);
            FHE.allowThis(candidate.deregistrationZero);
            FHE.allowThis(candidate.refundRemaining);
            FHE.allowThis(candidate.refundComplete);
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
        participant.thresholdSatisfied = FHE.ge(
            actualTransferred,
            MIN_REGISTRATION_DEPOSIT_BASE_UNITS
        );
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

    function _releaseBond(Participant storage participant, address owner) internal {
        if (!participant.bondHeld) return;
        participant.bondHeld = false;
        _creditBond(owner, REGISTRATION_BOND_WEI);
    }

    function _clearParticipant(uint256 slotIndex, address owner, ParticipantState state) internal {
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
