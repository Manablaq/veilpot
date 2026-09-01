import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ethers } from "ethers";
import * as hre from "hardhat";

import {
  BROADCAST_APPROVAL_VALUE,
  CUSDTMOCK_ADDRESS,
  EXPECTED_SEPOLIA_CHAIN_ID,
  ImmutableReferenceRange,
  WRAPPERS_REGISTRY_ADDRESS,
  assertExactAddress,
  assertExactDeploymentData,
  assertPublicEvidenceOnly,
  compareRuntimeIdentity,
  planProductionDeployment,
  sha256Bytecode,
} from "./production-sepolia-support";

const AUTOPILOT_EVIDENCE_REPOSITORY_PATH =
  "../../evidence/production-sepolia/autopilot-v3/deployment.json";

const AUTOPILOT_JOURNAL_REPOSITORY_PATH =
  "../../evidence/production-sepolia/autopilot-v3/deployment-journal.json";

const HISTORICAL_EVIDENCE_REPOSITORY_PATH = "../../evidence/production-sepolia/deployment.json";

const EVIDENCE_PATH = resolve(process.cwd(), AUTOPILOT_EVIDENCE_REPOSITORY_PATH);

const JOURNAL_PATH = resolve(process.cwd(), AUTOPILOT_JOURNAL_REPOSITORY_PATH);

type JsonRecord = Record<string, unknown>;

interface DeploymentTransactionRecord {
  readonly address: string;
  readonly transactionHash: string;
  readonly blockNumber: number;
}

interface CompleteDeploymentRecords {
  readonly pool: DeploymentTransactionRecord;
  readonly vault: DeploymentTransactionRecord;
  readonly adapter: DeploymentTransactionRecord;
  readonly reserve: DeploymentTransactionRecord;
}

interface ParsedJournal {
  readonly sourceCommit: string;
  readonly deployerAddress: string;
  readonly startingNonce: number;
  readonly state: string;
  readonly plannedAddresses: {
    readonly pool: string;
    readonly vault: string;
    readonly adapter: string;
    readonly reserve: string;
  };
  readonly deployments: CompleteDeploymentRecords;
  readonly broadcastApproval: string;
}

function currentGitCommit(): string {
  return execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function requireRecoveryWorktree(): void {
  const status = execFileSync(
    "/usr/bin/git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" },
  ).trim();

  if (status.length === 0) {
    return;
  }

  const lines = status.split("\n").filter(Boolean);

  if (
    lines.length === 1 &&
    lines[0] === "?? evidence/production-sepolia/autopilot-v3/deployment-journal.json"
  ) {
    return;
  }

  throw new Error(
    "Autopilot evidence recovery requires a clean source tree with only the deployment journal untracked",
  );
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " must be an object");
  }

  return value as JsonRecord;
}

function asString(record: JsonRecord, key: string, label: string): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(label + "." + key + " must be a non-empty string");
  }

  return value;
}

function asSafeInteger(record: JsonRecord, key: string, label: string): number {
  const value = record[key];

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(label + "." + key + " must be a non-negative safe integer");
  }

  return value;
}

function parseDeployment(deployments: JsonRecord, key: string): DeploymentTransactionRecord {
  const record = asRecord(deployments[key], "journal.deployments." + key);

  const address = ethers.getAddress(asString(record, "address", "journal.deployments." + key));

  const transactionHash = asString(record, "transactionHash", "journal.deployments." + key);

  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new TypeError(
      "journal.deployments." + key + ".transactionHash must be a 32-byte hex hash",
    );
  }

  const blockNumber = asSafeInteger(record, "blockNumber", "journal.deployments." + key);

  return {
    address,
    transactionHash,
    blockNumber,
  };
}

async function readCompleteJournal(): Promise<ParsedJournal> {
  if (!(await pathExists(JOURNAL_PATH))) {
    throw new Error("Autopilot deployment journal is missing");
  }

  if (await pathExists(EVIDENCE_PATH)) {
    throw new Error("Autopilot v3 deployment evidence already exists");
  }

  const root = asRecord(JSON.parse(await readFile(JOURNAL_PATH, "utf8")) as unknown, "journal");

  if (root.schemaVersion !== 1) {
    throw new Error("Autopilot deployment journal schemaVersion must equal 1");
  }

  if (root.profile !== "VEILPOT_AUTOPILOT_PRODUCTION_SEPOLIA_DEPLOYMENT_JOURNAL") {
    throw new Error("Autopilot deployment journal profile is invalid");
  }

  if (root.network !== "sepolia") {
    throw new Error("Autopilot deployment journal network is invalid");
  }

  if (root.chainId !== EXPECTED_SEPOLIA_CHAIN_ID.toString()) {
    throw new Error("Autopilot deployment journal chainId is invalid");
  }

  const state = asString(root, "state", "journal");

  if (state !== "RESERVE_CONFIRMED" && state !== "EVIDENCE_PUBLISHED") {
    throw new Error(
      "Autopilot deployment journal is incomplete; do not redeploy and reconcile the recorded partial deployment first",
    );
  }

  const sourceCommit = asString(root, "sourceCommit", "journal");

  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("Autopilot deployment journal sourceCommit is invalid");
  }

  const deployerAddress = ethers.getAddress(asString(root, "deployerAddress", "journal"));

  const startingNonce = asSafeInteger(root, "startingNonce", "journal");

  const planned = asRecord(root.plannedAddresses, "journal.plannedAddresses");

  const plannedAddresses = {
    pool: ethers.getAddress(asString(planned, "pool", "journal.plannedAddresses")),
    vault: ethers.getAddress(asString(planned, "vault", "journal.plannedAddresses")),
    adapter: ethers.getAddress(asString(planned, "adapter", "journal.plannedAddresses")),
    reserve: ethers.getAddress(asString(planned, "reserve", "journal.plannedAddresses")),
  };

  const expectedPlan = planProductionDeployment(deployerAddress, startingNonce);

  for (const key of ["pool", "vault", "adapter", "reserve"] as const) {
    assertExactAddress(plannedAddresses[key], expectedPlan[key], "journal.plannedAddresses." + key);
  }

  const deploymentRoot = asRecord(root.deployments, "journal.deployments");

  const deployments = {
    pool: parseDeployment(deploymentRoot, "pool"),
    vault: parseDeployment(deploymentRoot, "vault"),
    adapter: parseDeployment(deploymentRoot, "adapter"),
    reserve: parseDeployment(deploymentRoot, "reserve"),
  };

  for (const key of ["pool", "vault", "adapter", "reserve"] as const) {
    assertExactAddress(
      deployments[key].address,
      plannedAddresses[key],
      "journal.deployments." + key,
    );
  }

  const broadcastApproval = asString(root, "broadcastApproval", "journal");

  if (broadcastApproval !== BROADCAST_APPROVAL_VALUE) {
    throw new Error("Autopilot deployment journal broadcastApproval is invalid");
  }

  return {
    sourceCommit,
    deployerAddress,
    startingNonce,
    state,
    plannedAddresses,
    deployments,
    broadcastApproval,
  };
}

async function readSingle(
  provider: ethers.Provider,
  address: string,
  signature: string,
  method: string,
): Promise<unknown> {
  const abi = new ethers.Interface([signature]);

  const raw = await provider.call({
    to: address,
    data: abi.encodeFunctionData(method),
  });

  return abi.decodeFunctionResult(method, raw)[0] as unknown;
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

async function assertBindings(
  provider: ethers.Provider,
  plan: ParsedJournal["plannedAddresses"],
): Promise<void> {
  assertExactAddress(
    await readAddress(
      provider,
      plan.pool,
      "function prizeReserve() view returns (address)",
      "prizeReserve",
    ),
    plan.reserve,
    "pool.prizeReserve",
  );

  assertExactAddress(
    await readAddress(
      provider,
      plan.pool,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "pool.confidentialToken",
  );

  assertExactAddress(
    await readAddress(provider, plan.vault, "function pool() view returns (address)", "pool"),
    plan.pool,
    "vault.pool",
  );

  assertExactAddress(
    await readAddress(
      provider,
      plan.vault,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "vault.confidentialToken",
  );

  assertExactAddress(
    await readAddress(provider, plan.adapter, "function pool() view returns (address)", "pool"),
    plan.pool,
    "adapter.pool",
  );

  assertExactAddress(
    await readAddress(
      provider,
      plan.adapter,
      "function reserve() view returns (address)",
      "reserve",
    ),
    plan.reserve,
    "adapter.reserve",
  );

  assertExactAddress(
    await readAddress(
      provider,
      plan.adapter,
      "function confidentialToken() view returns (address)",
      "confidentialToken",
    ),
    CUSDTMOCK_ADDRESS,
    "adapter.confidentialToken",
  );

  assertExactAddress(
    await readAddress(provider, plan.reserve, "function pool() view returns (address)", "pool"),
    plan.pool,
    "reserve.pool",
  );

  assertExactAddress(
    await readAddress(
      provider,
      plan.reserve,
      "function adapter() view returns (address)",
      "adapter",
    ),
    plan.adapter,
    "reserve.adapter",
  );

  assertExactAddress(
    await readAddress(
      provider,
      plan.reserve,
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
  deployerAddress: string,
  nonce: number,
  expected: DeploymentTransactionRecord,
): Promise<void> {
  const transaction = await provider.getTransaction(expected.transactionHash);

  const receipt = await provider.getTransactionReceipt(expected.transactionHash);

  if (transaction === null || receipt === null) {
    throw new Error(label + " deployment transaction or receipt is missing");
  }

  if (
    transaction.from.toLowerCase() !== deployerAddress.toLowerCase() ||
    transaction.nonce !== nonce ||
    transaction.to !== null ||
    receipt.status !== 1 ||
    receipt.blockNumber !== expected.blockNumber ||
    receipt.contractAddress === null
  ) {
    throw new Error(label + " deployment transaction metadata differs from journal");
  }

  assertExactAddress(receipt.contractAddress, expected.address, label);
}

async function main(): Promise<void> {
  if (process.env.VEILPOT_PRODUCTION_SEPOLIA_BROADCAST !== undefined) {
    throw new Error("broadcast approval must be absent during Autopilot evidence recovery");
  }

  requireRecoveryWorktree();

  const journal = await readCompleteJournal();

  if (currentGitCommit() !== journal.sourceCommit) {
    throw new Error(
      "current Git HEAD differs from the sourceCommit that produced the Autopilot deployment",
    );
  }

  const recoveryCommit = currentGitCommit();

  const provider = hre.ethers.provider;

  const network = await provider.getNetwork();

  if (network.chainId !== EXPECTED_SEPOLIA_CHAIN_ID) {
    throw new Error("Autopilot evidence recovery is restricted to Sepolia chain 11155111");
  }

  await verifyDeployment(
    provider,
    "VeilpotPool",
    journal.deployerAddress,
    journal.startingNonce,
    journal.deployments.pool,
  );

  await verifyDeployment(
    provider,
    "VeilpotAutopilotVault",
    journal.deployerAddress,
    journal.startingNonce + 1,
    journal.deployments.vault,
  );

  await verifyDeployment(
    provider,
    "VeilpotSimulatedYieldAdapter",
    journal.deployerAddress,
    journal.startingNonce + 2,
    journal.deployments.adapter,
  );

  await verifyDeployment(
    provider,
    "VeilpotPrizeReserve",
    journal.deployerAddress,
    journal.startingNonce + 3,
    journal.deployments.reserve,
  );

  const poolArtifact = await hre.artifacts.readArtifact("VeilpotPool");

  const poolFactory = new ethers.ContractFactory(poolArtifact.abi, poolArtifact.bytecode);

  const expectedPoolDeployment = await poolFactory.getDeployTransaction(
    CUSDTMOCK_ADDRESS,
    journal.plannedAddresses.reserve,
    journal.plannedAddresses.vault,
  );

  const poolTransaction = await provider.getTransaction(journal.deployments.pool.transactionHash);

  if (poolTransaction === null) {
    throw new Error("VeilpotPool deployment transaction is missing during constructor proof");
  }

  assertExactDeploymentData(poolTransaction.data, expectedPoolDeployment.data, "VeilpotPool");

  await assertBindings(provider, journal.plannedAddresses);

  const vaultArtifact = await hre.artifacts.readArtifact("VeilpotAutopilotVault");

  const adapterArtifact = await hre.artifacts.readArtifact("VeilpotSimulatedYieldAdapter");

  const reserveArtifact = await hre.artifacts.readArtifact("VeilpotPrizeReserve");

  const runtimeIdentity = {
    pool: compareRuntimeIdentity(
      poolArtifact.deployedBytecode,
      await provider.getCode(journal.plannedAddresses.pool),
      await immutableRangesForArtifact(poolArtifact),
      "VeilpotPool",
    ),
    vault: compareRuntimeIdentity(
      vaultArtifact.deployedBytecode,
      await provider.getCode(journal.plannedAddresses.vault),
      await immutableRangesForArtifact(vaultArtifact),
      "VeilpotAutopilotVault",
    ),
    adapter: compareRuntimeIdentity(
      adapterArtifact.deployedBytecode,
      await provider.getCode(journal.plannedAddresses.adapter),
      await immutableRangesForArtifact(adapterArtifact),
      "VeilpotSimulatedYieldAdapter",
    ),
    reserve: compareRuntimeIdentity(
      reserveArtifact.deployedBytecode,
      await provider.getCode(journal.plannedAddresses.reserve),
      await immutableRangesForArtifact(reserveArtifact),
      "VeilpotPrizeReserve",
    ),
  };

  const evidence = {
    schemaVersion: 3,
    profile: "VEILPOT_AUTOPILOT_PRODUCTION_SEPOLIA_DEPLOYMENT",
    evidenceNamespace: "AUTOPILOT_V3",
    historicalEvidencePath: HISTORICAL_EVIDENCE_REPOSITORY_PATH,
    deploymentJournalPath: AUTOPILOT_JOURNAL_REPOSITORY_PATH,
    network: "sepolia",
    chainId: EXPECTED_SEPOLIA_CHAIN_ID.toString(),
    sourceCommit: journal.sourceCommit,
    evidenceRecoveryCommit: recoveryCommit,
    recoveryReason: "FINAL_EVIDENCE_PUBLICATION_RECOVERY_FROM_COMPLETE_JOURNAL",
    deployerAddress: journal.deployerAddress,
    startingNonce: journal.startingNonce,
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
    deployments: journal.deployments,
    privateImmutableVerification: {
      poolAutopilotVault: {
        expectedAddress: journal.plannedAddresses.vault,
        verificationMethod: "EXACT_POOL_DEPLOYMENT_TRANSACTION_INPUT",
        deploymentInputSha256: sha256Bytecode(poolTransaction.data),
      },
    },
    verifiedBindings: {
      pool: {
        confidentialToken: CUSDTMOCK_ADDRESS,
        prizeReserve: journal.plannedAddresses.reserve,
        autopilotVault: journal.plannedAddresses.vault,
        autopilotVaultVerification: "EXACT_POOL_DEPLOYMENT_TRANSACTION_INPUT",
      },
      vault: {
        confidentialToken: CUSDTMOCK_ADDRESS,
        pool: journal.plannedAddresses.pool,
      },
      adapter: {
        confidentialToken: CUSDTMOCK_ADDRESS,
        pool: journal.plannedAddresses.pool,
        reserve: journal.plannedAddresses.reserve,
      },
      reserve: {
        confidentialToken: CUSDTMOCK_ADDRESS,
        pool: journal.plannedAddresses.pool,
        adapter: journal.plannedAddresses.adapter,
      },
    },
    runtimeIdentity,
    deploymentBroadcastApproval: journal.broadcastApproval,
    evidenceRecoveryBroadcast: false,
    createdAt: new Date().toISOString(),
  };

  assertPublicEvidenceOnly(evidence);

  await mkdir(dirname(EVIDENCE_PATH), { recursive: true });

  await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n", "utf8");

  process.stdout.write("AUTOPILOT_PRODUCTION_SEPOLIA_DEPLOYMENT_EVIDENCE_RECOVERED\n");

  process.stdout.write(
    JSON.stringify(
      {
        sourceCommit: journal.sourceCommit,
        evidenceRecoveryCommit: recoveryCommit,
        startingNonce: journal.startingNonce,
        pool: journal.plannedAddresses.pool,
        vault: journal.plannedAddresses.vault,
        adapter: journal.plannedAddresses.adapter,
        reserve: journal.plannedAddresses.reserve,
        evidencePath: EVIDENCE_PATH,
        journalPath: JOURNAL_PATH,
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
