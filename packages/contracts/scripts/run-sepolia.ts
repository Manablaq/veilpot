import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { FhevmType } from "@fhevm/hardhat-plugin";
import { vars } from "hardhat/config";
import { ethers } from "ethers";
import * as hre from "hardhat";

import {
  acquireLiveRunLock,
  appendToolingRevision,
  createInvocation,
  nextFailureDrillAction,
  releaseLiveRunLock,
  updateLiveRunLock,
  type InvocationStatus,
  type LiveInvocation,
  type RunnerMode,
} from "./live-run-support";

type Handle = `0x${string}`;
type JsonObject = Record<string, unknown>;

type TransactionMethod<Arguments extends readonly unknown[] = []> = ((
  ...arguments_: Arguments
) => Promise<ethers.ContractTransactionResponse>) & {
  staticCall(...arguments_: Arguments): Promise<unknown>;
};

interface ProbeContract {
  getAddress(): Promise<string>;
  deploymentTransaction(): ethers.ContractTransactionResponse | null;
  startDraw: TransactionMethod<[Handle, string]>;
  prepareBucketEvidence: TransactionMethod;
  submitBucketEvidence: TransactionMethod<
    [exponent: bigint, isZero: boolean, isSupported: boolean, proof: string]
  >;
  generateCandidateBatch: TransactionMethod<[number]>;
  reduceSerial: TransactionMethod;
  reduceBalanced: TransactionMethod;
  prepareBatchEvidence: TransactionMethod;
  submitBatchEvidence: TransactionMethod<[boolean, string]>;
  benchmarkPrefixSelection: TransactionMethod<
    [weights: Handle[], weightsProof: string, target: Handle, targetProof: string]
  >;
  state(): Promise<bigint>;
  batchId(): Promise<bigint>;
  drawStarted(): Promise<boolean>;
  serialReduced(): Promise<boolean>;
  balancedReduced(): Promise<boolean>;
  batchEvidencePrepared(): Promise<boolean>;
  bucketEvidenceHandles(): Promise<[Handle, Handle, Handle]>;
  totalHandle(): Promise<Handle>;
  candidateHandle(index: bigint): Promise<Handle>;
  reductionHandles(): Promise<[Handle, Handle, Handle, Handle]>;
  acceptedTargetHandle(): Promise<Handle>;
}

interface DeploymentRecord {
  readonly contractAddress: string;
  readonly deploymentTransactionHash: string;
  readonly deploymentBlockNumber: number;
  readonly timestamp: string;
}

interface Preflight {
  readonly liveVerificationToolingCommit: string;
  readonly deployerAddress: string;
  readonly unauthorizedAddress: string;
}

interface RunState {
  readonly schemaVersion: 1;
  readonly network: "sepolia";
  readonly chainId: 11155111;
  readonly localGate0BaselineCommit: string;
  /** Original tooling commit for historical transactions; never overwritten. */
  readonly liveVerificationToolingCommit: string;
  toolingRevisions?: string[];
  invocations?: LiveInvocation[];
  activeInvocationId?: string;
  deployment?: DeploymentRecord;
  secondaryDeployment?: DeploymentRecord;
  failureDrillDeployment?: DeploymentRecord;
  readonly transactions: JsonObject[];
  readonly privacyProbes: JsonObject[];
  readonly proofBinding: JsonObject[];
  readonly antiGrinding: JsonObject[];
  readonly zeroTotal: JsonObject[];
  readonly recovery: JsonObject[];
  readonly performance: JsonObject[];
  readonly notes: string[];
}

const EVIDENCE_DIRECTORY = resolve(process.cwd(), "../../evidence/gate0/sepolia");
const PROGRESS_STATE_PATH = resolve(
  process.cwd(),
  "../../.git/veilpot-gate0-sepolia-progress.json",
);
const LIVE_RUN_LOCK_PATH = resolve(process.cwd(), "../../.git/veilpot-gate0-sepolia-run.lock.json");
const LOCAL_GATE0_BASELINE_COMMIT = "5b8483569b8ca63b821e7eb5ef5333ff86917b79";
const PRIMARY_BATCH_SIZE = 8;
const STATE_AWAITING_BUCKET = 0n;
const STATE_BUCKET_READY = 1n;
const STATE_AWAITING_CANDIDATE_BATCH = 2n;
const STATE_AWAITING_BATCH_PROOF = 3n;
const STATE_CANDIDATE_ACCEPTED = 4n;
const STATE_NO_ELIGIBLE_WEIGHT = 5n;
const PRIMARY_TOTAL = 1n << 20n;
const FAILURE_DRILL_TOTAL = 129n;
const FAILURE_DRILL_MAX_NEW_BATCHES_PER_INVOCATION = 6;

function gitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function commandSucceeds(command: string, arguments_: readonly string[]): boolean {
  try {
    execFileSync(command, arguments_, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function assertPreflight(): Preflight {
  const liveVerificationToolingCommit = gitCommit();
  if (!commandSucceeds("git", ["cat-file", "-e", `${LOCAL_GATE0_BASELINE_COMMIT}^{commit}`])) {
    throw new Error("recorded local Gate 0 baseline commit does not exist");
  }
  if (
    !commandSucceeds("git", [
      "merge-base",
      "--is-ancestor",
      LOCAL_GATE0_BASELINE_COMMIT,
      liveVerificationToolingCommit,
    ])
  ) {
    throw new Error(
      "recorded local Gate 0 baseline is not an ancestor of live verification tooling",
    );
  }
  if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0) {
    throw new Error("Git working tree must be clean before live verification");
  }
  if (
    !vars.has("SEPOLIA_RPC_URL") ||
    !vars.has("DEPLOYER_PRIVATE_KEY") ||
    !vars.has("UNAUTHORIZED_PRIVATE_KEY")
  ) {
    throw new Error("required Hardhat variables are not configured");
  }
  const deployerAddress = new ethers.Wallet(vars.get("DEPLOYER_PRIVATE_KEY")).address;
  const unauthorizedAddress = new ethers.Wallet(vars.get("UNAUTHORIZED_PRIVATE_KEY")).address;
  if (deployerAddress.toLowerCase() === unauthorizedAddress.toLowerCase()) {
    throw new Error("unauthorized test wallet must differ from the deployer wallet");
  }
  return { liveVerificationToolingCommit, deployerAddress, unauthorizedAddress };
}

function runnerMode(): RunnerMode {
  if (process.env.VEILPOT_LIVE_FINALIZE === "true") return "finalize";
  if (process.env.VEILPOT_LIVE_RUN_FAILURE_DRILL === "true") return "failure-retry-drill";
  if (process.env.VEILPOT_LIVE_STOP_AFTER === "batch-generated") return "primary-interrupt";
  return "primary";
}

function assertAndRecordToolingRevision(state: RunState, currentToolingCommit: string): void {
  if (state.localGate0BaselineCommit !== LOCAL_GATE0_BASELINE_COMMIT) {
    throw new Error("persisted local Gate 0 baseline does not match the immutable baseline");
  }
  if (
    !commandSucceeds("git", [
      "merge-base",
      "--is-ancestor",
      state.liveVerificationToolingCommit,
      currentToolingCommit,
    ])
  ) {
    throw new Error("current live tooling is not a descendant of persisted live evidence tooling");
  }
  state.toolingRevisions = appendToolingRevision(
    state.toolingRevisions,
    state.liveVerificationToolingCommit,
    currentToolingCommit,
  );
}

function recordWithInvocation(state: RunState, record: JsonObject): JsonObject {
  return state.activeInvocationId === undefined
    ? record
    : { ...record, invocationId: state.activeInvocationId };
}

function activeInvocation(state: RunState): LiveInvocation {
  const invocation = state.invocations?.find(
    (candidate) => candidate.invocationId === state.activeInvocationId,
  );
  if (invocation === undefined) throw new Error("active live invocation is not persisted");
  return invocation;
}

async function setInvocationStage(state: RunState, stage: string): Promise<void> {
  const invocation = activeInvocation(state);
  invocation.stage = stage;
  await updateLiveRunLock(LIVE_RUN_LOCK_PATH, invocation);
  await persist(state);
}

async function completeInvocation(
  state: RunState,
  status: Exclude<InvocationStatus, "RUNNING" | "FAILED">,
  stage: string,
): Promise<void> {
  const invocation = activeInvocation(state);
  invocation.status = status;
  invocation.stage = stage;
  invocation.completedAt = new Date().toISOString();
  await updateLiveRunLock(LIVE_RUN_LOCK_PATH, invocation);
  await persist(state);
  delete state.activeInvocationId;
  await persist(state);
  await releaseLiveRunLock(LIVE_RUN_LOCK_PATH);
}

async function failInvocation(state: RunState | undefined, error: unknown): Promise<void> {
  if (state?.activeInvocationId === undefined) return;
  const invocation = activeInvocation(state);
  invocation.status = "FAILED";
  invocation.stage = "failed-requires-explicit-lock-inspection";
  invocation.completedAt = new Date().toISOString();
  invocation.failure = sanitizeError(error);
  // Keep the lock in place after an abnormal exit. A future runner must fail closed.
  await updateLiveRunLock(LIVE_RUN_LOCK_PATH, invocation);
  await persist(state);
}

/**
 * Initializes the installed FHEVM CLI API for a real Sepolia process before
 * the runner deploys the probe, creates encrypted inputs, or asks the relayer
 * to decrypt values.
 * Plugin 0.4.2 performs its supported-network, address, and relayer-instance
 * setup inside this idempotent API.
 */
async function initializeLiveFhevm(): Promise<void> {
  await hre.fhevm.initializeCLIApi();
  if (hre.fhevm.isMock) {
    throw new Error("FHEVM CLI initialization resolved a mock environment instead of Sepolia");
  }
}

function sha256(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function sanitizeError(error: unknown): JsonObject {
  if (typeof error !== "object" || error === null) return { category: "NON_OBJECT_ERROR" };
  const value = error as { name?: unknown; code?: unknown; shortMessage?: unknown };
  return {
    category: typeof value.name === "string" ? value.name : "UNKNOWN_ERROR",
    code: typeof value.code === "string" || typeof value.code === "number" ? value.code : null,
    shortMessagePresent: typeof value.shortMessage === "string",
  };
}

function jsonStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readState(liveVerificationToolingCommit: string): Promise<RunState> {
  try {
    return JSON.parse(await readFile(PROGRESS_STATE_PATH, "utf8")) as RunState;
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      network: "sepolia",
      chainId: 11_155_111,
      localGate0BaselineCommit: LOCAL_GATE0_BASELINE_COMMIT,
      liveVerificationToolingCommit,
      transactions: [],
      privacyProbes: [],
      proofBinding: [],
      antiGrinding: [],
      zeroTotal: [],
      recovery: [],
      performance: [],
      notes: [],
    };
  }
}

async function persist(state: RunState): Promise<void> {
  await mkdir(dirname(PROGRESS_STATE_PATH), { recursive: true });
  await writeFile(PROGRESS_STATE_PATH, jsonStringify(state));
}

async function receiptRecord(
  state: RunState,
  label: string,
  transaction: Promise<ethers.ContractTransactionResponse>,
): Promise<ethers.TransactionReceipt> {
  const start = performance.now();
  const response = await transaction;
  const receipt = await response.wait();
  if (receipt === null) throw new Error(`missing receipt for ${label}`);
  state.transactions.push(
    recordWithInvocation(state, {
      label,
      transactionHash: response.hash,
      blockNumber: receipt.blockNumber,
      status: receipt.status === 1 ? "SUCCESS" : "FAILED",
      gasUsed: receipt.gasUsed.toString(),
      confirmationMilliseconds: Math.round(performance.now() - start),
    }),
  );
  await persist(state);
  return receipt;
}

async function expectedFailure(
  state: RunState,
  records: JsonObject[],
  label: string,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
    records.push(
      recordWithInvocation(state, { label, expected: "REVERT", actual: "UNEXPECTED_SUCCESS" }),
    );
    await persist(state);
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === `${label} unexpectedly succeeded`) throw error;
    records.push(
      recordWithInvocation(state, {
        label,
        expected: "REVERT",
        actual: "REVERTED",
        error: sanitizeError(error),
      }),
    );
    await persist(state);
  }
}

async function encrypt128(
  contract: ProbeContract,
  signerAddress: string,
  values: readonly bigint[],
): Promise<{ readonly handles: Handle[]; readonly proof: string }> {
  const input = hre.fhevm.createEncryptedInput(await contract.getAddress(), signerAddress);
  for (const value of values) input.add128(value);
  const encrypted = await input.encrypt();
  return {
    handles: encrypted.handles.map((handle) => ethers.hexlify(handle) as Handle),
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

async function deployProbe(state: RunState, label: string): Promise<DeploymentRecord> {
  const factory = await hre.ethers.getContractFactory("VeilDrawProbe");
  const contract = (await factory.deploy()) as unknown as ProbeContract;
  const deployment = contract.deploymentTransaction();
  if (deployment === null) throw new Error("missing deployment transaction");
  const receipt = await receiptRecord(state, `${label}:deploy`, Promise.resolve(deployment));
  return {
    contractAddress: await contract.getAddress(),
    deploymentTransactionHash: deployment.hash,
    deploymentBlockNumber: receipt.blockNumber,
    timestamp: new Date().toISOString(),
  };
}

async function contractAt(address: string): Promise<ProbeContract> {
  return (await hre.ethers.getContractAt("VeilDrawProbe", address)) as unknown as ProbeContract;
}

async function decryptBucketEvidence(contract: ProbeContract): Promise<{
  readonly exponent: bigint;
  readonly zero: boolean;
  readonly supported: boolean;
  readonly proof: string;
}> {
  const handles = await contract.bucketEvidenceHandles();
  const result = await hre.fhevm.publicDecrypt(handles);
  return {
    exponent: result.clearValues[handles[0]] as bigint,
    zero: result.clearValues[handles[1]] as boolean,
    supported: result.clearValues[handles[2]] as boolean,
    proof: result.decryptionProof,
    // The timing is attached by callers that own persistent state.
  };
}

async function recordProtectedPublicDecrypt(
  state: RunState,
  label: string,
  handle: Handle,
): Promise<void> {
  const started = performance.now();
  try {
    await hre.fhevm.publicDecrypt([handle]);
    state.privacyProbes.push(
      recordWithInvocation(state, {
        label,
        expected: "DENIED",
        actual: "UNEXPECTED_PUBLIC_DECRYPTION_SUCCESS",
        durationMilliseconds: Math.round(performance.now() - started),
        cleartextRecorded: false,
      }),
    );
    await persist(state);
    throw new Error(`${label} was publicly decrypted; protected cleartext intentionally discarded`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith(`${label} was publicly decrypted`))
      throw error;
    state.privacyProbes.push(
      recordWithInvocation(state, {
        label,
        expected: "DENIED",
        actual: "DENIED",
        durationMilliseconds: Math.round(performance.now() - started),
        error: sanitizeError(error),
      }),
    );
    await persist(state);
  }
}

async function recordUnauthorizedUserDecrypt(
  state: RunState,
  contract: ProbeContract,
  handle: Handle,
  unauthorizedAddress: string,
): Promise<void> {
  const signer = new ethers.Wallet(vars.get("UNAUTHORIZED_PRIVATE_KEY"), hre.ethers.provider);
  if (signer.address.toLowerCase() !== unauthorizedAddress.toLowerCase()) {
    throw new Error("unauthorized test wallet address changed after preflight");
  }
  const started = performance.now();
  try {
    await hre.fhevm.userDecryptEuint(
      FhevmType.euint128,
      handle,
      await contract.getAddress(),
      signer,
    );
    state.privacyProbes.push(
      recordWithInvocation(state, {
        label: "unauthorized-user-decrypt-total",
        unauthorizedAddress,
        expected: "DENIED",
        actual: "UNEXPECTED_DECRYPTION_SUCCESS",
        durationMilliseconds: Math.round(performance.now() - started),
        cleartextRecorded: false,
      }),
    );
    await persist(state);
    throw new Error("unauthorized user decryption unexpectedly succeeded");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === "unauthorized user decryption unexpectedly succeeded"
    ) {
      throw error;
    }
    state.privacyProbes.push(
      recordWithInvocation(state, {
        label: "unauthorized-user-decrypt-total",
        unauthorizedAddress,
        expected: "DENIED",
        actual: "DENIED",
        durationMilliseconds: Math.round(performance.now() - started),
        error: sanitizeError(error),
      }),
    );
    if (!state.notes.includes("unauthorized-user-decrypt-total-denied")) {
      state.notes.push("unauthorized-user-decrypt-total-denied");
    }
    await persist(state);
  }
}

async function writeDeploymentManifest(
  state: RunState,
  deployment: DeploymentRecord,
): Promise<void> {
  const artifactPath = resolve(
    process.cwd(),
    "artifacts/contracts/VeilDrawProbe.sol/VeilDrawProbe.json",
  );
  const sourcePath = resolve(process.cwd(), "contracts/VeilDrawProbe.sol");
  const packagePath = resolve(process.cwd(), "package.json");
  const rootPackagePath = resolve(process.cwd(), "../../package.json");
  const [artifactText, sourceText, packageText, rootPackageText] = await Promise.all([
    readFile(artifactPath, "utf8"),
    readFile(sourcePath, "utf8"),
    readFile(packagePath, "utf8"),
    readFile(rootPackagePath, "utf8"),
  ]);
  const artifact = JSON.parse(artifactText) as {
    abi: unknown;
    bytecode: string;
    deployedBytecode: string;
  };
  const contract = await contractAt(deployment.contractAddress);
  const onChainCode = await hre.ethers.provider.getCode(await contract.getAddress());
  const contractsPackage = JSON.parse(packageText) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const rootPackage = JSON.parse(rootPackageText) as { devDependencies: Record<string, string> };
  const manifest = {
    schemaVersion: 1,
    chainId: 11_155_111,
    network: "sepolia",
    deploymentTimestamp: deployment.timestamp,
    deploymentTransactionHash: deployment.deploymentTransactionHash,
    contractAddress: deployment.contractAddress,
    deployerAddress: (await hre.ethers.getSigners())[0]?.address ?? null,
    localGate0BaselineCommit: state.localGate0BaselineCommit,
    liveVerificationToolingCommit: state.liveVerificationToolingCommit,
    liveVerificationToolingRevisions: state.toolingRevisions ?? [
      state.liveVerificationToolingCommit,
    ],
    solidityCompilerVersion: "0.8.27",
    optimizer: { enabled: true, runs: 800 },
    metadata: { bytecodeHash: "none" },
    evmVersion: "cancun",
    abiHash: sha256(JSON.stringify(artifact.abi)),
    creationBytecodeHash: ethers.keccak256(artifact.bytecode),
    artifactRuntimeBytecodeHash: ethers.keccak256(artifact.deployedBytecode),
    onChainRuntimeBytecodeHash: ethers.keccak256(onChainCode),
    sourceHash: sha256(sourceText),
    dependencyVersions: {
      hardhat: rootPackage.devDependencies.hardhat,
      fhevmSolidity: contractsPackage.dependencies["@fhevm/solidity"],
      fhevmHardhatPlugin: contractsPackage.devDependencies["@fhevm/hardhat-plugin"],
      relayerSdk: contractsPackage.devDependencies["@zama-fhe/relayer-sdk"],
    },
  };
  await writeFile(resolve(EVIDENCE_DIRECTORY, "deployment.json"), jsonStringify(manifest));
  await writeFile(
    resolve(EVIDENCE_DIRECTORY, "source-parity.json"),
    jsonStringify({
      schemaVersion: 1,
      localGate0BaselineCommit: state.localGate0BaselineCommit,
      liveVerificationToolingCommit: state.liveVerificationToolingCommit,
      repositoryArtifactToOnChainRuntimeMatch:
        manifest.artifactRuntimeBytecodeHash === manifest.onChainRuntimeBytecodeHash,
      artifactRuntimeBytecodeHash: manifest.artifactRuntimeBytecodeHash,
      onChainRuntimeBytecodeHash: manifest.onChainRuntimeBytecodeHash,
      sourceVerification:
        "NOT_ATTEMPTED_BY_RUNNER; record an external Sourcify result only if actually returned",
    }),
  );
}

async function preparePrimary(
  state: RunState,
  contract: ProbeContract,
  signerAddress: string,
): Promise<void> {
  if (!(await contract.drawStarted())) {
    const encrypted = await encrypt128(contract, signerAddress, [PRIMARY_TOTAL]);
    await receiptRecord(
      state,
      "primary:start-encrypted-total",
      contract.startDraw(encrypted.handles[0]!, encrypted.proof),
    );
  }
  if ((await contract.state()) === STATE_AWAITING_BUCKET) {
    const handles = await contract.bucketEvidenceHandles();
    if (handles[0] === ethers.ZeroHash) {
      await receiptRecord(
        state,
        "primary:prepare-bucket-evidence",
        contract.prepareBucketEvidence(),
      );
    }
    const started = performance.now();
    const evidence = await decryptBucketEvidence(contract);
    state.performance.push(
      recordWithInvocation(state, {
        operation: "primary:bucket-public-decrypt",
        observedSepolia: true,
        durationMilliseconds: Math.round(performance.now() - started),
      }),
    );
    await expectedFailure(state, state.proofBinding, "bucket-wrong-cleartext", async () =>
      contract.submitBucketEvidence.staticCall(
        evidence.exponent + 1n,
        evidence.zero,
        evidence.supported,
        evidence.proof,
      ),
    );
    await expectedFailure(state, state.proofBinding, "bucket-empty-proof", async () =>
      contract.submitBucketEvidence.staticCall(
        evidence.exponent,
        evidence.zero,
        evidence.supported,
        "0x",
      ),
    );
    const secondaryEvidence = await prepareSecondaryBucketEvidence(state, signerAddress);
    await expectedFailure(state, state.proofBinding, "bucket-proof-from-another-draw", async () =>
      contract.submitBucketEvidence.staticCall(
        evidence.exponent,
        evidence.zero,
        evidence.supported,
        secondaryEvidence.proof,
      ),
    );
    await receiptRecord(
      state,
      "primary:submit-bucket-evidence",
      contract.submitBucketEvidence(
        evidence.exponent,
        evidence.zero,
        evidence.supported,
        evidence.proof,
      ),
    );
    state.proofBinding.push(
      recordWithInvocation(state, {
        label: "bucket-valid-proof",
        actual: "ACCEPTED",
        publicBucketExponent: evidence.exponent.toString(),
        publicZero: evidence.zero,
        publicSupported: evidence.supported,
      }),
    );
    await expectedFailure(state, state.proofBinding, "bucket-stale-proof", async () =>
      contract.submitBucketEvidence.staticCall(
        evidence.exponent,
        evidence.zero,
        evidence.supported,
        evidence.proof,
      ),
    );
    await persist(state);
  }
}

async function prepareSecondaryBucketEvidence(
  state: RunState,
  signerAddress: string,
): Promise<{ readonly proof: string }> {
  if (state.secondaryDeployment === undefined) {
    state.secondaryDeployment = await deployProbe(state, "proof-binding-secondary");
    await persist(state);
  }
  const secondary = await contractAt(state.secondaryDeployment.contractAddress);
  if (!(await secondary.drawStarted())) {
    const encrypted = await encrypt128(secondary, signerAddress, [PRIMARY_TOTAL]);
    await receiptRecord(
      state,
      "proof-binding-secondary:start-encrypted-total",
      secondary.startDraw(encrypted.handles[0]!, encrypted.proof),
    );
  }
  if ((await secondary.state()) === STATE_AWAITING_BUCKET) {
    const handles = await secondary.bucketEvidenceHandles();
    if (handles[0] === ethers.ZeroHash) {
      await receiptRecord(
        state,
        "proof-binding-secondary:prepare-bucket-evidence",
        secondary.prepareBucketEvidence(),
      );
    }
  }
  const evidence = await decryptBucketEvidence(secondary);
  return { proof: evidence.proof };
}

async function executePrimaryM8(
  state: RunState,
  contract: ProbeContract,
  unauthorizedAddress: string,
): Promise<void> {
  if ((await contract.state()) === STATE_BUCKET_READY) {
    await receiptRecord(
      state,
      "primary:generate-m8",
      contract.generateCandidateBatch(PRIMARY_BATCH_SIZE),
    );
    state.recovery.push(
      recordWithInvocation(state, {
        label: "candidate-batch-generated",
        state: "AwaitingBatchProof",
        resumeRequired: true,
      }),
    );
    await persist(state);
    if (process.env.VEILPOT_LIVE_STOP_AFTER === "batch-generated") {
      state.recovery.push(
        recordWithInvocation(state, {
          label: "intentional-interruption",
          actual: "STOPPED_AFTER_BATCH_GENERATION",
        }),
      );
      await persist(state);
      return;
    }
  }
  if ((await contract.state()) !== STATE_AWAITING_BATCH_PROOF) return;
  if (!(await contract.serialReduced())) {
    await receiptRecord(state, "primary:reduce-serial", contract.reduceSerial());
  }
  if (!(await contract.balancedReduced())) {
    await receiptRecord(state, "primary:reduce-balanced", contract.reduceBalanced());
  }
  if (!(await contract.batchEvidencePrepared())) {
    await receiptRecord(state, "primary:prepare-batch-evidence", contract.prepareBatchEvidence());
  }
  const candidate = await contract.candidateHandle(0n);
  const reductions = await contract.reductionHandles();
  await recordProtectedPublicDecrypt(
    state,
    "public-decrypt-exact-total",
    await contract.totalHandle(),
  );
  await recordProtectedPublicDecrypt(state, "public-decrypt-candidate-x0", candidate);
  await recordUnauthorizedUserDecrypt(
    state,
    contract,
    await contract.totalHandle(),
    unauthorizedAddress,
  );
  const started = performance.now();
  const publicResult = await hre.fhevm.publicDecrypt([reductions[1]]);
  state.performance.push(
    recordWithInvocation(state, {
      operation: "primary:batch-success-public-decrypt",
      observedSepolia: true,
      durationMilliseconds: Math.round(performance.now() - started),
    }),
  );
  const success = publicResult.clearValues[reductions[1]] as boolean;
  if (!success)
    throw new Error(
      "power-of-two primary total unexpectedly produced an invalid bounded candidate",
    );
  await expectedFailure(state, state.proofBinding, "batch-wrong-cleartext", async () =>
    contract.submitBatchEvidence.staticCall(false, publicResult.decryptionProof),
  );
  await receiptRecord(
    state,
    "primary:submit-batch-success",
    contract.submitBatchEvidence(true, publicResult.decryptionProof),
  );
  await recordProtectedPublicDecrypt(
    state,
    "public-decrypt-accepted-target",
    await contract.acceptedTargetHandle(),
  );
  await expectedFailure(state, state.antiGrinding, "successful-batch-reroll", async () =>
    contract.generateCandidateBatch.staticCall(PRIMARY_BATCH_SIZE),
  );
  await expectedFailure(state, state.proofBinding, "batch-replayed-proof", async () =>
    contract.submitBatchEvidence.staticCall(true, publicResult.decryptionProof),
  );
  state.antiGrinding.push(
    recordWithInvocation(state, {
      label: "primary-success-irreversible",
      actualState: (await contract.state()).toString(),
      expectedState: STATE_CANDIDATE_ACCEPTED.toString(),
    }),
  );
  if (
    state.recovery.some((record) => record.label === "intentional-interruption") &&
    !state.notes.includes("interruption-resume-complete")
  ) {
    state.recovery.push(
      recordWithInvocation(state, {
        label: "interruption-resume",
        actual: "RESUMED_WITHOUT_NEW_CANDIDATE_BATCH",
      }),
    );
    state.notes.push("interruption-resume-complete");
  }
  await persist(state);
}

async function runPrefixMeasurements(
  state: RunState,
  contract: ProbeContract,
  signerAddress: string,
): Promise<void> {
  if (state.notes.includes("prefix-measurements-complete")) return;
  for (const participantCount of [4, 8, 12, 16]) {
    const weights = Array.from({ length: participantCount }, () => 1n);
    const encryptedWeights = await encrypt128(contract, signerAddress, weights);
    const encryptedTarget = await encrypt128(contract, signerAddress, [0n]);
    await receiptRecord(
      state,
      `prefix:n=${String(participantCount)}`,
      contract.benchmarkPrefixSelection(
        encryptedWeights.handles,
        encryptedWeights.proof,
        encryptedTarget.handles[0]!,
        encryptedTarget.proof,
      ),
    );
    const latest = state.transactions.at(-1);
    state.performance.push(
      recordWithInvocation(state, {
        operation: "prefix-selection",
        participantCount,
        observedSepolia: true,
        gasUsed: latest?.gasUsed ?? null,
        liveHcuDepth: "NOT_DIRECTLY_OBSERVABLE_ON_LIVE_SEPOLIA",
      }),
    );
    await persist(state);
  }
  state.notes.push("prefix-measurements-complete");
  await persist(state);
}

async function runZeroTotal(state: RunState, signerAddress: string): Promise<void> {
  const existing = state.notes.includes("zero-total-complete");
  if (existing) return;
  const deployment = await deployProbe(state, "zero-total");
  const contract = await contractAt(deployment.contractAddress);
  const encrypted = await encrypt128(contract, signerAddress, [0n]);
  await receiptRecord(
    state,
    "zero-total:start",
    contract.startDraw(encrypted.handles[0]!, encrypted.proof),
  );
  await receiptRecord(state, "zero-total:prepare-bucket", contract.prepareBucketEvidence());
  const evidence = await decryptBucketEvidence(contract);
  await receiptRecord(
    state,
    "zero-total:submit-bucket",
    contract.submitBucketEvidence(
      evidence.exponent,
      evidence.zero,
      evidence.supported,
      evidence.proof,
    ),
  );
  await expectedFailure(state, state.zeroTotal, "zero-total-candidate-generation", async () =>
    contract.generateCandidateBatch.staticCall(1),
  );
  state.zeroTotal.push(
    recordWithInvocation(state, {
      terminalState: (await contract.state()).toString(),
      expectedTerminalState: STATE_NO_ELIGIBLE_WEIGHT.toString(),
      randomCandidateGenerated: false,
    }),
  );
  state.notes.push("zero-total-complete");
  await persist(state);
}

async function runFailureRetryDrill(state: RunState, signerAddress: string): Promise<void> {
  if (state.failureDrillDeployment === undefined) {
    state.failureDrillDeployment = await deployProbe(state, "failure-retry-drill");
    await persist(state);
  }
  const contract = await contractAt(state.failureDrillDeployment.contractAddress);
  if (!(await contract.drawStarted())) {
    const encrypted = await encrypt128(contract, signerAddress, [FAILURE_DRILL_TOTAL]);
    await receiptRecord(
      state,
      "failure-retry-drill:start-encrypted-total",
      contract.startDraw(encrypted.handles[0]!, encrypted.proof),
    );
  }
  if ((await contract.state()) === STATE_AWAITING_BUCKET) {
    const handles = await contract.bucketEvidenceHandles();
    if (handles[0] === ethers.ZeroHash) {
      await receiptRecord(
        state,
        "failure-retry-drill:prepare-bucket",
        contract.prepareBucketEvidence(),
      );
    }
    const evidence = await decryptBucketEvidence(contract);
    await receiptRecord(
      state,
      "failure-retry-drill:submit-bucket",
      contract.submitBucketEvidence(
        evidence.exponent,
        evidence.zero,
        evidence.supported,
        evidence.proof,
      ),
    );
  }
  let generatedThisInvocation = 0;
  let priorFailureProof: string | undefined;

  for (;;) {
    const currentState = await contract.state();
    const action = nextFailureDrillAction(
      currentState,
      generatedThisInvocation,
      FAILURE_DRILL_MAX_NEW_BATCHES_PER_INVOCATION,
    );
    if (action === "STOP_ACCEPTED") {
      await expectedFailure(
        state,
        state.antiGrinding,
        "failure-retry-drill-successful-batch-reroll",
        async () => contract.generateCandidateBatch.staticCall(1),
      );
      if (!state.notes.includes("failure-retry-drill-accepted")) {
        state.notes.push("failure-retry-drill-accepted");
      }
      await persist(state);
      return;
    }
    if (action === "BOUNDED_STOP") {
      state.recovery.push(
        recordWithInvocation(state, {
          label: "failure-retry-drill-bounded-stop",
          maximumNewBatches: FAILURE_DRILL_MAX_NEW_BATCHES_PER_INVOCATION,
          state: STATE_AWAITING_CANDIDATE_BATCH.toString(),
        }),
      );
      await persist(state);
      return;
    }
    if (action === "GENERATE_NEXT_BATCH") {
      const nextBatchId = (await contract.batchId()) + 1n;
      await setInvocationStage(
        state,
        `failure-drill:before-generate-batch-${nextBatchId.toString()}`,
      );
      await receiptRecord(
        state,
        `failure-retry-drill:generate-m1-batch-${nextBatchId.toString()}`,
        contract.generateCandidateBatch(1),
      );
      generatedThisInvocation += 1;
      await setInvocationStage(state, `failure-drill:generated-batch-${nextBatchId.toString()}`);
      continue;
    }

    const batchId = await contract.batchId();
    await setInvocationStage(state, `failure-drill:process-batch-${batchId.toString()}`);
    if (!(await contract.serialReduced())) {
      await receiptRecord(
        state,
        `failure-retry-drill:reduce-serial-batch-${batchId.toString()}`,
        contract.reduceSerial(),
      );
    }
    if (!(await contract.balancedReduced())) {
      await receiptRecord(
        state,
        `failure-retry-drill:reduce-balanced-batch-${batchId.toString()}`,
        contract.reduceBalanced(),
      );
    }
    if (!(await contract.batchEvidencePrepared())) {
      await receiptRecord(
        state,
        `failure-retry-drill:prepare-batch-evidence-${batchId.toString()}`,
        contract.prepareBatchEvidence(),
      );
    }
    const reductions = await contract.reductionHandles();
    const decryptStarted = performance.now();
    const result = await hre.fhevm.publicDecrypt([reductions[1]]);
    state.performance.push(
      recordWithInvocation(state, {
        operation: "failure-retry-drill:batch-success-public-decrypt",
        batchId: batchId.toString(),
        observedSepolia: true,
        durationMilliseconds: Math.round(performance.now() - decryptStarted),
      }),
    );
    const success = result.clearValues[reductions[1]] as boolean;
    if (success) {
      await receiptRecord(
        state,
        `failure-retry-drill:submit-success-batch-${batchId.toString()}`,
        contract.submitBatchEvidence(true, result.decryptionProof),
      );
      if ((await contract.state()) !== STATE_CANDIDATE_ACCEPTED) {
        throw new Error("proven successful failure-drill batch did not enter CandidateAccepted");
      }
      continue;
    }

    await expectedFailure(
      state,
      state.proofBinding,
      `failure-retry-drill:wrong-cleartext-batch-${batchId.toString()}`,
      async () => contract.submitBatchEvidence.staticCall(true, result.decryptionProof),
    );
    await expectedFailure(
      state,
      state.proofBinding,
      `failure-retry-drill:empty-proof-batch-${batchId.toString()}`,
      async () => contract.submitBatchEvidence.staticCall(false, "0x"),
    );
    if (priorFailureProof !== undefined) {
      await expectedFailure(
        state,
        state.proofBinding,
        `failure-retry-drill:prior-batch-proof-batch-${batchId.toString()}`,
        async () => contract.submitBatchEvidence.staticCall(false, priorFailureProof!),
      );
    }
    await expectedFailure(
      state,
      state.antiGrinding,
      `failure-retry-drill:retry-before-valid-failure-proof-batch-${batchId.toString()}`,
      async () => contract.generateCandidateBatch.staticCall(1),
    );
    await receiptRecord(
      state,
      `failure-retry-drill:submit-proven-failure-batch-${batchId.toString()}`,
      contract.submitBatchEvidence(false, result.decryptionProof),
    );
    if ((await contract.state()) !== STATE_AWAITING_CANDIDATE_BATCH) {
      throw new Error("proven failed batch did not enter AwaitingCandidateBatch");
    }
    priorFailureProof = result.decryptionProof;
    state.antiGrinding.push(
      recordWithInvocation(state, {
        label: `failure-retry-drill:failure-proof-accepted-batch-${batchId.toString()}`,
        actual: "PASSED",
        protectedCleartextRecorded: false,
      }),
    );
    await persist(state);
  }
}

async function emitEvidence(state: RunState): Promise<void> {
  const provenance = {
    localGate0BaselineCommit: state.localGate0BaselineCommit,
    liveVerificationToolingCommit: state.liveVerificationToolingCommit,
    liveVerificationToolingRevisions: state.toolingRevisions ?? [
      state.liveVerificationToolingCommit,
    ],
  };
  const files: Readonly<Record<string, unknown>> = {
    "run-summary.json": {
      schemaVersion: 1,
      ...provenance,
      status: "IN_PROGRESS_OR_COMPLETE_PER_RECORDED_SCENARIOS",
      primaryDeployment: state.deployment ?? null,
      invocations: state.invocations ?? [],
      noSecretValuesRecorded: true,
    },
    "transactions.json": {
      schemaVersion: 1,
      ...provenance,
      transactions: state.transactions,
      note: "Historical transactions without invocationId are intentionally unattributed.",
    },
    "privacy-probes.json": { schemaVersion: 1, ...provenance, probes: state.privacyProbes },
    "proof-binding.json": { schemaVersion: 1, ...provenance, probes: state.proofBinding },
    "anti-grinding.json": { schemaVersion: 1, ...provenance, probes: state.antiGrinding },
    "zero-total.json": { schemaVersion: 1, ...provenance, probes: state.zeroTotal },
    "recovery.json": { schemaVersion: 1, ...provenance, probes: state.recovery },
    "performance.json": {
      schemaVersion: 1,
      ...provenance,
      measurements: state.performance,
      liveHcu: "NOT_DIRECTLY_OBSERVABLE_ON_LIVE_SEPOLIA unless an authoritative endpoint is added",
    },
  };
  await Promise.all(
    Object.entries(files).map(([filename, payload]) =>
      writeFile(resolve(EVIDENCE_DIRECTORY, filename), jsonStringify(payload)),
    ),
  );
}

async function main(): Promise<void> {
  const preflight = assertPreflight();
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 11_155_111n)
    throw new Error(`expected Sepolia chain 11155111, got ${network.chainId.toString()}`);
  const startingConfirmedNonce = await hre.ethers.provider.getTransactionCount(
    preflight.deployerAddress,
    "latest",
  );
  const invocation = createInvocation(
    runnerMode(),
    startingConfirmedNonce,
    preflight.liveVerificationToolingCommit,
    preflight.deployerAddress,
  );
  await acquireLiveRunLock(LIVE_RUN_LOCK_PATH, invocation);

  let state: RunState | undefined;
  try {
    state = await readState(preflight.liveVerificationToolingCommit);
    assertAndRecordToolingRevision(state, preflight.liveVerificationToolingCommit);
    state.invocations ??= [];
    state.invocations.push(invocation);
    state.activeInvocationId = invocation.invocationId;
    await persist(state);
    await setInvocationStage(state, "preflight-complete-before-fhevm-initialization");
    await initializeLiveFhevm();
    await setInvocationStage(state, "fhevm-initialized");
    const signer = (await hre.ethers.getSigners())[0];
    if (signer === undefined) throw new Error("no deployer signer configured");
    if (signer.address.toLowerCase() !== preflight.deployerAddress.toLowerCase()) {
      throw new Error("configured deployer address does not match the preflight wallet");
    }
    if (state.deployment === undefined) {
      await setInvocationStage(state, "before-primary-deployment");
      state.deployment = await deployProbe(state, "primary");
      await persist(state);
    }
    const primary = await contractAt(state.deployment.contractAddress);
    await preparePrimary(state, primary, signer.address);
    await executePrimaryM8(state, primary, preflight.unauthorizedAddress);
    if ((await primary.state()) === STATE_CANDIDATE_ACCEPTED) {
      await runPrefixMeasurements(state, primary, signer.address);
      await runZeroTotal(state, signer.address);
    }
    if (process.env.VEILPOT_LIVE_RUN_FAILURE_DRILL === "true") {
      await runFailureRetryDrill(state, signer.address);
    }
    if (process.env.VEILPOT_LIVE_FINALIZE === "true") {
      if (!state.notes.includes("zero-total-complete")) {
        throw new Error("zero-total evidence is incomplete; refusing to finalize");
      }
      if (!state.notes.includes("prefix-measurements-complete")) {
        throw new Error("prefix measurement evidence is incomplete; refusing to finalize");
      }
      if (!state.notes.includes("interruption-resume-complete")) {
        throw new Error("interruption/resume evidence is incomplete; refusing to finalize");
      }
      if (!state.notes.includes("failure-retry-drill-accepted")) {
        throw new Error("failure-retry acceptance evidence is incomplete; refusing to finalize");
      }
      if (!state.notes.includes("unauthorized-user-decrypt-total-denied")) {
        throw new Error("independent-wallet denial evidence is incomplete; refusing to finalize");
      }
      await writeDeploymentManifest(state, state.deployment);
      await emitEvidence(state);
    }
    const intentionallyInterrupted =
      runnerMode() === "primary-interrupt" &&
      state.recovery.some((record) => record.label === "intentional-interruption");
    let boundedStop = false;
    if (runnerMode() === "failure-retry-drill" && state.failureDrillDeployment !== undefined) {
      const drill = await contractAt(state.failureDrillDeployment.contractAddress);
      boundedStop = (await drill.state()) === STATE_AWAITING_CANDIDATE_BATCH;
    }
    await completeInvocation(
      state,
      intentionallyInterrupted ? "INTERRUPTED" : boundedStop ? "BOUNDED_STOP" : "COMPLETED",
      intentionallyInterrupted
        ? "intentional-primary-interruption-after-persisted-candidate"
        : boundedStop
          ? "failure-drill-bounded-stop-awaiting-candidate-batch"
          : "runner-completed",
    );
  } catch (error: unknown) {
    await failInvocation(state, error);
    throw error;
  }
}

void main().catch((error: unknown) => {
  void error;
  // Errors are intentionally not serialized here because provider errors may echo request data.
  console.error("Sepolia runner stopped; inspect sanitized run-state evidence before resuming.");
  process.exitCode = 1;
});
