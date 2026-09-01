import type { ZamaSDK } from "@zama-fhe/sdk";

import { VEILPOT_SEPOLIA_DEPLOYMENT } from "./deployment.js";
import { assertAddress, assertHex, assertUint64, type Address, type Hex } from "./types.js";

export type VeilpotZamaEncryptionClient = Pick<ZamaSDK, "encrypt">;

export interface EncryptedEuint64Input {
  readonly encryptedValue: Hex;
  readonly inputProof: Hex;
  readonly contractAddress: Address;
  readonly userAddress: Address;
}

export interface ExplicitDecryptionRequest {
  readonly encryptedValue: Hex;
  readonly contractAddress: Address;
  readonly purpose: "ENTITLEMENT_USER_OPT_IN" | "TOKEN_BALANCE_USER_OPT_IN";
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
    values: [
      {
        value,
        type: "euint64",
      },
    ],
    contractAddress,
    userAddress,
  });

  const encryptedValue: unknown = result.encryptedValues[0];

  const inputProof: unknown = result.inputProof;

  assertHex(encryptedValue, "encrypted euint64 value");

  assertHex(inputProof, "encrypted input proof");

  return {
    encryptedValue,
    inputProof,
    contractAddress,
    userAddress,
  };
}

export async function encryptPoolAmount(
  sdk: VeilpotZamaEncryptionClient,
  value: bigint,
  userAddress: Address,
): Promise<EncryptedEuint64Input> {
  return encryptEuint64ForContract(sdk, value, VEILPOT_SEPOLIA_DEPLOYMENT.pool, userAddress);
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
