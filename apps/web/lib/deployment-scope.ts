import type { Address } from "viem";

import {
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_SEPOLIA_DEPLOYMENT,
} from "@veilpot/protocol-sdk";

import { exactActionStorageKey, type ExactActionDeploymentScope } from "./exact-action";

function assertStorageAddress(value: Address, label: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} is not an Ethereum address.`);
  }
}

export const VEILPOT_V1_EXACT_ACTION_SCOPE: ExactActionDeploymentScope = Object.freeze({
  storageNamespace: `v1:${String(VEILPOT_SEPOLIA_DEPLOYMENT.chainId)}`,
  chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId,
  allowedDestinations: Object.freeze([
    VEILPOT_SEPOLIA_DEPLOYMENT.pool,
    VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    VEILPOT_SEPOLIA_DEPLOYMENT.adapter,
    VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
    VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
  ]),
});

export const VEILPOT_V2_EXACT_ACTION_SCOPE: ExactActionDeploymentScope = Object.freeze({
  storageNamespace: `v2:${String(
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  )}:${VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase()}`,
  chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  allowedDestinations: Object.freeze([
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.adapter,
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
  ]),
});

export interface V2SaveStorageKeys {
  readonly exactAction: string;
  readonly operatorApproval: string;
  readonly deposit: string;
  readonly thresholdSettlement: string;
}

export function v2SaveStorageKeys(authenticatedAddress: Address): V2SaveStorageKeys {
  assertStorageAddress(authenticatedAddress, "V2 Save storage owner");

  const owner = authenticatedAddress.toLowerCase();
  const chainId = String(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId);
  const pool = VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase();
  const token = VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase();

  return Object.freeze({
    exactAction: exactActionStorageKey(VEILPOT_V2_EXACT_ACTION_SCOPE, authenticatedAddress),
    operatorApproval: `veilpot:operator-approval:unresolved:v2:${chainId}:${token}:${pool}:${owner}`,
    deposit: `veilpot:deposit:unresolved:v2:${chainId}:${pool}:${owner}`,
    thresholdSettlement: `veilpot:threshold-settlement:unresolved:v2:${chainId}:${pool}:${owner}`,
  });
}
