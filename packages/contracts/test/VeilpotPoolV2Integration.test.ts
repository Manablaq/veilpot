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

  snapshotWeightHandle(snapshotId: bigint, slot: bigint): Promise<Handle>;

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

  nextDrawId(): Promise<bigint>;

  nextDrawSnapshotId(): Promise<bigint>;

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
}

interface Engine extends ethers.BaseContract {
  pool(): Promise<string>;

  snapshotMetadata(snapshotId: bigint): Promise<readonly [bigint, bigint, boolean, boolean]>;

  snapshotWeightHandle(snapshotId: bigint, slot: bigint): Promise<Handle>;

  snapshotTotalHandle(snapshotId: bigint): Promise<Handle>;

  drawPrizeIndex(drawId: bigint): Promise<bigint>;

  drawProofContextValue(
    stage: bigint,
    drawId: bigint,
    batchId: bigint,
    attemptNonce: bigint,
  ): Promise<bigint>;
}

const BOND = 1_000_000_000_000_000n;

const PARTICIPANT_STATE = {
  ACTIVE: 3n,
} as const;

const DRAW_STATE = {
  BUCKET_DISCOVERY: 1n,
  BUCKET_READY: 2n,
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

async function decrypt128(handle: Handle): Promise<bigint> {
  const value = await hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);

  if (typeof value !== "bigint") {
    throw new TypeError("local debugger did not return euint128");
  }

  return value;
}

async function setTimestamp(timestamp: bigint): Promise<void> {
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await hre.network.provider.send("evm_mine");
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

function reportCost(operation: string, receipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);

  process.stdout.write(
    `${JSON.stringify({
      scope: "VEILPOT_POOL_V2_INTEGRATION_LOCAL_ONLY",
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

async function activate(
  pool: PoolV2,
  token: Token,
  signer: Signer,
  amount: bigint,
): Promise<bigint> {
  const userPool = pool.connect(signer) as unknown as PoolV2;
  const userToken = token.connect(signer) as unknown as Token;

  await waitFor(
    userPool.reserveParticipantSlot({
      value: BOND,
    }),
  );

  const metadata = await pool.participantMetadata(0n);

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

  const thresholdHandle = await pool.thresholdHandle(0n);

  const result = await hre.fhevm.publicDecrypt([thresholdHandle]);

  expect(asBoolean(result.clearValues[thresholdHandle])).to.equal(true);

  await waitFor(userPool.settleThreshold(0n, 1n, reservationNonce, true, result.decryptionProof));

  const activeMetadata = await pool.participantMetadata(0n);

  expect(asBigInt(activeMetadata[0])).to.equal(PARTICIPANT_STATE.ACTIVE);

  return reservationNonce;
}

async function finalizePoolSnapshot(pool: PoolV2): Promise<bigint> {
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

async function importSnapshotToEngine(
  pool: PoolV2,
  snapshotId: bigint,
  measure = false,
): Promise<void> {
  await waitFor(pool.beginDrawSnapshotImport(snapshotId));

  let metadata = await pool.drawSnapshotImportMetadata(snapshotId);

  let measured = false;

  while (metadata[1] < metadata[0]) {
    const receipt = await waitFor(pool.processDrawSnapshotImportChunk(snapshotId));

    if (measure && !measured) {
      reportCost("poolToEngineSnapshotShard8", receipt);
      measured = true;
    }

    metadata = await pool.drawSnapshotImportMetadata(snapshotId);
  }

  await waitFor(pool.finalizeDrawSnapshotImport(snapshotId));
}

describe("VeilpotPoolV2 custody-preserving Engine integration", function () {
  this.timeout(180_000);

  it("immutably binds its child Engine to the real PoolV2", async function () {
    const { pool, engine } = await fixture();

    expect(await engine.pool()).to.equal(await pool.getAddress());

    expect(await pool.veilDrawEngine()).to.equal(await engine.getAddress());
  });

  it("finalizes the Pool snapshot before Engine import, preserves beneficiary identity, and imports fresh encrypted derivatives", async function () {
    const { owner, token, pool, engine } = await fixture();

    const reservationNonce = await activate(pool, token, owner, 2_000_000n);

    const snapshotId = await finalizePoolSnapshot(pool);

    const beneficiary = await pool.snapshotBeneficiary(snapshotId, 0n);

    expect(beneficiary[0]).to.equal(owner.address);
    expect(beneficiary[1]).to.equal(1n);
    expect(beneficiary[2]).to.equal(reservationNonce);
    expect(beneficiary[3]).to.equal(true);

    const poolWeight = await pool.snapshotWeightHandle(snapshotId, 0n);

    await importSnapshotToEngine(pool, snapshotId, true);

    const engineMetadata = await engine.snapshotMetadata(snapshotId);

    expect(engineMetadata[2]).to.equal(true);
    expect(engineMetadata[3]).to.equal(true);
    expect(engineMetadata[1]).to.equal(engineMetadata[0]);

    const engineWeight = await engine.snapshotWeightHandle(snapshotId, 0n);

    expect(engineWeight).to.not.equal(poolWeight);

    expect(await decrypt128(engineWeight)).to.equal(await decrypt128(poolWeight));
  });

  it("preserves startDraw while atomically allocating three monotonic child draw IDs", async function () {
    const { owner, token, pool, engine } = await fixture();

    await activate(pool, token, owner, 2_000_000n);

    const snapshotId = await finalizePoolSnapshot(pool);

    // A finalized Pool snapshot alone is not enough.
    // Engine import must also have been explicitly completed.
    await expect(pool.startDraw()).to.be.reverted;

    await importSnapshotToEngine(pool, snapshotId);

    await waitFor(pool.startDraw());

    expect(await pool.nextDrawId()).to.equal(3n);
    expect(await pool.nextDrawSnapshotId()).to.equal(2n);

    expect(await pool.snapshotDrawId(snapshotId)).to.equal(1n);

    expect(await pool.snapshotPrizeDrawId(snapshotId, 0n)).to.equal(1n);
    expect(await pool.snapshotPrizeDrawId(snapshotId, 1n)).to.equal(2n);
    expect(await pool.snapshotPrizeDrawId(snapshotId, 2n)).to.equal(3n);

    for (let drawId = 1n; drawId <= 3n; drawId += 1n) {
      const metadata = await pool.drawMetadata(drawId);

      expect(metadata).to.have.length(7);

      expect(metadata[0]).to.equal(DRAW_STATE.BUCKET_DISCOVERY);
      expect(metadata[1]).to.equal(snapshotId);

      expect(await engine.drawPrizeIndex(drawId)).to.equal(drawId - 1n);
    }
  });

  it("proxies Engine bucket evidence with exact V2 proof binding while preserving the seven-field Pool ABI", async function () {
    const { owner, token, pool, engine } = await fixture();

    await activate(pool, token, owner, 2_000_000n);

    const snapshotId = await finalizePoolSnapshot(pool);

    await importSnapshotToEngine(pool, snapshotId);

    await waitFor(pool.startDraw());

    await waitFor(pool.prepareDrawBucketEvidence(1n, snapshotId));

    const handles = await pool.drawBucketEvidenceHandles(1n);

    const result = await hre.fhevm.publicDecrypt([...handles]);

    const exponent = asBigInt(result.clearValues[handles[0]]);
    const zero = asBoolean(result.clearValues[handles[1]]);
    const supported = asBoolean(result.clearValues[handles[2]]);
    const context = asBigInt(result.clearValues[handles[3]]);

    expect(zero).to.equal(false);
    expect(supported).to.equal(true);

    expect(context).to.equal(await engine.drawProofContextValue(1n, 1n, 0n, 1n));

    await waitFor(
      pool.submitDrawBucketEvidence(
        1n,
        snapshotId,
        exponent,
        zero,
        supported,
        result.decryptionProof,
      ),
    );

    const metadata = await pool.drawMetadata(1n);

    expect(metadata).to.have.length(7);
    expect(metadata[0]).to.equal(DRAW_STATE.BUCKET_READY);
    expect(metadata[1]).to.equal(snapshotId);
    expect(metadata[4]).to.equal(0n);
    expect(metadata[5]).to.equal(exponent);
    expect(metadata[6]).to.equal(0n);
  });

  it("keeps the slim PoolV2 and Engine inside the reviewed and Ethereum bytecode envelopes", async function () {
    const poolArtifact = await hre.artifacts.readArtifact("VeilpotPoolV2");

    const engineArtifact = await hre.artifacts.readArtifact("VeilDrawEngineV2");

    const poolRuntime = (poolArtifact.deployedBytecode.length - 2) / 2;
    const poolCreation = (poolArtifact.bytecode.length - 2) / 2;

    const engineRuntime = (engineArtifact.deployedBytecode.length - 2) / 2;
    const engineCreation = (engineArtifact.bytecode.length - 2) / 2;

    process.stdout.write(
      `${JSON.stringify({
        scope: "VEILPOT_POOL_V2_BUILD_GUARD",
        poolCreationBytes: poolCreation,
        poolRuntimeBytes: poolRuntime,
        poolReviewedBudgetBytes: 23_500,
        poolReviewedHeadroomBytes: 23_500 - poolRuntime,
        poolEip170HeadroomBytes: 24_576 - poolRuntime,
        engineCreationBytes: engineCreation,
        engineRuntimeBytes: engineRuntime,
        engineEip170HeadroomBytes: 24_576 - engineRuntime,
        eip170RuntimeLimitBytes: 24_576,
        eip3860InitcodeLimitBytes: 49_152,
      })}\n`,
    );

    expect(poolRuntime).to.be.at.most(23_500);
    expect(poolCreation).to.be.at.most(49_152);

    expect(engineRuntime).to.be.at.most(24_576);
    expect(engineCreation).to.be.at.most(49_152);
  });
});
