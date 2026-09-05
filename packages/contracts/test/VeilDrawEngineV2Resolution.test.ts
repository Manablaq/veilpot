import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Tx = Promise<ethers.ContractTransactionResponse>;
type Signer = Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

const DRAW_STATE = {
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

interface Host extends ethers.BaseContract {
  engine(): Promise<string>;

  setWeight(slotIndex: bigint, encryptedWeight: Handle, proof: string): Tx;

  beginSnapshotImport(snapshotId: bigint, participantCount: bigint): Tx;

  syncSnapshotChunk(snapshotId: bigint, start: bigint, participantCount: bigint): Tx;

  sealSnapshotImport(snapshotId: bigint): Tx;

  startDrawRound(snapshotId: bigint): Tx;

  prepareDrawBucketEvidence(drawId: bigint, snapshotId: bigint): Tx;

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
  drawMetadataV2(
    drawId: bigint,
  ): Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>;

  drawBucketEvidenceHandles(drawId: bigint): Promise<readonly [Handle, Handle, Handle, Handle]>;

  drawBatchHandles(drawId: bigint): Promise<readonly [Handle, Handle, Handle]>;

  drawProofContextValue(
    stage: bigint,
    drawId: bigint,
    batchId: bigint,
    attemptNonce: bigint,
  ): Promise<bigint>;

  drawResolutionMetadata(drawId: bigint): Promise<readonly [bigint, bigint, bigint, bigint]>;

  drawSelectedShardHandle(drawId: bigint, shardIndex: bigint): Promise<Handle>;

  drawWinnerPredicateHandle(drawId: bigint, slotIndex: bigint): Promise<Handle>;

  drawResolutionHandles(drawId: bigint): Promise<readonly [Handle, Handle, Handle]>;

  SHARD_COUNT(): Promise<bigint>;
  SHARD_SIZE(): Promise<bigint>;
  SHARD_SELECTION_CHUNK_SIZE(): Promise<bigint>;
}

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

function reportLocalCost(operation: string, receipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);

  process.stdout.write(
    `${JSON.stringify({
      scope: "VEILDRAW_V2_RESOLUTION_LOCAL_ONLY",
      operation,
      globalHCU: hcu.globalHCU,
      sequentialHCU: hcu.maxHCUDepth,
      gas: receipt.gasUsed.toString(),
    })}\n`,
  );

  expect(hcu.globalHCU).to.be.at.most(REVIEWED_GLOBAL_HCU_LIMIT);

  expect(hcu.maxHCUDepth).to.be.at.most(REVIEWED_SEQUENTIAL_HCU_LIMIT);
}

async function encrypted64(
  address: string,
  signer: Signer,
  value: bigint,
): Promise<{
  handle: Handle;
  proof: string;
}> {
  const input = hre.fhevm.createEncryptedInput(address, signer.address);

  input.add64(value);

  const encrypted = await input.encrypt();

  return {
    handle: ethers.hexlify(encrypted.handles[0]!) as Handle,
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

async function fixture() {
  const signers = await hre.ethers.getSigners();

  const alice = signers[0]!;

  const host = (await (
    await hre.ethers.getContractFactory("TestVeilDrawEngineV2Host")
  ).deploy()) as unknown as Host;

  await host.waitForDeployment();

  const engine = (await hre.ethers.getContractAt(
    "VeilDrawEngineV2",
    await host.engine(),
  )) as unknown as Engine;

  await hre.fhevm.assertCoprocessorInitialized(host, "TestVeilDrawEngineV2Host");

  await hre.fhevm.assertCoprocessorInitialized(engine, "VeilDrawEngineV2");

  return {
    alice,
    host,
    engine,
  };
}

async function setWeight(
  host: Host,
  signer: Signer,
  slotIndex: number,
  value: bigint,
): Promise<void> {
  const input = await encrypted64(await host.getAddress(), signer, value);

  const userHost = host.connect(signer) as unknown as Host;

  await waitFor(userHost.setWeight(BigInt(slotIndex), input.handle, input.proof));
}

async function importSnapshot(
  host: Host,
  signer: Signer,
  weights: readonly bigint[],
): Promise<void> {
  for (let index = 0; index < weights.length; index += 1) {
    await setWeight(host, signer, index, weights[index]!);
  }

  await waitFor(host.beginSnapshotImport(1n, BigInt(weights.length)));

  for (let start = 0; start < weights.length; start += 8) {
    await waitFor(host.syncSnapshotChunk(1n, BigInt(start), BigInt(weights.length)));
  }

  await waitFor(host.sealSnapshotImport(1n));

  await waitFor(host.startDrawRound(1n));
}

async function acceptDraw(host: Host, engine: Engine, drawId: bigint): Promise<void> {
  await waitFor(host.prepareDrawBucketEvidence(drawId, 1n));

  const bucketHandles = await engine.drawBucketEvidenceHandles(drawId);

  const bucket = await hre.fhevm.publicDecrypt([...bucketHandles]);

  const exponent = asBigInt(bucket.clearValues[bucketHandles[0]]);

  const zero = asBoolean(bucket.clearValues[bucketHandles[1]]);

  const supported = asBoolean(bucket.clearValues[bucketHandles[2]]);

  expect(exponent).to.equal(3n);
  expect(zero).to.equal(false);
  expect(supported).to.equal(true);

  expect(asBigInt(bucket.clearValues[bucketHandles[3]])).to.equal(
    await engine.drawProofContextValue(1n, drawId, 0n, 1n),
  );

  await waitFor(
    host.submitDrawBucketEvidence(drawId, 1n, exponent, false, true, bucket.decryptionProof),
  );

  await waitFor(host.generateDrawCandidateBatch(drawId, 1n));

  const metadata = await engine.drawMetadataV2(drawId);

  const batchId = metadata[3];

  await waitFor(host.reduceDrawCandidateBatch(drawId, 1n, batchId));

  const batch = await engine.drawBatchHandles(drawId);

  const publicBatch = await hre.fhevm.publicDecrypt([batch[1], batch[2]]);

  const success = asBoolean(publicBatch.clearValues[batch[1]]);

  // Every candidate is valid because the encrypted total and bucket are both 8.
  expect(success).to.equal(true);

  expect(asBigInt(publicBatch.clearValues[batch[2]])).to.equal(
    await engine.drawProofContextValue(2n, drawId, batchId, batchId),
  );

  await waitFor(
    host.submitDrawBatchEvidence(drawId, 1n, batchId, true, publicBatch.decryptionProof),
  );

  expect((await engine.drawMetadataV2(drawId))[0]).to.equal(DRAW_STATE.CANDIDATE_ACCEPTED);
}

async function processAllShardSelection(
  host: Host,
  drawId: bigint,
  measure = false,
): Promise<void> {
  for (let call = 0; call < 4; call += 1) {
    const receipt = await waitFor(host.processDrawShardSelectionChunk(drawId, 1n));

    if (measure && call === 0) {
      reportLocalCost("privateShardSelection4", receipt);
    }
  }
}

async function processAllWinnerShards(host: Host, drawId: bigint, measure = false): Promise<void> {
  for (let shard = 0; shard < 16; shard += 1) {
    const receipt = await waitFor(host.processDrawWinnerShard(drawId, 1n));

    if (measure && shard === 0) {
      reportLocalCost("privateWinnerShard8", receipt);
    }
  }
}

async function decryptBool(handle: Handle): Promise<boolean> {
  const value = await hre.fhevm.debugger.decryptEbool(handle);

  if (typeof value !== "boolean") {
    throw new TypeError("local FHE debugger did not return a boolean");
  }

  return value;
}

describe("VeilDrawEngineV2 private 16-shard winner resolution", function () {
  this.timeout(180_000);

  it("privately selects a forced second shard and exact historical winner", async function () {
    const { alice, host, engine } = await fixture();

    await importSnapshot(host, alice, [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 8n]);

    await acceptDraw(host, engine, 1n);

    await waitFor(host.startWinnerResolution(1n, 1n));

    expect(await engine.drawResolutionMetadata(1n)).to.deep.equal([
      RESOLUTION_PHASE.SHARD_SELECTION,
      0n,
      0n,
      0n,
    ]);

    await processAllShardSelection(host, 1n, true);

    const afterShardSelection = await engine.drawResolutionMetadata(1n);

    expect(afterShardSelection[0]).to.equal(RESOLUTION_PHASE.SLOT_RESOLUTION);

    expect(afterShardSelection[1]).to.equal(16n);

    const selected: number[] = [];

    for (let shard = 0; shard < 16; shard += 1) {
      const handle = await engine.drawSelectedShardHandle(1n, BigInt(shard));

      if (await decryptBool(handle)) {
        selected.push(shard);
      }
    }

    expect(selected).to.deep.equal([1]);

    const selectedHandle = await engine.drawSelectedShardHandle(1n, 1n);

    await expectRejected(() => hre.fhevm.publicDecrypt([selectedHandle]));

    await processAllWinnerShards(host, 1n, true);

    const winners: number[] = [];

    for (let slot = 0; slot < 9; slot += 1) {
      const handle = await engine.drawWinnerPredicateHandle(1n, BigInt(slot));

      if (await decryptBool(handle)) {
        winners.push(slot);
      }
    }

    expect(winners).to.deep.equal([8]);

    const winnerHandle = await engine.drawWinnerPredicateHandle(1n, 8n);

    await expectRejected(() => hre.fhevm.publicDecrypt([winnerHandle]));

    const resolution = await engine.drawResolutionMetadata(1n);

    expect(resolution).to.deep.equal([RESOLUTION_PHASE.COMPLETE, 16n, 16n, 9n]);

    await waitFor(host.finalizeDraw(1n, 1n));

    expect((await engine.drawMetadataV2(1n))[0]).to.equal(DRAW_STATE.FINALIZED);
  });

  it("allows all three independent prize draws to resolve to the same saver", async function () {
    const { alice, host, engine } = await fixture();

    await importSnapshot(host, alice, [8n]);

    for (let drawId = 1n; drawId <= 3n; drawId += 1n) {
      await acceptDraw(host, engine, drawId);

      await waitFor(host.startWinnerResolution(drawId, 1n));

      await processAllShardSelection(host, drawId);

      await processAllWinnerShards(host, drawId);

      expect(await decryptBool(await engine.drawWinnerPredicateHandle(drawId, 0n))).to.equal(true);

      await waitFor(host.finalizeDraw(drawId, 1n));

      expect((await engine.drawMetadataV2(drawId))[0]).to.equal(DRAW_STATE.FINALIZED);
    }
  });

  it("enforces the shard-selection then slot-resolution sequence and rejects replay", async function () {
    const { alice, host, engine } = await fixture();

    await importSnapshot(host, alice, [8n]);

    await acceptDraw(host, engine, 1n);

    await expect(host.processDrawShardSelectionChunk(1n, 1n)).to.be.reverted;

    await expect(host.finalizeDraw(1n, 1n)).to.be.reverted;

    await waitFor(host.startWinnerResolution(1n, 1n));

    await expect(host.processDrawWinnerShard(1n, 1n)).to.be.reverted;

    await waitFor(host.processDrawShardSelectionChunk(1n, 1n));

    expect((await engine.drawResolutionMetadata(1n))[1]).to.equal(4n);

    await expect(host.finalizeDraw(1n, 1n)).to.be.reverted;

    for (let call = 1; call < 4; call += 1) {
      await waitFor(host.processDrawShardSelectionChunk(1n, 1n));
    }

    await expect(host.processDrawShardSelectionChunk(1n, 1n)).to.be.reverted;

    await waitFor(host.processDrawWinnerShard(1n, 1n));

    await expect(host.finalizeDraw(1n, 1n)).to.be.reverted;

    for (let shard = 1; shard < 16; shard += 1) {
      await waitFor(host.processDrawWinnerShard(1n, 1n));
    }

    await expect(host.processDrawWinnerShard(1n, 1n)).to.be.reverted;

    expect((await engine.drawResolutionMetadata(1n))[0]).to.equal(RESOLUTION_PHASE.COMPLETE);

    await waitFor(host.finalizeDraw(1n, 1n));

    await expect(host.finalizeDraw(1n, 1n)).to.be.reverted;
  });

  it("produces exactly one encrypted winner without publicly exposing the selector", async function () {
    const { alice, host, engine } = await fixture();

    await importSnapshot(host, alice, [4n, 4n]);

    await acceptDraw(host, engine, 1n);

    await waitFor(host.startWinnerResolution(1n, 1n));

    await processAllShardSelection(host, 1n);

    let selectedCount = 0;

    for (let shard = 0; shard < 16; shard += 1) {
      if (await decryptBool(await engine.drawSelectedShardHandle(1n, BigInt(shard)))) {
        selectedCount += 1;
      }
    }

    expect(selectedCount).to.equal(1);

    await processAllWinnerShards(host, 1n);

    let winnerCount = 0;

    for (let slot = 0; slot < 2; slot += 1) {
      const handle = await engine.drawWinnerPredicateHandle(1n, BigInt(slot));

      if (await decryptBool(handle)) {
        winnerCount += 1;
      }

      await expectRejected(() => hre.fhevm.publicDecrypt([handle]));
    }

    expect(winnerCount).to.equal(1);

    const invariantHandles = await engine.drawResolutionHandles(1n);

    for (const handle of invariantHandles) {
      await expectRejected(() => hre.fhevm.publicDecrypt([handle]));
    }
  });

  it("locks the fixed 16 x 8 topology and remains below Ethereum code-size limits", async function () {
    const { engine } = await fixture();

    expect(await engine.SHARD_COUNT()).to.equal(16n);

    expect(await engine.SHARD_SIZE()).to.equal(8n);

    expect(await engine.SHARD_SELECTION_CHUNK_SIZE()).to.equal(4n);

    const artifact = await hre.artifacts.readArtifact("VeilDrawEngineV2");

    const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;

    const creationBytes = (artifact.bytecode.length - 2) / 2;

    process.stdout.write(
      `${JSON.stringify({
        scope: "VEILDRAW_V2_RESOLUTION_BUILD_GUARD",
        creationBytes,
        runtimeBytes,
        eip170RuntimeLimitBytes: 24_576,
        eip3860InitcodeLimitBytes: 49_152,
      })}\n`,
    );

    expect(runtimeBytes).to.be.at.most(24_576);

    expect(creationBytes).to.be.at.most(49_152);
  });
});

interface EntitlementPool extends Host {
  bindReserve(reserve: string): Tx;

  derivePrizeEntitlement(drawId: bigint, slotIndex: bigint, prizeAmount: Handle): Tx;

  derivePrizeEntitlementWithoutEngineGrant(
    drawId: bigint,
    slotIndex: bigint,
    prizeAmount: Handle,
  ): Tx;
}

interface EntitlementReserve extends ethers.BaseContract {
  setPrize(encryptedPrize: Handle, proof: string): Tx;

  deriveAndStore(drawId: bigint, slotIndex: bigint): Tx;

  deriveWithoutReserveGrant(drawId: bigint, slotIndex: bigint): Tx;

  deriveWithMissingEngineGrant(drawId: bigint, slotIndex: bigint): Tx;

  prizeHandle(): Promise<Handle>;

  storedEntitlementHandle(drawId: bigint, slotIndex: bigint): Promise<Handle>;
}

async function entitlementFixture() {
  const signers = await hre.ethers.getSigners();

  const alice = signers[0]!;

  const pool = (await (
    await hre.ethers.getContractFactory("TestVeilDrawEntitlementPoolV2")
  ).deploy()) as unknown as EntitlementPool;

  await pool.waitForDeployment();

  const reserve = (await (
    await hre.ethers.getContractFactory("TestVeilDrawEntitlementReserveV2")
  ).deploy(await pool.getAddress())) as unknown as EntitlementReserve;

  await reserve.waitForDeployment();

  await waitFor(pool.bindReserve(await reserve.getAddress()));

  const engine = (await hre.ethers.getContractAt(
    "VeilDrawEngineV2",
    await pool.engine(),
  )) as unknown as Engine;

  await hre.fhevm.assertCoprocessorInitialized(pool, "TestVeilDrawEntitlementPoolV2");

  await hre.fhevm.assertCoprocessorInitialized(reserve, "TestVeilDrawEntitlementReserveV2");

  await hre.fhevm.assertCoprocessorInitialized(engine, "VeilDrawEngineV2");

  return {
    alice,
    pool,
    reserve,
    engine,
  };
}

async function setReservePrize(
  reserve: EntitlementReserve,
  signer: Signer,
  amount: bigint,
): Promise<void> {
  const input = await encrypted64(await reserve.getAddress(), signer, amount);

  const userReserve = reserve.connect(signer) as unknown as EntitlementReserve;

  await waitFor(userReserve.setPrize(input.handle, input.proof));
}

async function decrypt64(handle: Handle): Promise<bigint> {
  const value = await hre.fhevm.debugger.decryptEuint(FhevmType.euint64, handle);

  if (typeof value !== "bigint") {
    throw new TypeError("local FHE debugger did not return euint64");
  }

  return value;
}

describe("VeilDrawEngineV2 three-hop entitlement ACL boundary", function () {
  this.timeout(180_000);

  it("derives exact encrypted winner prize and encrypted zero for the non-winner", async function () {
    const { alice, pool, reserve, engine } = await entitlementFixture();

    // Total is exactly 8 and slot 0 owns the entire interval.
    // Slot 0 therefore wins regardless of the hidden target in [0, 7].
    await importSnapshot(pool, alice, [8n, 0n]);

    await setReservePrize(reserve, alice, 5_000n);

    // Finalized state is a hard consequence precondition.
    await expectRejected(() => reserve.deriveAndStore(1n, 0n));

    await acceptDraw(pool, engine, 1n);

    await expectRejected(() => reserve.deriveAndStore(1n, 0n));

    await waitFor(pool.startWinnerResolution(1n, 1n));

    await processAllShardSelection(pool, 1n);

    await processAllWinnerShards(pool, 1n);

    await waitFor(pool.finalizeDraw(1n, 1n));

    expect((await engine.drawMetadataV2(1n))[0]).to.equal(DRAW_STATE.FINALIZED);

    const winnerReceipt = await waitFor(reserve.deriveAndStore(1n, 0n));

    reportLocalCost("threeHopWinnerEntitlement", winnerReceipt);

    const loserReceipt = await waitFor(reserve.deriveAndStore(1n, 1n));

    reportLocalCost("threeHopLoserEntitlement", loserReceipt);

    const winnerEntitlement = await reserve.storedEntitlementHandle(1n, 0n);

    const loserEntitlement = await reserve.storedEntitlementHandle(1n, 1n);

    expect(await decrypt64(winnerEntitlement)).to.equal(5_000n);

    expect(await decrypt64(loserEntitlement)).to.equal(0n);

    // Entitlements remain confidential.
    await expectRejected(() => hre.fhevm.publicDecrypt([winnerEntitlement]));

    await expectRejected(() => hre.fhevm.publicDecrypt([loserEntitlement]));

    // The Reserve persisted a new derivative, not its original prize
    // ciphertext.
    expect(winnerEntitlement).to.not.equal(await reserve.prizeHandle());
  });

  it("proves every inter-contract ACL grant is transaction-scoped", async function () {
    const { alice, pool, reserve, engine } = await entitlementFixture();

    await importSnapshot(pool, alice, [8n, 0n]);

    await acceptDraw(pool, engine, 1n);

    await waitFor(pool.startWinnerResolution(1n, 1n));

    await processAllShardSelection(pool, 1n);

    await processAllWinnerShards(pool, 1n);

    await waitFor(pool.finalizeDraw(1n, 1n));

    await setReservePrize(reserve, alice, 777n);

    // No Reserve -> Pool grant in this new transaction.
    await expectRejected(() => reserve.deriveWithoutReserveGrant(1n, 0n));

    // Reserve -> Pool exists, but Pool deliberately omits Pool -> Engine.
    await expectRejected(() => reserve.deriveWithMissingEngineGrant(1n, 0n));

    // Proper fresh grants across every hop succeed.
    await waitFor(reserve.deriveAndStore(1n, 0n));

    expect(await decrypt64(await reserve.storedEntitlementHandle(1n, 0n))).to.equal(777n);

    // A previous successful transaction must not leave Reserve -> Pool
    // authorization alive.
    await expectRejected(() => reserve.deriveWithoutReserveGrant(1n, 0n));
  });

  it("fails closed for invalid draw and slot consequences", async function () {
    const { alice, pool, reserve, engine } = await entitlementFixture();

    await importSnapshot(pool, alice, [8n, 0n]);

    await acceptDraw(pool, engine, 1n);

    await waitFor(pool.startWinnerResolution(1n, 1n));

    await processAllShardSelection(pool, 1n);

    await processAllWinnerShards(pool, 1n);

    await waitFor(pool.finalizeDraw(1n, 1n));

    await setReservePrize(reserve, alice, 42n);

    await expectRejected(() => reserve.deriveAndStore(999n, 0n));

    await expectRejected(() => reserve.deriveAndStore(1n, 2n));

    // Only the immutable Pool can call the Engine consequence function.
    const prize = await reserve.prizeHandle();

    await expectRejected(() =>
      engine.connect(alice).getFunction("derivePrizeEntitlement").staticCall(1n, 0n, prize),
    );
  });
});
