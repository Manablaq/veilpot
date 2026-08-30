import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

import {
  STATE_AWAITING_BATCH_PROOF,
  STATE_AWAITING_CANDIDATE_BATCH,
  STATE_BUCKET_READY,
  STATE_CANDIDATE_ACCEPTED,
  acquireLiveRunLock,
  appendToolingRevision,
  createInvocation,
  nextFailureDrillAction,
  releaseLiveRunLock,
} from "../scripts/live-run-support";

interface Measurement {
  readonly operation: string;
  readonly batchSize?: number;
  readonly participantCount?: number;
  readonly status: "MEASURED LOCALLY" | "EXCEEDS LIMIT";
  readonly evmGas?: string;
  readonly globalHCU?: number;
  readonly sequentialHCU?: number;
  readonly error?: string;
}

type Handle = `0x${string}`;
type Transaction = Promise<ethers.ContractTransactionResponse>;
type ProbeContract = ethers.Contract & {
  startDraw(handle: Handle, proof: string): Transaction;
  prepareBucketEvidence(): Transaction;
  submitBucketEvidence(
    exponent: bigint | number,
    zero: boolean,
    supported: boolean,
    proof: string,
  ): Transaction;
  generateCandidateBatch(size: number): Transaction;
  reduceSerial(): Transaction;
  reduceBalanced(): Transaction;
  prepareBatchEvidence(): Transaction;
  submitBatchEvidence(success: boolean, proof: string): Transaction;
  benchmarkPrefixSelection(
    weights: Handle[],
    weightsProof: string,
    target: Handle,
    targetProof: string,
  ): Transaction;
  state(): Promise<bigint>;
  batchId(): Promise<bigint>;
  bucketEvidenceHandles(): Promise<[Handle, Handle, Handle]>;
  totalHandle(): Promise<Handle>;
  candidateHandle(index: number): Promise<Handle>;
  reductionHandles(): Promise<[Handle, Handle, Handle, Handle]>;
  acceptedTargetHandle(): Promise<Handle>;
  prefixHandles(): Promise<[Handle, Handle]>;
  winnerPredicateHandle(index: number): Promise<Handle>;
};

const measurements: Measurement[] = [];
let assertions = 0;

async function deployProbe(): Promise<ProbeContract> {
  const factory = await hre.ethers.getContractFactory("VeilDrawProbe");
  const contract = (await factory.deploy()) as unknown as ProbeContract;
  await contract.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(contract, "VeilDrawProbe");
  return contract;
}

async function encrypt128(
  contract: ProbeContract,
  signer: HardhatEthersSigner,
  values: readonly bigint[],
): Promise<{ handles: Handle[]; proof: string }> {
  const input = hre.fhevm.createEncryptedInput(await contract.getAddress(), signer.address);
  for (const value of values) input.add128(value);
  const encrypted = await input.encrypt();
  return {
    handles: encrypted.handles.map((handle) => ethers.hexlify(handle) as Handle),
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("expected decrypted boolean");
  return value;
}

function asBigInt(value: unknown): bigint {
  if (typeof value !== "bigint") throw new TypeError("expected decrypted bigint");
  return value;
}

async function receiptOf(transaction: Promise<ethers.ContractTransactionResponse>) {
  const receipt = await (await transaction).wait();
  if (receipt === null) throw new Error("missing transaction receipt");
  return receipt;
}

function recordReceipt(
  operation: string,
  receipt: ethers.TransactionReceipt,
  dimensions: { batchSize?: number; participantCount?: number } = {},
): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);
  measurements.push({
    operation,
    ...dimensions,
    status: "MEASURED LOCALLY",
    evmGas: receipt.gasUsed.toString(),
    globalHCU: hcu.globalHCU,
    sequentialHCU: hcu.maxHCUDepth,
  });
}

async function startAndPrepareBucket(
  total: bigint,
  record = false,
): Promise<{
  contract: ProbeContract;
  owner: HardhatEthersSigner;
  other: HardhatEthersSigner;
  handles: [Handle, Handle, Handle];
  exponent: bigint;
  isZero: boolean;
  isSupported: boolean;
  proof: string;
}> {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;
  const other = signers[1]!;
  const contract = await deployProbe();
  const encrypted = await encrypt128(contract, owner, [total]);
  const startReceipt = await receiptOf(contract.startDraw(encrypted.handles[0]!, encrypted.proof));
  if (record) recordReceipt("encrypted-total-ingest", startReceipt);
  const bucketReceipt = await receiptOf(contract.prepareBucketEvidence());
  if (record) recordReceipt("bucket-computation", bucketReceipt);

  const returned = await contract.bucketEvidenceHandles();
  const result = await hre.fhevm.publicDecrypt(returned);
  const exponent = asBigInt(result.clearValues[returned[0]]!);
  const isZero = asBoolean(result.clearValues[returned[1]]!);
  const isSupported = asBoolean(result.clearValues[returned[2]]!);
  return {
    contract,
    owner,
    other,
    handles: returned,
    exponent,
    isZero,
    isSupported,
    proof: result.decryptionProof,
  };
}

async function submitPreparedBucket(prepared: Awaited<ReturnType<typeof startAndPrepareBucket>>) {
  return receiptOf(
    prepared.contract.submitBucketEvidence(
      prepared.exponent,
      prepared.isZero,
      prepared.isSupported,
      prepared.proof,
    ),
  );
}

async function debugUint128(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);
}

async function debugBool(handle: Handle): Promise<boolean> {
  return hre.fhevm.debugger.decryptEbool(handle);
}

async function expectRejected(action: () => Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await action();
  } catch {
    rejected = true;
  }
  expect(rejected).to.equal(true);
  assertions += 1;
}

describe("VeilDrawProbe Gate 0", function () {
  describe("failure-drill runner resumability and invocation attribution", function () {
    it("selects a proof-before-retry action for every resumable state and stops at the cap", function () {
      expect(nextFailureDrillAction(STATE_BUCKET_READY, 0, 6)).to.equal("GENERATE_NEXT_BATCH");
      expect(nextFailureDrillAction(STATE_AWAITING_BATCH_PROOF, 0, 6)).to.equal(
        "PROCESS_CURRENT_BATCH",
      );
      expect(nextFailureDrillAction(STATE_AWAITING_CANDIDATE_BATCH, 0, 6)).to.equal(
        "GENERATE_NEXT_BATCH",
      );
      expect(nextFailureDrillAction(STATE_AWAITING_CANDIDATE_BATCH, 6, 6)).to.equal("BOUNDED_STOP");
      expect(nextFailureDrillAction(STATE_CANDIDATE_ACCEPTED, 0, 6)).to.equal("STOP_ACCEPTED");
      assertions += 5;
    });

    it("atomically rejects a duplicate or unresolved live-run lock", async function () {
      const directory = await mkdtemp(join(tmpdir(), "veilpot-live-lock-"));
      const lockPath = join(directory, "runner.lock.json");
      const first = createInvocation(
        "failure-retry-drill",
        100,
        "tooling-commit",
        "0x1111111111111111111111111111111111111111",
      );
      const second = createInvocation(
        "failure-retry-drill",
        101,
        "tooling-commit",
        "0x1111111111111111111111111111111111111111",
      );
      try {
        await acquireLiveRunLock(lockPath, first);
        await expectRejected(() => acquireLiveRunLock(lockPath, second));
        await releaseLiveRunLock(lockPath);
        await writeFile(lockPath, '{"status":"RUNNING"}\n', "utf8");
        await expectRejected(() => acquireLiveRunLock(lockPath, second));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      assertions += 2;
    });

    it("preserves historical tooling provenance without attributing old transactions", function () {
      expect(appendToolingRevision(undefined, "historical", "corrected")).to.deep.equal([
        "historical",
        "corrected",
      ]);
      expect(
        appendToolingRevision(["historical", "corrected"], "historical", "corrected"),
      ).to.deep.equal(["historical", "corrected"]);
      assertions += 2;
    });
  });

  describe("live runner initialization ordering", function () {
    it("performs preflight and chain checks before CLI initialization and deploys only afterward", async function () {
      const runner = await readFile(resolve(process.cwd(), "scripts/run-sepolia.ts"), "utf8");
      const checker = await readFile(
        resolve(process.cwd(), "scripts/check-sepolia-initialization.ts"),
        "utf8",
      );
      const hardhatConfig = await readFile(resolve(process.cwd(), "hardhat.config.ts"), "utf8");
      const main = runner.slice(runner.indexOf("async function main(): Promise<void>"));
      const preflight = main.indexOf("const preflight = assertPreflight()");
      const chainCheck = main.indexOf("const network = await hre.ethers.provider.getNetwork()");
      const initialization = main.indexOf("await initializeLiveFhevm()");
      const deployment = main.indexOf("state.deployment = await deployProbe");
      const primaryFheWork = main.indexOf("await preparePrimary(state, primary, signer.address)");
      const initializer = runner.slice(
        runner.indexOf("async function initializeLiveFhevm"),
        runner.indexOf("function sha256"),
      );
      expect(preflight).to.be.greaterThan(-1);
      expect(chainCheck).to.be.greaterThan(preflight);
      expect(initialization).to.be.greaterThan(chainCheck);
      expect(deployment).to.be.greaterThan(initialization);
      expect(primaryFheWork).to.be.greaterThan(deployment);
      expect(initializer).to.include("await hre.fhevm.initializeCLIApi()");
      expect(initializer).to.include("hre.fhevm.isMock");
      expect(initializer).not.to.include("getRelayerMetadata");
      const checkerPreflight = checker.indexOf('stage = "credential-preflight"');
      const checkerChain = checker.indexOf('stage = "chain-verification"');
      const checkerInitialization = checker.indexOf('stage = "initialize-cli-api"');
      const checkerInput = checker.indexOf('stage = "create-encrypted-input"');
      const checkerEncrypt = checker.indexOf('stage = "encrypt"');
      const checkerNonceVerification = checker.indexOf('stage = "transaction-count-verification"');
      expect(checkerChain).to.be.greaterThan(checkerPreflight);
      expect(checkerInitialization).to.be.greaterThan(checkerChain);
      expect(checkerInput).to.be.greaterThan(checkerInitialization);
      expect(checkerEncrypt).to.be.greaterThan(checkerInput);
      expect(checkerNonceVerification).to.be.greaterThan(checkerEncrypt);
      expect(checker).to.include("const encrypted = await input.encrypt()");
      expect(checker).to.include(
        "confirmedTransactionCountAfter !== confirmedTransactionCountBefore",
      );
      expect(checker).not.to.include("getRelayerMetadata");
      const primaryExecution = runner.slice(
        runner.indexOf("async function executePrimaryM8"),
        runner.indexOf("async function runPrefixMeasurements"),
      );
      const candidateGeneration = primaryExecution.indexOf(
        "contract.generateCandidateBatch(PRIMARY_BATCH_SIZE)",
      );
      const generatedProgress = primaryExecution.indexOf('label: "candidate-batch-generated"');
      const persistAfterGeneration = primaryExecution.indexOf(
        "await persist(state)",
        generatedProgress,
      );
      const interruptionStop = primaryExecution.indexOf(
        'process.env.VEILPOT_LIVE_STOP_AFTER === "batch-generated"',
      );
      const serialReduction = primaryExecution.indexOf("contract.reduceSerial()");
      const balancedReduction = primaryExecution.indexOf("contract.reduceBalanced()");
      expect(candidateGeneration).to.be.greaterThan(-1);
      expect(generatedProgress).to.be.greaterThan(candidateGeneration);
      expect(persistAfterGeneration).to.be.greaterThan(generatedProgress);
      expect(interruptionStop).to.be.greaterThan(persistAfterGeneration);
      expect(serialReduction).to.be.greaterThan(interruptionStop);
      expect(balancedReduction).to.be.greaterThan(serialReduction);
      expect(main).not.to.include('process.env.VEILPOT_LIVE_STOP_AFTER === "batch-generated"');
      expect(hardhatConfig).to.include('metadata: { bytecodeHash: "none" }');
      expect(hardhatConfig).to.include("optimizer: { enabled: true, runs: 800 }");
      assertions += 25;
    });
  });

  this.timeout(300_000);

  after(async function () {
    const evidenceDirectory = resolve(process.cwd(), "../../evidence/gate0");
    await mkdir(evidenceDirectory, { recursive: true });
    const payload = {
      schemaVersion: 1,
      measurementEnvironment: {
        network: "Hardhat in-process mock FHEVM",
        mockCryptography: true,
        plugin: "@fhevm/hardhat-plugin@0.4.2",
        hcuSource: "plugin transaction receipt event analysis",
        nodeActuallyUsed: process.version,
      },
      currentDocumentedLimits: {
        globalHCU: 20_000_000,
        sequentialHCU: 5_000_000,
        classification: "VERIFIED FACT; not a local measurement",
      },
      measurementPolicy: {
        globalHCU: "DETERMINISTIC_FOR_IDENTICAL_MOCK_OPERATION",
        sequentialHCU: "DETERMINISTIC_FOR_IDENTICAL_MOCK_OPERATION",
        evmGas: "RUN_SPECIFIC",
        evmGasVariationCause:
          "Mock encrypted-input handles and proofs use cryptographic randomness; their calldata zero-byte pattern changes intrinsic EVM gas while FHE operation events remain fixed.",
      },
      testAssertions: assertions,
      measurements,
      publicDecryptionLatency: "NOT MEASURED LOCALLY",
      kmsRoundTripLatency: "NOT MEASURED LOCALLY",
    };
    await writeFile(
      resolve(evidenceDirectory, "hcu.json"),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  });

  describe("bucket discovery and zero handling", function () {
    for (const scenario of [
      { total: 0n, exponent: 0n, zero: true, supported: true },
      { total: 1n, exponent: 0n, zero: false, supported: true },
      { total: 2n, exponent: 1n, zero: false, supported: true },
      { total: 3n, exponent: 2n, zero: false, supported: true },
      { total: 129n, exponent: 8n, zero: false, supported: true },
      { total: 255n, exponent: 8n, zero: false, supported: true },
      { total: 256n, exponent: 8n, zero: false, supported: true },
      { total: 1n << 120n, exponent: 120n, zero: false, supported: true },
      { total: (1n << 120n) + 1n, exponent: 121n, zero: false, supported: false },
    ]) {
      it(`derives fixed evidence for T=${scenario.total.toString()}`, async function () {
        const prepared = await startAndPrepareBucket(scenario.total, scenario.total === 129n);
        expect(prepared.exponent).to.equal(scenario.exponent);
        expect(prepared.isZero).to.equal(scenario.zero);
        expect(prepared.isSupported).to.equal(scenario.supported);
        assertions += 3;
        await submitPreparedBucket(prepared);
        const state = await prepared.contract.state();
        expect(state).to.equal(scenario.zero ? 5n : scenario.supported ? 1n : 6n);
        assertions += 1;
        if (scenario.zero) {
          await expect(prepared.contract.generateCandidateBatch(1)).to.be.revertedWithCustomError(
            prepared.contract,
            "InvalidState",
          );
          assertions += 1;
        }
      });
    }

    it("rejects altered bucket evidence and empty proofs", async function () {
      const prepared = await startAndPrepareBucket(129n);
      await expect(prepared.contract.submitBucketEvidence(7, false, true, prepared.proof)).to.be
        .reverted;
      await expect(prepared.contract.submitBucketEvidence(8, false, true, "0x")).to.be.reverted;
      assertions += 2;
    });
  });

  describe("candidate generation, reductions, and measurements", function () {
    for (const size of [1, 2, 4, 8, 16]) {
      it(`measures and compares both reductions for m=${String(size)}`, async function () {
        const prepared = await startAndPrepareBucket(1n << 20n);
        await submitPreparedBucket(prepared);

        const generation = await receiptOf(prepared.contract.generateCandidateBatch(size));
        recordReceipt("candidate-generation-and-validation", generation, { batchSize: size });
        const serial = await receiptOf(prepared.contract.reduceSerial());
        recordReceipt("serial-reduction", serial, { batchSize: size });
        const balanced = await receiptOf(prepared.contract.reduceBalanced());
        recordReceipt("balanced-reduction", balanced, { batchSize: size });

        const handles = await prepared.contract.reductionHandles();
        const serialValue = await debugUint128(handles[0]);
        const serialValid = await debugBool(handles[1]);
        const balancedValue = await debugUint128(handles[2]);
        const balancedValid = await debugBool(handles[3]);
        expect(serialValid).to.equal(true);
        expect(balancedValid).to.equal(true);
        expect(balancedValue).to.equal(serialValue);
        assertions += 3;

        await receiptOf(prepared.contract.prepareBatchEvidence());
        const successResult = await hre.fhevm.publicDecrypt([handles[1]]);
        expect(asBoolean(successResult.clearValues[handles[1]]!)).to.equal(true);
        assertions += 1;
        await receiptOf(prepared.contract.submitBatchEvidence(true, successResult.decryptionProof));
        expect(await prepared.contract.state()).to.equal(4n);
        expect(await debugUint128(await prepared.contract.acceptedTargetHandle())).to.equal(
          serialValue,
        );
        assertions += 2;

        await expect(prepared.contract.generateCandidateBatch(size)).to.be.revertedWithCustomError(
          prepared.contract,
          "InvalidState",
        );
        await expect(prepared.contract.submitBatchEvidence(true, successResult.decryptionProof)).to
          .be.reverted;
        assertions += 2;
      });
    }

    it("selects the earliest of multiple valid candidates", async function () {
      const prepared = await startAndPrepareBucket(1n << 20n);
      await submitPreparedBucket(prepared);
      await receiptOf(prepared.contract.generateCandidateBatch(16));
      const candidates: bigint[] = [];
      for (let index = 0; index < 16; index += 1) {
        candidates.push(await debugUint128(await prepared.contract.candidateHandle(index)));
      }
      await receiptOf(prepared.contract.reduceSerial());
      await receiptOf(prepared.contract.reduceBalanced());
      const reductions = await prepared.contract.reductionHandles();
      expect(await debugUint128(reductions[0])).to.equal(candidates[0]);
      expect(await debugUint128(reductions[2])).to.equal(candidates[0]);
      assertions += 2;
    });

    it("allows a fresh batch only after a cryptographically proven failure", async function () {
      let failed:
        | {
            prepared: Awaited<ReturnType<typeof startAndPrepareBucket>>;
            validHandle: Handle;
            failureProof: string;
          }
        | undefined;

      for (let attempt = 0; attempt < 24 && failed === undefined; attempt += 1) {
        const prepared = await startAndPrepareBucket(129n);
        await submitPreparedBucket(prepared);
        await receiptOf(prepared.contract.generateCandidateBatch(1));
        await receiptOf(prepared.contract.reduceSerial());
        await receiptOf(prepared.contract.reduceBalanced());
        await receiptOf(prepared.contract.prepareBatchEvidence());
        const reductions = await prepared.contract.reductionHandles();
        const result = await hre.fhevm.publicDecrypt([reductions[1]]);
        if (!asBoolean(result.clearValues[reductions[1]]!)) {
          failed = { prepared, validHandle: reductions[1], failureProof: result.decryptionProof };
        }
      }
      if (failed === undefined) throw new Error("mock PRNG did not produce a failed m=1 batch");

      const failedCandidate = await debugUint128(await failed.prepared.contract.candidateHandle(0));
      expect(failedCandidate >= 129n).to.equal(true);
      expect(await failed.prepared.contract.batchId()).to.equal(1n);
      await expect(
        failed.prepared.contract.generateCandidateBatch(1),
      ).to.be.revertedWithCustomError(failed.prepared.contract, "InvalidState");
      await expect(failed.prepared.contract.submitBatchEvidence(true, failed.failureProof)).to.be
        .reverted;
      await receiptOf(failed.prepared.contract.submitBatchEvidence(false, failed.failureProof));
      expect(await failed.prepared.contract.state()).to.equal(2n);
      assertions += 5;

      await receiptOf(failed.prepared.contract.generateCandidateBatch(1));
      expect(await failed.prepared.contract.batchId()).to.equal(2n);
      await receiptOf(failed.prepared.contract.reduceSerial());
      await receiptOf(failed.prepared.contract.reduceBalanced());
      await receiptOf(failed.prepared.contract.prepareBatchEvidence());
      await expect(failed.prepared.contract.submitBatchEvidence(false, failed.failureProof)).to.be
        .reverted;
      assertions += 2;

      const nextReductions = await failed.prepared.contract.reductionHandles();
      const nextResult = await hre.fhevm.publicDecrypt([nextReductions[1]]);
      const nextSuccess = asBoolean(nextResult.clearValues[nextReductions[1]]!);
      await receiptOf(
        failed.prepared.contract.submitBatchEvidence(nextSuccess, nextResult.decryptionProof),
      );
      expect(await failed.prepared.contract.state()).to.equal(nextSuccess ? 4n : 2n);
      assertions += 1;
    });
  });

  describe("ACL and proof/state adversarial behavior", function () {
    it("keeps total, candidates, reductions, and accepted target non-public", async function () {
      const prepared = await startAndPrepareBucket(256n);
      const totalHandle = await prepared.contract.totalHandle();
      await expectRejected(() => hre.fhevm.publicDecrypt([totalHandle]));
      await expectRejected(() =>
        hre.fhevm.userDecryptEuint(
          FhevmType.euint128,
          totalHandle,
          prepared.contract.getAddress(),
          prepared.owner,
        ),
      );
      await submitPreparedBucket(prepared);
      await receiptOf(prepared.contract.generateCandidateBatch(2));
      const candidate = await prepared.contract.candidateHandle(0);
      await expectRejected(() => hre.fhevm.publicDecrypt([candidate]));
      await expectRejected(() =>
        hre.fhevm.userDecryptEuint(
          FhevmType.euint128,
          candidate,
          prepared.contract.getAddress(),
          prepared.other,
        ),
      );
      await receiptOf(prepared.contract.reduceSerial());
      await receiptOf(prepared.contract.reduceBalanced());
      const reductions = await prepared.contract.reductionHandles();
      await expectRejected(() => hre.fhevm.publicDecrypt([reductions[0]]));
      await expectRejected(() => hre.fhevm.publicDecrypt([reductions[2]]));
      await receiptOf(prepared.contract.prepareBatchEvidence());
      const success = await hre.fhevm.publicDecrypt([reductions[1]]);
      await receiptOf(
        prepared.contract.submitBatchEvidence(
          asBoolean(success.clearValues[reductions[1]]!),
          success.decryptionProof,
        ),
      );
      const target = await prepared.contract.acceptedTargetHandle();
      await expectRejected(() => hre.fhevm.publicDecrypt([target]));
    });

    it("rejects wrong-draw, wrong-handle, and fake proofs", async function () {
      const first = await startAndPrepareBucket(129n);
      const second = await startAndPrepareBucket(129n);
      await expect(
        first.contract.submitBucketEvidence(
          second.exponent,
          second.isZero,
          second.isSupported,
          second.proof,
        ),
      ).to.be.reverted;
      await expect(
        first.contract.submitBucketEvidence(
          first.exponent,
          first.isZero,
          first.isSupported,
          "0x1234",
        ),
      ).to.be.reverted;
      assertions += 2;
    });

    it("has no caller-controlled seed, bound, candidate, or threshold oracle", async function () {
      const contract = await deployProbe();
      const names = contract.interface.fragments
        .filter((fragment) => fragment.type === "function")
        .map((fragment) => ("name" in fragment ? fragment.name : ""));
      expect(names).not.to.include("isTotalAbove");
      expect(names).not.to.include("setSeed");
      expect(names).not.to.include("supplyCandidate");
      const generate = contract.interface.getFunction("generateCandidateBatch");
      expect(generate?.inputs.map((input) => input.type)).to.deep.equal(["uint8"]);
      assertions += 4;
    });
  });

  describe("prefix winner-selection microbenchmark", function () {
    const vectors = [
      [1n],
      [1n, 1n],
      [1n, 2n],
      [1n, 2n, 7n],
      [0n, 5n, 0n],
      [97n, 3n],
      [1n, 1n, 1n, 1n, 1n, 1n],
      [(1n << 80n) - 1n, 1n << 79n, 17n],
    ];

    it("selects exactly one positive interval at all boundaries", async function () {
      const owner = (await hre.ethers.getSigners())[0]!;
      const contract = await deployProbe();
      for (const weights of vectors) {
        const total = weights.reduce((sum, value) => sum + value, 0n);
        const targets = new Set<bigint>([0n, total - 1n]);
        let prefix = 0n;
        for (const weight of weights) {
          if (weight > 0n) {
            targets.add(prefix);
            targets.add(prefix + weight - 1n);
          }
          prefix += weight;
        }
        for (const target of targets) {
          const encryptedWeights = await encrypt128(contract, owner, weights);
          const encryptedTarget = await encrypt128(contract, owner, [target]);
          await receiptOf(
            contract.benchmarkPrefixSelection(
              encryptedWeights.handles,
              encryptedWeights.proof,
              encryptedTarget.handles[0]!,
              encryptedTarget.proof,
            ),
          );
          const [prefixHandle, countHandle] = await contract.prefixHandles();
          expect(await debugUint128(prefixHandle)).to.equal(total);
          expect(await debugUint128(countHandle)).to.equal(1n);
          for (let index = 0; index < weights.length; index++) {
            const predicate = await debugBool(await contract.winnerPredicateHandle(index));
            if (predicate) expect(weights[index]! > 0n).to.equal(true);
          }
          assertions += 2 + weights.length;
        }
      }
    });

    for (const count of [1, 2, 4, 8, 16]) {
      it(`measures prefix selection for n=${String(count)}`, async function () {
        const owner = (await hre.ethers.getSigners())[0]!;
        const contract = await deployProbe();
        const weights = Array<bigint>(count).fill(1n);
        const encryptedWeights = await encrypt128(contract, owner, weights);
        const encryptedTarget = await encrypt128(contract, owner, [BigInt(count - 1)]);
        const receipt = await receiptOf(
          contract.benchmarkPrefixSelection(
            encryptedWeights.handles,
            encryptedWeights.proof,
            encryptedTarget.handles[0]!,
            encryptedTarget.proof,
          ),
        );
        recordReceipt("prefix-selection", receipt, { participantCount: count });
        const [prefixHandle, countHandle] = await contract.prefixHandles();
        expect(await debugUint128(prefixHandle)).to.equal(BigInt(count));
        expect(await debugUint128(countHandle)).to.equal(1n);
        assertions += 2;
      });
    }
  });
});
