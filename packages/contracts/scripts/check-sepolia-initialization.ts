import { vars } from "hardhat/config";
import * as hre from "hardhat";

// This is the excluded diagnostic deployment from the first tooling incident.
// It is used only as the relayer input domain-binding target below. encrypt()
// does not submit the resulting input to it or otherwise invoke this contract.
const DIAGNOSTIC_INPUT_TARGET = "0x815D3Ad40AC60A43971A9e64918D0B83faEdcf3F";

const REQUIRED_VARIABLES = [
  "SEPOLIA_RPC_URL",
  "DEPLOYER_PRIVATE_KEY",
  "UNAUTHORIZED_PRIVATE_KEY",
] as const;

let stage = "preflight";

function sanitizedError(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return { category: "NON_OBJECT_ERROR" };
  const value = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    shortMessage?: unknown;
  };
  const rawMessage =
    typeof value.shortMessage === "string"
      ? value.shortMessage
      : typeof value.message === "string"
        ? value.message
        : "unknown error";
  return {
    category: typeof value.name === "string" ? value.name : "UNKNOWN_ERROR",
    code: typeof value.code === "string" || typeof value.code === "number" ? value.code : null,
    message: rawMessage
      .replaceAll(/https?:\/\/[^\s]+/gu, "[URL]")
      .replaceAll(/0x[a-fA-F0-9]{16,}/gu, "[HEX]"),
  };
}

async function main(): Promise<void> {
  stage = "credential-preflight";
  for (const name of REQUIRED_VARIABLES) {
    if (!vars.has(name)) throw new Error(`required Hardhat variable is not configured: ${name}`);
  }

  stage = "chain-verification";
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 11_155_111n) {
    throw new Error(`expected Sepolia chain 11155111, got ${network.chainId.toString()}`);
  }

  stage = "initialize-cli-api";
  await hre.fhevm.initializeCLIApi();
  if (hre.fhevm.isMock) throw new Error("FHEVM initialization resolved a mock environment");

  stage = "deployer-address";
  const signer = (await hre.ethers.getSigners())[0];
  if (signer === undefined) throw new Error("no deployer signer configured");
  const confirmedTransactionCountBefore = await hre.ethers.provider.getTransactionCount(
    signer.address,
    "latest",
  );

  stage = "create-encrypted-input";
  const input = hre.fhevm.createEncryptedInput(DIAGNOSTIC_INPUT_TARGET, signer.address);
  stage = "add-euint128";
  input.add128(1n);
  stage = "encrypt";
  const encrypted = await input.encrypt();
  const handleCount = encrypted.handles.length;
  const inputProofPresent = encrypted.inputProof.length > 0;
  if (handleCount !== 1) {
    throw new Error(`expected exactly one encrypted handle, got ${String(handleCount)}`);
  }
  if (!inputProofPresent) throw new Error("relayer encryption returned an empty input proof");

  stage = "transaction-count-verification";
  const confirmedTransactionCountAfter = await hre.ethers.provider.getTransactionCount(
    signer.address,
    "latest",
  );
  if (confirmedTransactionCountAfter !== confirmedTransactionCountBefore) {
    throw new Error("transaction count changed during transaction-free encryption sanity check");
  }

  console.log(
    JSON.stringify({
      status: "SEPOLIA_FHEVM_ENCRYPTED_INPUT_READY",
      chainId: network.chainId.toString(),
      mock: false,
      deployerAddress: signer.address,
      encryptedHandleCount: handleCount,
      inputProofPresent,
      confirmedTransactionCountBefore,
      confirmedTransactionCountAfter,
      ethereumTransactionBroadcast: false,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      status: "SEPOLIA_FHEVM_ENCRYPTED_INPUT_NOT_READY",
      stage,
      error: sanitizedError(error),
    }),
  );
  process.exitCode = 1;
});
