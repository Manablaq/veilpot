import {
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_CONFIDENTIAL_TRANSFER_AND_CALL_ABI,
} from "./autopilot-abi.js";
import { VEILPOT_ADAPTER_ABI, VEILPOT_POOL_ABI, VEILPOT_RESERVE_ABI } from "./abi.js";
import {
  assertClaimSignature,
  assertFrozenClaimAuthorization,
  type ClaimAuthorization,
} from "./claim.js";
import {
  MAX_AUTOPILOT_EXECUTIONS,
  REGISTRATION_BOND_WEI,
  SUPPORTED_REGISTRATION_VERSION,
  VEILPOT_SEPOLIA_DEPLOYMENT,
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
import type { EncryptedAutopilotPlanAmounts, EncryptedEuint64Input } from "./zama.js";

function assertEncryptedBinding(
  encrypted: EncryptedEuint64Input,
  expectedContract: Address,
  expectedUser: Address,
): void {
  if (
    !sameAddress(encrypted.contractAddress, expectedContract) ||
    !sameAddress(encrypted.userAddress, expectedUser)
  ) {
    throw new Error("encrypted input is bound to the wrong contract or user");
  }
}

export function buildReserveParticipantSlotCall() {
  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
    abi: VEILPOT_POOL_ABI,
    functionName: "reserveParticipantSlot",
    args: [] as const,
    value: REGISTRATION_BOND_WEI,
  } as const;
}

export interface DepositCallInput {
  readonly encrypted: EncryptedEuint64Input;
  readonly depositor: Address;
  readonly reservationNonce: bigint;
  readonly depositNonce: bigint;
}

export function buildDepositCall(input: DepositCallInput) {
  assertAddress(input.depositor, "depositor");

  assertUint256(input.reservationNonce, "reservationNonce");

  assertUint256(input.depositNonce, "depositNonce");

  assertEncryptedBinding(input.encrypted, VEILPOT_SEPOLIA_DEPLOYMENT.pool, input.depositor);

  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
    abi: VEILPOT_POOL_ABI,
    functionName: "deposit",
    args: [
      input.encrypted.encryptedValue,
      input.encrypted.inputProof,
      input.depositor,
      VEILPOT_SEPOLIA_DEPLOYMENT.pool,
      SUPPORTED_REGISTRATION_VERSION,
      input.reservationNonce,
      input.depositNonce,
    ] as const,
  } as const;
}

export interface WithdrawalCallInput {
  readonly encrypted: EncryptedEuint64Input;
  readonly caller: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly withdrawalNonce: bigint;
}

export function buildWithdrawalCall(input: WithdrawalCallInput) {
  assertAddress(input.caller, "withdrawal caller");

  assertUint256(input.registrationVersion, "registrationVersion");

  assertUint256(input.reservationNonce, "reservationNonce");

  assertUint256(input.withdrawalNonce, "withdrawalNonce");

  assertEncryptedBinding(input.encrypted, VEILPOT_SEPOLIA_DEPLOYMENT.pool, input.caller);

  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
    abi: VEILPOT_POOL_ABI,
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

export interface YieldFundingCallInput {
  readonly encrypted: EncryptedEuint64Input;
  readonly funder: Address;
  readonly fundingNonce: bigint;
}

export function buildYieldFundingCall(input: YieldFundingCallInput) {
  assertAddress(input.funder, "yield funder");
  assertUint256(input.fundingNonce, "fundingNonce");

  assertEncryptedBinding(input.encrypted, VEILPOT_SEPOLIA_DEPLOYMENT.adapter, input.funder);

  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.adapter,
    abi: VEILPOT_ADAPTER_ABI,
    functionName: "fundYieldLiquidity",
    args: [
      input.encrypted.encryptedValue,
      input.encrypted.inputProof,
      input.funder,
      input.fundingNonce,
    ] as const,
  } as const;
}

export interface SponsorFundingCallInput {
  readonly drawId: bigint;
  readonly encrypted: EncryptedEuint64Input;
  readonly funder: Address;
  readonly fundingNonce: bigint;
}

export function buildSponsorFundingCall(input: SponsorFundingCallInput) {
  assertAddress(input.funder, "sponsor funder");

  assertUint256(input.drawId, "drawId");

  assertUint256(input.fundingNonce, "fundingNonce");

  assertEncryptedBinding(input.encrypted, VEILPOT_SEPOLIA_DEPLOYMENT.reserve, input.funder);

  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
    abi: VEILPOT_RESERVE_ABI,
    functionName: "fundSponsorForDraw",
    args: [
      input.drawId,
      input.encrypted.encryptedValue,
      input.encrypted.inputProof,
      input.funder,
      input.fundingNonce,
    ] as const,
  } as const;
}

export function buildAuthorizeEntitlementDecryptionCall(drawId: bigint, slotIndex: bigint) {
  assertUint256(drawId, "drawId");
  assertUint256(slotIndex, "slotIndex");

  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
    abi: VEILPOT_RESERVE_ABI,
    functionName: "authorizeEntitlementDecryption",
    args: [drawId, slotIndex] as const,
  } as const;
}

export function buildClaimPrizeCall(authorization: ClaimAuthorization, signature: Hex) {
  assertFrozenClaimAuthorization(authorization);

  assertClaimSignature(signature);

  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
    abi: VEILPOT_RESERVE_ABI,
    functionName: "claimPrize",
    args: [authorization, signature] as const,
  } as const;
}

function assertAutopilotPlanEncryptedBinding(
  encrypted: EncryptedAutopilotPlanAmounts,
  expectedUser: Address,
): void {
  if (
    !sameAddress(encrypted.contractAddress, VEILPOT_SEPOLIA_DEPLOYMENT.vault) ||
    !sameAddress(encrypted.userAddress, expectedUser)
  ) {
    throw new Error("Autopilot plan encryption is bound to the wrong Vault or user");
  }
}

function assertScheduleProof(proof: readonly Hex[]): void {
  proof.forEach((entry, index) => {
    assertBytes32(entry, `schedule proof[${String(index)}]`);
  });
}

export interface CreateAutopilotPlanCallInput {
  readonly encrypted: EncryptedAutopilotPlanAmounts;
  readonly owner: Address;
  readonly slotIndex: bigint;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly planNonce: bigint;
  readonly scheduleRoot: Hex;
  readonly executionCount: number;
}

export function buildCreateAutopilotPlanCall(input: CreateAutopilotPlanCallInput) {
  assertAddress(input.owner, "Autopilot owner");
  assertUint256(input.slotIndex, "Autopilot slotIndex");
  assertUint256(input.registrationVersion, "Autopilot registrationVersion");
  assertUint256(input.reservationNonce, "Autopilot reservationNonce");
  assertUint256(input.planNonce, "Autopilot planNonce");
  assertNonzeroBytes32(input.scheduleRoot, "Autopilot scheduleRoot");
  assertUint16(input.executionCount, "Autopilot executionCount");

  if (input.registrationVersion !== SUPPORTED_REGISTRATION_VERSION) {
    throw new RangeError("Autopilot registrationVersion is unsupported");
  }

  if (input.executionCount === 0 || input.executionCount > MAX_AUTOPILOT_EXECUTIONS) {
    throw new RangeError(
      `Autopilot executionCount must be between 1 and ${String(MAX_AUTOPILOT_EXECUTIONS)}`,
    );
  }

  assertAutopilotPlanEncryptedBinding(input.encrypted, input.owner);

  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
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

export interface AutopilotFundingCallInput {
  readonly encrypted: EncryptedEuint64Input;
  readonly owner: Address;
  readonly planId: Hex;
}

export function buildAutopilotFundingCall(input: AutopilotFundingCallInput) {
  assertAddress(input.owner, "Autopilot funding owner");
  assertNonzeroBytes32(input.planId, "Autopilot planId");
  assertEncryptedBinding(
    input.encrypted,
    VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
    input.owner,
  );

  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
    abi: VEILPOT_CONFIDENTIAL_TRANSFER_AND_CALL_ABI,
    functionName: "confidentialTransferAndCall",
    args: [
      VEILPOT_SEPOLIA_DEPLOYMENT.vault,
      input.encrypted.encryptedValue,
      input.encrypted.inputProof,
      input.planId,
    ] as const,
  } as const;
}

export interface AutopilotWindowCallInput {
  readonly planId: Hex;
  readonly index: bigint;
  readonly notBefore: bigint;
  readonly notAfter: bigint;
  readonly proof: readonly Hex[];
}

function validateAutopilotWindow(input: AutopilotWindowCallInput): void {
  assertNonzeroBytes32(input.planId, "Autopilot planId");
  assertUint256(input.index, "Autopilot execution index");
  assertUint64(input.notBefore, "Autopilot notBefore");
  assertUint64(input.notAfter, "Autopilot notAfter");
  if (input.notBefore > input.notAfter) {
    throw new RangeError("Autopilot notBefore must be <= notAfter");
  }
  assertScheduleProof(input.proof);
}

function buildAutopilotWindowCall(
  functionName: "execute" | "skipNext" | "advanceMissed",
  input: AutopilotWindowCallInput,
) {
  validateAutopilotWindow(input);
  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName,
    args: [input.planId, input.index, input.notBefore, input.notAfter, input.proof] as const,
  } as const;
}

export function buildExecuteAutopilotPlanCall(input: AutopilotWindowCallInput) {
  return buildAutopilotWindowCall("execute", input);
}

export function buildSkipAutopilotWindowCall(input: AutopilotWindowCallInput) {
  return buildAutopilotWindowCall("skipNext", input);
}

export function buildAdvanceMissedAutopilotWindowCall(input: AutopilotWindowCallInput) {
  return buildAutopilotWindowCall("advanceMissed", input);
}

function buildAutopilotPlanIdOnlyCall(
  functionName: "pausePlan" | "resumePlan" | "revokePlan" | "withdrawPlanFunds",
  planId: Hex,
) {
  assertNonzeroBytes32(planId, "Autopilot planId");
  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName,
    args: [planId] as const,
  } as const;
}

export function buildPauseAutopilotPlanCall(planId: Hex) {
  return buildAutopilotPlanIdOnlyCall("pausePlan", planId);
}

export function buildResumeAutopilotPlanCall(planId: Hex) {
  return buildAutopilotPlanIdOnlyCall("resumePlan", planId);
}

export function buildRevokeAutopilotPlanCall(planId: Hex) {
  return buildAutopilotPlanIdOnlyCall("revokePlan", planId);
}

export function buildWithdrawAutopilotPlanFundsCall(planId: Hex) {
  return buildAutopilotPlanIdOnlyCall("withdrawPlanFunds", planId);
}

export function buildAutopilotPlanMetadataCall(planId: Hex) {
  assertNonzeroBytes32(planId, "Autopilot planId");
  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName: "planMetadata",
    args: [planId] as const,
  } as const;
}

export function buildAutopilotPlanAmountHandlesCall(planId: Hex) {
  assertNonzeroBytes32(planId, "Autopilot planId");
  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName: "planAmountHandles",
    args: [planId] as const,
  } as const;
}

export function buildAutopilotPlanIdCall(
  owner: Address,
  registrationVersion: bigint,
  reservationNonce: bigint,
  planNonce: bigint,
) {
  assertAddress(owner, "Autopilot owner");
  assertUint256(registrationVersion, "Autopilot registrationVersion");
  assertUint256(reservationNonce, "Autopilot reservationNonce");
  assertUint256(planNonce, "Autopilot planNonce");
  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName: "planIdFor",
    args: [owner, registrationVersion, reservationNonce, planNonce] as const,
  } as const;
}

export function buildAutopilotScheduleLeafCall(
  planId: Hex,
  index: bigint,
  notBefore: bigint,
  notAfter: bigint,
) {
  assertNonzeroBytes32(planId, "Autopilot planId");
  assertUint256(index, "Autopilot execution index");
  assertUint64(notBefore, "Autopilot notBefore");
  assertUint64(notAfter, "Autopilot notAfter");
  if (notBefore > notAfter) throw new RangeError("Autopilot notBefore must be <= notAfter");

  return {
    address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    functionName: "scheduleLeaf",
    args: [planId, index, notBefore, notAfter] as const,
  } as const;
}
