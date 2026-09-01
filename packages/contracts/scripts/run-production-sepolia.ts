import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ethers } from "ethers";
import * as hre from "hardhat";

import {
  BROADCAST_APPROVAL_VALUE,
  CUSDTMOCK_ADDRESS,
  EXPECTED_SEPOLIA_CHAIN_ID,
  EXPECTED_TOKEN_DECIMALS,
  EXPECTED_TOKEN_NAME,
  EXPECTED_TOKEN_SYMBOL,
  WRAPPERS_REGISTRY_ADDRESS,
  ImmutableReferenceRange,
  assertExactAddress,
  assertExactDeploymentData,
  assertPublicEvidenceOnly,
  assertStableNonceSnapshot,
  compareRuntimeIdentity,
  planProductionDeployment,
  sha256Bytecode,
  requireExplicitBroadcastApproval,
} from "./production-sepolia-support";

const EVIDENCE_PATH = resolve(process.cwd(), "../../evidence/production-sepolia/deployment.json");

interface DeploymentTransactionRecord {
  readonly address: string;
  readonly transactionHash: string;
  readonly blockNumber: number;
}

function currentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function requireCleanWorktree(): void {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    encoding: "utf8",
  }).trim();

  if (status.length !== 0) {
    throw new Error("Git working tree must be clean before production Sepolia deployment");
  }
}

async function readSingle(
  provider: ethers.Provider,
  address: string,
  signature: string,
  method: string,
): Promise<unknown> {
  const abi = new ethers.Interface([signature]);

  const data = abi.encodeFunctionData(method);

  const raw = await provider.call({
    to: address,
    data,
  });

  const decoded = abi.decodeFunctionResult(method, raw);

  return decoded[0];
}

async function readString(
  provider: ethers.Provider,
  address: string,
  signature: string,
  method: string,
): Promise<string> {
  const value = await readSingle(provider, address, signature, method);

  if (typeof value !== "string") {
    throw new TypeError(method + " did not return a string");
  }

  return value;
}

async function readBigInt(
  provider: ethers.Provider,
  address: string,
  signature: string,
  method: string,
): Promise<bigint> {
  const value = await readSingle(provider, address, signature, method);

  if (typeof value !== "bigint") {
    throw new TypeError(method + " did not return a bigint");
  }

  return value;
}

async function readAddress(
  provider: ethers.Provider,
  address: string,
  signature: string,
  method: string,
): Promise<string> {
  const value = await readSingle(provider, address, signature, method);

  if (typeof value !== "string") {
    throw new TypeError(method + " did not return an address");
  }

  return ethers.getAddress(value);
}

async function deploymentRecord(
  contract: ethers.BaseContract,
): Promise<DeploymentTransactionRecord> {
  const transaction = contract.deploymentTransaction();

  if (transaction === null) {
    throw new Error("deployment transaction is missing");
  }

  const receipt = await transaction.wait();

  if (receipt === null) {
    throw new Error("deployment receipt is missing");
  }

  return {
    address: await contract.getAddress(),
    transactionHash: transaction.hash,
    blockNumber: receipt.blockNumber,
  };
}

async function assertTokenProfile(provider: ethers.Provider): Promise<void> {
  const tokenCode = await provider.getCode(CUSDTMOCK_ADDRESS);

  if (tokenCode === "0x") {
    throw new Error("cUSDTMock has no code at the frozen Sepolia address");
  }

  const registryCode = await provider.getCode(WRAPPERS_REGISTRY_ADDRESS);

  if (registryCode === "0x") {
    throw new Error("Zama wrappers registry has no code at the frozen Sepolia address");
  }

  const name = await readString(
    provider,
    CUSDTMOCK_ADDRESS,
    "function name() view returns (string)",
    "name",
  );

  const symbol = await readString(
    provider,
    CUSDTMOCK_ADDRESS,
    "function symbol() view returns (string)",
    "symbol",
  );

  const decimals = await readBigInt(
    provider,
    CUSDTMOCK_ADDRESS,
    "function decimals() view returns (uint8)",
    "decimals",
  );

  if (
    name !== EXPECTED_TOKEN_NAME ||
    symbol !== EXPECTED_TOKEN_SYMBOL ||
    decimals !== EXPECTED_TOKEN_DECIMALS
  ) {
    throw new Error("Sepolia cUSDTMock profile differs from the frozen competition profile");
  }
}

async function immutableRangesForArtifact(
  artifact: Awaited<ReturnType<typeof hre.artifacts.readArtifact>>,
): Promise<readonly ImmutableReferenceRange[]> {
  const fullyQualifiedName = artifact.sourceName + ":" + artifact.contractName;

  const buildInfo = await hre.artifacts.getBuildInfo(fullyQualifiedName);

  if (buildInfo === undefined) {
    throw new Error("build information is unavailable for " + artifact.contractName);
  }

  const compiledContract = buildInfo.output.contracts[artifact.sourceName]?.[artifact.contractName];

  if (compiledContract === undefined) {
    throw new Error("compiled contract output is unavailable for " + artifact.contractName);
  }

  const immutableReferences = compiledContract.evm.deployedBytecode.immutableReferences ?? {};

  return Object.values(immutableReferences)
    .flat()
    .map(({ start, length }) => ({
      start,
      length,
    }))
    .sort((left, right) => left.start - right.start || left.length - right.length);
}

async function assertBindings(
  provider: ethers.Provider,
  poolAddress: string,
  vaultAddress: string,
  adapterAddress: string,
  reserveAddress: string,
): Promise<void> {
  assertExactAddress(
    await readAddress(
      provider,
      poolAddress,
      "function prizeReserve() view returns (address)",
      "prizeReserve",
    ),
    reserveAddress,
    "pool.prizeReserve",
  );

  assertExactAddress(
    await readAddress(
      provider,
      poolAddress,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "pool.confidentialToken",
  );

  assertExactAddress(
    await readAddress(provider, vaultAddress, "function pool() view returns (address)", "pool"),
    poolAddress,
    "vault.pool",
  );

  assertExactAddress(
    await readAddress(
      provider,
      vaultAddress,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "vault.confidentialToken",
  );

  assertExactAddress(
    await readAddress(provider, adapterAddress, "function pool() view returns (address)", "pool"),
    poolAddress,
    "adapter.pool",
  );

  assertExactAddress(
    await readAddress(
      provider,
      adapterAddress,
      "function reserve() view returns (address)",
      "reserve",
    ),
    reserveAddress,
    "adapter.reserve",
  );

  assertExactAddress(
    await readAddress(
      provider,
      adapterAddress,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "adapter.confidentialToken",
  );

  assertExactAddress(
    await readAddress(provider, reserveAddress, "function pool() view returns (address)", "pool"),
    poolAddress,
    "reserve.pool",
  );

  assertExactAddress(
    await readAddress(
      provider,
      reserveAddress,
      "function adapter() view returns (address)",
      "adapter",
    ),
    adapterAddress,
    "reserve.adapter",
  );

  assertExactAddress(
    await readAddress(
      provider,
      reserveAddress,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "reserve.confidentialToken",
  );
}

async function main(): Promise<void> {
  requireExplicitBroadcastApproval(process.env);

  requireCleanWorktree();

  const sourceCommit = currentGitCommit();

  const provider = hre.ethers.provider;

  const network = await provider.getNetwork();

  if (network.chainId !== EXPECTED_SEPOLIA_CHAIN_ID) {
    throw new Error("production runner is restricted to Sepolia chain 11155111");
  }

  await assertTokenProfile(provider);

  const signers = await hre.ethers.getSigners();

  const deployer = signers[0];

  if (deployer === undefined) {
    throw new Error("no configured deployment signer");
  }

  const deployerAddress = await deployer.getAddress();

  const confirmedNonce = await provider.getTransactionCount(deployerAddress, "latest");

  const pendingNonce = await provider.getTransactionCount(deployerAddress, "pending");

  const startingNonce = assertStableNonceSnapshot(confirmedNonce, pendingNonce);

  const plan = planProductionDeployment(deployerAddress, startingNonce);

  const poolFactory = await hre.ethers.getContractFactory("VeilpotPool", deployer);

  const expectedPoolDeployment = await poolFactory.getDeployTransaction(
    CUSDTMOCK_ADDRESS,
    plan.reserve,
    plan.vault,
  );

  const pool = await poolFactory.deploy(CUSDTMOCK_ADDRESS, plan.reserve, plan.vault);

  await pool.waitForDeployment();

  assertExactAddress(await pool.getAddress(), plan.pool, "VeilpotPool");

  const poolDeploymentTransaction = pool.deploymentTransaction();

  if (poolDeploymentTransaction === null) {
    throw new Error("VeilpotPool deployment transaction is missing");
  }

  assertExactDeploymentData(
    poolDeploymentTransaction.data,
    expectedPoolDeployment.data,
    "VeilpotPool",
  );

  const poolDeployment = await deploymentRecord(pool);

  const vaultFactory = await hre.ethers.getContractFactory("VeilpotAutopilotVault", deployer);

  const vault = await vaultFactory.deploy(CUSDTMOCK_ADDRESS, plan.pool);

  await vault.waitForDeployment();

  assertExactAddress(await vault.getAddress(), plan.vault, "VeilpotAutopilotVault");

  const vaultDeployment = await deploymentRecord(vault);

  const adapterFactory = await hre.ethers.getContractFactory(
    "VeilpotSimulatedYieldAdapter",
    deployer,
  );

  const adapter = await adapterFactory.deploy(CUSDTMOCK_ADDRESS, plan.pool, plan.reserve);

  await adapter.waitForDeployment();

  assertExactAddress(await adapter.getAddress(), plan.adapter, "VeilpotSimulatedYieldAdapter");

  const adapterDeployment = await deploymentRecord(adapter);

  const reserveFactory = await hre.ethers.getContractFactory("VeilpotPrizeReserve", deployer);

  const reserve = await reserveFactory.deploy(plan.pool, plan.adapter);

  await reserve.waitForDeployment();

  assertExactAddress(await reserve.getAddress(), plan.reserve, "VeilpotPrizeReserve");

  const reserveDeployment = await deploymentRecord(reserve);

  await assertBindings(provider, plan.pool, plan.vault, plan.adapter, plan.reserve);

  const poolArtifact = await hre.artifacts.readArtifact("VeilpotPool");

  const vaultArtifact = await hre.artifacts.readArtifact("VeilpotAutopilotVault");

  const adapterArtifact = await hre.artifacts.readArtifact("VeilpotSimulatedYieldAdapter");

  const reserveArtifact = await hre.artifacts.readArtifact("VeilpotPrizeReserve");

  const deployedPoolRuntime = await provider.getCode(plan.pool);

  const deployedVaultRuntime = await provider.getCode(plan.vault);

  const deployedAdapterRuntime = await provider.getCode(plan.adapter);

  const deployedReserveRuntime = await provider.getCode(plan.reserve);

  const runtimeIdentity = {
    pool: compareRuntimeIdentity(
      poolArtifact.deployedBytecode,
      deployedPoolRuntime,
      await immutableRangesForArtifact(poolArtifact),
      "VeilpotPool",
    ),
    vault: compareRuntimeIdentity(
      vaultArtifact.deployedBytecode,
      deployedVaultRuntime,
      await immutableRangesForArtifact(vaultArtifact),
      "VeilpotAutopilotVault",
    ),
    adapter: compareRuntimeIdentity(
      adapterArtifact.deployedBytecode,
      deployedAdapterRuntime,
      await immutableRangesForArtifact(adapterArtifact),
      "VeilpotSimulatedYieldAdapter",
    ),
    reserve: compareRuntimeIdentity(
      reserveArtifact.deployedBytecode,
      deployedReserveRuntime,
      await immutableRangesForArtifact(reserveArtifact),
      "VeilpotPrizeReserve",
    ),
  };

  const evidence = {
    schemaVersion: 3,
    profile: "VEILPOT_PRODUCTION_SEPOLIA_DEPLOYMENT",
    network: "sepolia",
    chainId: EXPECTED_SEPOLIA_CHAIN_ID.toString(),
    sourceCommit,
    deployerAddress,
    startingNonce,
    token: {
      address: CUSDTMOCK_ADDRESS,
      classification: "OFFICIAL_ZAMA_TESTNET_MOCK_ASSET",
      productionAsset: false,
    },
    wrappersRegistry: WRAPPERS_REGISTRY_ADDRESS,
    yieldProfile: "SIMULATED_YIELD_FOR_SEPOLIA_DEMO",
    deterministicCreateOrder: [
      "VeilpotPool",
      "VeilpotAutopilotVault",
      "VeilpotSimulatedYieldAdapter",
      "VeilpotPrizeReserve",
    ],
    deployments: {
      pool: poolDeployment,
      vault: vaultDeployment,
      adapter: adapterDeployment,
      reserve: reserveDeployment,
    },
    privateImmutableVerification: {
      poolAutopilotVault: {
        expectedAddress: plan.vault,
        verificationMethod: "EXACT_POOL_DEPLOYMENT_TRANSACTION_INPUT",
        deploymentInputSha256: sha256Bytecode(poolDeploymentTransaction.data),
      },
    },
    runtimeIdentity,
    broadcastApproval: BROADCAST_APPROVAL_VALUE,
    createdAt: new Date().toISOString(),
  };

  assertPublicEvidenceOnly(evidence);

  await mkdir(dirname(EVIDENCE_PATH), { recursive: true });

  await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n", "utf8");

  process.stdout.write("PRODUCTION_SEPOLIA_DEPLOYMENT_COMPLETE\n");

  process.stdout.write(
    JSON.stringify(
      {
        sourceCommit,
        startingNonce,
        pool: plan.pool,
        vault: plan.vault,
        adapter: plan.adapter,
        reserve: plan.reserve,
        evidencePath: EVIDENCE_PATH,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);

  process.stderr.write(message + "\n");

  process.exitCode = 1;
});
