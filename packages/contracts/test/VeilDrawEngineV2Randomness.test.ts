import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Tx = Promise<ethers.ContractTransactionResponse>;
type Signer = Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

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
}

interface Engine extends ethers.BaseContract {
  nextDrawId(): Promise<bigint>;
  nextDrawSnapshotId(): Promise<bigint>;

  snapshotDrawId(snapshotId: bigint): Promise<bigint>;

  snapshotPrizeDrawId(snapshotId: bigint, prizeIndex: bigint): Promise<bigint>;

  drawPrizeIndex(drawId: bigint): Promise<bigint>;

  drawMetadataV2(
    drawId: bigint,
  ): Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>;

  drawTotalHandle(drawId: bigint): Promise<Handle>;

  drawBucketEvidenceHandles(drawId: bigint): Promise<readonly [Handle, Handle, Handle, Handle]>;

  drawCandidateHandle(drawId: bigint, index: bigint): Promise<Handle>;

  drawBatchHandles(drawId: bigint): Promise<readonly [Handle, Handle, Handle]>;

  drawAcceptedTargetHandle(drawId: bigint): Promise<Handle>;

  drawProofContextValue(
    stage: bigint,
    drawId: bigint,
    batchId: bigint,
    attemptNonce: bigint,
  ): Promise<bigint>;

  DRAW_BATCH_SIZE(): Promise<bigint>;
  MAX_DRAW_BUCKET_EXPONENT(): Promise<bigint>;
  MAX_DRAW_TOTAL(): Promise<bigint>;
  PRIZE_SLOTS(): Promise<bigint>;
}

async function waitFor(tx: Tx): Promise<ethers.TransactionReceipt> {
  const receipt = await (await tx).wait();

  if (receipt === null) {
    throw new Error("missing transaction receipt");
  }

  return receipt;
}

function reportLocalCost(operation: string, receipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);

  process.stdout.write(
    `${JSON.stringify({
      scope: "VEILDRAW_V2_RNG_LOCAL_ONLY",
      operation,
      globalHCU: hcu.globalHCU,
      sequentialHCU: hcu.maxHCUDepth,
      gas: receipt.gasUsed.toString(),
    })}\n`,
  );

  expect(hcu.globalHCU, `${operation} exceeded reviewed global HCU`).to.be.at.most(
    REVIEWED_GLOBAL_HCU_LIMIT,
  );

  expect(hcu.maxHCUDepth, `${operation} exceeded reviewed sequential HCU`).to.be.at.most(
    REVIEWED_SEQUENTIAL_HCU_LIMIT,
  );
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

  const other = signers[1]!;

  const host = (await (
    await hre.ethers.getContractFactory("TestVeilDrawEngineV2Host")
  ).deploy()) as unknown as Host;

  await host.waitForDeployment();

  const engineAddress = await host.engine();

  const engine = (await hre.ethers.getContractAt(
    "VeilDrawEngineV2",
    engineAddress,
  )) as unknown as Engine;

  await hre.fhevm.assertCoprocessorInitialized(host, "TestVeilDrawEngineV2Host");

  await hre.fhevm.assertCoprocessorInitialized(engine, "VeilDrawEngineV2");

  return {
    alice,
    other,
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
  snapshotId: bigint,
  weights: readonly bigint[],
): Promise<void> {
  for (let index = 0; index < weights.length; index += 1) {
    await setWeight(host, signer, index, weights[index]!);
  }

  await waitFor(host.beginSnapshotImport(snapshotId, BigInt(weights.length)));

  for (let start = 0; start < weights.length; start += 8) {
    await waitFor(host.syncSnapshotChunk(snapshotId, BigInt(start), BigInt(weights.length)));
  }

  await waitFor(host.sealSnapshotImport(snapshotId));
}

async function importZeroSnapshot(host: Host, snapshotId: bigint): Promise<void> {
  await waitFor(host.beginSnapshotImport(snapshotId, 0n));

  await waitFor(host.sealSnapshotImport(snapshotId));
}

async function decryptBucket(engine: Engine, drawId: bigint) {
  const handles = await engine.drawBucketEvidenceHandles(drawId);

  const result = await hre.fhevm.publicDecrypt([...handles]);

  return {
    exponent: asBigInt(result.clearValues[handles[0]]),
    zero: asBoolean(result.clearValues[handles[1]]),
    supported: asBoolean(result.clearValues[handles[2]]),
    context: asBigInt(result.clearValues[handles[3]]),
    proof: result.decryptionProof,
  };
}

async function preparePositiveDraw(
  host: Host,
  engine: Engine,
  drawId: bigint,
  snapshotId: bigint,
  measure = false,
) {
  const receipt = await waitFor(host.prepareDrawBucketEvidence(drawId, snapshotId));

  if (measure) {
    reportLocalCost("drawBucketComputation", receipt);
  }

  const bucket = await decryptBucket(engine, drawId);

  expect(bucket.zero).to.equal(false);

  expect(bucket.supported).to.equal(true);

  await waitFor(
    host.submitDrawBucketEvidence(drawId, snapshotId, bucket.exponent, false, true, bucket.proof),
  );

  expect((await engine.drawMetadataV2(drawId))[0]).to.equal(DRAW_STATE.BUCKET_READY);

  return bucket;
}

async function acceptCandidate(
  host: Host,
  engine: Engine,
  drawId: bigint,
  snapshotId: bigint,
  measure = false,
): Promise<void> {
  const metadataBefore = await engine.drawMetadataV2(drawId);

  const bucketExponent = metadataBefore[4];

  const bound = 1n << bucketExponent;

  // This helper is intentionally used with the [5, 3] snapshot only.
  // Its encrypted total is 8 and its minimal power-of-two bucket is 8,
  // so every bounded Zama PRNG candidate is necessarily valid.
  expect(bound).to.equal(8n);

  const drawTotalHandle = await engine.drawTotalHandle(drawId);

  const snapshotTotalHandle = (await engine
    .getFunction("snapshotTotalHandle")
    .staticCall(snapshotId)) as Handle;

  // A child draw consumes the exact immutable encrypted snapshot total.
  expect(drawTotalHandle).to.equal(snapshotTotalHandle);

  const generation = await waitFor(host.generateDrawCandidateBatch(drawId, snapshotId));

  if (measure) {
    reportLocalCost("candidateBatchM8", generation);
  }

  const metadata = await engine.drawMetadataV2(drawId);

  const batchId = metadata[3];

  expect(metadata[0]).to.equal(DRAW_STATE.BATCH_REDUCTION_PENDING);

  // Confidential PRNG outputs must never be publicly decryptable.
  for (let index = 0; index < 8; index += 1) {
    const candidate = await engine.drawCandidateHandle(drawId, BigInt(index));

    await expectRejected(() => hre.fhevm.publicDecrypt([candidate]));
  }

  await expect(host.generateDrawCandidateBatch(drawId, snapshotId)).to.be.reverted;

  const reduction = await waitFor(host.reduceDrawCandidateBatch(drawId, snapshotId, batchId));

  if (measure) {
    reportLocalCost("candidateBalancedReductionM8", reduction);
  }

  const batch = await engine.drawBatchHandles(drawId);

  // The selected target remains confidential.
  await expectRejected(() => hre.fhevm.publicDecrypt([batch[0]]));

  // Only aggregate success + its exact V2 proof context are public.
  const publicResult = await hre.fhevm.publicDecrypt([batch[1], batch[2]]);

  const success = asBoolean(publicResult.clearValues[batch[1]]);

  const clearContext = asBigInt(publicResult.clearValues[batch[2]]);

  expect(clearContext).to.equal(await engine.drawProofContextValue(2n, drawId, batchId, batchId));

  // total == bucket bound == 8, therefore every bounded candidate is valid.
  expect(success).to.equal(true);

  await waitFor(
    host.submitDrawBatchEvidence(drawId, snapshotId, batchId, true, publicResult.decryptionProof),
  );

  expect((await engine.drawMetadataV2(drawId))[0]).to.equal(DRAW_STATE.CANDIDATE_ACCEPTED);

  const acceptedTarget = await engine.drawAcceptedTargetHandle(drawId);

  // Acceptance must not reveal the actual winning target.
  await expectRejected(() => hre.fhevm.publicDecrypt([acceptedTarget]));

  await expect(host.generateDrawCandidateBatch(drawId, snapshotId)).to.be.reverted;
}

describe("VeilDrawEngineV2 three-prize Zama-native randomness", function () {
  this.timeout(180_000);

  it("allocates exactly three monotonic child draw IDs per sealed snapshot", async function () {
    const { alice, host, engine } = await fixture();

    await importSnapshot(host, alice, 1n, [5n, 3n]);

    await waitFor(host.startDrawRound(1n));

    expect(await engine.PRIZE_SLOTS()).to.equal(3n);

    expect(await engine.nextDrawId()).to.equal(3n);

    expect(await engine.nextDrawSnapshotId()).to.equal(2n);

    expect(await engine.snapshotDrawId(1n)).to.equal(1n);

    for (let index = 0; index < 3; index += 1) {
      const drawId = BigInt(index + 1);

      expect(await engine.snapshotPrizeDrawId(1n, BigInt(index))).to.equal(drawId);

      expect(await engine.drawPrizeIndex(drawId)).to.equal(BigInt(index));

      const metadata = await engine.drawMetadataV2(drawId);

      expect(metadata[0]).to.equal(DRAW_STATE.BUCKET_DISCOVERY);

      expect(metadata[1]).to.equal(1n);

      expect(metadata[2]).to.equal(2n);
    }

    await expect(host.startDrawRound(1n)).to.be.reverted;

    await importSnapshot(host, alice, 2n, [1n]);

    await waitFor(host.startDrawRound(2n));

    expect(await engine.nextDrawId()).to.equal(6n);

    expect(await engine.snapshotPrizeDrawId(2n, 0n)).to.equal(4n);

    expect(await engine.snapshotPrizeDrawId(2n, 1n)).to.equal(5n);

    expect(await engine.snapshotPrizeDrawId(2n, 2n)).to.equal(6n);
  });

  it("domain-separates bucket evidence across all three prize slots and rejects cross-prize proof replay", async function () {
    const { alice, host, engine } = await fixture();

    await importSnapshot(host, alice, 1n, [5n, 3n]);

    await waitFor(host.startDrawRound(1n));

    const buckets = [];

    for (let drawId = 1n; drawId <= 3n; drawId += 1n) {
      await waitFor(host.prepareDrawBucketEvidence(drawId, 1n));

      const bucket = await decryptBucket(engine, drawId);

      expect(bucket.exponent).to.equal(3n);

      expect(bucket.zero).to.equal(false);

      expect(bucket.supported).to.equal(true);

      const expectedContext = await engine.drawProofContextValue(1n, drawId, 0n, 1n);

      expect(bucket.context).to.equal(expectedContext);

      buckets.push(bucket);
    }

    expect(new Set(buckets.map((bucket) => bucket.context.toString())).size).to.equal(3);

    await expect(
      host.submitDrawBucketEvidence(
        1n,
        1n,
        buckets[1]!.exponent,
        buckets[1]!.zero,
        buckets[1]!.supported,
        buckets[1]!.proof,
      ),
    ).to.be.reverted;

    for (let index = 0; index < 3; index += 1) {
      const bucket = buckets[index]!;

      await waitFor(
        host.submitDrawBucketEvidence(
          BigInt(index + 1),
          1n,
          bucket.exponent,
          bucket.zero,
          bucket.supported,
          bucket.proof,
        ),
      );
    }

    for (let drawId = 1n; drawId <= 3n; drawId += 1n) {
      expect((await engine.drawMetadataV2(drawId))[0]).to.equal(DRAW_STATE.BUCKET_READY);
    }
  });

  it("terminates every zero-total child before any RNG call", async function () {
    const { host, engine } = await fixture();

    await importZeroSnapshot(host, 1n);

    await waitFor(host.startDrawRound(1n));

    for (let drawId = 1n; drawId <= 3n; drawId += 1n) {
      await waitFor(host.prepareDrawBucketEvidence(drawId, 1n));

      const bucket = await decryptBucket(engine, drawId);

      expect(bucket.exponent).to.equal(0n);

      expect(bucket.zero).to.equal(true);

      expect(bucket.supported).to.equal(true);

      await waitFor(host.submitDrawBucketEvidence(drawId, 1n, 0n, true, true, bucket.proof));

      expect((await engine.drawMetadataV2(drawId))[0]).to.equal(DRAW_STATE.NO_WEIGHT_TERMINAL);

      await expect(host.generateDrawCandidateBatch(drawId, 1n)).to.be.reverted;
    }
  });

  it("uses fixed m=8 Zama PRNG and keeps candidates and accepted targets private", async function () {
    const { alice, host, engine } = await fixture();

    await importSnapshot(host, alice, 1n, [5n, 3n]);

    await waitFor(host.startDrawRound(1n));

    expect(await engine.DRAW_BATCH_SIZE()).to.equal(8n);

    expect(await engine.MAX_DRAW_BUCKET_EXPONENT()).to.equal(69n);

    expect(await engine.MAX_DRAW_TOTAL()).to.equal(1n << 69n);

    const generateFunction = engine.interface.getFunction("generateDrawCandidateBatch");

    expect(generateFunction?.inputs.map((input) => input.type)).to.deep.equal([
      "uint256",
      "uint256",
    ]);

    for (let drawId = 1n; drawId <= 3n; drawId += 1n) {
      await preparePositiveDraw(host, engine, drawId, 1n, drawId === 1n);
    }

    await acceptCandidate(host, engine, 1n, 1n, true);

    await acceptCandidate(host, engine, 2n, 1n);

    await acceptCandidate(host, engine, 3n, 1n);
  });

  it("rejects batch-proof replay across prize slots even when their public success booleans match", async function () {
    const { alice, host, engine } = await fixture();

    await importSnapshot(host, alice, 1n, [8n]);

    await waitFor(host.startDrawRound(1n));

    for (let drawId = 1n; drawId <= 2n; drawId += 1n) {
      await preparePositiveDraw(host, engine, drawId, 1n);

      await waitFor(host.generateDrawCandidateBatch(drawId, 1n));

      await waitFor(host.reduceDrawCandidateBatch(drawId, 1n, 1n));
    }

    const first = await engine.drawBatchHandles(1n);

    const second = await engine.drawBatchHandles(2n);

    const firstPublic = await hre.fhevm.publicDecrypt([first[1], first[2]]);

    const secondPublic = await hre.fhevm.publicDecrypt([second[1], second[2]]);

    const firstSuccess = asBoolean(firstPublic.clearValues[first[1]]);

    const secondSuccess = asBoolean(secondPublic.clearValues[second[1]]);

    expect(firstSuccess).to.equal(true);

    expect(secondSuccess).to.equal(true);

    expect(asBigInt(firstPublic.clearValues[first[2]])).to.not.equal(
      asBigInt(secondPublic.clearValues[second[2]]),
    );

    await expect(
      host.submitDrawBatchEvidence(1n, 1n, 1n, secondSuccess, secondPublic.decryptionProof),
    ).to.be.reverted;

    await waitFor(
      host.submitDrawBatchEvidence(1n, 1n, 1n, firstSuccess, firstPublic.decryptionProof),
    );

    await waitFor(
      host.submitDrawBatchEvidence(2n, 1n, 1n, secondSuccess, secondPublic.decryptionProof),
    );

    expect((await engine.drawMetadataV2(1n))[0]).to.equal(DRAW_STATE.CANDIDATE_ACCEPTED);

    expect((await engine.drawMetadataV2(2n))[0]).to.equal(DRAW_STATE.CANDIDATE_ACCEPTED);
  });

  it("binds V2 proof context to chain, Pool, Engine, snapshot, draw, prize, stage, batch, and attempt", async function () {
    const { alice, host, engine } = await fixture();

    await importSnapshot(host, alice, 1n, [5n, 3n]);

    await waitFor(host.startDrawRound(1n));

    const network = await hre.ethers.provider.getNetwork();

    for (let drawId = 1n; drawId <= 3n; drawId += 1n) {
      const prizeIndex = drawId - 1n;

      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "bytes32",
          "uint256",
          "address",
          "address",
          "uint256",
          "uint256",
          "uint8",
          "uint8",
          "uint256",
          "uint256",
        ],
        [
          ethers.encodeBytes32String("VEILPOT_DRAW_PROOF_V2"),
          network.chainId,
          await host.getAddress(),
          await engine.getAddress(),
          1n,
          drawId,
          prizeIndex,
          1,
          0n,
          1n,
        ],
      );

      const expected = BigInt(ethers.keccak256(encoded));

      expect(await engine.drawProofContextValue(1n, drawId, 0n, 1n)).to.equal(expected);
    }
  });
});
