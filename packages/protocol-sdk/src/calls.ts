import { VEILPOT_ADAPTER_ABI, VEILPOT_POOL_ABI, VEILPOT_RESERVE_ABI } from "./abi.js";
import {
  assertClaimSignature,
  assertFrozenClaimAuthorization,
  type ClaimAuthorization,
} from "./claim.js";
import {
  REGISTRATION_BOND_WEI,
  SUPPORTED_REGISTRATION_VERSION,
  VEILPOT_SEPOLIA_DEPLOYMENT,
} from "./deployment.js";
import { assertAddress, assertUint256, sameAddress, type Address, type Hex } from "./types.js";
import type { EncryptedEuint64Input } from "./zama.js";

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
