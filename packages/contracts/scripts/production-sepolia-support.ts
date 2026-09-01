import { createHash } from "node:crypto";

import { ethers } from "ethers";

export const EXPECTED_SEPOLIA_CHAIN_ID = 11_155_111n;

export const CUSDTMOCK_ADDRESS = "0x4E7B06D78965594eB5EF5414c357ca21E1554491";

export const WRAPPERS_REGISTRY_ADDRESS = "0x2f0750Bbb0A246059d80e94c454586a7F27a128e";

export const EXPECTED_TOKEN_NAME = "Confidential USDT (Mock)";
export const EXPECTED_TOKEN_SYMBOL = "cUSDTMock";
export const EXPECTED_TOKEN_DECIMALS = 6n;

export const BROADCAST_APPROVAL_VALUE = "I_AUTHORIZE_VEILPOT_PRODUCTION_SEPOLIA_DEPLOYMENT";

export interface ProductionDeploymentPlan {
  readonly deployer: string;
  readonly startingNonce: number;
  readonly pool: string;
  readonly adapter: string;
  readonly reserve: string;
}

export function requireExplicitBroadcastApproval(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.VEILPOT_PRODUCTION_SEPOLIA_BROADCAST !== BROADCAST_APPROVAL_VALUE) {
    throw new Error("production Sepolia broadcast is disabled; explicit approval flag is required");
  }
}

export function assertStableNonceSnapshot(confirmedNonce: number, pendingNonce: number): number {
  if (
    !Number.isSafeInteger(confirmedNonce) ||
    !Number.isSafeInteger(pendingNonce) ||
    confirmedNonce < 0 ||
    pendingNonce < 0
  ) {
    throw new Error("deployment nonces must be non-negative safe integers");
  }

  if (confirmedNonce !== pendingNonce) {
    throw new Error(
      "deployer has pending transactions; deterministic N/N+1/N+2 deployment is unsafe",
    );
  }

  return confirmedNonce;
}

export function planProductionDeployment(
  deployer: string,
  startingNonce: number,
): ProductionDeploymentPlan {
  const normalizedDeployer = ethers.getAddress(deployer);

  if (!Number.isSafeInteger(startingNonce) || startingNonce < 0) {
    throw new Error("starting nonce must be a non-negative safe integer");
  }

  return {
    deployer: normalizedDeployer,
    startingNonce,
    pool: ethers.getCreateAddress({
      from: normalizedDeployer,
      nonce: startingNonce,
    }),
    adapter: ethers.getCreateAddress({
      from: normalizedDeployer,
      nonce: startingNonce + 1,
    }),
    reserve: ethers.getCreateAddress({
      from: normalizedDeployer,
      nonce: startingNonce + 2,
    }),
  };
}

export function assertExactAddress(actual: string, expected: string, label: string): void {
  if (ethers.getAddress(actual) !== ethers.getAddress(expected)) {
    throw new Error(label + " address differs from deterministic deployment plan");
  }
}

export function sha256Bytecode(bytecode: string): string {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(bytecode)) {
    throw new Error("bytecode must be 0x-prefixed even-length hexadecimal");
  }

  return createHash("sha256")
    .update(Buffer.from(bytecode.slice(2), "hex"))
    .digest("hex");
}

const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "privateKey",
  "private_key",
  "rpcUrl",
  "rpc_url",
  "secret",
  "mnemonic",
  "seedPhrase",
  "seed_phrase",
]);

export function assertPublicEvidenceOnly(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertPublicEvidenceOnly(item);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_EVIDENCE_KEYS.has(key)) {
      throw new Error("deployment evidence contains forbidden secret-bearing key: " + key);
    }

    assertPublicEvidenceOnly(nested);
  }
}
