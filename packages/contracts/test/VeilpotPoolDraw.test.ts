// Gate 1B.3 production VeilDraw integration tests. Local FHEVM only.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Tx = Promise<ethers.ContractTransactionResponse>;
type Signer = Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

interface Token extends ethers.BaseContract {
  mintClear(to: string, amount: bigint): Tx;
  setOperator(operator: string, until: bigint): Tx;
}

interface Pool extends ethers.BaseContract {
  reserveParticipantSlot(overrides: { value: bigint }): Tx;
  participantMetadata(slot: number): Promise<readonly unknown[]>;
  deposit(
    amount: Handle,
    proof: string,
    depositor: string,
    pool: string,
    version: bigint,
    reservationNonce: bigint,
    depositNonce: bigint,
  ): Tx;
  settleThreshold(
    slot: number,
    version: bigint,
    reservationNonce: bigint,
    result: boolean,
    proof: string,
  ): Tx;
  thresholdHandle(slot: number): Promise<Handle>;
  withdraw(
    amount: Handle,
    proof: string,
    version: bigint,
    reservationNonce: bigint,
    withdrawalNonce: bigint,
  ): Tx;
  prepareDeregistration(slot: number): Tx;
  deregistrationZeroHandle(slot: number): Promise<Handle>;
  settleDeregistration(slot: number, clearZero: boolean, proof: string): Tx;
  slotReusableAfter(slot: number): Promise<bigint>;
  activeEpochEnd(): Promise<bigint>;
  startSnapshot(): Tx;
  processSnapshotChunk(): Tx;
  finalizeSnapshot(): Tx;
  nextSnapshotId(): Promise<bigint>;
  snapshotParticipantCount(): Promise<bigint>;
  snapshotCursor(): Promise<bigint>;
  snapshotTotalHandle(snapshotId: bigint): Promise<Handle>;
  snapshotWeightHandle(snapshotId: bigint, slot: number): Promise<Handle>;
  snapshotBeneficiary(
    snapshotId: bigint,
    slot: number,
  ): Promise<readonly [string, bigint, bigint, boolean]>;
  startDraw(): Tx;
  nextDrawId(): Promise<bigint>;
  nextDrawSnapshotId(): Promise<bigint>;
  snapshotDrawId(snapshotId: bigint): Promise<bigint>;
  drawMetadata(
    drawId: bigint,
  ): Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint]>;
  drawTotalHandle(drawId: bigint): Promise<Handle>;
  prepareDrawBucketEvidence(drawId: bigint, snapshotId: bigint): Tx;
  drawBucketEvidenceHandles(drawId: bigint): Promise<readonly [Handle, Handle, Handle, Handle]>;
  submitDrawBucketEvidence(
    drawId: bigint,
    snapshotId: bigint,
    exponent: bigint,
    zero: boolean,
    supported: boolean,
    proof: string,
  ): Tx;
  generateDrawCandidateBatch(drawId: bigint, snapshotId: bigint): Tx;
  reduceDrawCandidateBatch(drawId: bigint, snapshotId: bigint, batchId: bigint): Tx;
  drawCandidateHandle(drawId: bigint, index: number): Promise<Handle>;
  drawBatchHandles(drawId: bigint): Promise<readonly [Handle, Handle, Handle]>;
  submitDrawBatchEvidence(
    drawId: bigint,
    snapshotId: bigint,
    batchId: bigint,
    success: boolean,
    proof: string,
  ): Tx;
  drawAcceptedTargetHandle(drawId: bigint): Promise<Handle>;
  startWinnerResolution(drawId: bigint, snapshotId: bigint): Tx;
  processDrawWinnerChunk(drawId: bigint, snapshotId: bigint): Tx;
  finalizeDraw(drawId: bigint, snapshotId: bigint): Tx;
  drawResolutionHandles(drawId: bigint): Promise<readonly [Handle, Handle]>;
  drawWinnerRecord(
    drawId: bigint,
    slot: number,
  ): Promise<readonly [Handle, string, bigint, bigint, boolean, boolean]>;
  DRAW_BATCH_SIZE(): Promise<bigint>;
  WINNER_CHUNK_SIZE(): Promise<bigint>;
  MAX_DRAW_BUCKET_EXPONENT(): Promise<bigint>;
  MAX_DRAW_TOTAL(): Promise<bigint>;
  MAX_PARTICIPANTS(): Promise<bigint>;
  MAX_USER_PRINCIPAL_BASE_UNITS(): Promise<bigint>;
  MAX_DRAW_DURATION_SECONDS(): Promise<bigint>;
}

const BOND = 1_000_000_000_000_000n;
const REVIEWED_GLOBAL_HCU_LIMIT = 20_000_000;
const REVIEWED_SEQUENTIAL_HCU_LIMIT = 5_000_000;
const DRAW_STATE = {
  NO_DRAW: 0n,
  BUCKET_DISCOVERY: 1n,
  BUCKET_READY: 2n,
  AWAITING_CANDIDATE_BATCH: 3n,
  BATCH_REDUCTION_PENDING: 4n,
  BATCH_PROOF_PENDING: 5n,
  CANDIDATE_ACCEPTED: 6n,
  WINNER_RESOLUTION: 7n,
  FINALIZED: 8n,
  NO_WEIGHT_TERMINAL: 9n,
  UNSUPPORTED_TOTAL: 10n,
} as const;

async function waitFor(tx: Tx): Promise<ethers.TransactionReceipt> {
  const receipt = await (await tx).wait();
  if (receipt === null) throw new Error("missing receipt");
  return receipt;
}

function reportLocalCost(operation: string, receipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);
  const globalHcu = hcu.globalHCU;
  const sequentialHcu = hcu.maxHCUDepth;
  console.log(
    JSON.stringify({
      scope: "GATE_1B.3_PRODUCTION_LOCAL_ONLY",
      operation,
      localGlobalHCU: hcu.globalHCU,
      localSequentialHCU: hcu.maxHCUDepth,
      localEvmGasRunSpecific: receipt.gasUsed.toString(),
    }),
  );
  if (globalHcu > REVIEWED_GLOBAL_HCU_LIMIT || sequentialHcu > REVIEWED_SEQUENTIAL_HCU_LIMIT) {
    throw new Error(
      `GATE_1B.3_HCU_LIMIT_BLOCKER ${operation}: global=${globalHcu.toString()}, sequential=${sequentialHcu.toString()}`,
    );
  }
}

async function encryptedInput(address: string, signer: Signer, amount: bigint) {
  const input = hre.fhevm.createEncryptedInput(address, signer.address);
  input.add64(amount);
  const encrypted = await input.encrypt();
  return {
    handle: ethers.hexlify(encrypted.handles[0]!) as Handle,
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

function asBigInt(value: unknown): bigint {
  if (typeof value !== "bigint") throw new TypeError("expected bigint");
  return value;
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("expected boolean");
  return value;
}

async function publicBool(handle: Handle): Promise<{ value: boolean; proof: string }> {
  const result = await hre.fhevm.publicDecrypt([handle]);
  return {
    value: asBoolean(result.clearValues[handle]),
    proof: result.decryptionProof,
  };
}

async function decrypt128(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);
}

async function decryptBool(handle: Handle): Promise<boolean> {
  return hre.fhevm.debugger.decryptEbool(handle);
}

async function expectRejected(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error("expected operation to reject");
}

async function setTimestamp(timestamp: bigint): Promise<void> {
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await hre.network.provider.send("evm_mine");
}

function ceilLog2(value: bigint): bigint {
  if (value <= 0n) return 0n;
  let exponent = 0n;
  let bound = 1n;
  while (bound < value) {
    bound <<= 1n;
    exponent += 1n;
  }
  return exponent;
}

async function expectedProofContext(
  pool: Pool,
  stage: number,
  drawId: bigint,
  snapshotId: bigint,
  batchId: bigint,
): Promise<bigint> {
  const network = await hre.ethers.provider.getNetwork();
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "uint256", "address", "uint8", "uint256", "uint256", "uint256"],
    [
      ethers.encodeBytes32String("VEILPOT_DRAW_PROOF_V1"),
      network.chainId,
      await pool.getAddress(),
      stage,
      drawId,
      snapshotId,
      batchId,
    ],
  );
  return BigInt(ethers.keccak256(encoded));
}

async function fixture() {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;
  const other = signers[1]!;
  const token = (await (
    await hre.ethers.getContractFactory("TestERC7984")
  ).deploy()) as unknown as Token;
  await token.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(token, "TestERC7984");
  const pool = (await (
    await hre.ethers.getContractFactory("VeilpotPool")
  ).deploy(await token.getAddress())) as unknown as Pool;
  await pool.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPool");
  return { signers, owner, other, token, pool };
}

async function activate(pool: Pool, token: Token, signer: Signer, amount: bigint, slot: number) {
  const userPool = pool.connect(signer) as unknown as Pool;
  const userToken = token.connect(signer) as unknown as Token;
  await waitFor(userPool.reserveParticipantSlot({ value: BOND }));
  const metadata = await pool.participantMetadata(slot);
  const reservationNonce = BigInt(String(metadata[3]));
  await waitFor(userToken.mintClear(signer.address, amount));
  const latest = await hre.ethers.provider.getBlock("latest");
  await waitFor(
    userToken.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 86_400)),
  );
  const input = await encryptedInput(await pool.getAddress(), signer, amount);
  await waitFor(
    userPool.deposit(
      input.handle,
      input.proof,
      signer.address,
      await pool.getAddress(),
      1n,
      reservationNonce,
      0n,
    ),
  );
  const threshold = await publicBool(await pool.thresholdHandle(slot));
  expect(threshold.value).to.equal(true);
  await waitFor(userPool.settleThreshold(slot, 1n, reservationNonce, true, threshold.proof));
  return reservationNonce;
}

async function finalizeSnapshot(pool: Pool): Promise<bigint> {
  const cutoff = await pool.activeEpochEnd();
  await setTimestamp(cutoff - 1n);
  await waitFor(pool.startSnapshot());
  const snapshotId = await pool.nextSnapshotId();
  const count = await pool.snapshotParticipantCount();
  while ((await pool.snapshotCursor()) < count) {
    await waitFor(pool.processSnapshotChunk());
  }
  await waitFor(pool.finalizeSnapshot());
  return snapshotId;
}

async function decryptBucket(pool: Pool, drawId: bigint) {
  const handles = await pool.drawBucketEvidenceHandles(drawId);
  const result = await hre.fhevm.publicDecrypt([...handles]);
  return {
    exponent: asBigInt(result.clearValues[handles[0]]),
    zero: asBoolean(result.clearValues[handles[1]]),
    supported: asBoolean(result.clearValues[handles[2]]),
    context: asBigInt(result.clearValues[handles[3]]),
    proof: result.decryptionProof,
  };
}

async function preparePositiveDraw(pool: Pool, measureBucket = false) {
  await waitFor(pool.startDraw());
  const drawId = await pool.nextDrawId();
  const metadata = await pool.drawMetadata(drawId);
  const snapshotId = metadata[1];
  const bucketReceipt = await waitFor(pool.prepareDrawBucketEvidence(drawId, snapshotId));
  if (measureBucket) reportLocalCost("drawBucketComputation", bucketReceipt);
  const bucket = await decryptBucket(pool, drawId);
  expect(bucket.zero).to.equal(false);
  expect(bucket.supported).to.equal(true);
  await waitFor(
    pool.submitDrawBucketEvidence(
      drawId,
      snapshotId,
      bucket.exponent,
      bucket.zero,
      bucket.supported,
      bucket.proof,
    ),
  );
  expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.BUCKET_READY);
  return { drawId, snapshotId, bucket };
}

async function acceptCandidate(pool: Pool, drawId: bigint, snapshotId: bigint, measure = false) {
  const total = await decrypt128(await pool.drawTotalHandle(drawId));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const generation = await waitFor(pool.generateDrawCandidateBatch(drawId, snapshotId));
    if (measure && attempt === 0) reportLocalCost("candidateBatchM8", generation);
    const metadata = await pool.drawMetadata(drawId);
    const batchId = metadata[4];
    expect(metadata[0]).to.equal(DRAW_STATE.BATCH_REDUCTION_PENDING);

    const candidates: bigint[] = [];
    for (let index = 0; index < 8; index += 1) {
      candidates.push(await decrypt128(await pool.drawCandidateHandle(drawId, index)));
    }
    await expect(pool.generateDrawCandidateBatch(drawId, snapshotId)).to.be.reverted;

    const reduction = await waitFor(pool.reduceDrawCandidateBatch(drawId, snapshotId, batchId));
    if (measure && attempt === 0) reportLocalCost("candidateBalancedReductionM8", reduction);
    const batchHandles = await pool.drawBatchHandles(drawId);
    const batchResult = await hre.fhevm.publicDecrypt([batchHandles[1], batchHandles[2]]);
    const success = asBoolean(batchResult.clearValues[batchHandles[1]]);
    asBigInt(batchResult.clearValues[batchHandles[2]]);
    const expected = candidates.find((candidate) => candidate < total);
    expect(success).to.equal(expected !== undefined);
    expect(await decrypt128(batchHandles[0])).to.equal(expected ?? 0n);
    await expectRejected(() => hre.fhevm.publicDecrypt([batchHandles[0]]));
    await expect(pool.generateDrawCandidateBatch(drawId, snapshotId)).to.be.reverted;
    await expect(
      pool.submitDrawBatchEvidence(
        drawId,
        snapshotId,
        batchId,
        !success,
        batchResult.decryptionProof,
      ),
    ).to.be.reverted;

    await waitFor(
      pool.submitDrawBatchEvidence(
        drawId,
        snapshotId,
        batchId,
        success,
        batchResult.decryptionProof,
      ),
    );
    if (success) {
      const accepted = await pool.drawAcceptedTargetHandle(drawId);
      expect(await decrypt128(accepted)).to.equal(expected);
      expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.CANDIDATE_ACCEPTED);
      await expect(pool.generateDrawCandidateBatch(drawId, snapshotId)).to.be.reverted;
      await expect(
        pool.submitDrawBatchEvidence(
          drawId,
          snapshotId,
          batchId,
          true,
          batchResult.decryptionProof,
        ),
      ).to.be.reverted;
      return accepted;
    }

    expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.AWAITING_CANDIDATE_BATCH);
  }
  throw new Error("m=8 did not produce a successful batch within 32 proof-gated attempts");
}

describe("VeilpotPool Gate 1B.3 production VeilDraw", function () {
  this.timeout(180_000);

  it("consumes finalized snapshots monotonically and derives the exact protected bucket", async function () {
    const { owner, other, token, pool } = await fixture();
    await expect(pool.startDraw()).to.be.revertedWithCustomError(pool, "SnapshotNotReadyForDraw");
    await activate(pool, token, owner, 2_000_000n, 0);
    const snapshotId = await finalizeSnapshot(pool);
    expect(snapshotId).to.equal(1n);

    const snapshotTotal = await pool.snapshotTotalHandle(snapshotId);
    const total = await decrypt128(snapshotTotal);
    expect(total > 0n).to.equal(true);

    await waitFor(pool.startDraw());
    expect(await pool.nextDrawId()).to.equal(1n);
    expect(await pool.snapshotDrawId(1n)).to.equal(1n);
    expect(await pool.nextDrawSnapshotId()).to.equal(2n);
    await expect(pool.startDraw()).to.be.revertedWithCustomError(pool, "SnapshotNotReadyForDraw");

    const metadata = await pool.drawMetadata(1n);
    expect(metadata[0]).to.equal(DRAW_STATE.BUCKET_DISCOVERY);
    expect(metadata[1]).to.equal(1n);
    expect(metadata[3]).to.equal(1n);
    expect(await pool.drawTotalHandle(1n)).to.equal(snapshotTotal);
    await expectRejected(() => hre.fhevm.publicDecrypt([snapshotTotal]));
    await expectRejected(async () =>
      hre.fhevm.userDecryptEuint(FhevmType.euint128, snapshotTotal, await pool.getAddress(), other),
    );

    reportLocalCost("drawBucketComputation", await waitFor(pool.prepareDrawBucketEvidence(1n, 1n)));
    await expect(pool.prepareDrawBucketEvidence(1n, 1n)).to.be.revertedWithCustomError(
      pool,
      "DrawEvidenceAlreadyPrepared",
    );
    const bucket = await decryptBucket(pool, 1n);
    expect(bucket.exponent).to.equal(ceilLog2(total));
    expect(bucket.context).to.equal(await expectedProofContext(pool, 1, 1n, 1n, 0n));
    expect(bucket.zero).to.equal(false);
    expect(bucket.supported).to.equal(true);
    expect(bucket.exponent <= 69n).to.equal(true);
    await expect(
      pool.submitDrawBucketEvidence(1n, 1n, bucket.exponent + 1n, false, true, bucket.proof),
    ).to.be.reverted;
    await expect(
      pool.submitDrawBucketEvidence(1n, 2n, bucket.exponent, false, true, bucket.proof),
    ).to.be.revertedWithCustomError(pool, "DrawSnapshotMismatch");
    await waitFor(
      pool.submitDrawBucketEvidence(1n, 1n, bucket.exponent, false, true, bucket.proof),
    );
    expect((await pool.drawMetadata(1n))[0]).to.equal(DRAW_STATE.BUCKET_READY);
    expect((await pool.drawMetadata(1n))[5]).to.equal(bucket.exponent);
    await expect(pool.submitDrawBucketEvidence(1n, 1n, bucket.exponent, false, true, bucket.proof))
      .to.be.reverted;
  });

  it("terminates a proven zero-total snapshot before any RNG call", async function () {
    const { pool } = await fixture();
    const snapshotId = await finalizeSnapshot(pool);
    expect(snapshotId).to.equal(1n);
    expect(await decrypt128(await pool.snapshotTotalHandle(1n))).to.equal(0n);
    await waitFor(pool.startDraw());
    await waitFor(pool.prepareDrawBucketEvidence(1n, 1n));
    const bucket = await decryptBucket(pool, 1n);
    expect(bucket.exponent).to.equal(0n);
    expect(bucket.zero).to.equal(true);
    expect(bucket.supported).to.equal(true);
    await waitFor(pool.submitDrawBucketEvidence(1n, 1n, 0n, true, true, bucket.proof));
    expect((await pool.drawMetadata(1n))[0]).to.equal(DRAW_STATE.NO_WEIGHT_TERMINAL);
    expect((await pool.drawMetadata(1n))[4]).to.equal(0n);
    await expect(pool.generateDrawCandidateBatch(1n, 1n)).to.be.reverted;
    await expect(pool.startWinnerResolution(1n, 1n)).to.be.reverted;
    await expect(pool.finalizeDraw(1n, 1n)).to.be.reverted;
  });

  it("uses only fixed m=8 FHE randomness and enforces proof-before-retry and success irreversibility", async function () {
    const { owner, other, token, pool } = await fixture();
    await activate(pool, token, owner, 2_000_000n, 0);
    await finalizeSnapshot(pool);
    const { drawId, snapshotId } = await preparePositiveDraw(pool);

    expect(await pool.DRAW_BATCH_SIZE()).to.equal(8n);
    expect(await pool.WINNER_CHUNK_SIZE()).to.equal(8n);
    expect(await pool.MAX_DRAW_BUCKET_EXPONENT()).to.equal(69n);
    expect(await pool.MAX_DRAW_TOTAL()).to.equal(1n << 69n);

    const start = pool.interface.getFunction("startDraw");
    const generate = pool.interface.getFunction("generateDrawCandidateBatch");
    expect(start?.inputs).to.have.length(0);
    expect(generate?.inputs.map((input) => input.type)).to.deep.equal(["uint256", "uint256"]);

    await waitFor(pool.generateDrawCandidateBatch(drawId, snapshotId));
    expect((await pool.drawMetadata(drawId))[4]).to.equal(1n);
    for (let index = 0; index < 8; index += 1) {
      const candidate = await pool.drawCandidateHandle(drawId, index);
      await expectRejected(() => hre.fhevm.publicDecrypt([candidate]));
      await expectRejected(async () =>
        hre.fhevm.userDecryptEuint(FhevmType.euint128, candidate, await pool.getAddress(), other),
      );
    }
    await expect(pool.generateDrawCandidateBatch(drawId, snapshotId)).to.be.reverted;
    await expect(
      pool.reduceDrawCandidateBatch(drawId, snapshotId, 2n),
    ).to.be.revertedWithCustomError(pool, "DrawBatchMismatch");

    const reduction = await waitFor(pool.reduceDrawCandidateBatch(drawId, snapshotId, 1n));
    reportLocalCost("candidateBalancedReductionM8", reduction);
    const batch = await pool.drawBatchHandles(drawId);
    await expectRejected(() => hre.fhevm.publicDecrypt([batch[0]]));
    const proof = await hre.fhevm.publicDecrypt([batch[1], batch[2]]);
    const success = asBoolean(proof.clearValues[batch[1]]);
    expect(asBigInt(proof.clearValues[batch[2]])).to.equal(
      await expectedProofContext(pool, 2, drawId, snapshotId, 1n),
    );
    await expect(
      pool.submitDrawBatchEvidence(drawId, snapshotId, 1n, !success, proof.decryptionProof),
    ).to.be.reverted;
    await waitFor(
      pool.submitDrawBatchEvidence(drawId, snapshotId, 1n, success, proof.decryptionProof),
    );

    if (!success) {
      expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.AWAITING_CANDIDATE_BATCH);
      await acceptCandidate(pool, drawId, snapshotId, true);
    } else {
      expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.CANDIDATE_ACCEPTED);
    }

    const accepted = await pool.drawAcceptedTargetHandle(drawId);
    const target = await decrypt128(accepted);
    const total = await decrypt128(await pool.drawTotalHandle(drawId));
    expect(target < total).to.equal(true);
    await expectRejected(() => hre.fhevm.publicDecrypt([accepted]));
    await expectRejected(async () =>
      hre.fhevm.userDecryptEuint(FhevmType.euint128, accepted, await pool.getAddress(), owner),
    );
    await expect(pool.generateDrawCandidateBatch(drawId, snapshotId)).to.be.reverted;
  });

  it("rejects cross-draw bucket proofs even when both draws use the same pool", async function () {
    const { owner, token, pool } = await fixture();
    await activate(pool, token, owner, 2_000_000n, 0);
    await finalizeSnapshot(pool);
    await finalizeSnapshot(pool);

    await waitFor(pool.startDraw());
    await waitFor(pool.startDraw());
    await waitFor(pool.prepareDrawBucketEvidence(1n, 1n));
    await waitFor(pool.prepareDrawBucketEvidence(2n, 2n));
    const first = await decryptBucket(pool, 1n);
    const second = await decryptBucket(pool, 2n);
    expect(first.context).to.not.equal(second.context);

    await expect(
      pool.submitDrawBucketEvidence(
        1n,
        1n,
        second.exponent,
        second.zero,
        second.supported,
        second.proof,
      ),
    ).to.be.reverted;
    expect((await pool.drawMetadata(1n))[0]).to.equal(DRAW_STATE.BUCKET_DISCOVERY);

    await waitFor(
      pool.submitDrawBucketEvidence(
        1n,
        1n,
        first.exponent,
        first.zero,
        first.supported,
        first.proof,
      ),
    );
    await waitFor(
      pool.submitDrawBucketEvidence(
        2n,
        2n,
        second.exponent,
        second.zero,
        second.supported,
        second.proof,
      ),
    );
    expect((await pool.drawMetadata(1n))[0]).to.equal(DRAW_STATE.BUCKET_READY);
    expect((await pool.drawMetadata(2n))[0]).to.equal(DRAW_STATE.BUCKET_READY);

    // Batch evidence is also application-bound: the same pool and same batch ID
    // cannot relabel a proof from another draw.
    await waitFor(pool.generateDrawCandidateBatch(1n, 1n));
    await waitFor(pool.generateDrawCandidateBatch(2n, 2n));
    await waitFor(pool.reduceDrawCandidateBatch(1n, 1n, 1n));
    await waitFor(pool.reduceDrawCandidateBatch(2n, 2n, 1n));
    const firstBatch = await pool.drawBatchHandles(1n);
    const secondBatch = await pool.drawBatchHandles(2n);
    const firstBatchProof = await hre.fhevm.publicDecrypt([firstBatch[1], firstBatch[2]]);
    const secondBatchProof = await hre.fhevm.publicDecrypt([secondBatch[1], secondBatch[2]]);
    const firstBatchSuccess = asBoolean(firstBatchProof.clearValues[firstBatch[1]]);
    const secondBatchSuccess = asBoolean(secondBatchProof.clearValues[secondBatch[1]]);
    expect(asBigInt(firstBatchProof.clearValues[firstBatch[2]])).to.not.equal(
      asBigInt(secondBatchProof.clearValues[secondBatch[2]]),
    );
    await expect(
      pool.submitDrawBatchEvidence(2n, 2n, 1n, firstBatchSuccess, firstBatchProof.decryptionProof),
    ).to.be.reverted;
    expect((await pool.drawMetadata(2n))[0]).to.equal(DRAW_STATE.BATCH_PROOF_PENDING);
    await waitFor(
      pool.submitDrawBatchEvidence(
        2n,
        2n,
        1n,
        secondBatchSuccess,
        secondBatchProof.decryptionProof,
      ),
    );
  });

  it("domain-separates bucket evidence across pool contracts", async function () {
    const firstFixture = await fixture();
    await finalizeSnapshot(firstFixture.pool);
    await waitFor(firstFixture.pool.startDraw());
    await waitFor(firstFixture.pool.prepareDrawBucketEvidence(1n, 1n));
    const first = await decryptBucket(firstFixture.pool, 1n);

    // Deploy the second pool only after the first proof exists so its epoch clock
    // starts from the current chain timestamp and never requires time travel backward.
    const secondFixture = await fixture();
    await finalizeSnapshot(secondFixture.pool);
    await waitFor(secondFixture.pool.startDraw());
    await waitFor(secondFixture.pool.prepareDrawBucketEvidence(1n, 1n));
    const second = await decryptBucket(secondFixture.pool, 1n);
    expect(first.context).to.not.equal(second.context);
    await expect(
      secondFixture.pool.submitDrawBucketEvidence(
        1n,
        1n,
        first.exponent,
        first.zero,
        first.supported,
        first.proof,
      ),
    ).to.be.reverted;
    await waitFor(
      secondFixture.pool.submitDrawBucketEvidence(
        1n,
        1n,
        second.exponent,
        second.zero,
        second.supported,
        second.proof,
      ),
    );
    expect((await secondFixture.pool.drawMetadata(1n))[0]).to.equal(DRAW_STATE.NO_WEIGHT_TERMINAL);
  });

  it("resolves a one-slot winner to the frozen historical beneficiary after live slot reuse", async function () {
    const { owner, other, token, pool } = await fixture();
    const reservationNonce = await activate(pool, token, owner, 2_000_000n, 0);
    await finalizeSnapshot(pool);
    const historical = await pool.snapshotBeneficiary(1n, 0);
    expect(historical[0]).to.equal(owner.address);
    expect(historical[2]).to.equal(reservationNonce);

    const withdrawal = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(pool.withdraw(withdrawal.handle, withdrawal.proof, 1n, reservationNonce, 0n));
    await waitFor(pool.prepareDeregistration(0));
    const zero = await publicBool(await pool.deregistrationZeroHandle(0));
    expect(zero.value).to.equal(true);
    await waitFor(pool.settleDeregistration(0, true, zero.proof));

    const reusableAfter = await pool.slotReusableAfter(0);
    const latest = await hre.ethers.provider.getBlock("latest");
    const latestTimestamp = BigInt(latest?.timestamp ?? 0);
    if (latestTimestamp <= reusableAfter) await setTimestamp(reusableAfter + 1n);
    await waitFor((pool.connect(other) as unknown as Pool).reserveParticipantSlot({ value: BOND }));
    const current = await pool.participantMetadata(0);
    expect(current[1]).to.equal(other.address);

    const { drawId, snapshotId } = await preparePositiveDraw(pool);
    await acceptCandidate(pool, drawId, snapshotId, true);
    await waitFor(pool.startWinnerResolution(drawId, snapshotId));
    const chunk = await waitFor(pool.processDrawWinnerChunk(drawId, snapshotId));
    reportLocalCost("winnerPrefixChunkHistoricalOne", chunk);

    const [prefix, count] = await pool.drawResolutionHandles(drawId);
    expect(await decrypt128(prefix)).to.equal(await decrypt128(await pool.drawTotalHandle(drawId)));
    expect(await decrypt128(count)).to.equal(1n);
    const record = await pool.drawWinnerRecord(drawId, 0);
    expect(await decryptBool(record[0])).to.equal(true);
    expect(record[1]).to.equal(owner.address);
    expect(record[2]).to.equal(1n);
    expect(record[3]).to.equal(reservationNonce);
    expect(record[4]).to.equal(true);
    expect(record[5]).to.equal(true);
    await expectRejected(() => hre.fhevm.publicDecrypt([record[0]]));

    await waitFor(pool.finalizeDraw(drawId, snapshotId));
    expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.FINALIZED);
    await expect(pool.processDrawWinnerChunk(drawId, snapshotId)).to.be.reverted;
    await expect(pool.finalizeDraw(drawId, snapshotId)).to.be.reverted;
  });

  it("processes a real nine-participant winner in fixed 8+1 chunks with no early stop", async function () {
    const { signers, token, pool } = await fixture();
    for (let index = 0; index < 9; index += 1) {
      await activate(pool, token, signers[index]!, 1_000_000n, index);
    }
    await finalizeSnapshot(pool);
    expect(await pool.snapshotParticipantCount()).to.equal(9n);
    const { drawId, snapshotId } = await preparePositiveDraw(pool, true);
    await acceptCandidate(pool, drawId, snapshotId, true);
    await waitFor(pool.startWinnerResolution(drawId, snapshotId));

    const first = await waitFor(pool.processDrawWinnerChunk(drawId, snapshotId));
    reportLocalCost("winnerPrefixChunk8Active", first);
    expect((await pool.drawMetadata(drawId))[6]).to.equal(8n);
    await expect(pool.finalizeDraw(drawId, snapshotId)).to.be.revertedWithCustomError(
      pool,
      "DrawWinnerIncomplete",
    );
    const second = await waitFor(pool.processDrawWinnerChunk(drawId, snapshotId));
    reportLocalCost("winnerPrefixChunkFinalOne", second);
    expect((await pool.drawMetadata(drawId))[6]).to.equal(9n);
    await expect(pool.processDrawWinnerChunk(drawId, snapshotId)).to.be.revertedWithCustomError(
      pool,
      "DrawWinnerComplete",
    );

    const [prefix, count] = await pool.drawResolutionHandles(drawId);
    const total = await decrypt128(await pool.drawTotalHandle(drawId));
    expect(await decrypt128(prefix)).to.equal(total);
    expect(await decrypt128(count)).to.equal(1n);
    await expectRejected(() => hre.fhevm.publicDecrypt([prefix]));
    await expectRejected(() => hre.fhevm.publicDecrypt([count]));
    let winners = 0;
    for (let index = 0; index < 9; index += 1) {
      const record = await pool.drawWinnerRecord(drawId, index);
      if (await decryptBool(record[0])) winners += 1;
      expect(record[4]).to.equal(true);
      expect(record[5]).to.equal(true);
      await expectRejected(() => hre.fhevm.publicDecrypt([record[0]]));
    }
    expect(winners).to.equal(1);
    await waitFor(pool.finalizeDraw(drawId, snapshotId));
    expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.FINALIZED);
  });

  it("runs all sixteen winner chunks at the 128-slot cap instead of stopping on the encrypted winner", async function () {
    const { owner, token, pool } = await fixture();
    await activate(pool, token, owner, 1_000_000n, 0);

    const wallets = Array.from({ length: 127 }, () =>
      ethers.Wallet.createRandom().connect(hre.ethers.provider),
    );
    for (const wallet of wallets) {
      await hre.network.provider.send("hardhat_setBalance", [
        wallet.address,
        "0x56BC75E2D63100000",
      ]);
      await waitFor(
        (pool.connect(wallet) as unknown as Pool).reserveParticipantSlot({ value: BOND }),
      );
    }

    await finalizeSnapshot(pool);
    expect(await pool.snapshotParticipantCount()).to.equal(128n);
    const { drawId, snapshotId } = await preparePositiveDraw(pool);
    await acceptCandidate(pool, drawId, snapshotId);
    await waitFor(pool.startWinnerResolution(drawId, snapshotId));

    for (let chunk = 0; chunk < 16; chunk += 1) {
      await waitFor(pool.processDrawWinnerChunk(drawId, snapshotId));
      expect((await pool.drawMetadata(drawId))[6]).to.equal(BigInt((chunk + 1) * 8));
      if (chunk < 15) await expect(pool.finalizeDraw(drawId, snapshotId)).to.be.reverted;
    }
    await expect(pool.processDrawWinnerChunk(drawId, snapshotId)).to.be.reverted;
    const [prefix, count] = await pool.drawResolutionHandles(drawId);
    expect(await decrypt128(prefix)).to.equal(await decrypt128(await pool.drawTotalHandle(drawId)));
    expect(await decrypt128(count)).to.equal(1n);

    let winnerPredicates = 0;
    for (let index = 0; index < 128; index += 1) {
      const record = await pool.drawWinnerRecord(drawId, index);
      if (await decryptBool(record[0])) winnerPredicates += 1;

      if (index > 0) {
        expect(await decryptBool(record[0])).to.equal(false);
      }
    }
    expect(winnerPredicates).to.equal(1);

    await waitFor(pool.finalizeDraw(drawId, snapshotId));
    expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.FINALIZED);
  });

  it("proves the legitimate TWAB envelope cannot reach the unsupported draw domain", async function () {
    const { pool } = await fixture();

    const maximumParticipants = await pool.MAX_PARTICIPANTS();
    const maximumPrincipal = await pool.MAX_USER_PRINCIPAL_BASE_UNITS();
    const maximumDuration = await pool.MAX_DRAW_DURATION_SECONDS();
    const maximumDrawTotal = await pool.MAX_DRAW_TOTAL();

    const maximumLegitimateTwab = maximumParticipants * maximumPrincipal * maximumDuration;

    expect(maximumLegitimateTwab).to.equal(128n * 1_000_000_000_000n * 2_592_000n);
    expect(maximumLegitimateTwab).to.be.lessThan(maximumDrawTotal);
    expect(maximumDrawTotal).to.equal(1n << 69n);
  });

  it("domain-separates every consequential draw-proof context component", async function () {
    const firstFixture = await fixture();
    const secondFixture = await fixture();

    const base = await expectedProofContext(firstFixture.pool, 1, 1n, 1n, 0n);

    const differentStage = await expectedProofContext(firstFixture.pool, 2, 1n, 1n, 0n);
    const differentDraw = await expectedProofContext(firstFixture.pool, 1, 2n, 1n, 0n);
    const differentSnapshot = await expectedProofContext(firstFixture.pool, 1, 1n, 2n, 0n);
    const differentBatch = await expectedProofContext(firstFixture.pool, 1, 1n, 1n, 1n);
    const differentContract = await expectedProofContext(secondFixture.pool, 1, 1n, 1n, 0n);

    const contexts = [
      base,
      differentStage,
      differentDraw,
      differentSnapshot,
      differentBatch,
      differentContract,
    ];

    expect(new Set(contexts.map((value) => value.toString())).size).to.equal(contexts.length);

    const network = await hre.ethers.provider.getNetwork();
    const wrongChainEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "uint8", "uint256", "uint256", "uint256"],
      [
        ethers.encodeBytes32String("VEILPOT_DRAW_PROOF_V1"),
        network.chainId + 1n,
        await firstFixture.pool.getAddress(),
        1,
        1n,
        1n,
        0n,
      ],
    );

    const wrongChainContext = BigInt(ethers.keccak256(wrongChainEncoded));
    expect(wrongChainContext).to.not.equal(base);
  });

  it("denies user decryption of resolution state and winner predicates", async function () {
    const { owner, other, token, pool } = await fixture();

    await activate(pool, token, owner, 2_000_000n, 0);
    await finalizeSnapshot(pool);

    const { drawId, snapshotId } = await preparePositiveDraw(pool);
    await acceptCandidate(pool, drawId, snapshotId);
    await waitFor(pool.startWinnerResolution(drawId, snapshotId));
    await waitFor(pool.processDrawWinnerChunk(drawId, snapshotId));

    const [prefix, count] = await pool.drawResolutionHandles(drawId);
    const record = await pool.drawWinnerRecord(drawId, 0);
    const poolAddress = await pool.getAddress();

    await expectRejected(async () =>
      hre.fhevm.userDecryptEuint(FhevmType.euint128, prefix, poolAddress, other),
    );

    await expectRejected(async () =>
      hre.fhevm.userDecryptEuint(FhevmType.euint128, count, poolAddress, other),
    );

    await expectRejected(async () => hre.fhevm.userDecryptEbool(record[0], poolAddress, other));
  });

  it("keeps the production draw section free of caller entropy, timestamp entropy, and current-owner resolution", async function () {
    const source = await readFile(resolve(process.cwd(), "contracts/VeilpotPool.sol"), "utf8");
    const start = source.indexOf("// Gate 1B.3 production VeilDraw integration");
    const end = source.indexOf("/// @notice Settle one immutable refund-completion handle", start);
    expect(start).to.be.greaterThan(-1);
    expect(end).to.be.greaterThan(start);
    const drawSection = source.slice(start, end);
    expect(drawSection).to.include("FHE.randEuint128(bound)");
    expect(drawSection).not.to.include("blockhash");
    expect(drawSection).not.to.include("block.prevrandao");
    expect(drawSection).not.to.include("block.timestamp");
    expect(drawSection).not.to.include("tx.origin");
    expect(drawSection).not.to.include("msg.sender");
    expect(drawSection).not.to.include("FHE.fromExternal");
    expect(drawSection).not.to.include("_participants[");
    expect(drawSection).to.include("_snapshotWeights[snapshotId][index]");
    expect(drawSection).to.include("_epochBeneficiaries[");
  });
});
