import type { ZamaSDK } from "@zama-fhe/sdk";

import { VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT, VEILPOT_SEPOLIA_DEPLOYMENT } from "./deployment.js";
import { assertAddress, assertHex, assertUint64, type Address, type Hex } from "./types.js";

export type VeilpotZamaEncryptionClient = Pick<ZamaSDK, "encrypt">;

export interface EncryptedEuint64Input {
  readonly encryptedValue: Hex;
  readonly inputProof: Hex;
  readonly contractAddress: Address;
  readonly userAddress: Address;
}

export interface EncryptedAutopilotPlanAmounts {
  readonly encryptedPeriodAmount: Hex;
  readonly encryptedLifetimeCap: Hex;
  readonly inputProof: Hex;
  readonly contractAddress: Address;
  readonly userAddress: Address;
}

export interface ExplicitDecryptionRequest {
  readonly encryptedValue: Hex;
  readonly contractAddress: Address;
  readonly purpose:
    | "ENTITLEMENT_USER_OPT_IN"
    | "TOKEN_BALANCE_USER_OPT_IN"
    | "AUTOPILOT_PLAN_USER_OPT_IN";
}

async function encryptEuint64ForContract(
  sdk: VeilpotZamaEncryptionClient,
  value: bigint,
  contractAddress: Address,
  userAddress: Address,
): Promise<EncryptedEuint64Input> {
  assertUint64(value, "encrypted amount");
  assertAddress(contractAddress, "encryption contract");
  assertAddress(userAddress, "encryption user");

  const result = await sdk.encrypt({
    values: [{ value, type: "euint64" }],
    contractAddress,
    userAddress,
  });

  const encryptedValue: unknown = result.encryptedValues[0];
  const inputProof: unknown = result.inputProof;
  assertHex(encryptedValue, "encrypted euint64 value");
  assertHex(inputProof, "encrypted input proof");

  return { encryptedValue, inputProof, contractAddress, userAddress };
}

export async function encryptPoolAmount(
  sdk: VeilpotZamaEncryptionClient,
  value: bigint,
  userAddress: Address,
): Promise<EncryptedEuint64Input> {
  return encryptEuint64ForContract(sdk, value, VEILPOT_SEPOLIA_DEPLOYMENT.pool, userAddress);
}

export async function encryptV2PoolAmount(
  sdk: VeilpotZamaEncryptionClient,
  value: bigint,
  userAddress: Address,
): Promise<EncryptedEuint64Input> {
  return encryptEuint64ForContract(sdk, value, VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool, userAddress);
}

export async function encryptYieldFundingAmount(
  sdk: VeilpotZamaEncryptionClient,
  value: bigint,
  userAddress: Address,
): Promise<EncryptedEuint64Input> {
  return encryptEuint64ForContract(sdk, value, VEILPOT_SEPOLIA_DEPLOYMENT.adapter, userAddress);
}

export async function encryptSponsorFundingAmount(
  sdk: VeilpotZamaEncryptionClient,
  value: bigint,
  userAddress: Address,
): Promise<EncryptedEuint64Input> {
  return encryptEuint64ForContract(sdk, value, VEILPOT_SEPOLIA_DEPLOYMENT.reserve, userAddress);
}

export async function encryptAutopilotFundingAmount(
  sdk: VeilpotZamaEncryptionClient,
  value: bigint,
  userAddress: Address,
): Promise<EncryptedEuint64Input> {
  return encryptEuint64ForContract(
    sdk,
    value,
    VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
    userAddress,
  );
}

export async function encryptV2AutopilotFundingAmount(
  sdk: VeilpotZamaEncryptionClient,
  value: bigint,
  userAddress: Address,
): Promise<EncryptedEuint64Input> {
  return encryptEuint64ForContract(
    sdk,
    value,
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
    userAddress,
  );
}

export async function encryptAutopilotPlanAmounts(
  sdk: VeilpotZamaEncryptionClient,
  periodAmount: bigint,
  lifetimeCap: bigint,
  userAddress: Address,
): Promise<EncryptedAutopilotPlanAmounts> {
  assertUint64(periodAmount, "Autopilot period amount");
  assertUint64(lifetimeCap, "Autopilot lifetime cap");
  assertAddress(userAddress, "Autopilot plan owner");

  const result = await sdk.encrypt({
    values: [
      { value: periodAmount, type: "euint64" },
      { value: lifetimeCap, type: "euint64" },
    ],
    contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    userAddress,
  });

  const encryptedPeriodAmount: unknown = result.encryptedValues[0];
  const encryptedLifetimeCap: unknown = result.encryptedValues[1];
  const inputProof: unknown = result.inputProof;
  assertHex(encryptedPeriodAmount, "encrypted Autopilot period amount");
  assertHex(encryptedLifetimeCap, "encrypted Autopilot lifetime cap");
  assertHex(inputProof, "Autopilot plan input proof");

  return {
    encryptedPeriodAmount,
    encryptedLifetimeCap,
    inputProof,
    contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    userAddress,
  };
}

export async function encryptV2AutopilotPlanAmounts(
  sdk: VeilpotZamaEncryptionClient,
  periodAmount: bigint,
  lifetimeCap: bigint,
  userAddress: Address,
): Promise<EncryptedAutopilotPlanAmounts> {
  assertUint64(periodAmount, "V2 Autopilot period amount");
  assertUint64(lifetimeCap, "V2 Autopilot lifetime cap");
  assertAddress(userAddress, "V2 Autopilot plan owner");

  const result = await sdk.encrypt({
    values: [
      {
        value: periodAmount,
        type: "euint64",
      },
      {
        value: lifetimeCap,
        type: "euint64",
      },
    ],
    contractAddress: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    userAddress,
  });

  const encryptedPeriodAmount: unknown = result.encryptedValues[0];
  const encryptedLifetimeCap: unknown = result.encryptedValues[1];
  const inputProof: unknown = result.inputProof;

  assertHex(encryptedPeriodAmount, "V2 Autopilot encrypted period amount");
  assertHex(encryptedLifetimeCap, "V2 Autopilot encrypted lifetime cap");
  assertHex(inputProof, "V2 Autopilot input proof");

  return {
    encryptedPeriodAmount,
    encryptedLifetimeCap,
    inputProof,
    contractAddress: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    userAddress,
  };
}

export function buildEntitlementDecryptionRequest(encryptedValue: Hex): ExplicitDecryptionRequest {
  assertHex(encryptedValue, "entitlement encrypted value");
  return {
    encryptedValue,
    contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
    purpose: "ENTITLEMENT_USER_OPT_IN",
  };
}

export function buildTokenBalanceDecryptionRequest(encryptedValue: Hex): ExplicitDecryptionRequest {
  assertHex(encryptedValue, "token encrypted balance");
  return {
    encryptedValue,
    contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
    purpose: "TOKEN_BALANCE_USER_OPT_IN",
  };
}

export function buildAutopilotPlanValueDecryptionRequest(
  encryptedValue: Hex,
): ExplicitDecryptionRequest {
  assertHex(encryptedValue, "Autopilot encrypted plan value");
  return {
    encryptedValue,
    contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    purpose: "AUTOPILOT_PLAN_USER_OPT_IN",
  };
}

export function buildV2AutopilotPlanValueDecryptionRequest(
  encryptedValue: Hex,
): ExplicitDecryptionRequest {
  assertHex(encryptedValue, "V2 Autopilot encrypted plan value");

  return {
    encryptedValue,
    contractAddress: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    purpose: "AUTOPILOT_PLAN_USER_OPT_IN",
  };
}
