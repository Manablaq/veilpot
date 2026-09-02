export const VEILPOT_AUTOPILOT_VAULT_ABI = [
  {
    inputs: [
      {
        internalType: "contract IERC7984",
        name: "token",
        type: "address",
      },
      {
        internalType: "contract IVeilpotAutopilotPool",
        name: "pool_",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "ExecutionExpired",
    type: "error",
  },
  {
    inputs: [],
    name: "ExecutionTooEarly",
    type: "error",
  },
  {
    inputs: [],
    name: "FundingCallerMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "FundingSourceMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidExecutionIndex",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidFundingData",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidOwner",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidParticipantBinding",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidPlan",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidPlanState",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidPool",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidRegistrationVersion",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidSchedule",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidScheduleProof",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidToken",
    type: "error",
  },
  {
    inputs: [],
    name: "PlanNonceMismatch",
    type: "error",
  },
  {
    inputs: [],
    name: "Reentrancy",
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
    name: "ZamaProtocolUnsupported",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "MissedWindowAdvanced",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "planNonce",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "slotIndex",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "registrationVersion",
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
        internalType: "uint16",
        name: "executionCount",
        type: "uint16",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "scheduleRoot",
        type: "bytes32",
      },
    ],
    name: "PlanCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "executor",
        type: "address",
      },
    ],
    name: "PlanExecuted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "PlanFunded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "PlanFundsWithdrawn",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    name: "PlanPaused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    name: "PlanResumed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    name: "PlanRevoked",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "PlanSkipped",
    type: "event",
  },
  {
    inputs: [],
    name: "MAX_AUTOPILOT_EXECUTIONS",
    outputs: [
      {
        internalType: "uint16",
        name: "",
        type: "uint16",
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
    inputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
      {
        internalType: "uint64",
        name: "notBefore",
        type: "uint64",
      },
      {
        internalType: "uint64",
        name: "notAfter",
        type: "uint64",
      },
      {
        internalType: "bytes32[]",
        name: "proof",
        type: "bytes32[]",
      },
    ],
    name: "advanceMissed",
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
        name: "planNonce",
        type: "uint256",
      },
      {
        internalType: "bytes32",
        name: "scheduleRoot",
        type: "bytes32",
      },
      {
        internalType: "uint16",
        name: "executionCount",
        type: "uint16",
      },
      {
        internalType: "externalEuint64",
        name: "encryptedPeriodAmount",
        type: "bytes32",
      },
      {
        internalType: "externalEuint64",
        name: "encryptedLifetimeCap",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "inputProof",
        type: "bytes",
      },
    ],
    name: "createPlan",
    outputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
      {
        internalType: "uint64",
        name: "notBefore",
        type: "uint64",
      },
      {
        internalType: "uint64",
        name: "notAfter",
        type: "uint64",
      },
      {
        internalType: "bytes32[]",
        name: "proof",
        type: "bytes32[]",
      },
    ],
    name: "execute",
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
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "nextPlanNonce",
    outputs: [
      {
        internalType: "uint256",
        name: "nonce",
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
        name: "operator",
        type: "address",
      },
      {
        internalType: "address",
        name: "from",
        type: "address",
      },
      {
        internalType: "euint64",
        name: "amount",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "data",
        type: "bytes",
      },
    ],
    name: "onConfidentialTransferReceived",
    outputs: [
      {
        internalType: "ebool",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    name: "pausePlan",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    name: "planAmountHandles",
    outputs: [
      {
        internalType: "euint64",
        name: "periodAmount",
        type: "bytes32",
      },
      {
        internalType: "euint64",
        name: "remainingBudget",
        type: "bytes32",
      },
      {
        internalType: "euint64",
        name: "funds",
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
        name: "planNonce",
        type: "uint256",
      },
    ],
    name: "planIdFor",
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
    inputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    name: "planMetadata",
    outputs: [
      {
        internalType: "enum VeilpotAutopilotVault.PlanState",
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
        name: "planNonce",
        type: "uint256",
      },
      {
        internalType: "bytes32",
        name: "scheduleRoot",
        type: "bytes32",
      },
      {
        internalType: "uint16",
        name: "executionCount",
        type: "uint16",
      },
      {
        internalType: "uint16",
        name: "nextExecutionIndex",
        type: "uint16",
      },
      {
        internalType: "uint64",
        name: "lastWindowNotAfter",
        type: "uint64",
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
        internalType: "contract IVeilpotAutopilotPool",
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
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    name: "resumePlan",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    name: "revokePlan",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
      {
        internalType: "uint64",
        name: "notBefore",
        type: "uint64",
      },
      {
        internalType: "uint64",
        name: "notAfter",
        type: "uint64",
      },
    ],
    name: "scheduleLeaf",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
      {
        internalType: "uint64",
        name: "notBefore",
        type: "uint64",
      },
      {
        internalType: "uint64",
        name: "notAfter",
        type: "uint64",
      },
      {
        internalType: "bytes32[]",
        name: "proof",
        type: "bytes32[]",
      },
    ],
    name: "skipNext",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "planId",
        type: "bytes32",
      },
    ],
    name: "withdrawPlanFunds",
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
] as const;

export const VEILPOT_CONFIDENTIAL_TRANSFER_AND_CALL_ABI = [
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "externalEuint64", name: "encryptedAmount", type: "bytes32" },
      { internalType: "bytes", name: "inputProof", type: "bytes" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "confidentialTransferAndCall",
    outputs: [{ internalType: "euint64", name: "transferred", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
