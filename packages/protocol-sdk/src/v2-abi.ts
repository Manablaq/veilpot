// AUTO-GENERATED FROM THE AUDITED HARDHAT ARTIFACTS.
// Do not hand-edit ABI entries. Regenerate from the exact compiled artifacts.

export const VEILPOT_POOL_V2_ABI = [
  {
    inputs: [
      {
        internalType: "contract IERC7984",
        name: "token",
        type: "address",
      },
      {
        internalType: "address",
        name: "prizeReserve_",
        type: "address",
      },
      {
        internalType: "address",
        name: "autopilotVault_",
        type: "address",
      },
      {
        internalType: "address",
        name: "yieldAdapterV2_",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "ActivationProofExpired",
    type: "error",
  },
  {
    inputs: [],
    name: "ActivationProofNotExpired",
    type: "error",
  },
  {
    inputs: [],
    name: "AlreadyRegistered",
    type: "error",
  },
  {
    inputs: [],
    name: "CallerDepositorMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "CapacityFull",
    type: "error",
  },
  {
    inputs: [],
    name: "DepositNonceMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "DeregistrationNotActive",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawBatchMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawDurationExceeded",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawEvidenceAlreadyPrepared",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawEvidenceNotPrepared",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawSnapshotMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawWinnerComplete",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawWinnerIncomplete",
    type: "error",
  },
  {
    inputs: [],
    name: "HistoricalBeneficiaryMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidBond",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidDraw",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidDrawBucketEvidence",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidDrawIndex",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum VeilpotPoolV2.DrawState",
        name: "expected",
        type: "uint8",
      },
      {
        internalType: "enum VeilpotPoolV2.DrawState",
        name: "actual",
        type: "uint8",
      },
    ],
    name: "InvalidDrawState",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidKMSSignatures",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidParticipant",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidPrizeReserve",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidRecipient",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum VeilpotPoolV2.ParticipantState",
        name: "expected",
        type: "uint8",
      },
      {
        internalType: "enum VeilpotPoolV2.ParticipantState",
        name: "actual",
        type: "uint8",
      },
    ],
    name: "InvalidState",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidToken",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidYieldAdapter",
    type: "error",
  },
  {
    inputs: [],
    name: "MissingEngineAcl",
    type: "error",
  },
  {
    inputs: [],
    name: "MissingPrizeAcl",
    type: "error",
  },
  {
    inputs: [],
    name: "OnlyPrizeReserve",
    type: "error",
  },
  {
    inputs: [],
    name: "OperatorUnauthorized",
    type: "error",
  },
  {
    inputs: [],
    name: "PoolDomainMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "Reentrancy",
    type: "error",
  },
  {
    inputs: [],
    name: "RefundAttemptPending",
    type: "error",
  },
  {
    inputs: [],
    name: "RefundProofMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "RegistrationVersionMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "ReservationExpired",
    type: "error",
  },
  {
    inputs: [],
    name: "ReservationNonceMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "ReservationNotExpired",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "handle",
        type: "bytes32",
      },
      {
        internalType: "address",
        name: "sender",
        type: "address",
      },
    ],
    name: "SenderNotAllowedToUseHandle",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotAlreadyDrawn",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotCursorMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotInProgress",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotIncomplete",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotNotInProgress",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotNotReadyForDraw",
    type: "error",
  },
  {
    inputs: [],
    name: "WithdrawalNonceMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "WithdrawalNotActive",
    type: "error",
  },
  {
    inputs: [],
    name: "ZamaProtocolUnsupported",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "participant",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "BondRefundCredited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "participant",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "BondWithdrawn",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "participant",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "slot",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "depositNonce",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "activationDeadline",
        type: "uint256",
      },
    ],
    name: "DepositPending",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
    ],
    name: "DrawBatchGenerated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "success",
        type: "bool",
      },
    ],
    name: "DrawBatchResolved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "bucketExponent",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "enum VeilpotPoolV2.DrawState",
        name: "state",
        type: "uint8",
      },
    ],
    name: "DrawBucketResolved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "DrawFinalized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotEpoch",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
    ],
    name: "DrawStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "start",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "end",
        type: "uint256",
      },
    ],
    name: "DrawWinnerChunkProcessed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "participant",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "slot",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "expiry",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "registrationVersion",
        type: "uint256",
      },
    ],
    name: "ParticipantReserved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "participant",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "slot",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "enum VeilpotPoolV2.ParticipantState",
        name: "state",
        type: "uint8",
      },
    ],
    name: "ParticipantStateChanged",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32[]",
        name: "handlesList",
        type: "bytes32[]",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "abiEncodedCleartexts",
        type: "bytes",
      },
    ],
    name: "PublicDecryptionVerified",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "participant",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "slot",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "refundAttemptNonce",
        type: "uint256",
      },
    ],
    name: "RefundAttemptStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "start",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "end",
        type: "uint256",
      },
    ],
    name: "SnapshotChunkProcessed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "cutoffTimestamp",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
    ],
    name: "SnapshotReady",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "cutoffTimestamp",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
    ],
    name: "SnapshotStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "participant",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "withdrawalNonce",
        type: "uint256",
      },
    ],
    name: "WithdrawalProcessed",
    type: "event",
  },
  {
    inputs: [],
    name: "DRAW_BATCH_SIZE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_DRAW_BUCKET_EXPONENT",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_DRAW_DURATION_SECONDS",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_DRAW_TOTAL",
    outputs: [
      {
        internalType: "uint128",
        name: "",
        type: "uint128",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_PARTICIPANTS",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_USER_PRINCIPAL_BASE_UNITS",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MIN_REGISTRATION_DEPOSIT_BASE_UNITS",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "REGISTRATION_ACTIVATION_PROOF_TTL_SECONDS",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "REGISTRATION_BOND_WEI",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "REGISTRATION_RESERVATION_TTL_SECONDS",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "SNAPSHOT_CHUNK_SIZE",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "SUPPORTED_REGISTRATION_VERSION",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "WINNER_CHUNK_SIZE",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "activeEpochEnd",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "activeEpochId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "activeEpochStart",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "activeParticipantCount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "aggregatePendingHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "aggregatePrincipalHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "beginDrawSnapshotImport",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "canonicalReceivedHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "confidentialProtocolId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "confidentialToken",
    outputs: [
      {
        internalType: "contract IERC7984",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "currentSnapshotId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "externalEuint64",
        name: "encryptedAmount",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "inputProof",
        type: "bytes",
      },
      {
        internalType: "address",
        name: "depositor",
        type: "address",
      },
      {
        internalType: "address",
        name: "claimedPool",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "claimedVersion",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "depositNonce",
        type: "uint256",
      },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "deregistrationZeroHandle",
    outputs: [
      {
        internalType: "ebool",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
      {
        internalType: "euint64",
        name: "prizeAmount",
        type: "bytes32",
      },
    ],
    name: "derivePrizeEntitlement",
    outputs: [
      {
        internalType: "euint64",
        name: "entitlement",
        type: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawBatchHandles",
    outputs: [
      {
        internalType: "euint128",
        name: "target",
        type: "bytes32",
      },
      {
        internalType: "ebool",
        name: "success",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "proofContext",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawBucketEvidenceHandles",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawMetadata",
    outputs: [
      {
        internalType: "enum VeilpotPoolV2.DrawState",
        name: "state",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotEpochId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
      {
        internalType: "uint8",
        name: "bucketExponent",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "winnerCursor",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "drawSnapshotImportMetadata",
    outputs: [
      {
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "cursor",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "initialized",
        type: "bool",
      },
      {
        internalType: "bool",
        name: "isSealed",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epochId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "epochBeneficiary",
    outputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "registrationVersion",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "bound",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epochId",
        type: "uint256",
      },
    ],
    name: "epochParticipantBound",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epochId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "epochSnapshotWeightBound",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epochId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "epochSnapshotWeightHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "expirePendingActivation",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "expireReservation",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "finalizeDraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "finalizeDrawSnapshotImport",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "finalizeSnapshot",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "generateDrawCandidateBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "nextDepositNonce",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextDrawId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextDrawSnapshotId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextReservationNonce",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextSnapshotId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "nextWithdrawNonce",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "participantMetadata",
    outputs: [
      {
        internalType: "enum VeilpotPoolV2.ParticipantState",
        name: "state",
        type: "uint8",
      },
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "registrationVersion",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "reservationExpiry",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "activationStartedAt",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "activationDeadline",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "refundAttemptNonce",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "bondHeld",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "participantState",
    outputs: [
      {
        internalType: "enum VeilpotPoolV2.ParticipantState",
        name: "",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "pendingAmountHandle",
    outputs: [
      {
        internalType: "euint64",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "pendingBondRefund",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "prepareDeregistration",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "prepareDrawBucketEvidence",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "principalHandle",
    outputs: [
      {
        internalType: "euint64",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "prizeReserve",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "processDrawShardSelectionChunk",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "processDrawSnapshotImportChunk",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "processDrawWinnerShard",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "processSnapshotChunk",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        internalType: "euint64",
        name: "authorizedAmount",
        type: "bytes32",
      },
    ],
    name: "pullAutopilotContribution",
    outputs: [
      {
        internalType: "euint64",
        name: "actualTransferred",
        type: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "recognizeRoundYield",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
    ],
    name: "reduceDrawCandidateBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "refundAttempt",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "refundCompleteHandle",
    outputs: [
      {
        internalType: "ebool",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "refundRemainingHandle",
    outputs: [
      {
        internalType: "euint64",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "reserveParticipantSlot",
    outputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "clearZero",
        type: "bool",
      },
      {
        internalType: "bytes",
        name: "decryptionProof",
        type: "bytes",
      },
    ],
    name: "settleDeregistration",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "registrationVersion",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "refundAttemptNonce",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "clearComplete",
        type: "bool",
      },
      {
        internalType: "bytes",
        name: "decryptionProof",
        type: "bytes",
      },
    ],
    name: "settleRefundCompletion",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "registrationVersion",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "clearSatisfied",
        type: "bool",
      },
      {
        internalType: "bytes",
        name: "decryptionProof",
        type: "bytes",
      },
    ],
    name: "settleThreshold",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "slotReusableAfter",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "snapshotBeneficiary",
    outputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "registrationVersion",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "bound",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "snapshotCursor",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "snapshotCutoffTimestamp",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "snapshotDrawId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "snapshotEpoch",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "snapshotInProgress",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "snapshotMetadata",
    outputs: [
      {
        internalType: "uint256",
        name: "cutoff",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "cursor",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "inProgress",
        type: "bool",
      },
      {
        internalType: "bool",
        name: "ready",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "snapshotParticipantCount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "snapshotPrizeDrawId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "snapshotReady",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "snapshotTotalHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "snapshotWeightHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "startDraw",
    outputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "startSnapshot",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "startWinnerResolution",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "clearSuccess",
        type: "bool",
      },
      {
        internalType: "bytes",
        name: "decryptionProof",
        type: "bytes",
      },
    ],
    name: "submitDrawBatchEvidence",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint8",
        name: "clearBucketExponent",
        type: "uint8",
      },
      {
        internalType: "bool",
        name: "clearTotalIsZero",
        type: "bool",
      },
      {
        internalType: "bool",
        name: "clearTotalIsSupported",
        type: "bool",
      },
      {
        internalType: "bytes",
        name: "decryptionProof",
        type: "bytes",
      },
    ],
    name: "submitDrawBucketEvidence",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "thresholdHandle",
    outputs: [
      {
        internalType: "ebool",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "twabAccumulatorHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "twabMetadata",
    outputs: [
      {
        internalType: "euint128",
        name: "accumulator",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "lastCheckpoint",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
      {
        internalType: "euint128",
        name: "pendingWeight",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "pendingEpoch",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "isSealed",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "veilDrawEngine",
    outputs: [
      {
        internalType: "contract VeilDrawEngineV2",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "externalEuint64",
        name: "encryptedRequestedAmount",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "inputProof",
        type: "bytes",
      },
      {
        internalType: "uint256",
        name: "registrationVersion",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "reservationNonce",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "withdrawalNonce",
        type: "uint256",
      },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawBond",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const VEILDRAW_ENGINE_V2_ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "pool_",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "DrawBatchMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawEvidenceAlreadyPrepared",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawEvidenceNotPrepared",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawShardSelectionComplete",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawSnapshotMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawWinnerIncomplete",
    type: "error",
  },
  {
    inputs: [],
    name: "DrawWinnerResolutionComplete",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidDraw",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidDrawBucketEvidence",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidDrawIndex",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum VeilDrawEngineV2.DrawState",
        name: "expected",
        type: "uint8",
      },
      {
        internalType: "enum VeilDrawEngineV2.DrawState",
        name: "actual",
        type: "uint8",
      },
    ],
    name: "InvalidDrawState",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidKMSSignatures",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidParticipantCount",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidPool",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidPrizeIndex",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum VeilDrawEngineV2.ResolutionPhase",
        name: "expected",
        type: "uint8",
      },
      {
        internalType: "enum VeilDrawEngineV2.ResolutionPhase",
        name: "actual",
        type: "uint8",
      },
    ],
    name: "InvalidResolutionPhase",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidShard",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidShardBoundary",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidSlot",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidSnapshotId",
    type: "error",
  },
  {
    inputs: [],
    name: "MissingPoolGrant",
    type: "error",
  },
  {
    inputs: [],
    name: "MissingPrizeAcl",
    type: "error",
  },
  {
    inputs: [],
    name: "OnlyPool",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotAlreadyDrawn",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotAlreadyInitialized",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotAlreadySealed",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotCursorMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotNotComplete",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotNotInitialized",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotNotReadyForDraw",
    type: "error",
  },
  {
    inputs: [],
    name: "SnapshotNotSealed",
    type: "error",
  },
  {
    inputs: [],
    name: "ZamaProtocolUnsupported",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
    ],
    name: "DrawBatchGenerated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "success",
        type: "bool",
      },
    ],
    name: "DrawBatchResolved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "bucketExponent",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "enum VeilDrawEngineV2.DrawState",
        name: "state",
        type: "uint8",
      },
    ],
    name: "DrawBucketResolved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "DrawFinalized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "firstDrawId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "lastDrawId",
        type: "uint256",
      },
    ],
    name: "DrawRoundStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "startShard",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "endShard",
        type: "uint256",
      },
    ],
    name: "DrawShardSelectionChunkProcessed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint8",
        name: "prizeIndex",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
    ],
    name: "DrawStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "DrawWinnerResolutionStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "shardIndex",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "winnerCursor",
        type: "uint256",
      },
    ],
    name: "DrawWinnerShardProcessed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32[]",
        name: "handlesList",
        type: "bytes32[]",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "abiEncodedCleartexts",
        type: "bytes",
      },
    ],
    name: "PublicDecryptionVerified",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "shardIndex",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "start",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "end",
        type: "uint256",
      },
    ],
    name: "SnapshotChunkImported",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
    ],
    name: "SnapshotImportSealed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
    ],
    name: "SnapshotImportStarted",
    type: "event",
  },
  {
    inputs: [],
    name: "DRAW_BATCH_SIZE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_DRAW_BUCKET_EXPONENT",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_DRAW_TOTAL",
    outputs: [
      {
        internalType: "uint128",
        name: "",
        type: "uint128",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_PARTICIPANTS",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "PRIZE_SLOTS",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "SHARD_COUNT",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "SHARD_SELECTION_CHUNK_SIZE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "SHARD_SIZE",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
    ],
    name: "beginSnapshotImport",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "confidentialProtocolId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
      {
        internalType: "euint64",
        name: "prizeAmount",
        type: "bytes32",
      },
    ],
    name: "derivePrizeEntitlement",
    outputs: [
      {
        internalType: "euint64",
        name: "entitlement",
        type: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawAcceptedTargetHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawBatchHandles",
    outputs: [
      {
        internalType: "euint128",
        name: "target",
        type: "bytes32",
      },
      {
        internalType: "ebool",
        name: "success",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "proofContext",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawBucketEvidenceHandles",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "drawCandidateHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawMetadataV2",
    outputs: [
      {
        internalType: "enum VeilDrawEngineV2.DrawState",
        name: "state",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
      {
        internalType: "uint8",
        name: "bucketExponent",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "bucketAttemptNonce",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawPrizeIndex",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "stage",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "attemptNonce",
        type: "uint256",
      },
    ],
    name: "drawProofContextValue",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawResolutionHandles",
    outputs: [
      {
        internalType: "euint128",
        name: "shardPrefix",
        type: "bytes32",
      },
      {
        internalType: "euint128",
        name: "runningPrefix",
        type: "bytes32",
      },
      {
        internalType: "euint128",
        name: "winnerCount",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawResolutionMetadata",
    outputs: [
      {
        internalType: "enum VeilDrawEngineV2.ResolutionPhase",
        name: "phase",
        type: "uint8",
      },
      {
        internalType: "uint256",
        name: "shardSelectionCursor",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "winnerShardCursor",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "winnerCursor",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "shardIndex",
        type: "uint256",
      },
    ],
    name: "drawSelectedShardHandle",
    outputs: [
      {
        internalType: "ebool",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "shardIndex",
        type: "uint256",
      },
    ],
    name: "drawShardPrefixHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawTotalHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "drawWinnerPredicateHandle",
    outputs: [
      {
        internalType: "ebool",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "finalizeDraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "generateDrawCandidateBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "start",
        type: "uint256",
      },
      {
        internalType: "euint128[8]",
        name: "weights",
        type: "bytes32[8]",
      },
    ],
    name: "importSnapshotChunk",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "nextDrawId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextDrawSnapshotId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pool",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "prepareDrawBucketEvidence",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "processDrawShardSelectionChunk",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "processDrawWinnerShard",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
    ],
    name: "reduceDrawCandidateBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "sealSnapshotImport",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "snapshotDrawId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "snapshotMetadata",
    outputs: [
      {
        internalType: "uint256",
        name: "participantCount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "cursor",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "initialized",
        type: "bool",
      },
      {
        internalType: "bool",
        name: "isSealed",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "snapshotPrizeDrawId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "shardIndex",
        type: "uint256",
      },
    ],
    name: "snapshotShardTotalHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "snapshotTotalHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
    ],
    name: "snapshotWeightHandle",
    outputs: [
      {
        internalType: "euint128",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "startDrawRound",
    outputs: [
      {
        internalType: "uint256[3]",
        name: "drawIds",
        type: "uint256[3]",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "startWinnerResolution",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "batchId",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "clearSuccess",
        type: "bool",
      },
      {
        internalType: "bytes",
        name: "decryptionProof",
        type: "bytes",
      },
    ],
    name: "submitDrawBatchEvidence",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint8",
        name: "clearBucketExponent",
        type: "uint8",
      },
      {
        internalType: "bool",
        name: "clearTotalIsZero",
        type: "bool",
      },
      {
        internalType: "bool",
        name: "clearTotalIsSupported",
        type: "bool",
      },
      {
        internalType: "bytes",
        name: "decryptionProof",
        type: "bytes",
      },
    ],
    name: "submitDrawBucketEvidence",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const VEILPOT_ADAPTER_V2_ABI = [
  {
    inputs: [
      {
        internalType: "contract IERC7984",
        name: "token_",
        type: "address",
      },
      {
        internalType: "address",
        name: "pool_",
        type: "address",
      },
      {
        internalType: "address",
        name: "reserve_",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "CallerFunderMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "FundingNonceMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidChildDraws",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidKMSSignatures",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidPool",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidReserve",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidReserveAcknowledgement",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidRound",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidToken",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "enum VeilpotSimulatedYieldAdapterV2.YieldState",
        name: "expected",
        type: "uint8",
      },
      {
        internalType: "enum VeilpotSimulatedYieldAdapterV2.YieldState",
        name: "actual",
        type: "uint8",
      },
    ],
    name: "InvalidYieldState",
    type: "error",
  },
  {
    inputs: [],
    name: "MissingFundingTransferAcl",
    type: "error",
  },
  {
    inputs: [],
    name: "MissingPoolAcl",
    type: "error",
  },
  {
    inputs: [],
    name: "MissingSweepTransferAcl",
    type: "error",
  },
  {
    inputs: [],
    name: "OnlyPool",
    type: "error",
  },
  {
    inputs: [],
    name: "OperatorUnauthorized",
    type: "error",
  },
  {
    inputs: [],
    name: "Reentrancy",
    type: "error",
  },
  {
    inputs: [],
    name: "RoundAlreadyRecognized",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "handle",
        type: "bytes32",
      },
      {
        internalType: "address",
        name: "sender",
        type: "address",
      },
    ],
    name: "SenderNotAllowedToUseHandle",
    type: "error",
  },
  {
    inputs: [],
    name: "SweepAttemptMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "UnknownDrawYield",
    type: "error",
  },
  {
    inputs: [],
    name: "YieldAlreadyRecognized",
    type: "error",
  },
  {
    inputs: [],
    name: "ZamaProtocolUnsupported",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "zeroYield",
        type: "bool",
      },
    ],
    name: "DrawYieldRecognitionSettled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint8",
        name: "prizeIndex",
        type: "uint8",
      },
    ],
    name: "DrawYieldRecognized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "sweepAttemptNonce",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "complete",
        type: "bool",
      },
    ],
    name: "DrawYieldSweepSettled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "sweepAttemptNonce",
        type: "uint256",
      },
    ],
    name: "DrawYieldSweepStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32[]",
        name: "handlesList",
        type: "bytes32[]",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "abiEncodedCleartexts",
        type: "bytes",
      },
    ],
    name: "PublicDecryptionVerified",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "firstDrawId",
        type: "uint256",
      },
    ],
    name: "RoundYieldRecognized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "funder",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "fundingNonce",
        type: "uint256",
      },
    ],
    name: "YieldLiquidityFunded",
    type: "event",
  },
  {
    inputs: [],
    name: "BPS_DENOMINATOR",
    outputs: [
      {
        internalType: "uint128",
        name: "",
        type: "uint128",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "DAY_SECONDS",
    outputs: [
      {
        internalType: "uint128",
        name: "",
        type: "uint128",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_GROSS_SYNTHETIC_YIELD",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "PRIZE_COUNT",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "RATE_BPS_PER_DAY",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "YIELD_DENOMINATOR",
    outputs: [
      {
        internalType: "uint128",
        name: "",
        type: "uint128",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "YIELD_PROFILE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "confidentialProtocolId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "confidentialToken",
    outputs: [
      {
        internalType: "contract IERC7984",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawRoundMetadata",
    outputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint8",
        name: "prizeIndex",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "drawYieldHandles",
    outputs: [
      {
        internalType: "enum VeilpotSimulatedYieldAdapterV2.YieldState",
        name: "state",
        type: "uint8",
      },
      {
        internalType: "euint64",
        name: "grossYield",
        type: "bytes32",
      },
      {
        internalType: "euint64",
        name: "recognizedYield",
        type: "bytes32",
      },
      {
        internalType: "euint64",
        name: "remainingUnswept",
        type: "bytes32",
      },
      {
        internalType: "ebool",
        name: "statusPredicate",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "proofContext",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "sweepAttemptNonce",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "externalEuint64",
        name: "encryptedAmount",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "inputProof",
        type: "bytes",
      },
      {
        internalType: "address",
        name: "funder",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "fundingNonce",
        type: "uint256",
      },
    ],
    name: "fundYieldLiquidity",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "liquidityHandles",
    outputs: [
      {
        internalType: "euint64",
        name: "fundedYieldLiquidity",
        type: "bytes32",
      },
      {
        internalType: "euint64",
        name: "committedUnswept",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "nextFundingNonce",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pool",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
      {
        internalType: "uint256[3]",
        name: "drawIds",
        type: "uint256[3]",
      },
      {
        internalType: "euint128",
        name: "rawTotalTwab",
        type: "bytes32",
      },
    ],
    name: "recognizeRoundYield",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "reserve",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "roundDrawIds",
    outputs: [
      {
        internalType: "uint256[3]",
        name: "drawIds",
        type: "uint256[3]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "snapshotId",
        type: "uint256",
      },
    ],
    name: "roundRecognized",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "clearZeroYield",
        type: "bool",
      },
      {
        internalType: "bytes",
        name: "decryptionProof",
        type: "bytes",
      },
    ],
    name: "settleRecognition",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "sweepAttemptNonce",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "clearComplete",
        type: "bool",
      },
      {
        internalType: "bytes",
        name: "decryptionProof",
        type: "bytes",
      },
    ],
    name: "settleSweepCompletion",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "drawId",
        type: "uint256",
      },
    ],
    name: "sweepYield",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
