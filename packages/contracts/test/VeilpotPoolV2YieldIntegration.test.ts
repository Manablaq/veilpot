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

  recognizeRoundYield(snapshotId: bigint): Tx;
}

interface YieldAdapterV2 extends ethers.BaseContract {
  confidentialToken(): Promise<string>;
  pool(): Promise<string>;
  reserve(): Promise<string>;

  fundYieldLiquidity(amount: Handle, proof: string, funder: string, fundingNonce: bigint): Tx;

  drawYieldHandles(
    drawId: bigint,
  ): Promise<readonly [bigint, Handle, Handle, Handle, Handle, Handle, bigint]>;

  settleRecognition(drawId: bigint, clearZeroYield: boolean, proof: string): Tx;

  sweepYield(drawId: bigint): Tx;

  settleSweepCompletion(
    drawId: bigint,
    attemptNonce: bigint,
    clearComplete: boolean,
    proof: string,
  ): Tx;

  liquidityHandles(): Promise<readonly [Handle, Handle]>;

  roundDrawIds(snapshotId: bigint): Promise<readonly [bigint, bigint, bigint]>;

  roundRecognized(snapshotId: bigint): Promise<boolean>;
}

interface Reserve extends ethers.BaseContract {
  pool(): Promise<string>;
  adapter(): Promise<string>;
  confidentialToken(): Promise<string>;

  prizeHandles(
    drawId: bigint,
  ): Promise<
    readonly [bigint, Handle, Handle, Handle, Handle, Handle, bigint, bigint, bigint, bigint]
  >;

  preparePrize(drawId: bigint): Tx;

  settlePrizeStatus(
    drawId: bigint,
    statusAttemptNonce: bigint,
    clearZeroPrize: boolean,
    proof: string,
  ): Tx;

  assignPrizeEntitlementChunk(drawId: bigint, expectedCursor: bigint): Tx;

  prizeEntitlementRecord(
    drawId: bigint,
    slotIndex: bigint,
  ): Promise<readonly [boolean, boolean, string, bigint, bigint, Handle]>;

  reserveAccountingHandles(): Promise<readonly [Handle, Handle]>;
}

const BOND = 1_000_000_000_000_000n;

const DRAW_FINALIZED = 8n;

const YIELD = {
  RECOGNITION_PROOF_PENDING: 1n,
  RECOGNIZED: 2n,
  SWEEP_PROOF_PENDING: 3n,
  FUNDING_FINALIZED: 4n,
} as const;

const PRIZE = {
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

async function decrypt64(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint64, handle);
}

async function decrypt128(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);
}

async function expectRejected(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    return;
  }

  throw new Error("expected operation to reject");
}

async function encrypted64(
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
      scope: "VEILPOT_POOL_YIELD_RESERVE_V2_LOCAL_ONLY",
      operation,
      globalHCU: hcu.globalHCU,
      sequentialHCU: hcu.maxHCUDepth,
      gas: receipt.gasUsed.toString(),
    })}\n`,
  );

  expect(hcu.globalHCU).to.be.at.most(20_000_000);
  expect(hcu.maxHCUDepth).to.be.at.most(5_000_000);
}

async function deployRealTopology() {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;

  const token = (await (
    await hre.ethers.getContractFactory("TestERC7984")
  ).deploy()) as unknown as Token;

  await token.waitForDeployment();

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
    predictedAdapter,
  )) as unknown as PoolV2;

  await pool.waitForDeployment();

  expect(await pool.getAddress()).to.equal(predictedPool);

  const adapter = (await (
    await hre.ethers.getContractFactory("VeilpotSimulatedYieldAdapterV2")
  ).deploy(await token.getAddress(), predictedPool, predictedReserve)) as unknown as YieldAdapterV2;

  await adapter.waitForDeployment();

  expect(await adapter.getAddress()).to.equal(predictedAdapter);

  const reserve = (await (
    await hre.ethers.getContractFactory("VeilpotPrizeReserve")
  ).deploy(predictedPool, predictedAdapter)) as unknown as Reserve;

  await reserve.waitForDeployment();

  expect(await reserve.getAddress()).to.equal(predictedReserve);

  await hre.fhevm.assertCoprocessorInitialized(token, "TestERC7984");

  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPoolV2");

  await hre.fhevm.assertCoprocessorInitialized(adapter, "VeilpotSimulatedYieldAdapterV2");

  await hre.fhevm.assertCoprocessorInitialized(reserve, "VeilpotPrizeReserve");

  expect(await pool.prizeReserve()).to.equal(predictedReserve);

  expect(await adapter.pool()).to.equal(predictedPool);
  expect(await adapter.reserve()).to.equal(predictedReserve);

  expect(await reserve.pool()).to.equal(predictedPool);
  expect(await reserve.adapter()).to.equal(predictedAdapter);

  expect(await adapter.confidentialToken()).to.equal(await token.getAddress());

  expect(await reserve.confidentialToken()).to.equal(await token.getAddress());

  return {
    owner,
    token,
    pool,
    adapter,
    reserve,
  };
}

async function activateSaver(pool: PoolV2, token: Token, signer: Signer): Promise<bigint> {
  const userPool = pool.connect(signer) as unknown as PoolV2;
  const userToken = token.connect(signer) as unknown as Token;

  await waitFor(
    userPool.reserveParticipantSlot({
      value: BOND,
    }),
  );

  const metadata = await pool.participantMetadata(0n);

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

  const thresholdHandle = await pool.thresholdHandle(0n);

  const threshold = await hre.fhevm.publicDecrypt([thresholdHandle]);

  expect(asBoolean(threshold.clearValues[thresholdHandle])).to.equal(true);

  await waitFor(
    userPool.settleThreshold(0n, 1n, reservationNonce, true, threshold.decryptionProof),
  );

  return reservationNonce;
}

async function createRound(pool: PoolV2): Promise<bigint> {
  const cutoff = await pool.activeEpochEnd();

  await setTimestamp(cutoff - 1n);

  await waitFor(pool.startSnapshot());

  const snapshotId = await pool.nextSnapshotId();

  const count = await pool.snapshotParticipantCount();

  expect(count).to.equal(1n);

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

  expect(await pool.snapshotDrawId(snapshotId)).to.equal(1n);

  expect(await pool.snapshotPrizeDrawId(snapshotId, 0n)).to.equal(1n);

  expect(await pool.snapshotPrizeDrawId(snapshotId, 1n)).to.equal(2n);

  expect(await pool.snapshotPrizeDrawId(snapshotId, 2n)).to.equal(3n);

  return snapshotId;
}

async function finalizeChild(pool: PoolV2, drawId: bigint, snapshotId: bigint): Promise<void> {
  await waitFor(pool.prepareDrawBucketEvidence(drawId, snapshotId));

  const bucket = await pool.drawBucketEvidenceHandles(drawId);

  const bucketProof = await hre.fhevm.publicDecrypt([...bucket]);

  const exponent = asBigInt(bucketProof.clearValues[bucket[0]]);

  const zero = asBoolean(bucketProof.clearValues[bucket[1]]);

  const supported = asBoolean(bucketProof.clearValues[bucket[2]]);

  expect(zero).to.equal(false);
  expect(supported).to.equal(true);

  await waitFor(
    pool.submitDrawBucketEvidence(
      drawId,
      snapshotId,
      exponent,
      zero,
      supported,
      bucketProof.decryptionProof,
    ),
  );

  let accepted = false;

  for (let attempt = 0; attempt < 32; attempt += 1) {
    await waitFor(pool.generateDrawCandidateBatch(drawId, snapshotId));

    const before = await pool.drawMetadata(drawId);

    const batchId = before[4];

    await waitFor(pool.reduceDrawCandidateBatch(drawId, snapshotId, batchId));

    const batch = await pool.drawBatchHandles(drawId);

    const proof = await hre.fhevm.publicDecrypt([batch[1], batch[2]]);

    const success = asBoolean(proof.clearValues[batch[1]]);

    await waitFor(
      pool.submitDrawBatchEvidence(drawId, snapshotId, batchId, success, proof.decryptionProof),
    );

    if (success) {
      accepted = true;
      break;
    }
  }

  if (!accepted) {
    throw new Error(`draw ${drawId.toString()} failed rejection sampling`);
  }

  await waitFor(pool.startWinnerResolution(drawId, snapshotId));

  for (let index = 0; index < 4; index += 1) {
    await waitFor(pool.processDrawShardSelectionChunk(drawId, snapshotId));
  }

  for (let index = 0; index < 16; index += 1) {
    await waitFor(pool.processDrawWinnerShard(drawId, snapshotId));
  }

  await waitFor(pool.finalizeDraw(drawId, snapshotId));

  expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_FINALIZED);
}

async function fundAdapter(
  token: Token,
  adapter: YieldAdapterV2,
  signer: Signer,
  amount: bigint,
): Promise<ethers.TransactionReceipt> {
  await waitFor(token.mintClear(signer.address, amount));

  const latest = await hre.ethers.provider.getBlock("latest");

  await waitFor(
    token
      .connect(signer)
      .setOperator(await adapter.getAddress(), BigInt((latest?.timestamp ?? 0) + 3_600)) as Tx,
  );

  const input = await encrypted64(await adapter.getAddress(), signer, amount);

  return waitFor(
    adapter.connect(signer).fundYieldLiquidity(input.handle, input.proof, signer.address, 0n) as Tx,
  );
}

async function settleAndSweep(adapter: YieldAdapterV2, drawId: bigint): Promise<void> {
  let handles = await adapter.drawYieldHandles(drawId);

  expect(handles[0]).to.equal(YIELD.RECOGNITION_PROOF_PENDING);

  const recognition = await hre.fhevm.publicDecrypt([handles[4], handles[5]]);

  const zero = asBoolean(recognition.clearValues[handles[4]]);

  expect(zero).to.equal(false);

  await waitFor(adapter.settleRecognition(drawId, false, recognition.decryptionProof));

  expect((await adapter.drawYieldHandles(drawId))[0]).to.equal(YIELD.RECOGNIZED);

  await waitFor(adapter.sweepYield(drawId));

  handles = await adapter.drawYieldHandles(drawId);

  expect(handles[0]).to.equal(YIELD.SWEEP_PROOF_PENDING);

  const sweep = await hre.fhevm.publicDecrypt([handles[4], handles[5]]);

  const complete = asBoolean(sweep.clearValues[handles[4]]);

  expect(complete).to.equal(true);

  await waitFor(adapter.settleSweepCompletion(drawId, handles[6], true, sweep.decryptionProof));

  expect((await adapter.drawYieldHandles(drawId))[0]).to.equal(YIELD.FUNDING_FINALIZED);
}

async function prepareAndAssign(
  reserve: Reserve,
  drawId: bigint,
  expectedPrize: bigint,
  expectedOwner: string,
  reservationNonce: bigint,
): Promise<void> {
  let prize = await reserve.prizeHandles(drawId);

  expect(prize[0]).to.equal(PRIZE.UNPREPARED);

  expect(await decrypt64(prize[1])).to.equal(expectedPrize);

  await waitFor(reserve.preparePrize(drawId));

  prize = await reserve.prizeHandles(drawId);

  expect(prize[0]).to.equal(PRIZE.STATUS_PROOF_PENDING);

  expect(prize[6]).to.equal(1n);

  const status = await hre.fhevm.publicDecrypt([prize[4], prize[5]]);

  const zeroPrize = asBoolean(status.clearValues[prize[4]]);

  expect(zeroPrize).to.equal(false);

  await waitFor(reserve.settlePrizeStatus(drawId, prize[8], false, status.decryptionProof));

  expect((await reserve.prizeHandles(drawId))[0]).to.equal(PRIZE.ASSIGNING);

  await waitFor(reserve.assignPrizeEntitlementChunk(drawId, 0n));

  expect((await reserve.prizeHandles(drawId))[0]).to.equal(PRIZE.CLAIMABLE);

  const record = await reserve.prizeEntitlementRecord(drawId, 0n);

  expect(record[0]).to.equal(true);
  expect(record[1]).to.equal(true);
  expect(record[2]).to.equal(expectedOwner);
  expect(record[3]).to.equal(1n);
  expect(record[4]).to.equal(reservationNonce);

  expect(await decrypt64(record[5])).to.equal(expectedPrize);

  await expectRejected(() => hre.fhevm.publicDecrypt([record[5]]));
}

describe("VeilpotPoolV2 real three-prize yield integration", function () {
  this.timeout(300_000);

  it("fails closed before all three children finalize, then conserves one round through the real unchanged Reserve", async function () {
    const { owner, token, pool, adapter, reserve } = await deployRealTopology();

    const reservationNonce = await activateSaver(pool, token, owner);

    const snapshotId = await createRound(pool);

    await finalizeChild(pool, 1n, snapshotId);

    await expect(pool.recognizeRoundYield(snapshotId)).to.be.reverted;

    expect(await adapter.roundRecognized(snapshotId)).to.equal(false);

    await finalizeChild(pool, 2n, snapshotId);

    await finalizeChild(pool, 3n, snapshotId);

    for (const drawId of [1n, 2n, 3n]) {
      expect((await pool.drawMetadata(drawId))[0]).to.equal(DRAW_FINALIZED);
    }

    const fundingReceipt = await fundAdapter(token, adapter, owner, 11n);

    reportCost("fundV2RoundLiquidity", fundingReceipt);

    const recognitionReceipt = await waitFor(pool.recognizeRoundYield(snapshotId));

    reportCost("poolRecognizeRoundYield3", recognitionReceipt);

    expect(await adapter.roundRecognized(snapshotId)).to.equal(true);

    expect(Array.from(await adapter.roundDrawIds(snapshotId))).to.deep.equal([1n, 2n, 3n]);

    const expected = [3n, 3n, 5n];

    for (let index = 0; index < 3; index += 1) {
      const drawId = BigInt(index + 1);

      const handles = await adapter.drawYieldHandles(drawId);

      expect(handles[0]).to.equal(YIELD.RECOGNITION_PROOF_PENDING);

      expect(await decrypt64(handles[2])).to.equal(expected[index]);

      await expectRejected(() => hre.fhevm.publicDecrypt([handles[2]]));
    }

    await expect(pool.recognizeRoundYield(snapshotId)).to.be.reverted;

    for (const drawId of [1n, 2n, 3n]) {
      await settleAndSweep(adapter, drawId);
    }

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(0n);

    expect(await decrypt64(liquidity[1])).to.equal(0n);

    for (let index = 0; index < 3; index += 1) {
      const drawId = BigInt(index + 1);

      const prize = await reserve.prizeHandles(drawId);

      expect(await decrypt64(prize[1])).to.equal(expected[index]);
    }

    for (let index = 0; index < 3; index += 1) {
      await prepareAndAssign(
        reserve,
        BigInt(index + 1),
        expected[index]!,
        owner.address,
        reservationNonce,
      );
    }

    const accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(11n);

    expect(await decrypt128(accounting[1])).to.equal(11n);
  });

  it("keeps PoolV2 inside its reviewed 23,500-byte runtime envelope after the real bridge", async function () {
    const poolArtifact = await hre.artifacts.readArtifact("VeilpotPoolV2");

    const adapterArtifact = await hre.artifacts.readArtifact("VeilpotSimulatedYieldAdapterV2");

    const poolRuntime = (poolArtifact.deployedBytecode.length - 2) / 2;

    const poolCreation = (poolArtifact.bytecode.length - 2) / 2;

    const adapterRuntime = (adapterArtifact.deployedBytecode.length - 2) / 2;

    const adapterCreation = (adapterArtifact.bytecode.length - 2) / 2;

    process.stdout.write(
      `${JSON.stringify({
        scope: "VEILPOT_POOL_YIELD_RESERVE_V2_SIZE",
        poolCreationBytes: poolCreation,
        poolRuntimeBytes: poolRuntime,
        poolReviewedHeadroomBytes: 23_500 - poolRuntime,
        poolEip170HeadroomBytes: 24_576 - poolRuntime,
        adapterCreationBytes: adapterCreation,
        adapterRuntimeBytes: adapterRuntime,
        adapterEip170HeadroomBytes: 24_576 - adapterRuntime,
      })}\n`,
    );

    expect(poolRuntime).to.be.at.most(23_500);

    expect(poolCreation).to.be.at.most(49_152);

    expect(adapterRuntime).to.be.at.most(24_576);

    expect(adapterCreation).to.be.at.most(49_152);
  });
});
