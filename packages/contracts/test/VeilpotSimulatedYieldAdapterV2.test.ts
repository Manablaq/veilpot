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

interface PartialToken extends Token {
  setPartialCap(cap: bigint): Tx;
}

interface PoolHarness extends ethers.BaseContract {
  recognizeRound(
    adapter: string,
    snapshotId: bigint,
    drawIds: readonly [bigint, bigint, bigint],
    rawTotalTwab: Handle,
    proof: string,
  ): Tx;

  recognizeRoundWithoutGrant(
    adapter: string,
    snapshotId: bigint,
    drawIds: readonly [bigint, bigint, bigint],
    rawTotalTwab: Handle,
    proof: string,
  ): Tx;
}

interface ReserveHarness extends ethers.BaseContract {
  receivedHandle(drawId: bigint): Promise<Handle>;
}

interface Adapter extends ethers.BaseContract {
  fundYieldLiquidity(amount: Handle, proof: string, funder: string, fundingNonce: bigint): Tx;

  settleRecognition(drawId: bigint, clearZeroYield: boolean, proof: string): Tx;

  sweepYield(drawId: bigint): Tx;

  settleSweepCompletion(
    drawId: bigint,
    sweepAttemptNonce: bigint,
    clearComplete: boolean,
    proof: string,
  ): Tx;

  drawYieldHandles(
    drawId: bigint,
  ): Promise<readonly [bigint, Handle, Handle, Handle, Handle, Handle, bigint]>;

  drawRoundMetadata(drawId: bigint): Promise<readonly [bigint, bigint]>;

  roundDrawIds(snapshotId: bigint): Promise<readonly [bigint, bigint, bigint]>;

  roundRecognized(snapshotId: bigint): Promise<boolean>;

  liquidityHandles(): Promise<readonly [Handle, Handle]>;
}

const YIELD_DENOMINATOR = 10_000n * 86_400n;

const STATE = {
  RECOGNITION_PROOF_PENDING: 1n,
  RECOGNIZED: 2n,
  SWEEP_PROOF_PENDING: 3n,
  FUNDING_FINALIZED: 4n,
} as const;

async function waitFor(tx: Tx): Promise<ethers.TransactionReceipt> {
  const receipt = await (await tx).wait();

  if (receipt === null) {
    throw new Error("missing transaction receipt");
  }

  return receipt;
}

async function encrypt64(
  contractAddress: string,
  signer: Signer,
  value: bigint,
): Promise<{ handle: Handle; proof: string }> {
  const input = hre.fhevm.createEncryptedInput(contractAddress, signer.address);

  input.add64(value);

  const encrypted = await input.encrypt();

  return {
    handle: ethers.hexlify(encrypted.handles[0]!) as Handle,
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

async function encrypt128(
  contractAddress: string,
  signer: Signer,
  value: bigint,
): Promise<{ handle: Handle; proof: string }> {
  const input = hre.fhevm.createEncryptedInput(contractAddress, signer.address);

  input.add128(value);

  const encrypted = await input.encrypt();

  return {
    handle: ethers.hexlify(encrypted.handles[0]!) as Handle,
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

async function decrypt64(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint64, handle);
}

async function publicStage(
  statusHandle: Handle,
  contextHandle: Handle,
): Promise<{
  clear: boolean;
  context: bigint;
  proof: string;
}> {
  const result = await hre.fhevm.publicDecrypt([statusHandle, contextHandle]);

  const clear = result.clearValues[statusHandle];
  const context = result.clearValues[contextHandle];

  if (typeof clear !== "boolean") {
    throw new TypeError("expected public boolean");
  }

  if (typeof context !== "bigint") {
    throw new TypeError("expected public context");
  }

  return {
    clear,
    context,
    proof: result.decryptionProof,
  };
}

async function expectRejected(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    return;
  }

  throw new Error("expected operation to reject");
}

function reportCost(operation: string, receipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);

  process.stdout.write(
    `${JSON.stringify({
      scope: "VEILPOT_YIELD_V2_LOCAL_ONLY",
      operation,
      globalHCU: hcu.globalHCU,
      sequentialHCU: hcu.maxHCUDepth,
      gas: receipt.gasUsed.toString(),
    })}\n`,
  );

  expect(hcu.globalHCU).to.be.at.most(20_000_000);
  expect(hcu.maxHCUDepth).to.be.at.most(5_000_000);
}

async function fixture(
  tokenName:
    | "TestERC7984"
    | "TestERC7984PartialReturn"
    | "TestERC7984NoReturnAcl"
    | "TestERC7984DirectNoReturnAcl" = "TestERC7984",
  tokenArgs: readonly bigint[] = [],
) {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;

  const token = (await (
    await hre.ethers.getContractFactory(tokenName)
  ).deploy(...tokenArgs)) as unknown as Token;

  await token.waitForDeployment();

  const pool = (await (
    await hre.ethers.getContractFactory("TestVeilpotYieldV2PoolHarness")
  ).deploy()) as unknown as PoolHarness;

  await pool.waitForDeployment();

  const reserve = (await (
    await hre.ethers.getContractFactory("TestVeilpotYieldV2ReserveHarness")
  ).deploy()) as unknown as ReserveHarness;

  await reserve.waitForDeployment();

  const adapter = (await (
    await hre.ethers.getContractFactory("VeilpotSimulatedYieldAdapterV2")
  ).deploy(
    await token.getAddress(),
    await pool.getAddress(),
    await reserve.getAddress(),
  )) as unknown as Adapter;

  await adapter.waitForDeployment();

  await hre.fhevm.assertCoprocessorInitialized(token, tokenName);

  await hre.fhevm.assertCoprocessorInitialized(pool, "TestVeilpotYieldV2PoolHarness");

  await hre.fhevm.assertCoprocessorInitialized(reserve, "TestVeilpotYieldV2ReserveHarness");

  await hre.fhevm.assertCoprocessorInitialized(adapter, "VeilpotSimulatedYieldAdapterV2");

  return {
    owner,
    token,
    pool,
    reserve,
    adapter,
  };
}

async function fund(
  token: Token,
  adapter: Adapter,
  owner: Signer,
  amount: bigint,
  nonce = 0n,
): Promise<ethers.TransactionReceipt> {
  await waitFor(token.mintClear(owner.address, amount));

  const latest = await hre.ethers.provider.getBlock("latest");

  await waitFor(
    token.setOperator(await adapter.getAddress(), BigInt((latest?.timestamp ?? 0) + 3_600)),
  );

  const input = await encrypt64(await adapter.getAddress(), owner, amount);

  return waitFor(adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, nonce));
}

async function recognize(
  pool: PoolHarness,
  adapter: Adapter,
  owner: Signer,
  snapshotId: bigint,
  drawIds: readonly [bigint, bigint, bigint],
  grossYield: bigint,
): Promise<ethers.TransactionReceipt> {
  const rawTwab = grossYield * YIELD_DENOMINATOR;

  const input = await encrypt128(await pool.getAddress(), owner, rawTwab);

  return waitFor(
    pool.recognizeRound(await adapter.getAddress(), snapshotId, drawIds, input.handle, input.proof),
  );
}

function splitThree(value: bigint): readonly [bigint, bigint, bigint] {
  const q = value / 3n;

  return [q, q, value - q - q];
}

async function settleRecognition(adapter: Adapter, drawId: bigint): Promise<boolean> {
  const handles = await adapter.drawYieldHandles(drawId);

  const stage = await publicStage(handles[4], handles[5]);

  await waitFor(adapter.settleRecognition(drawId, stage.clear, stage.proof));

  return stage.clear;
}

async function sweepAndSettle(
  adapter: Adapter,
  drawId: bigint,
): Promise<{
  complete: boolean;
  receipt: ethers.TransactionReceipt;
}> {
  const receipt = await waitFor(adapter.sweepYield(drawId));

  const handles = await adapter.drawYieldHandles(drawId);

  expect(handles[0]).to.equal(STATE.SWEEP_PROOF_PENDING);

  const stage = await publicStage(handles[4], handles[5]);

  await waitFor(adapter.settleSweepCompletion(drawId, handles[6], stage.clear, stage.proof));

  return {
    complete: stage.clear,
    receipt,
  };
}

describe("VeilpotSimulatedYieldAdapterV2 exact three-prize conservation", function () {
  this.timeout(180_000);

  it("conserves encrypted 0/1/2 and non-divisible values exactly across three child draws", async function () {
    const { owner, token, pool, adapter } = await fixture();

    await fund(token, adapter, owner, 100n);

    const values = [0n, 1n, 2n, 3n, 4n, 5n, 11n];

    let snapshotId = 1n;
    let firstDrawId = 1n;
    let totalRecognized = 0n;

    for (const value of values) {
      const drawIds = [firstDrawId, firstDrawId + 1n, firstDrawId + 2n] as const;

      await recognize(pool, adapter, owner, snapshotId, drawIds, value);

      expect(await adapter.roundRecognized(snapshotId)).to.equal(true);

      expect(Array.from(await adapter.roundDrawIds(snapshotId))).to.deep.equal(Array.from(drawIds));

      const expected = splitThree(value);
      let roundSum = 0n;

      for (let index = 0; index < 3; index += 1) {
        const handles = await adapter.drawYieldHandles(drawIds[index]!);

        expect(handles[0]).to.equal(STATE.RECOGNITION_PROOF_PENDING);

        const gross = await decrypt64(handles[1]);
        const recognized = await decrypt64(handles[2]);
        const residual = await decrypt64(handles[3]);

        expect(gross).to.equal(expected[index]);
        expect(recognized).to.equal(expected[index]);
        expect(residual).to.equal(expected[index]);

        roundSum += recognized;

        const metadata = await adapter.drawRoundMetadata(drawIds[index]!);

        expect(metadata[0]).to.equal(snapshotId);
        expect(metadata[1]).to.equal(BigInt(index));
      }

      expect(roundSum).to.equal(value);

      totalRecognized += value;

      snapshotId += 1n;
      firstDrawId += 3n;
    }

    expect(totalRecognized).to.equal(26n);

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(74n);
    expect(await decrypt64(liquidity[1])).to.equal(26n);

    const privateHandle = (await adapter.drawYieldHandles(21n))[2];

    await expectRejected(() => hre.fhevm.publicDecrypt([privateHandle]));
  });

  it("caps funded liquidity once before child splitting and sends indivisible residual only to prize 2", async function () {
    const { owner, token, pool, adapter } = await fixture();

    await fund(token, adapter, owner, 2n);

    await recognize(pool, adapter, owner, 1n, [1n, 2n, 3n], 8n);

    const gross: bigint[] = [];
    const recognized: bigint[] = [];

    for (const drawId of [1n, 2n, 3n]) {
      const handles = await adapter.drawYieldHandles(drawId);

      gross.push(await decrypt64(handles[1]));

      recognized.push(await decrypt64(handles[2]));
    }

    expect(gross).to.deep.equal([2n, 2n, 4n]);

    expect(recognized).to.deep.equal([0n, 0n, 2n]);

    expect(recognized.reduce((sum, value) => sum + value, 0n)).to.equal(2n);

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(0n);
    expect(await decrypt64(liquidity[1])).to.equal(2n);
  });

  it("domain-separates all three child recognition proofs and rejects cross-prize replay", async function () {
    const { owner, token, pool, adapter } = await fixture();

    await fund(token, adapter, owner, 5n);

    await recognize(pool, adapter, owner, 9n, [40n, 41n, 42n], 5n);

    const stages = [];

    for (const drawId of [40n, 41n, 42n]) {
      const handles = await adapter.drawYieldHandles(drawId);

      stages.push(await publicStage(handles[4], handles[5]));
    }

    expect(stages[0]!.clear).to.equal(false);
    expect(stages[1]!.clear).to.equal(false);
    expect(stages[2]!.clear).to.equal(false);

    expect(stages[0]!.context).to.not.equal(stages[1]!.context);

    expect(stages[1]!.context).to.not.equal(stages[2]!.context);

    await expect(adapter.settleRecognition(41n, false, stages[0]!.proof)).to.be.reverted;

    for (let index = 0; index < 3; index += 1) {
      await waitFor(adapter.settleRecognition(40n + BigInt(index), false, stages[index]!.proof));

      expect((await adapter.drawYieldHandles(40n + BigInt(index)))[0]).to.equal(STATE.RECOGNIZED);
    }
  });

  it("sweeps all three exact child allocations and conserves the complete round in reserve custody", async function () {
    const { owner, token, pool, reserve, adapter } = await fixture();

    const fundingReceipt = await fund(token, adapter, owner, 11n);

    reportCost("fundRoundLiquidity", fundingReceipt);

    const recognitionReceipt = await recognize(pool, adapter, owner, 1n, [1n, 2n, 3n], 11n);

    reportCost("recognizeAndSplitRound3", recognitionReceipt);

    for (const drawId of [1n, 2n, 3n]) {
      expect(await settleRecognition(adapter, drawId)).to.equal(false);

      const result = await sweepAndSettle(adapter, drawId);

      expect(result.complete).to.equal(true);

      if (drawId === 3n) {
        reportCost("sweepResidualPrize2", result.receipt);
      }

      expect((await adapter.drawYieldHandles(drawId))[0]).to.equal(STATE.FUNDING_FINALIZED);
    }

    const received: bigint[] = [];

    for (const drawId of [1n, 2n, 3n]) {
      received.push(await decrypt64(await reserve.receivedHandle(drawId)));
    }

    expect(received).to.deep.equal([3n, 3n, 5n]);

    expect(received.reduce((sum, value) => sum + value, 0n)).to.equal(11n);

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(0n);
    expect(await decrypt64(liquidity[1])).to.equal(0n);
  });

  it("preserves a child residual across repeated partial ERC-7984 actual transfers", async function () {
    const {
      owner,
      token: baseToken,
      pool,
      reserve,
      adapter,
    } = await fixture("TestERC7984PartialReturn", [100n]);

    const token = baseToken as unknown as PartialToken;

    await fund(token, adapter, owner, 11n);

    await recognize(pool, adapter, owner, 1n, [1n, 2n, 3n], 11n);

    expect(await settleRecognition(adapter, 3n)).to.equal(false);

    await waitFor(token.setPartialCap(2n));

    let result = await sweepAndSettle(adapter, 3n);

    expect(result.complete).to.equal(false);

    let handles = await adapter.drawYieldHandles(3n);

    expect(await decrypt64(handles[3])).to.equal(3n);

    let liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[1])).to.equal(9n);

    result = await sweepAndSettle(adapter, 3n);

    expect(result.complete).to.equal(false);

    handles = await adapter.drawYieldHandles(3n);

    expect(await decrypt64(handles[3])).to.equal(1n);

    liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[1])).to.equal(7n);

    result = await sweepAndSettle(adapter, 3n);

    expect(result.complete).to.equal(true);

    handles = await adapter.drawYieldHandles(3n);

    expect(handles[0]).to.equal(STATE.FUNDING_FINALIZED);

    expect(await decrypt64(handles[3])).to.equal(0n);

    expect(await decrypt64(await reserve.receivedHandle(3n))).to.equal(5n);

    liquidity = await adapter.liquidityHandles();

    // Draws 1 and 2 still retain their exact 3 + 3 commitments.
    expect(await decrypt64(liquidity[1])).to.equal(6n);
  });

  it("preserves the entire child residual when ERC-7984 reports zero actual transfer", async function () {
    const {
      owner,
      token: baseToken,
      pool,
      reserve,
      adapter,
    } = await fixture("TestERC7984PartialReturn", [100n]);

    const token = baseToken as unknown as PartialToken;

    await fund(token, adapter, owner, 5n);

    await recognize(pool, adapter, owner, 1n, [1n, 2n, 3n], 5n);

    expect(await settleRecognition(adapter, 3n)).to.equal(false);

    await waitFor(token.setPartialCap(0n));

    const result = await sweepAndSettle(adapter, 3n);

    expect(result.complete).to.equal(false);

    const handles = await adapter.drawYieldHandles(3n);

    expect(handles[0]).to.equal(STATE.RECOGNIZED);

    expect(await decrypt64(handles[3])).to.equal(3n);

    expect(await decrypt64(await reserve.receivedHandle(3n))).to.equal(0n);

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[1])).to.equal(5n);
  });

  it("fails closed on missing Pool ACL, round replay, malformed IDs, and child reuse", async function () {
    const { owner, token, pool, adapter } = await fixture();

    await fund(token, adapter, owner, 20n);

    const missingAcl = await encrypt128(await pool.getAddress(), owner, 3n * YIELD_DENOMINATOR);

    await expect(
      pool.recognizeRoundWithoutGrant(
        await adapter.getAddress(),
        1n,
        [1n, 2n, 3n],
        missingAcl.handle,
        missingAcl.proof,
      ),
    ).to.be.reverted;

    await recognize(pool, adapter, owner, 1n, [1n, 2n, 3n], 3n);

    const replay = await encrypt128(await pool.getAddress(), owner, 3n * YIELD_DENOMINATOR);

    await expect(
      pool.recognizeRound(
        await adapter.getAddress(),
        1n,
        [4n, 5n, 6n],
        replay.handle,
        replay.proof,
      ),
    ).to.be.reverted;

    const malformed = await encrypt128(await pool.getAddress(), owner, 3n * YIELD_DENOMINATOR);

    await expect(
      pool.recognizeRound(
        await adapter.getAddress(),
        2n,
        [7n, 9n, 10n],
        malformed.handle,
        malformed.proof,
      ),
    ).to.be.reverted;

    const reuse = await encrypt128(await pool.getAddress(), owner, 3n * YIELD_DENOMINATOR);

    await expect(
      pool.recognizeRound(await adapter.getAddress(), 3n, [2n, 3n, 4n], reuse.handle, reuse.proof),
    ).to.be.reverted;
  });

  it("fails closed when ERC-7984 omits the actual-return ACL during funding or sweeping", async function () {
    {
      const { owner, token, adapter } = await fixture("TestERC7984NoReturnAcl");

      await waitFor(token.mintClear(owner.address, 10n));

      const latest = await hre.ethers.provider.getBlock("latest");

      await waitFor(
        token.setOperator(await adapter.getAddress(), BigInt((latest?.timestamp ?? 0) + 3_600)),
      );

      const input = await encrypt64(await adapter.getAddress(), owner, 10n);

      await expect(adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, 0n)).to.be
        .reverted;
    }

    {
      const { owner, token, pool, adapter } = await fixture("TestERC7984DirectNoReturnAcl");

      await fund(token, adapter, owner, 3n);

      await recognize(pool, adapter, owner, 1n, [1n, 2n, 3n], 3n);

      expect(await settleRecognition(adapter, 1n)).to.equal(false);

      const before = await adapter.drawYieldHandles(1n);

      expect(await decrypt64(before[3])).to.equal(1n);

      await expect(adapter.sweepYield(1n)).to.be.reverted;

      const after = await adapter.drawYieldHandles(1n);

      expect(after[0]).to.equal(STATE.RECOGNIZED);

      // The malformed token return reverts the whole transaction,
      // including its attempted token transfer.
      expect(await decrypt64(after[3])).to.equal(1n);
    }
  });

  it("remains independently deployable below Ethereum bytecode envelopes", async function () {
    const artifact = await hre.artifacts.readArtifact("VeilpotSimulatedYieldAdapterV2");

    const creationBytes = (artifact.bytecode.length - 2) / 2;

    const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;

    process.stdout.write(
      `${JSON.stringify({
        scope: "VEILPOT_YIELD_V2_BUILD_GUARD",
        creationBytes,
        runtimeBytes,
        eip170HeadroomBytes: 24_576 - runtimeBytes,
        eip3860HeadroomBytes: 49_152 - creationBytes,
      })}\n`,
    );

    expect(runtimeBytes).to.be.at.most(24_576);
    expect(creationBytes).to.be.at.most(49_152);
  });
});
