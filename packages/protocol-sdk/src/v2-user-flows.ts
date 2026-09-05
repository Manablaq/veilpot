import {
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_CONFIDENTIAL_TRANSFER_AND_CALL_ABI,
} from "./autopilot-abi.js";
import {
  MAX_AUTOPILOT_EXECUTIONS,
  REGISTRATION_BOND_WEI,
  SUPPORTED_REGISTRATION_VERSION,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
} from "./deployment.js";
import {
  assertAddress,
  assertBytes32,
  assertNonzeroBytes32,
  assertUint16,
  assertUint64,
  assertUint256,
  sameAddress,
  type Address,
  type Hex,
} from "./types.js";
import { VEILPOT_POOL_V2_ABI } from "./v2-abi.js";
import type { EncryptedAutopilotPlanAmounts, EncryptedEuint64Input } from "./zama.js";

function assertV2EncryptedBinding(
  encrypted: EncryptedEuint64Input,
  expectedContract: Address,
  expectedUser: Address,
): void {
  if (
    !sameAddress(encrypted.contractAddress, expectedContract) ||
    !sameAddress(encrypted.userAddress, expectedUser)
  ) {
    throw new Error("V2 encrypted input is bound to the wrong contract or user");
  }
}

export function buildV2ReserveParticipantSlotCall() {
  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    abi: VEILPOT_POOL_V2_ABI,
    functionName: "reserveParticipantSlot",
    args: [] as const,
    value: REGISTRATION_BOND_WEI,
  } as const;
}

export interface V2DepositCallInput {
  readonly encrypted: EncryptedEuint64Input;
  readonly depositor: Address;
  readonly reservationNonce: bigint;
  readonly depositNonce: bigint;
}

export function buildV2DepositCall(input: V2DepositCallInput) {
  assertAddress(input.depositor, "V2 depositor");
  assertUint256(input.reservationNonce, "V2 reservationNonce");
  assertUint256(input.depositNonce, "V2 depositNonce");

  assertV2EncryptedBinding(
    input.encrypted,
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    input.depositor,
  );

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    abi: VEILPOT_POOL_V2_ABI,
    functionName: "deposit",
    args: [
      input.encrypted.encryptedValue,
      input.encrypted.inputProof,
      input.depositor,
      VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      SUPPORTED_REGISTRATION_VERSION,
      input.reservationNonce,
      input.depositNonce,
    ] as const,
  } as const;
}

export interface V2WithdrawalCallInput {
  readonly encrypted: EncryptedEuint64Input;
  readonly caller: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly withdrawalNonce: bigint;
}

export function buildV2WithdrawalCall(input: V2WithdrawalCallInput) {
  assertAddress(input.caller, "V2 withdrawal caller");
  assertUint256(input.registrationVersion, "V2 registrationVersion");
  assertUint256(input.reservationNonce, "V2 reservationNonce");
  assertUint256(input.withdrawalNonce, "V2 withdrawalNonce");

  assertV2EncryptedBinding(input.encrypted, VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool, input.caller);

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    abi: VEILPOT_POOL_V2_ABI,
    functionName: "withdraw",
    args: [
      input.encrypted.encryptedValue,
      input.encrypted.inputProof,
      input.registrationVersion,
      input.reservationNonce,
      input.withdrawalNonce,
    ] as const,
  } as const;
}

function assertV2AutopilotPlanEncryptedBinding(
  encrypted: EncryptedAutopilotPlanAmounts,
  expectedUser: Address,
): void {
  if (
    !sameAddress(encrypted.contractAddress, VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault) ||
    !sameAddress(encrypted.userAddress, expectedUser)
  ) {
    throw new Error("V2 Autopilot encryption is bound to the wrong Vault or user");
  }
}

function assertV2ScheduleProof(proof: readonly Hex[]): void {
  proof.forEach((entry, index) => {
    assertBytes32(entry, `V2 schedule proof[${String(index)}]`);
  });
}

export interface V2CreateAutopilotPlanCallInput {
  readonly encrypted: EncryptedAutopilotPlanAmounts;
  readonly owner: Address;
  readonly slotIndex: bigint;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly planNonce: bigint;
  readonly scheduleRoot: Hex;
  readonly executionCount: number;
}

export function buildV2CreateAutopilotPlanCall(input: V2CreateAutopilotPlanCallInput) {
  assertAddress(input.owner, "V2 Autopilot owner");
  assertUint256(input.slotIndex, "V2 Autopilot slotIndex");
  assertUint256(input.registrationVersion, "V2 Autopilot registrationVersion");
  assertUint256(input.reservationNonce, "V2 Autopilot reservationNonce");
  assertUint256(input.planNonce, "V2 Autopilot planNonce");
  assertNonzeroBytes32(input.scheduleRoot, "V2 Autopilot scheduleRoot");
  assertUint16(input.executionCount, "V2 Autopilot executionCount");

  if (input.registrationVersion !== SUPPORTED_REGISTRATION_VERSION) {
    throw new RangeError("V2 Autopilot registrationVersion is unsupported");
  }

  if (input.executionCount === 0 || input.executionCount > MAX_AUTOPILOT_EXECUTIONS) {
    throw new RangeError(
      `V2 Autopilot executionCount must be between 1 and ${String(MAX_AUTOPILOT_EXECUTIONS)}`,
    );
  }

  assertV2AutopilotPlanEncryptedBinding(input.encrypted, input.owner);

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName: "createPlan",
    args: [
      input.slotIndex,
      input.registrationVersion,
      input.reservationNonce,
      input.planNonce,
      input.scheduleRoot,
      input.executionCount,
      input.encrypted.encryptedPeriodAmount,
      input.encrypted.encryptedLifetimeCap,
      input.encrypted.inputProof,
    ] as const,
  } as const;
}

export interface V2AutopilotFundingCallInput {
  readonly encrypted: EncryptedEuint64Input;
  readonly owner: Address;
  readonly planId: Hex;
}

export function buildV2AutopilotFundingCall(input: V2AutopilotFundingCallInput) {
  assertAddress(input.owner, "V2 Autopilot funding owner");
  assertNonzeroBytes32(input.planId, "V2 Autopilot planId");

  assertV2EncryptedBinding(
    input.encrypted,
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
    input.owner,
  );

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
    abi: VEILPOT_CONFIDENTIAL_TRANSFER_AND_CALL_ABI,
    functionName: "confidentialTransferAndCall",
    args: [
      VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
      input.encrypted.encryptedValue,
      input.encrypted.inputProof,
      input.planId,
    ] as const,
  } as const;
}

export interface V2AutopilotWindowCallInput {
  readonly planId: Hex;
  readonly index: bigint;
  readonly notBefore: bigint;
  readonly notAfter: bigint;
  readonly proof: readonly Hex[];
}

function validateV2AutopilotWindow(input: V2AutopilotWindowCallInput): void {
  assertNonzeroBytes32(input.planId, "V2 Autopilot planId");
  assertUint256(input.index, "V2 Autopilot execution index");
  assertUint64(input.notBefore, "V2 Autopilot notBefore");
  assertUint64(input.notAfter, "V2 Autopilot notAfter");

  if (input.notBefore > input.notAfter) {
    throw new RangeError("V2 Autopilot notBefore must be <= notAfter");
  }

  assertV2ScheduleProof(input.proof);
}

function buildV2AutopilotWindowCall(
  functionName: "execute" | "skipNext" | "advanceMissed",
  input: V2AutopilotWindowCallInput,
) {
  validateV2AutopilotWindow(input);

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName,
    args: [input.planId, input.index, input.notBefore, input.notAfter, input.proof] as const,
  } as const;
}

export function buildV2ExecuteAutopilotPlanCall(input: V2AutopilotWindowCallInput) {
  return buildV2AutopilotWindowCall("execute", input);
}

export function buildV2SkipAutopilotWindowCall(input: V2AutopilotWindowCallInput) {
  return buildV2AutopilotWindowCall("skipNext", input);
}

export function buildV2AdvanceMissedAutopilotWindowCall(input: V2AutopilotWindowCallInput) {
  return buildV2AutopilotWindowCall("advanceMissed", input);
}

function buildV2AutopilotPlanIdOnlyCall(
  functionName: "pausePlan" | "resumePlan" | "revokePlan" | "withdrawPlanFunds",
  planId: Hex,
) {
  assertNonzeroBytes32(planId, "V2 Autopilot planId");

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName,
    args: [planId] as const,
  } as const;
}

export function buildV2PauseAutopilotPlanCall(planId: Hex) {
  return buildV2AutopilotPlanIdOnlyCall("pausePlan", planId);
}

export function buildV2ResumeAutopilotPlanCall(planId: Hex) {
  return buildV2AutopilotPlanIdOnlyCall("resumePlan", planId);
}

export function buildV2RevokeAutopilotPlanCall(planId: Hex) {
  return buildV2AutopilotPlanIdOnlyCall("revokePlan", planId);
}

export function buildV2WithdrawAutopilotPlanFundsCall(planId: Hex) {
  return buildV2AutopilotPlanIdOnlyCall("withdrawPlanFunds", planId);
}

export function buildV2AutopilotPlanMetadataCall(planId: Hex) {
  assertNonzeroBytes32(planId, "V2 Autopilot planId");

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName: "planMetadata",
    args: [planId] as const,
  } as const;
}

export function buildV2AutopilotPlanAmountHandlesCall(planId: Hex) {
  assertNonzeroBytes32(planId, "V2 Autopilot planId");

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName: "planAmountHandles",
    args: [planId] as const,
  } as const;
}

export function buildV2AutopilotPlanIdCall(
  owner: Address,
  registrationVersion: bigint,
  reservationNonce: bigint,
  planNonce: bigint,
) {
  assertAddress(owner, "V2 Autopilot owner");
  assertUint256(registrationVersion, "V2 Autopilot registrationVersion");
  assertUint256(reservationNonce, "V2 Autopilot reservationNonce");
  assertUint256(planNonce, "V2 Autopilot planNonce");

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName: "planIdFor",
    args: [owner, registrationVersion, reservationNonce, planNonce] as const,
  } as const;
}

export function buildV2AutopilotScheduleLeafCall(
  planId: Hex,
  index: bigint,
  notBefore: bigint,
  notAfter: bigint,
) {
  assertNonzeroBytes32(planId, "V2 Autopilot planId");
  assertUint256(index, "V2 Autopilot execution index");
  assertUint64(notBefore, "V2 Autopilot notBefore");
  assertUint64(notAfter, "V2 Autopilot notAfter");

  if (notBefore > notAfter) {
    throw new RangeError("V2 Autopilot notBefore must be <= notAfter");
  }

  return {
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName: "scheduleLeaf",
    args: [planId, index, notBefore, notAfter] as const,
  } as const;
}
