import { vars } from "hardhat/config";
import * as hre from "hardhat";

const REQUIRED_VARIABLES = [
  "SEPOLIA_RPC_URL",
  "DEPLOYER_PRIVATE_KEY",
  "UNAUTHORIZED_PRIVATE_KEY",
] as const;

async function main(): Promise<void> {
  for (const name of REQUIRED_VARIABLES) {
    if (!vars.has(name)) throw new Error(`required Hardhat variable is not configured: ${name}`);
  }
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 11_155_111n) {
    throw new Error(`expected Sepolia chain 11155111, got ${network.chainId.toString()}`);
  }

  await hre.fhevm.initializeCLIApi();
  if (hre.fhevm.isMock) throw new Error("FHEVM initialization resolved a mock environment");
  await hre.fhevm.getRelayerMetadata();

  console.log(
    JSON.stringify({
      status: "SEPOLIA_FHEVM_CLI_INITIALIZED",
      chainId: network.chainId.toString(),
      mock: false,
      relayerMetadataReachable: true,
    }),
  );
}

void main().catch(() => {
  // Provider errors can include operator-configured endpoints.
  console.error("Sepolia FHEVM initialization sanity check failed.");
  process.exitCode = 1;
});
