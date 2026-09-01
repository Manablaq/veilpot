import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ethers } from "ethers";
import * as hre from "hardhat";

import {
  CUSDTMOCK_ADDRESS,
  EXPECTED_SEPOLIA_CHAIN_ID,
  ImmutableReferenceRange,
  WRAPPERS_REGISTRY_ADDRESS,
  assertExactAddress,
  assertPublicEvidenceOnly,
  compareRuntimeIdentity,
} from "./production-sepolia-support";

const DEPLOYMENT_SOURCE_COMMIT = "c0fb1a9dba5d384a1745c5e7c5f9f1348f4d89d3";

const DEPLOYER = "0x1f87Ae197af539253978d435aD45cCf28Fb95024";

const STARTING_NONCE = 487;

const POOL = "0x3beB5C46b5982b0029a6fbC39A9313ee8D19eb6B";

const ADAPTER = "0xe1FbD1fBe801c00f13aF44E1D4e3B4271aDF0f56";

const RESERVE = "0xf748bF23C9f1C020Dcf3eb96c955904FCD8b40b0";

const DEPLOYMENTS = {
  pool: {
    nonce: 487,
    address: POOL,
    transactionHash: "0x14ba134d6b220e9f572ed78ae1e6063c938045e4bef542fdc5122eefe1b492c1",
    blockNumber: 11609481,
  },
  adapter: {
    nonce: 488,
    address: ADAPTER,
    transactionHash: "0x51f872938b4929e1c918d3c8388f5408a4337cd750bbdd31313cc9899c73bf2d",
    blockNumber: 11609482,
  },
  reserve: {
    nonce: 489,
    address: RESERVE,
    transactionHash: "0x6f00e4c30a4c6725758eea86ad6e6d5e9bb137c043176b6c1afca5746ba29a27",
    blockNumber: 11609484,
  },
} as const;

const EVIDENCE_PATH = resolve(process.cwd(), "../../evidence/production-sepolia/deployment.json");

function currentGitCommit(): string {
  return execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function requireCleanWorktree(): void {
  const status = execFileSync(
    "/usr/bin/git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" },
  ).trim();

  if (status.length !== 0) {
    throw new Error("Git working tree must be clean before production evidence recovery");
  }
}

async function readAddress(
  provider: ethers.Provider,
  address: string,
  signature: string,
  method: string,
): Promise<string> {
  const abi = new ethers.Interface([signature]);

  const raw = await provider.call({
    to: address,
    data: abi.encodeFunctionData(method),
  });

  const decoded = abi.decodeFunctionResult(method, raw);

  const value = decoded[0] as unknown;

  if (typeof value !== "string") {
    throw new TypeError(method + " did not return an address");
  }

  return ethers.getAddress(value);
}

async function assertBindings(provider: ethers.Provider): Promise<void> {
  assertExactAddress(
    await readAddress(
      provider,
      POOL,
      "function prizeReserve() view returns (address)",
      "prizeReserve",
    ),
    RESERVE,
    "pool.prizeReserve",
  );

  assertExactAddress(
    await readAddress(
      provider,
      POOL,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "pool.confidentialToken",
  );

  assertExactAddress(
    await readAddress(provider, ADAPTER, "function pool() view returns (address)", "pool"),
    POOL,
    "adapter.pool",
  );

  assertExactAddress(
    await readAddress(provider, ADAPTER, "function reserve() view returns (address)", "reserve"),
    RESERVE,
    "adapter.reserve",
  );

  assertExactAddress(
    await readAddress(
      provider,
      ADAPTER,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "adapter.confidentialToken",
  );

  assertExactAddress(
    await readAddress(provider, RESERVE, "function pool() view returns (address)", "pool"),
    POOL,
    "reserve.pool",
  );

  assertExactAddress(
    await readAddress(provider, RESERVE, "function adapter() view returns (address)", "adapter"),
    ADAPTER,
    "reserve.adapter",
  );

  assertExactAddress(
    await readAddress(
      provider,
      RESERVE,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "reserve.confidentialToken",
  );
}

async function immutableRangesForArtifact(
  artifact: Awaited<ReturnType<typeof hre.artifacts.readArtifact>>,
): Promise<readonly ImmutableReferenceRange[]> {
  const buildInfo = await hre.artifacts.getBuildInfo(
    artifact.sourceName + ":" + artifact.contractName,
  );

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

async function verifyDeployment(
  provider: ethers.Provider,
  label: string,
  expected: {
    readonly nonce: number;
    readonly address: string;
    readonly transactionHash: string;
    readonly blockNumber: number;
  },
): Promise<void> {
  const transaction = await provider.getTransaction(expected.transactionHash);

  const receipt = await provider.getTransactionReceipt(expected.transactionHash);

  if (transaction === null || receipt === null) {
    throw new Error(label + " deployment transaction or receipt is missing");
  }

  if (
    transaction.from.toLowerCase() !== DEPLOYER.toLowerCase() ||
    transaction.nonce !== expected.nonce ||
    transaction.to !== null ||
    receipt.status !== 1 ||
    receipt.blockNumber !== expected.blockNumber ||
    receipt.contractAddress === null
  ) {
    throw new Error(label + " deployment transaction metadata differs from frozen evidence");
  }

  assertExactAddress(receipt.contractAddress, expected.address, label);
}

async function main(): Promise<void> {
  if (process.env.VEILPOT_PRODUCTION_SEPOLIA_BROADCAST !== undefined) {
    throw new Error("broadcast approval must be absent during evidence recovery");
  }

  requireCleanWorktree();

  const recoveryCommit = currentGitCommit();

  const provider = hre.ethers.provider;

  const network = await provider.getNetwork();

  if (network.chainId !== EXPECTED_SEPOLIA_CHAIN_ID) {
    throw new Error("evidence recovery is restricted to Sepolia chain 11155111");
  }

  const existingEvidence = await import("node:fs/promises").then(async ({ access }) => {
    try {
      await access(EVIDENCE_PATH);
      return true;
    } catch {
      return false;
    }
  });

  if (existingEvidence) {
    throw new Error("production deployment evidence already exists");
  }

  await verifyDeployment(provider, "VeilpotPool", DEPLOYMENTS.pool);

  await verifyDeployment(provider, "VeilpotSimulatedYieldAdapter", DEPLOYMENTS.adapter);

  await verifyDeployment(provider, "VeilpotPrizeReserve", DEPLOYMENTS.reserve);

  await assertBindings(provider);

  const poolArtifact = await hre.artifacts.readArtifact("VeilpotPool");

  const adapterArtifact = await hre.artifacts.readArtifact("VeilpotSimulatedYieldAdapter");

  const reserveArtifact = await hre.artifacts.readArtifact("VeilpotPrizeReserve");

  const runtimeIdentity = {
    pool: compareRuntimeIdentity(
      poolArtifact.deployedBytecode,
      await provider.getCode(POOL),
      await immutableRangesForArtifact(poolArtifact),
      "VeilpotPool",
    ),
    adapter: compareRuntimeIdentity(
      adapterArtifact.deployedBytecode,
      await provider.getCode(ADAPTER),
      await immutableRangesForArtifact(adapterArtifact),
      "VeilpotSimulatedYieldAdapter",
    ),
    reserve: compareRuntimeIdentity(
      reserveArtifact.deployedBytecode,
      await provider.getCode(RESERVE),
      await immutableRangesForArtifact(reserveArtifact),
      "VeilpotPrizeReserve",
    ),
  };

  const evidence = {
    schemaVersion: 2,
    profile: "VEILPOT_PRODUCTION_SEPOLIA_DEPLOYMENT",
    network: "sepolia",
    chainId: EXPECTED_SEPOLIA_CHAIN_ID.toString(),
    sourceCommit: DEPLOYMENT_SOURCE_COMMIT,
    evidenceRecoveryCommit: recoveryCommit,
    recoveryReason: "RAW_RUNTIME_HASH_IMMUTABLES_NOT_NORMALIZED",
    deployerAddress: DEPLOYER,
    startingNonce: STARTING_NONCE,
    token: {
      address: CUSDTMOCK_ADDRESS,
      classification: "OFFICIAL_ZAMA_TESTNET_MOCK_ASSET",
      productionAsset: false,
    },
    wrappersRegistry: WRAPPERS_REGISTRY_ADDRESS,
    yieldProfile: "SIMULATED_YIELD_FOR_SEPOLIA_DEMO",
    deterministicCreateOrder: [
      "VeilpotPool",
      "VeilpotSimulatedYieldAdapter",
      "VeilpotPrizeReserve",
    ],
    deployments: {
      pool: {
        address: DEPLOYMENTS.pool.address,
        transactionHash: DEPLOYMENTS.pool.transactionHash,
        blockNumber: DEPLOYMENTS.pool.blockNumber,
      },
      adapter: {
        address: DEPLOYMENTS.adapter.address,
        transactionHash: DEPLOYMENTS.adapter.transactionHash,
        blockNumber: DEPLOYMENTS.adapter.blockNumber,
      },
      reserve: {
        address: DEPLOYMENTS.reserve.address,
        transactionHash: DEPLOYMENTS.reserve.transactionHash,
        blockNumber: DEPLOYMENTS.reserve.blockNumber,
      },
    },
    runtimeIdentity,
    createdAt: new Date().toISOString(),
  };

  assertPublicEvidenceOnly(evidence);

  await mkdir(dirname(EVIDENCE_PATH), { recursive: true });

  await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n", "utf8");

  process.stdout.write("PRODUCTION_SEPOLIA_DEPLOYMENT_EVIDENCE_RECOVERED\n");

  process.stdout.write(
    JSON.stringify(
      {
        sourceCommit: DEPLOYMENT_SOURCE_COMMIT,
        evidenceRecoveryCommit: recoveryCommit,
        startingNonce: STARTING_NONCE,
        pool: POOL,
        adapter: ADAPTER,
        reserve: RESERVE,
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
