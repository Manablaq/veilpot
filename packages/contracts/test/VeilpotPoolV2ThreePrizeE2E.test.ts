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

interface PoolV2 extends ethers.BaseContract {
  veilDrawEngine(): Promise<string>;

  reserveParticipantSlot(overrides: { value: bigint }): Tx;

  participantMetadata(slot: bigint): Promise<readonly unknown[]>;

  deposit(
    amount: Handle,
    proof: string,
    depositor: string,
    claimedPool: string,
    version: bigint,
    reservationNonce: bigint,
    depositNonce: bigint,
  ): Tx;

  thresholdHandle(slot: bigint): Promise<Handle>;

  settleThreshold(
    slot: bigint,
    version: bigint,
    reservationNonce: bigint,
    clearSatisfied: boolean,
    proof: string,
  ): Tx;

  activeEpochEnd(): Promise<bigint>;

  startSnapshot(): Tx;
  processSnapshotChunk(): Tx;
  finalizeSnapshot(): Tx;

  nextSnapshotId(): Promise<bigint>;
  snapshotParticipantCount(): Promise<bigint>;
  snapshotCursor(): Promise<bigint>;

  snapshotBeneficiary(
    snapshotId: bigint,
    slot: bigint,
  ): Promise<readonly [string, bigint, bigint, boolean]>;

  beginDrawSnapshotImport(snapshotId: bigint): Tx;
  processDrawSnapshotImportChunk(snapshotId: bigint): Tx;
  finalizeDrawSnapshotImport(snapshotId: bigint): Tx;

  drawSnapshotImportMetadata(
    snapshotId: bigint,
  ): Promise<readonly [bigint, bigint, boolean, boolean]>;

  startDraw(): Tx;

  snapshotDrawId(snapshotId: bigint): Promise<bigint>;

  snapshotPrizeDrawId(snapshotId: bigint, prizeIndex: bigint): Promise<bigint>;

  drawMetadata(
    drawId: bigint,
  ): Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint]>;

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

  drawBatchHandles(drawId: bigint): Promise<readonly [Handle, Handle, Handle]>;

  submitDrawBatchEvidence(
    drawId: bigint,
    snapshotId: bigint,
    batchId: bigint,
    success: boolean,
    proof: string,
  ): Tx;

  startWinnerResolution(drawId: bigint, snapshotId: bigint): Tx;

  processDrawShardSelectionChunk(drawId: bigint, snapshotId: bigint): Tx;

  processDrawWinnerShard(drawId: bigint, snapshotId: bigint): Tx;

  finalizeDraw(drawId: bigint, snapshotId: bigint): Tx;
}

interface Engine extends ethers.BaseContract {
  pool(): Promise<string>;

  drawMetadataV2(
    drawId: bigint,
  ): Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>;

  drawPrizeIndex(drawId: bigint): Promise<bigint>;

  drawAcceptedTargetHandle(drawId: bigint): Promise<Handle>;

  drawSelectedShardHandle(drawId: bigint, shardIndex: bigint): Promise<Handle>;

  drawWinnerPredicateHandle(drawId: bigint, slotIndex: bigint): Promise<Handle>;

  drawResolutionMetadata(drawId: bigint): Promise<readonly [bigint, bigint, bigint, bigint]>;

  drawResolutionHandles(drawId: bigint): Promise<readonly [Handle, Handle, Handle]>;
}

const BOND = 1_000_000_000_000_000n;

const DRAW_STATE = {
  BUCKET_DISCOVERY: 1n,
  BUCKET_READY: 2n,
  AWAITING_CANDIDATE_BATCH: 3n,
  BATCH_REDUCTION_PENDING: 4n,
  BATCH_PROOF_PENDING: 5n,
  CANDIDATE_ACCEPTED: 6n,
  WINNER_RESOLUTION: 7n,
  FINALIZED: 8n,
} as const;

const RESOLUTION_PHASE = {
  NONE: 0n,
  SHARD_SELECTION: 1n,
  SLOT_RESOLUTION: 2n,
  COMPLETE: 3n,
} as const;

const REVIEWED_GLOBAL_HCU_LIMIT = 20_000_000;
const REVIEWED_SEQUENTIAL_HCU_LIMIT = 5_000_000;

async function waitFor(tx: Tx): Promise<ethers.TransactionReceipt> {
  const receipt = await (await tx).wait();

  if (receipt === null) {
    throw new Error("missing transaction receipt");
  }

  return receipt;
}

function asBigInt(value: unknown): bigint {
  if (typeof value !== "bigint") {
    throw new TypeError("expected bigint");
  }

  return value;
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("expected boolean");
  }

  return value;
}

async function expectRejected(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    return;
  }

  throw new Error("expected operation to reject");
}

async function encryptedInput(
  contractAddress: string,
  signer: Signer,
  amount: bigint,
): Promise<{ handle: Handle; proof: string }> {
  const input = hre.fhevm.createEncryptedInput(contractAddress, signer.address);

  input.add64(amount);

  const encrypted = await input.encrypt();

  return {
    handle: ethers.hexlify(encrypted.handles[0]!) as Handle,
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

async function setTimestamp(timestamp: bigint): Promise<void> {
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await hre.network.provider.send("evm_mine");
}

function reportCost(operation: string, receipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);

  process.stdout.write(
    `${JSON.stringify({
      scope: "VEILPOT_POOL_V2_THREE_PRIZE_E2E_LOCAL_ONLY",
      operation,
      globalHCU: hcu.globalHCU,
      sequentialHCU: hcu.maxHCUDepth,
      gas: receipt.gasUsed.toString(),
    })}\n`,
  );

  expect(hcu.globalHCU).to.be.at.most(REVIEWED_GLOBAL_HCU_LIMIT);
  expect(hcu.maxHCUDepth).to.be.at.most(REVIEWED_SEQUENTIAL_HCU_LIMIT);
}

async function fixture() {
  const signers = await hre.ethers.getSigners();

  const owner = signers[0]!;

  const token = (await (
    await hre.ethers.getContractFactory("TestERC7984")
  ).deploy()) as unknown as Token;

  await token.waitForDeployment();

  await hre.fhevm.assertCoprocessorInitialized(token, "TestERC7984");

  const pool = (await (
    await hre.ethers.getContractFactory("VeilpotPoolV2")
  ).deploy(
    await token.getAddress(),
    owner.address,
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
  )) as unknown as PoolV2;

  await pool.waitForDeployment();

  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPoolV2");

  const engine = (await hre.ethers.getContractAt(
    "VeilDrawEngineV2",
    await pool.veilDrawEngine(),
  )) as unknown as Engine;

  await hre.fhevm.assertCoprocessorInitialized(engine, "VeilDrawEngineV2");

  return {
    owner,
    token,
    pool,
    engine,
  };
}

async function activateOneSaver(pool: PoolV2, token: Token, signer: Signer): Promise<bigint> {
  const userPool = pool.connect(signer) as unknown as PoolV2;
  const userToken = token.connect(signer) as unknown as Token;

  await waitFor(
    userPool.reserveParticipantSlot({
      value: BOND,
    }),
  );

  const metadata = await pool.participantMetadata(0n);

  const reservationNonce = BigInt(String(metadata[3]));

  await waitFor(userToken.mintClear(signer.address, 2_000_000n));

  const latest = await hre.ethers.provider.getBlock("latest");

  await waitFor(
    userToken.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 86_400)),
  );

  const input = await encryptedInput(await pool.getAddress(), signer, 2_000_000n);

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

  const thresholdHandle = await pool.thresholdHandle(0n);

  const threshold = await hre.fhevm.publicDecrypt([thresholdHandle]);

  expect(asBoolean(threshold.clearValues[thresholdHandle])).to.equal(true);

  await waitFor(
    userPool.settleThreshold(0n, 1n, reservationNonce, true, threshold.decryptionProof),
  );

  return reservationNonce;
}

async function finalizeAndImportSnapshot(pool: PoolV2): Promise<bigint> {
  const cutoff = await pool.activeEpochEnd();

  // startSnapshot's transaction advances the local block to the exact cutoff.
  await setTimestamp(cutoff - 1n);

  await waitFor(pool.startSnapshot());

  const snapshotId = await pool.nextSnapshotId();
  const count = await pool.snapshotParticipantCount();

  while ((await pool.snapshotCursor()) < count) {
    await waitFor(pool.processSnapshotChunk());
  }

  await waitFor(pool.finalizeSnapshot());

  await waitFor(pool.beginDrawSnapshotImport(snapshotId));

  let imported = await pool.drawSnapshotImportMetadata(snapshotId);

  while (imported[1] < imported[0]) {
    await waitFor(pool.processDrawSnapshotImportChunk(snapshotId));

    imported = await pool.drawSnapshotImportMetadata(snapshotId);
  }

  await waitFor(pool.finalizeDrawSnapshotImport(snapshotId));

  return snapshotId;
}

async function prepareBucket(pool: PoolV2, drawId: bigint, snapshotId: bigint): Promise<void> {
  await waitFor(pool.prepareDrawBucketEvidence(drawId, snapshotId));

  const handles = await pool.drawBucketEvidenceHandles(drawId);

  const result = await hre.fhevm.publicDecrypt([...handles]);

  const exponent = asBigInt(result.clearValues[handles[0]]);
  const zero = asBoolean(result.clearValues[handles[1]]);
  const supported = asBoolean(result.clearValues[handles[2]]);

  expect(zero).to.equal(false);
  expect(supported).to.equal(true);

  await waitFor(
    pool.submitDrawBucketEvidence(
      drawId,
      snapshotId,
      exponent,
      zero,
      supported,
      result.decryptionProof,
    ),
  );

  expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.BUCKET_READY);
}

async function acceptPrivateTarget(
  pool: PoolV2,
  engine: Engine,
  drawId: bigint,
  snapshotId: bigint,
  measure = false,
): Promise<number> {
  for (let attempt = 1; attempt <= 32; attempt += 1) {
    const generation = await waitFor(pool.generateDrawCandidateBatch(drawId, snapshotId));

    if (measure && attempt === 1) {
      reportCost("poolWrappedCandidateBatchM8", generation);
    }

    const metadata = await pool.drawMetadata(drawId);

    expect(metadata[0]).to.equal(DRAW_STATE.BATCH_REDUCTION_PENDING);

    const batchId = metadata[4];

    const reduction = await waitFor(pool.reduceDrawCandidateBatch(drawId, snapshotId, batchId));

    if (measure && attempt === 1) {
      reportCost("poolWrappedCandidateReductionM8", reduction);
    }

    expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.BATCH_PROOF_PENDING);

    const handles = await pool.drawBatchHandles(drawId);

    const clear = await hre.fhevm.publicDecrypt([handles[1], handles[2]]);

    const success = asBoolean(clear.clearValues[handles[1]]);

    await waitFor(
      pool.submitDrawBatchEvidence(drawId, snapshotId, batchId, success, clear.decryptionProof),
    );

    const after = await pool.drawMetadata(drawId);

    if (success) {
      expect(after[0]).to.equal(DRAW_STATE.CANDIDATE_ACCEPTED);

      const acceptedTarget = await engine.drawAcceptedTargetHandle(drawId);

      await expectRejected(() => hre.fhevm.publicDecrypt([acceptedTarget]));

      return attempt;
    }

    expect(after[0]).to.equal(DRAW_STATE.AWAITING_CANDIDATE_BATCH);
  }

  throw new Error(`draw ${drawId.toString()} failed to accept a candidate within 32 batches`);
}

async function resolvePrivateWinner(
  pool: PoolV2,
  engine: Engine,
  drawId: bigint,
  snapshotId: bigint,
  measure = false,
): Promise<void> {
  await waitFor(pool.startWinnerResolution(drawId, snapshotId));

  let resolution = await engine.drawResolutionMetadata(drawId);

  expect(resolution[0]).to.equal(RESOLUTION_PHASE.SHARD_SELECTION);

  for (let index = 0; index < 4; index += 1) {
    const receipt = await waitFor(pool.processDrawShardSelectionChunk(drawId, snapshotId));

    if (measure && index === 0) {
      reportCost("poolWrappedPrivateShardSelection4", receipt);
    }
  }

  resolution = await engine.drawResolutionMetadata(drawId);

  expect(resolution[0]).to.equal(RESOLUTION_PHASE.SLOT_RESOLUTION);
  expect(resolution[1]).to.equal(16n);

  for (let shard = 0; shard < 16; shard += 1) {
    const receipt = await waitFor(pool.processDrawWinnerShard(drawId, snapshotId));

    if (measure && shard === 0) {
      reportCost("poolWrappedPrivateWinnerShard8", receipt);
    }
  }

  resolution = await engine.drawResolutionMetadata(drawId);

  expect(resolution[0]).to.equal(RESOLUTION_PHASE.COMPLETE);
  expect(resolution[1]).to.equal(16n);
  expect(resolution[2]).to.equal(16n);
  expect(resolution[3]).to.equal(1n);

  await waitFor(pool.finalizeDraw(drawId, snapshotId));

  const metadata = await pool.drawMetadata(drawId);

  expect(metadata[0]).to.equal(DRAW_STATE.FINALIZED);
  expect(metadata[1]).to.equal(snapshotId);
  expect(metadata[3]).to.equal(1n);
  expect(metadata[6]).to.equal(1n);
}

async function prepareRound() {
  const setup = await fixture();

  const reservationNonce = await activateOneSaver(setup.pool, setup.token, setup.owner);

  const snapshotId = await finalizeAndImportSnapshot(setup.pool);

  await waitFor(setup.pool.startDraw());

  return {
    ...setup,
    reservationNonce,
    snapshotId,
  };
}

describe("VeilpotPoolV2 full three-prize confidential E2E", function () {
  this.timeout(240_000);

  it("drives all three child draws independently from Pool snapshot to FINALIZED", async function () {
    const { pool, engine, snapshotId } = await prepareRound();

    expect(await pool.snapshotDrawId(snapshotId)).to.equal(1n);
    expect(await pool.snapshotPrizeDrawId(snapshotId, 0n)).to.equal(1n);
    expect(await pool.snapshotPrizeDrawId(snapshotId, 1n)).to.equal(2n);
    expect(await pool.snapshotPrizeDrawId(snapshotId, 2n)).to.equal(3n);

    for (let drawId = 1n; drawId <= 3n; drawId += 1n) {
      expect(await engine.drawPrizeIndex(drawId)).to.equal(drawId - 1n);

      await prepareBucket(pool, drawId, snapshotId);

      const attempts = await acceptPrivateTarget(pool, engine, drawId, snapshotId, drawId === 1n);

      process.stdout.write(
        `${JSON.stringify({
          scope: "VEILPOT_POOL_V2_THREE_PRIZE_E2E",
          drawId: drawId.toString(),
          prizeIndex: (drawId - 1n).toString(),
          acceptedBatchAttempt: attempts,
        })}\n`,
      );

      await resolvePrivateWinner(pool, engine, drawId, snapshotId, drawId === 1n);

      expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.FINALIZED);
    }
  });

  it("proves one completed prize cannot advance either sibling child draw", async function () {
    const { pool, engine, snapshotId } = await prepareRound();

    await prepareBucket(pool, 1n, snapshotId);
    await acceptPrivateTarget(pool, engine, 1n, snapshotId);
    await resolvePrivateWinner(pool, engine, 1n, snapshotId);

    expect((await pool.drawMetadata(1n))[0]).to.equal(DRAW_STATE.FINALIZED);

    expect((await pool.drawMetadata(2n))[0]).to.equal(DRAW_STATE.BUCKET_DISCOVERY);

    expect((await pool.drawMetadata(3n))[0]).to.equal(DRAW_STATE.BUCKET_DISCOVERY);

    expect(await engine.drawPrizeIndex(1n)).to.equal(0n);
    expect(await engine.drawPrizeIndex(2n)).to.equal(1n);
    expect(await engine.drawPrizeIndex(3n)).to.equal(2n);
  });

  it("keeps shard selection, accepted targets, winner predicates, and resolution invariants private", async function () {
    const { pool, engine, snapshotId } = await prepareRound();

    await prepareBucket(pool, 1n, snapshotId);
    await acceptPrivateTarget(pool, engine, 1n, snapshotId);
    await resolvePrivateWinner(pool, engine, 1n, snapshotId);

    const acceptedTarget = await engine.drawAcceptedTargetHandle(1n);
    const selectedShard = await engine.drawSelectedShardHandle(1n, 0n);
    const winner = await engine.drawWinnerPredicateHandle(1n, 0n);
    const invariants = await engine.drawResolutionHandles(1n);

    for (const handle of [
      acceptedTarget,
      selectedShard,
      winner,
      invariants[0],
      invariants[1],
      invariants[2],
    ]) {
      await expectRejected(() => hre.fhevm.publicDecrypt([handle]));
    }

    // One real saver means every valid hidden target is in shard 0
    // and necessarily resolves to historical slot 0.
    expect(await hre.fhevm.debugger.decryptEbool(selectedShard)).to.equal(true);
    expect(await hre.fhevm.debugger.decryptEbool(winner)).to.equal(true);

    for (let shard = 1; shard < 16; shard += 1) {
      expect(
        await hre.fhevm.debugger.decryptEbool(
          await engine.drawSelectedShardHandle(1n, BigInt(shard)),
        ),
      ).to.equal(false);
    }
  });

  it("allows the same historical saver to win all three prize slots without unique-winner exclusion", async function () {
    const { owner, pool, engine, snapshotId, reservationNonce } = await prepareRound();

    const beneficiary = await pool.snapshotBeneficiary(snapshotId, 0n);

    expect(beneficiary[0]).to.equal(owner.address);
    expect(beneficiary[1]).to.equal(1n);
    expect(beneficiary[2]).to.equal(reservationNonce);
    expect(beneficiary[3]).to.equal(true);

    for (let drawId = 1n; drawId <= 3n; drawId += 1n) {
      await prepareBucket(pool, drawId, snapshotId);
      await acceptPrivateTarget(pool, engine, drawId, snapshotId);
      await resolvePrivateWinner(pool, engine, drawId, snapshotId);

      const winner = await engine.drawWinnerPredicateHandle(drawId, 0n);

      expect(await hre.fhevm.debugger.decryptEbool(winner)).to.equal(true);

      await expectRejected(() => hre.fhevm.publicDecrypt([winner]));

      const metadata = await pool.drawMetadata(drawId);

      expect(metadata).to.have.length(7);
      expect(metadata[0]).to.equal(DRAW_STATE.FINALIZED);
      expect(metadata[1]).to.equal(snapshotId);
      expect(metadata[3]).to.equal(1n);
      expect(metadata[6]).to.equal(1n);
    }
  });

  it("retains the reviewed PoolV2 runtime margin after full three-prize orchestration", async function () {
    const poolArtifact = await hre.artifacts.readArtifact("VeilpotPoolV2");
    const engineArtifact = await hre.artifacts.readArtifact("VeilDrawEngineV2");

    const poolRuntime = (poolArtifact.deployedBytecode.length - 2) / 2;
    const poolCreation = (poolArtifact.bytecode.length - 2) / 2;

    const engineRuntime = (engineArtifact.deployedBytecode.length - 2) / 2;
    const engineCreation = (engineArtifact.bytecode.length - 2) / 2;

    process.stdout.write(
      `${JSON.stringify({
        scope: "VEILPOT_POOL_V2_THREE_PRIZE_BUILD_GUARD",
        poolCreationBytes: poolCreation,
        poolRuntimeBytes: poolRuntime,
        poolReviewedBudgetBytes: 23_500,
        poolReviewedHeadroomBytes: 23_500 - poolRuntime,
        poolEip170HeadroomBytes: 24_576 - poolRuntime,
        engineCreationBytes: engineCreation,
        engineRuntimeBytes: engineRuntime,
        engineEip170HeadroomBytes: 24_576 - engineRuntime,
      })}\n`,
    );

    expect(poolRuntime).to.be.at.most(23_500);
    expect(poolCreation).to.be.at.most(49_152);
    expect(engineRuntime).to.be.at.most(24_576);
    expect(engineCreation).to.be.at.most(49_152);
  });
});
