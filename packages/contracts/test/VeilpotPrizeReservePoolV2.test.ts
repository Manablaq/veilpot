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

interface PoolV2 extends ethers.BaseContract {
  prizeReserve(): Promise<string>;
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

  beginDrawSnapshotImport(snapshotId: bigint): Tx;

  processDrawSnapshotImportChunk(snapshotId: bigint): Tx;

  finalizeDrawSnapshotImport(snapshotId: bigint): Tx;

  drawSnapshotImportMetadata(
    snapshotId: bigint,
  ): Promise<readonly [bigint, bigint, boolean, boolean]>;

  startDraw(): Tx;

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
  drawWinnerPredicateHandle(drawId: bigint, slotIndex: bigint): Promise<Handle>;
}

interface AdapterView extends ethers.BaseContract {
  confidentialToken(): Promise<string>;
  pool(): Promise<string>;
  reserve(): Promise<string>;

  drawYieldHandles(drawId: bigint): Promise<bigint>;
}

interface PrizeReserve extends ethers.BaseContract {
  pool(): Promise<string>;
  adapter(): Promise<string>;
  confidentialToken(): Promise<string>;

  nextSponsorFundingNonce(funder: string): Promise<bigint>;

  fundSponsorForDraw(
    drawId: bigint,
    encryptedAmount: Handle,
    inputProof: string,
    funder: string,
    fundingNonce: bigint,
  ): Tx;

  preparePrize(drawId: bigint): Tx;

  settlePrizeStatus(
    drawId: bigint,
    statusAttemptNonce: bigint,
    clearZeroPrize: boolean,
    proof: string,
  ): Tx;

  assignPrizeEntitlementChunk(drawId: bigint, expectedCursor: bigint): Tx;

  prizeHandles(
    drawId: bigint,
  ): Promise<
    readonly [bigint, Handle, Handle, Handle, Handle, Handle, bigint, bigint, bigint, bigint]
  >;

  prizeEntitlementRecord(
    drawId: bigint,
    slotIndex: bigint,
  ): Promise<readonly [boolean, boolean, string, bigint, bigint, Handle]>;

  prizeAssignmentTotalHandle(drawId: bigint): Promise<Handle>;

  reserveAccountingHandles(): Promise<readonly [Handle, Handle]>;
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

const PRIZE_STATE = {
  UNPREPARED: 0n,
  STATUS_PROOF_PENDING: 1n,
  ASSIGNING: 2n,
  CLAIMABLE: 3n,
} as const;

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

async function decrypt64(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint64, handle);
}

async function decrypt128(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);
}

async function encrypted64(
  contractAddress: string,
  signer: Signer,
  amount: bigint,
): Promise<{
  handle: Handle;
  proof: string;
}> {
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
      scope: "VEILPOT_REAL_RESERVE_POOL_V2_LOCAL_ONLY",
      operation,
      globalHCU: hcu.globalHCU,
      sequentialHCU: hcu.maxHCUDepth,
      gas: receipt.gasUsed.toString(),
    })}\n`,
  );

  expect(hcu.globalHCU).to.be.at.most(20_000_000);

  expect(hcu.maxHCUDepth).to.be.at.most(5_000_000);
}

async function deploySystem() {
  const signers = await hre.ethers.getSigners();

  const owner = signers[0]!;

  const other = signers[1]!;

  const token = (await (
    await hre.ethers.getContractFactory("TestERC7984")
  ).deploy()) as unknown as Token;

  await token.waitForDeployment();

  await hre.fhevm.assertCoprocessorInitialized(token, "TestERC7984");

  // PrizeReserve constructor validates a circular immutable binding:
  // Pool -> Reserve, Adapter -> Pool/Reserve, Reserve -> Pool/Adapter.
  // Predict all three owner-CREATE addresses before deploying any of them.
  const nonce = await hre.ethers.provider.getTransactionCount(owner.address);

  const predictedPool = ethers.getCreateAddress({
    from: owner.address,
    nonce,
  });

  const predictedAdapter = ethers.getCreateAddress({
    from: owner.address,
    nonce: nonce + 1,
  });

  const predictedReserve = ethers.getCreateAddress({
    from: owner.address,
    nonce: nonce + 2,
  });

  const pool = (await (
    await hre.ethers.getContractFactory("VeilpotPoolV2")
  ).deploy(
    await token.getAddress(),
    predictedReserve,
    "0x1111111111111111111111111111111111111111",
  )) as unknown as PoolV2;

  await pool.waitForDeployment();

  expect(await pool.getAddress()).to.equal(predictedPool);

  const adapter = (await (
    await hre.ethers.getContractFactory("TestVeilpotPrizeAdapterViewV2")
  ).deploy(await token.getAddress(), predictedPool, predictedReserve)) as unknown as AdapterView;

  await adapter.waitForDeployment();

  expect(await adapter.getAddress()).to.equal(predictedAdapter);

  const reserve = (await (
    await hre.ethers.getContractFactory("VeilpotPrizeReserve")
  ).deploy(predictedPool, predictedAdapter)) as unknown as PrizeReserve;

  await reserve.waitForDeployment();

  expect(await reserve.getAddress()).to.equal(predictedReserve);

  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPoolV2");

  await hre.fhevm.assertCoprocessorInitialized(reserve, "VeilpotPrizeReserve");

  const engine = (await hre.ethers.getContractAt(
    "VeilDrawEngineV2",
    await pool.veilDrawEngine(),
  )) as unknown as Engine;

  await hre.fhevm.assertCoprocessorInitialized(engine, "VeilDrawEngineV2");

  return {
    owner,
    other,
    token,
    pool,
    engine,
    adapter,
    reserve,
    predictedPool,
    predictedAdapter,
    predictedReserve,
  };
}

async function activate(
  pool: PoolV2,
  token: Token,
  signer: Signer,
  slotIndex: bigint,
): Promise<bigint> {
  const userPool = pool.connect(signer) as unknown as PoolV2;

  const userToken = token.connect(signer) as unknown as Token;

  await waitFor(
    userPool.reserveParticipantSlot({
      value: BOND,
    }),
  );

  const metadata = await pool.participantMetadata(slotIndex);

  expect(String(metadata[1]).toLowerCase()).to.equal(signer.address.toLowerCase());

  const reservationNonce = BigInt(String(metadata[3]));

  await waitFor(token.mintClear(signer.address, 2_000_000n));

  const latest = await hre.ethers.provider.getBlock("latest");

  await waitFor(
    userToken.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 86_400)),
  );

  const input = await encrypted64(await pool.getAddress(), signer, 2_000_000n);

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

  const thresholdHandle = await pool.thresholdHandle(slotIndex);

  const threshold = await hre.fhevm.publicDecrypt([thresholdHandle]);

  expect(asBoolean(threshold.clearValues[thresholdHandle])).to.equal(true);

  await waitFor(
    userPool.settleThreshold(slotIndex, 1n, reservationNonce, true, threshold.decryptionProof),
  );

  return reservationNonce;
}

async function createRound(pool: PoolV2): Promise<bigint> {
  const cutoff = await pool.activeEpochEnd();

  await setTimestamp(cutoff - 1n);

  await waitFor(pool.startSnapshot());

  const snapshotId = await pool.nextSnapshotId();

  const count = await pool.snapshotParticipantCount();

  expect(count).to.equal(2n);

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

  await waitFor(pool.startDraw());

  return snapshotId;
}

async function finalizeDrawOne(pool: PoolV2, snapshotId: bigint): Promise<void> {
  const drawId = 1n;

  await waitFor(pool.prepareDrawBucketEvidence(drawId, snapshotId));

  const bucket = await pool.drawBucketEvidenceHandles(drawId);

  const bucketClear = await hre.fhevm.publicDecrypt([...bucket]);

  const exponent = asBigInt(bucketClear.clearValues[bucket[0]]);

  const zero = asBoolean(bucketClear.clearValues[bucket[1]]);

  const supported = asBoolean(bucketClear.clearValues[bucket[2]]);

  expect(zero).to.equal(false);

  expect(supported).to.equal(true);

  await waitFor(
    pool.submitDrawBucketEvidence(
      drawId,
      snapshotId,
      exponent,
      zero,
      supported,
      bucketClear.decryptionProof,
    ),
  );

  expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_STATE.BUCKET_READY);

  let accepted = false;

  for (let attempt = 0; attempt < 32; attempt += 1) {
    await waitFor(pool.generateDrawCandidateBatch(drawId, snapshotId));

    let metadata = await pool.drawMetadata(drawId);

    const batchId = metadata[4];

    await waitFor(pool.reduceDrawCandidateBatch(drawId, snapshotId, batchId));

    const batch = await pool.drawBatchHandles(drawId);

    const batchClear = await hre.fhevm.publicDecrypt([batch[1], batch[2]]);

    const success = asBoolean(batchClear.clearValues[batch[1]]);

    await waitFor(
      pool.submitDrawBatchEvidence(
        drawId,
        snapshotId,
        batchId,
        success,
        batchClear.decryptionProof,
      ),
    );

    metadata = await pool.drawMetadata(drawId);

    if (success) {
      expect(metadata[0]).to.equal(DRAW_STATE.CANDIDATE_ACCEPTED);

      accepted = true;

      break;
    }

    expect(metadata[0]).to.equal(DRAW_STATE.AWAITING_CANDIDATE_BATCH);
  }

  if (!accepted) {
    throw new Error("draw 1 failed to accept a candidate within 32 batches");
  }

  await waitFor(pool.startWinnerResolution(drawId, snapshotId));

  for (let chunk = 0; chunk < 4; chunk += 1) {
    await waitFor(pool.processDrawShardSelectionChunk(drawId, snapshotId));
  }

  for (let shard = 0; shard < 16; shard += 1) {
    await waitFor(pool.processDrawWinnerShard(drawId, snapshotId));
  }

  await waitFor(pool.finalizeDraw(drawId, snapshotId));

  const finalized = await pool.drawMetadata(drawId);

  expect(finalized[0]).to.equal(DRAW_STATE.FINALIZED);

  expect(finalized[3]).to.equal(2n);

  expect(finalized[4]).to.be.greaterThan(0n);

  expect(finalized[6]).to.equal(2n);
}

async function sponsor(
  token: Token,
  reserve: PrizeReserve,
  signer: Signer,
  drawId: bigint,
  amount: bigint,
  nonce: bigint,
): Promise<ethers.TransactionReceipt> {
  await waitFor(token.mintClear(signer.address, amount));

  const userToken = token.connect(signer) as unknown as Token;

  const latest = await hre.ethers.provider.getBlock("latest");

  await waitFor(
    userToken.setOperator(await reserve.getAddress(), BigInt((latest?.timestamp ?? 0) + 3_600)),
  );

  const input = await encrypted64(await reserve.getAddress(), signer, amount);

  return waitFor(
    reserve
      .connect(signer)
      .fundSponsorForDraw(drawId, input.handle, input.proof, signer.address, nonce) as Tx,
  );
}

async function setupFinalizedDrawOne() {
  const setup = await deploySystem();

  const ownerNonce = await activate(setup.pool, setup.token, setup.owner, 0n);

  const otherNonce = await activate(setup.pool, setup.token, setup.other, 1n);

  const snapshotId = await createRound(setup.pool);

  await finalizeDrawOne(setup.pool, snapshotId);

  return {
    ...setup,
    snapshotId,
    ownerNonce,
    otherNonce,
  };
}

describe("VeilpotPrizeReserve unchanged source against real PoolV2", function () {
  this.timeout(240_000);

  it("satisfies the exact immutable Pool/Adapter/Reserve deployment cycle", async function () {
    const { token, pool, adapter, reserve, predictedPool, predictedAdapter, predictedReserve } =
      await deploySystem();

    expect(await pool.getAddress()).to.equal(predictedPool);

    expect(await adapter.getAddress()).to.equal(predictedAdapter);

    expect(await reserve.getAddress()).to.equal(predictedReserve);

    expect(await pool.prizeReserve()).to.equal(predictedReserve);

    expect(await reserve.pool()).to.equal(predictedPool);

    expect(await reserve.adapter()).to.equal(predictedAdapter);

    expect(await reserve.confidentialToken()).to.equal(await token.getAddress());

    expect(await adapter.pool()).to.equal(predictedPool);

    expect(await adapter.reserve()).to.equal(predictedReserve);

    expect(await adapter.confidentialToken()).to.equal(await token.getAddress());

    expect(await adapter.drawYieldHandles(1n)).to.equal(4n);
  });

  it("assigns the exact encrypted prize to the real private winner and encrypted zero to the non-winner", async function () {
    const { owner, other, token, pool, engine, reserve, ownerNonce, otherNonce } =
      await setupFinalizedDrawOne();

    const sponsorReceipt = await sponsor(token, reserve, owner, 1n, 5_000n, 0n);

    reportCost("realReserveSponsorFunding", sponsorReceipt);

    let prize = await reserve.prizeHandles(1n);

    expect(prize[0]).to.equal(PRIZE_STATE.UNPREPARED);

    expect(await decrypt64(prize[2])).to.equal(5_000n);

    const prepareReceipt = await waitFor(reserve.preparePrize(1n));

    reportCost("realReservePreparePrize", prepareReceipt);

    prize = await reserve.prizeHandles(1n);

    expect(prize[0]).to.equal(PRIZE_STATE.STATUS_PROOF_PENDING);

    expect(prize[6]).to.equal(2n);

    const status = await hre.fhevm.publicDecrypt([prize[4], prize[5]]);

    const zeroPrize = asBoolean(status.clearValues[prize[4]]);

    expect(zeroPrize).to.equal(false);

    await waitFor(reserve.settlePrizeStatus(1n, prize[8], zeroPrize, status.decryptionProof));

    prize = await reserve.prizeHandles(1n);

    expect(prize[0]).to.equal(PRIZE_STATE.ASSIGNING);

    const assignmentReceipt = await waitFor(reserve.assignPrizeEntitlementChunk(1n, 0n));

    reportCost("realReservePoolEngineAssignment2", assignmentReceipt);

    prize = await reserve.prizeHandles(1n);

    expect(prize[0]).to.equal(PRIZE_STATE.CLAIMABLE);

    expect(prize[7]).to.equal(2n);

    const record0 = await reserve.prizeEntitlementRecord(1n, 0n);

    const record1 = await reserve.prizeEntitlementRecord(1n, 1n);

    expect(record0[0]).to.equal(true);

    expect(record1[0]).to.equal(true);

    expect(record0[1]).to.equal(true);

    expect(record1[1]).to.equal(true);

    expect(record0[2]).to.equal(owner.address);

    expect(record1[2]).to.equal(other.address);

    expect(record0[3]).to.equal(1n);

    expect(record1[3]).to.equal(1n);

    expect(record0[4]).to.equal(ownerNonce);

    expect(record1[4]).to.equal(otherNonce);

    const winner0 = await hre.fhevm.debugger.decryptEbool(
      await engine.drawWinnerPredicateHandle(1n, 0n),
    );

    const winner1 = await hre.fhevm.debugger.decryptEbool(
      await engine.drawWinnerPredicateHandle(1n, 1n),
    );

    expect(Number(winner0) + Number(winner1)).to.equal(1);

    const entitlement0 = await decrypt64(record0[5]);

    const entitlement1 = await decrypt64(record1[5]);

    expect(entitlement0).to.equal(winner0 ? 5_000n : 0n);

    expect(entitlement1).to.equal(winner1 ? 5_000n : 0n);

    expect(entitlement0 + entitlement1).to.equal(5_000n);

    await expectRejected(() => hre.fhevm.publicDecrypt([record0[5]]));

    await expectRejected(() => hre.fhevm.publicDecrypt([record1[5]]));

    expect(await decrypt128(await reserve.prizeAssignmentTotalHandle(1n))).to.equal(5_000n);

    const accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(5_000n);

    expect(await decrypt128(accounting[1])).to.equal(5_000n);

    // Pool consequence is reachable only through the canonical Reserve.
    expect(await pool.prizeReserve()).to.equal(await reserve.getAddress());
  });

  it("fails closed for an unfinished sibling draw and freezes funding once prize preparation starts", async function () {
    const { owner, token, pool, reserve } = await setupFinalizedDrawOne();

    // Draw 2 exists, but remains at BUCKET_DISCOVERY.
    expect((await pool.drawMetadata(2n))[0]).to.equal(DRAW_STATE.BUCKET_DISCOVERY);

    const unfinishedInput = await encrypted64(await reserve.getAddress(), owner, 100n);

    await expect(
      reserve
        .connect(owner)
        .fundSponsorForDraw(2n, unfinishedInput.handle, unfinishedInput.proof, owner.address, 0n),
    ).to.be.revertedWithCustomError(reserve, "DrawNotFinalized");

    await sponsor(token, reserve, owner, 1n, 1_000n, 0n);

    await waitFor(reserve.preparePrize(1n));

    const frozenInput = await encrypted64(await reserve.getAddress(), owner, 1n);

    await expect(
      reserve
        .connect(owner)
        .fundSponsorForDraw(1n, frozenInput.handle, frozenInput.proof, owner.address, 1n),
    ).to.be.revertedWithCustomError(reserve, "PrizeFundingFrozen");

    expect(await reserve.nextSponsorFundingNonce(owner.address)).to.equal(1n);
  });
});
