// Gate 1B.2 production withdrawal/TWAB/snapshot tests. Local FHEVM only.
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";
import { LazyEpochTwabModel } from "../../reference-model/dist/src/twab-design.js";

type Handle = `0x${string}`;
type Signer = Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

interface Token extends ethers.BaseContract {
  mintClear(to: string, amount: bigint): Promise<ethers.ContractTransactionResponse>;
  setOperator(operator: string, until: bigint): Promise<ethers.ContractTransactionResponse>;
  confidentialBalanceOf(account: string): Promise<Handle>;
}

interface PartialToken extends Token {
  setPartialCap(cap: bigint): Promise<ethers.ContractTransactionResponse>;
}

interface PausableToken extends Token {
  setPaused(value: boolean): Promise<ethers.ContractTransactionResponse>;
}

interface Pool extends ethers.BaseContract {
  reserveParticipantSlot(overrides: { value: bigint }): Promise<ethers.ContractTransactionResponse>;
  participantMetadata(slot: number): Promise<readonly unknown[]>;
  participantState(slot: number): Promise<bigint>;
  deposit(
    amount: Handle,
    proof: string,
    depositor: string,
    pool: string,
    version: bigint,
    reservationNonce: bigint,
    depositNonce: bigint,
  ): Promise<ethers.ContractTransactionResponse>;
  settleThreshold(
    slot: number,
    version: bigint,
    reservationNonce: bigint,
    result: boolean,
    proof: string,
  ): Promise<ethers.ContractTransactionResponse>;
  withdraw(
    amount: Handle,
    proof: string,
    version: bigint,
    reservationNonce: bigint,
    withdrawalNonce: bigint,
  ): Promise<ethers.ContractTransactionResponse>;
  principalHandle(slot: number): Promise<Handle>;
  thresholdHandle(slot: number): Promise<Handle>;
  aggregatePrincipalHandle(): Promise<Handle>;
  twabAccumulatorHandle(slot: number): Promise<Handle>;
  startSnapshot(): Promise<ethers.ContractTransactionResponse>;
  processSnapshotChunk(): Promise<ethers.ContractTransactionResponse>;
  finalizeSnapshot(): Promise<ethers.ContractTransactionResponse>;
  activeEpochEnd(): Promise<bigint>;
  activeEpochStart(): Promise<bigint>;
  currentSnapshotId(): Promise<bigint>;
  snapshotCutoffTimestamp(): Promise<bigint>;
  snapshotParticipantCount(): Promise<bigint>;
  snapshotCursor(): Promise<bigint>;
  snapshotReady(): Promise<boolean>;
  snapshotTotalHandle(id: bigint): Promise<Handle>;
  snapshotWeightHandle(id: bigint, slot: number): Promise<Handle>;
  twabMetadata(slot: number): Promise<readonly unknown[]>;
  nextWithdrawNonce(owner: string): Promise<bigint>;
}

async function waitFor(
  tx: Promise<ethers.ContractTransactionResponse>,
): Promise<ethers.TransactionReceipt> {
  const receipt = await (await tx).wait();
  if (receipt === null) throw new Error("missing receipt");
  return receipt;
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

async function decrypt64(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint64, handle);
}

async function decrypt128(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);
}

function reportLocalCost(operation: string, receipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);
  console.log(
    JSON.stringify({
      scope: "GATE_1B.2_PRODUCTION_LOCAL_ONLY",
      operation,
      localGlobalHCU: hcu.globalHCU,
      localSequentialHCU: hcu.maxHCUDepth,
      localEvmGasRunSpecific: receipt.gasUsed.toString(),
    }),
  );
}

async function publicBool(handle: Handle): Promise<{ value: boolean; proof: string }> {
  const result = await hre.fhevm.publicDecrypt([handle]);
  const value = result.clearValues[handle];
  if (typeof value !== "boolean") throw new Error("expected boolean");
  return { value, proof: result.decryptionProof };
}

async function setTimestamp(timestamp: bigint): Promise<void> {
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await hre.network.provider.send("evm_mine");
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
  return { owner, other, token, pool };
}

async function customFixture(factoryName: string, args: readonly unknown[] = []) {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;
  const other = signers[1]!;
  const token = (await (
    await hre.ethers.getContractFactory(factoryName)
  ).deploy(...args)) as unknown as Token;
  await token.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(token, factoryName);
  const pool = (await (
    await hre.ethers.getContractFactory("VeilpotPool")
  ).deploy(await token.getAddress())) as unknown as Pool;
  await pool.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPool");
  return { owner, other, token, pool };
}

async function activate(pool: Pool, token: Token, signer: Signer, amount: bigint, slot = 0) {
  const userPool = pool.connect(signer) as unknown as Pool;
  const userToken = token.connect(signer) as unknown as Token;
  await waitFor(userPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
  const metadata = await pool.participantMetadata(slot);
  const reservationNonce = BigInt(String(metadata[3]));
  await waitFor(userToken.mintClear(signer.address, amount));
  const latest = await hre.ethers.provider.getBlock("latest");
  await waitFor(
    userToken.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 3600)),
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
  await waitFor(userPool.settleThreshold(slot, 1n, reservationNonce, true, threshold.proof));
  return reservationNonce;
}

describe("VeilpotPool Gate 1B.2 withdrawal/TWAB/snapshot", function () {
  it("uses actual withdrawal, direct caller binding, and monotonic nonce replay protection", async function () {
    const { owner, token, pool } = await fixture();
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const request = await encryptedInput(await pool.getAddress(), owner, 1_000_000n);
    reportLocalCost(
      "withdrawPartial",
      await waitFor(pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n)),
    );
    expect(await decrypt64(await pool.principalHandle(0))).to.equal(1_000_000n);
    expect(await pool.nextWithdrawNonce(owner.address)).to.equal(1n);
    await expect(pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n)).to.be
      .reverted;
    const foreignPool = pool.connect((await hre.ethers.getSigners())[1]!) as unknown as Pool;
    await expect(foreignPool.withdraw(request.handle, request.proof, 1n, reservationNonce, 1n)).to
      .be.reverted;
  });

  it("accounts a partial token return and checkpoints old principal before mutation", async function () {
    const { owner, token, pool } = await customFixture("TestERC7984PartialReturn", [2_000_000n]);
    const partial = token as unknown as PartialToken;
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const activationBlock = await hre.ethers.provider.getBlock("latest");
    const activationTime = BigInt(activationBlock?.timestamp ?? 0);
    await setTimestamp(activationTime + 10n);
    await (await partial.setPartialCap(400_000n)).wait();
    const request = await encryptedInput(await pool.getAddress(), owner, 1_000_000n);
    await waitFor(pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n));
    expect(await decrypt64(await pool.principalHandle(0))).to.equal(1_600_000n);
    expect(await decrypt128(await pool.twabAccumulatorHandle(0))).to.equal(24_000_000n);
    expect(await pool.nextWithdrawNonce(owner.address)).to.equal(1n);
  });

  it("rolls back withdrawal state while the external token is paused", async function () {
    const { owner, token, pool } = await customFixture("TestERC7984Pausable");
    const pausable = token as unknown as PausableToken;
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const beforePrincipal = await decrypt64(await pool.principalHandle(0));
    const beforeTwab = await decrypt128(await pool.twabAccumulatorHandle(0));
    const request = await encryptedInput(await pool.getAddress(), owner, 1_000_000n);
    await waitFor(pausable.setPaused(true));
    await expect(pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n)).to.be
      .reverted;
    expect(await decrypt64(await pool.principalHandle(0))).to.equal(beforePrincipal);
    expect(await decrypt128(await pool.twabAccumulatorHandle(0))).to.equal(beforeTwab);
    expect(await pool.nextWithdrawNonce(owner.address)).to.equal(0n);
    await waitFor(pausable.setPaused(false));
    await waitFor(pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n));
    expect(await pool.nextWithdrawNonce(owner.address)).to.equal(1n);
  });

  it("clamps over-principal withdrawal and processes encrypted zero exactly once", async function () {
    const { owner, token, pool } = await fixture();
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const over = await encryptedInput(await pool.getAddress(), owner, 9_000_000n);
    await waitFor(pool.withdraw(over.handle, over.proof, 1n, reservationNonce, 0n));
    expect(await decrypt64(await pool.principalHandle(0))).to.equal(0n);
    expect(await decrypt128(await pool.aggregatePrincipalHandle())).to.equal(0n);
    expect(await pool.nextWithdrawNonce(owner.address)).to.equal(1n);
    const zero = await encryptedInput(await pool.getAddress(), owner, 0n);
    await waitFor(pool.withdraw(zero.handle, zero.proof, 1n, reservationNonce, 1n));
    expect(await pool.nextWithdrawNonce(owner.address)).to.equal(2n);
    await expect(pool.withdraw(zero.handle, zero.proof, 1n, reservationNonce, 1n)).to.be.reverted;
  });

  it("measures zero and full withdrawal paths locally", async function () {
    const { owner, token, pool } = await fixture();
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const zero = await encryptedInput(await pool.getAddress(), owner, 0n);
    reportLocalCost(
      "withdrawZero",
      await waitFor(pool.withdraw(zero.handle, zero.proof, 1n, reservationNonce, 0n)),
    );
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    reportLocalCost(
      "withdrawFull",
      await waitFor(pool.withdraw(full.handle, full.proof, 1n, reservationNonce, 1n)),
    );
    expect(await decrypt64(await pool.principalHandle(0))).to.equal(0n);
  });

  it("keeps aggregate obligations within current confidential token backing after withdrawal", async function () {
    const { owner, token, pool } = await fixture();
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const beforeBacking = await decrypt64(
      await token.confidentialBalanceOf(await pool.getAddress()),
    );
    expect(beforeBacking).to.equal(2_000_000n);
    const request = await encryptedInput(await pool.getAddress(), owner, 400_000n);
    await waitFor(pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n));
    const afterBacking = await decrypt64(
      await token.confidentialBalanceOf(await pool.getAddress()),
    );
    const obligations = await decrypt128(await pool.aggregatePrincipalHandle());
    expect(afterBacking).to.equal(1_600_000n);
    expect(obligations).to.equal(1_600_000n);
    expect(obligations <= afterBacking).to.equal(true);
  });

  it("isolates an immutable cutoff and materializes raw TWAB in bounded chunks", async function () {
    const { owner, token, pool } = await fixture();
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const start = await hre.ethers.provider.getBlock("latest");
    const activationTime = BigInt(start?.timestamp ?? 0);
    await setTimestamp(activationTime + 10n);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 1n);
    reportLocalCost("snapshotStart", await waitFor(pool.startSnapshot()));
    expect(await pool.snapshotParticipantCount()).to.equal(1n);
    const request = await encryptedInput(await pool.getAddress(), owner, 1_000_000n);
    await setTimestamp(cutoff + 10n);
    await waitFor(pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n));
    await setTimestamp(cutoff + 100n);
    reportLocalCost("snapshotChunk8OrBounded", await waitFor(pool.processSnapshotChunk()));
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(
      2_000_000n * (cutoff - activationTime),
    );
    // Same deterministic timeline as the frozen bigint reference model:
    // one balance mutation at activation, then a cutoff seal.
    const referenceModelWeight = 2_000_000n * (cutoff - activationTime);
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(referenceModelWeight);
    expect(await decrypt128(await pool.snapshotTotalHandle(1n))).to.equal(
      2_000_000n * (cutoff - activationTime),
    );
    reportLocalCost("snapshotFinalize", await waitFor(pool.finalizeSnapshot()));
    expect(await pool.snapshotReady()).to.equal(true);
    expect(await pool.snapshotCursor()).to.equal(1n);
  });

  it("permits a late snapshot start while retaining the configured cutoff", async function () {
    const { owner, token, pool } = await fixture();
    await activate(pool, token, owner, 2_000_000n);
    const activationBlock = await hre.ethers.provider.getBlock("latest");
    const activationTime = BigInt(activationBlock?.timestamp ?? 0);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff + 60n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotCutoffTimestamp()).to.equal(cutoff);
    expect(await pool.snapshotParticipantCount()).to.equal(1n);
    await waitFor(pool.processSnapshotChunk());
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(
      2_000_000n * (cutoff - activationTime),
    );
    await waitFor(pool.finalizeSnapshot());
    expect(await pool.snapshotReady()).to.equal(true);
  });

  it("seals a post-cutoff withdrawal before a late start without rewriting either epoch", async function () {
    const { owner, token, pool } = await fixture();
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const activationBlock = await hre.ethers.provider.getBlock("latest");
    const activationTime = BigInt(activationBlock?.timestamp ?? 0);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff + 30n);
    const request = await encryptedInput(await pool.getAddress(), owner, 400_000n);
    const withdrawalReceipt = await waitFor(
      pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n),
    );
    const withdrawalBlock = await hre.ethers.provider.getBlock(withdrawalReceipt.blockNumber);
    const withdrawalTimestamp = BigInt(withdrawalBlock?.timestamp ?? 0);
    await setTimestamp(cutoff + 60n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotCutoffTimestamp()).to.equal(cutoff);
    await waitFor(pool.processSnapshotChunk());
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(
      2_000_000n * (cutoff - activationTime),
    );
    const currentEpochStart = await pool.activeEpochStart();
    const currentAccumulator = await decrypt128(await pool.twabAccumulatorHandle(0));
    expect(currentEpochStart).to.equal(cutoff);
    // The late withdrawal sealed the old epoch and accrued the old principal
    // only from the cutoff to the withdrawal timestamp.
    expect(currentAccumulator).to.equal(2_000_000n * (withdrawalTimestamp - cutoff));
    await setTimestamp(cutoff + 90n);
    const secondRequest = await encryptedInput(await pool.getAddress(), owner, 100_000n);
    const secondReceipt = await waitFor(
      pool.withdraw(secondRequest.handle, secondRequest.proof, 1n, reservationNonce, 1n),
    );
    const secondBlock = await hre.ethers.provider.getBlock(secondReceipt.blockNumber);
    expect(await decrypt128(await pool.twabAccumulatorHandle(0))).to.equal(
      2_000_000n * (withdrawalTimestamp - cutoff) +
        1_600_000n * (BigInt(secondBlock?.timestamp ?? 0) - withdrawalTimestamp),
    );
  });

  it("excludes activation settled after cutoff even when snapshot start is late", async function () {
    const { owner, token, pool } = await fixture();
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff + 10n);
    await waitFor(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const reservationNonce = BigInt(String((await pool.participantMetadata(0))[3]));
    await waitFor(token.mintClear(owner.address, 2_000_000n));
    const latest = await hre.ethers.provider.getBlock("latest");
    await waitFor(
      token.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 3600)),
    );
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(
      pool.deposit(
        input.handle,
        input.proof,
        owner.address,
        await pool.getAddress(),
        1n,
        reservationNonce,
        0n,
      ),
    );
    const threshold = await publicBool(await pool.thresholdHandle(0));
    await setTimestamp(cutoff + 30n);
    await waitFor(pool.settleThreshold(0, 1n, reservationNonce, true, threshold.proof));
    await setTimestamp(cutoff + 40n);
    const postCutoffWithdrawal = await encryptedInput(await pool.getAddress(), owner, 100_000n);
    await waitFor(
      pool.withdraw(
        postCutoffWithdrawal.handle,
        postCutoffWithdrawal.proof,
        1n,
        reservationNonce,
        0n,
      ),
    );
    await setTimestamp(cutoff + 60n);
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(0n);
    await waitFor(pool.finalizeSnapshot());
  });

  it("keeps active principal within the frozen maximum envelope", async function () {
    const { owner, token, pool } = await fixture();
    const amount = 1_000_000_000_001n;
    await waitFor(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const reservationNonce = BigInt(String((await pool.participantMetadata(0))[3]));
    await waitFor(token.mintClear(owner.address, amount));
    const latest = await hre.ethers.provider.getBlock("latest");
    await waitFor(
      token.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 3600)),
    );
    const input = await encryptedInput(await pool.getAddress(), owner, amount);
    await waitFor(
      pool.deposit(
        input.handle,
        input.proof,
        owner.address,
        await pool.getAddress(),
        1n,
        reservationNonce,
        0n,
      ),
    );
    const threshold = await publicBool(await pool.thresholdHandle(0));
    expect(threshold.value).to.equal(false);
    await expect(pool.settleThreshold(0, 1n, reservationNonce, true, threshold.proof)).to.be
      .reverted;
    await waitFor(pool.settleThreshold(0, 1n, reservationNonce, false, threshold.proof));
    expect(await pool.participantState(0)).to.equal(4n);
  });

  it("accepts the exact maximum principal and materializes its bounded raw TWAB", async function () {
    const { owner, token, pool } = await fixture();
    const maximum = 1_000_000_000_000n;
    await activate(pool, token, owner, maximum);
    expect(await decrypt64(await pool.principalHandle(0))).to.equal(maximum);
    const activationBlock = await hre.ethers.provider.getBlock("latest");
    const activationTime = BigInt(activationBlock?.timestamp ?? 0);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 1n);
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(
      maximum * (cutoff - activationTime),
    );
    expect(maximum * 2_592_000n).to.equal(2_592_000_000_000_000_000n);
  });

  it("matches the compiled LazyEpochTwabModel on representative timelines", async function () {
    type Scenario =
      | "activate-wait"
      | "partial-before-cutoff"
      | "post-cutoff-withdrawal"
      | "full-before-cutoff"
      | "activate-after-cutoff";

    async function runScenario(scenario: Scenario): Promise<void> {
      const { owner, token, pool } = await fixture();
      const amount = 2_000_000n;
      let reservationNonce: bigint;
      if (scenario === "activate-after-cutoff") {
        const cutoff = await pool.activeEpochEnd();
        await setTimestamp(cutoff - 100n);
        await waitFor(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
        reservationNonce = BigInt(String((await pool.participantMetadata(0))[3]));
        await waitFor(token.mintClear(owner.address, amount));
        const latest = await hre.ethers.provider.getBlock("latest");
        await waitFor(
          token.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 3600)),
        );
        const input = await encryptedInput(await pool.getAddress(), owner, amount);
        await waitFor(
          pool.deposit(
            input.handle,
            input.proof,
            owner.address,
            await pool.getAddress(),
            1n,
            reservationNonce,
            0n,
          ),
        );
        const threshold = await publicBool(await pool.thresholdHandle(0));
        await setTimestamp(cutoff + 10n);
        await waitFor(pool.startSnapshot());
        const model = new LazyEpochTwabModel((await pool.activeEpochStart()) - 2_592_000n, cutoff);
        model.advanceTime(cutoff);
        model.closeEpoch();
        const afterCutoffProof = threshold.proof;
        await waitFor(pool.settleThreshold(0, 1n, reservationNonce, true, afterCutoffProof));
        await waitFor(pool.processSnapshotChunk());
        expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(
          model.naiveWeight("alice", model.snapshotEpoch!),
        );
        return;
      }

      reservationNonce = await activate(pool, token, owner, amount);
      const activationBlock = await hre.ethers.provider.getBlock("latest");
      const activationTime = BigInt(activationBlock?.timestamp ?? 0);
      const epochStart = await pool.activeEpochStart();
      const cutoff = await pool.activeEpochEnd();
      const model = new LazyEpochTwabModel(epochStart, cutoff);
      model.advanceTime(activationTime);
      model.deposit("alice", amount);

      if (scenario === "partial-before-cutoff") {
        const target = activationTime + 100n;
        await setTimestamp(target - 1n);
        const request = await encryptedInput(await pool.getAddress(), owner, 400_000n);
        const txReceipt = await waitFor(
          pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n),
        );
        const block = await hre.ethers.provider.getBlock(txReceipt.blockNumber);
        const mutationTime = BigInt(block?.timestamp ?? 0);
        model.advanceTime(mutationTime);
        model.withdraw("alice", 400_000n);
      } else if (scenario === "full-before-cutoff") {
        const target = activationTime + 100n;
        await setTimestamp(target - 1n);
        const request = await encryptedInput(await pool.getAddress(), owner, amount);
        const txReceipt = await waitFor(
          pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n),
        );
        const block = await hre.ethers.provider.getBlock(txReceipt.blockNumber);
        model.advanceTime(BigInt(block?.timestamp ?? 0));
        model.withdraw("alice", amount);
      }

      await setTimestamp(cutoff - 1n);
      await waitFor(pool.startSnapshot());
      model.advanceTime(cutoff);
      const epoch = model.closeEpoch();
      if (scenario === "post-cutoff-withdrawal") {
        const target = cutoff + 10n;
        await setTimestamp(target - 1n);
        const request = await encryptedInput(await pool.getAddress(), owner, 400_000n);
        const txReceipt = await waitFor(
          pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n),
        );
        const block = await hre.ethers.provider.getBlock(txReceipt.blockNumber);
        model.advanceTime(BigInt(block?.timestamp ?? 0));
        model.withdraw("alice", 400_000n);
      }
      await waitFor(pool.processSnapshotChunk());
      expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(
        model.snapshot("alice"),
      );
      expect(await decrypt128(await pool.snapshotTotalHandle(1n))).to.equal(
        model.naiveWeight("alice", epoch),
      );
    }

    for (const scenario of [
      "activate-wait",
      "partial-before-cutoff",
      "post-cutoff-withdrawal",
      "full-before-cutoff",
      "activate-after-cutoff",
    ] as const) {
      await runScenario(scenario);
    }
  });

  it("processes a multi-chunk snapshot exactly once with a fixed participant bound", async function () {
    const signers = await hre.ethers.getSigners();
    const { token, pool } = await fixture();
    for (let index = 0; index < 9; index += 1) {
      await activate(pool, token, signers[index]!, 1_000_000n, index);
    }
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 1n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotParticipantCount()).to.equal(9n);
    reportLocalCost("snapshotChunkFirst", await waitFor(pool.processSnapshotChunk()));
    expect(await pool.snapshotCursor()).to.equal(8n);
    reportLocalCost("snapshotChunkFinal", await waitFor(pool.processSnapshotChunk()));
    expect(await pool.snapshotCursor()).to.equal(9n);
    await expect(pool.processSnapshotChunk()).to.be.reverted;
    reportLocalCost("snapshotFinalizeMulti", await waitFor(pool.finalizeSnapshot()));
    expect(await pool.snapshotReady()).to.equal(true);
    await expect(pool.finalizeSnapshot()).to.be.reverted;
  });

  it("enforces the frozen snapshot bounds through the 128-slot cursor", async function () {
    const { pool } = await fixture();
    const wallets = Array.from({ length: 128 }, () =>
      ethers.Wallet.createRandom().connect(hre.ethers.provider),
    );
    for (const wallet of wallets) {
      await hre.network.provider.send("hardhat_setBalance", [
        wallet.address,
        "0x56BC75E2D63100000",
      ]);
      await waitFor(
        (pool.connect(wallet) as unknown as Pool).reserveParticipantSlot({
          value: 1_000_000_000_000_000n,
        }),
      );
    }
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 1n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotParticipantCount()).to.equal(128n);
    expect(await pool.snapshotCursor()).to.equal(0n);
    for (let chunk = 0; chunk < 16; chunk += 1) {
      await waitFor(pool.processSnapshotChunk());
      expect(await pool.snapshotCursor()).to.equal(BigInt((chunk + 1) * 8));
    }
    await expect(pool.processSnapshotChunk()).to.be.reverted;
    await waitFor(pool.finalizeSnapshot());
    await expect(pool.finalizeSnapshot()).to.be.reverted;
  });

  it("handles empty and one-chunk participant bounds without out-of-range work", async function () {
    for (const count of [0, 7, 8]) {
      const { pool } = await fixture();
      const signers = await hre.ethers.getSigners();
      for (let index = 0; index < count; index += 1) {
        await waitFor(
          (pool.connect(signers[index]!) as unknown as Pool).reserveParticipantSlot({
            value: 1_000_000_000_000_000n,
          }),
        );
      }
      const cutoff = await pool.activeEpochEnd();
      await setTimestamp(cutoff - 1n);
      await waitFor(pool.startSnapshot());
      expect(await pool.snapshotParticipantCount()).to.equal(BigInt(count));
      const expectedChunks = count === 0 ? 0 : 1;
      for (let chunk = 0; chunk < expectedChunks; chunk += 1) {
        await waitFor(pool.processSnapshotChunk());
      }
      expect(await pool.snapshotCursor()).to.equal(BigInt(count));
      if (count === 0) await expect(pool.processSnapshotChunk()).to.be.reverted;
      await waitFor(pool.finalizeSnapshot());
    }
  });

  it("terminates exactly at the 127-slot boundary", async function () {
    const { pool } = await fixture();
    const wallets = Array.from({ length: 127 }, () =>
      ethers.Wallet.createRandom().connect(hre.ethers.provider),
    );
    for (const wallet of wallets) {
      await hre.network.provider.send("hardhat_setBalance", [
        wallet.address,
        "0x56BC75E2D63100000",
      ]);
      await waitFor(
        (pool.connect(wallet) as unknown as Pool).reserveParticipantSlot({
          value: 1_000_000_000_000_000n,
        }),
      );
    }
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 1n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotParticipantCount()).to.equal(127n);
    for (let chunk = 0; chunk < 16; chunk += 1) await waitFor(pool.processSnapshotChunk());
    expect(await pool.snapshotCursor()).to.equal(127n);
    await expect(pool.processSnapshotChunk()).to.be.reverted;
    await waitFor(pool.finalizeSnapshot());
  });

  it("fails closed beyond the maximum next-epoch duration", async function () {
    const { owner, token, pool } = await fixture();
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 1n);
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    const nextEpochEnd = await pool.activeEpochEnd();
    await setTimestamp(nextEpochEnd - 1n);
    const exact = await encryptedInput(await pool.getAddress(), owner, 0n);
    await waitFor(pool.withdraw(exact.handle, exact.proof, 1n, reservationNonce, 0n));
    const beyond = await encryptedInput(await pool.getAddress(), owner, 0n);
    await setTimestamp(nextEpochEnd + 1n);
    await expect(pool.withdraw(beyond.handle, beyond.proof, 1n, reservationNonce, 1n)).to.be
      .reverted;
  });

  it("handles withdrawal and snapshot start ordering at one cutoff timestamp", async function () {
    async function runOrdering(snapshotFirst: boolean): Promise<bigint> {
      const { owner, token, pool } = await fixture();
      const reservationNonce = await activate(pool, token, owner, 2_000_000n);
      const activationBlock = await hre.ethers.provider.getBlock("latest");
      const activationTime = BigInt(activationBlock?.timestamp ?? 0);
      const cutoff = await pool.activeEpochEnd();
      const request = await encryptedInput(await pool.getAddress(), owner, 400_000n);
      await hre.network.provider.send("evm_setAutomine", [false]);
      await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(cutoff)]);
      const ordered = snapshotFirst
        ? [
            pool.startSnapshot(),
            pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n),
          ]
        : [
            pool.withdraw(request.handle, request.proof, 1n, reservationNonce, 0n),
            pool.startSnapshot(),
          ];
      await hre.network.provider.send("evm_mine");
      await hre.network.provider.send("evm_setAutomine", [true]);
      await (await ordered[0]!).wait();
      await (await ordered[1]!).wait();
      await waitFor(pool.processSnapshotChunk());
      expect(await pool.snapshotCutoffTimestamp()).to.equal(cutoff);
      return decrypt128(await pool.snapshotWeightHandle(1n, 0)).then((weight) => {
        expect(weight).to.equal(2_000_000n * (cutoff - activationTime));
        return weight;
      });
    }

    const withdrawalFirst = await runOrdering(false);
    const snapshotFirst = await runOrdering(true);
    expect(snapshotFirst).to.equal(withdrawalFirst);
  });

  it("catches up two overdue epochs permissionlessly without overwriting sealed weights", async function () {
    const { owner, token, pool } = await fixture();
    const reservationNonce = await activate(pool, token, owner, 2_000_000n);
    const activationBlock = await hre.ethers.provider.getBlock("latest");
    const activationTime = BigInt(activationBlock?.timestamp ?? 0);
    const firstCutoff = await pool.activeEpochEnd();
    const duration = 2_592_000n;

    // Skip the first cutoff and arrive after the entire second epoch has ended.
    await setTimestamp(firstCutoff + duration + 60n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotCutoffTimestamp()).to.equal(firstCutoff);
    await waitFor(pool.processSnapshotChunk());
    const firstWeight = await decrypt128(await pool.snapshotWeightHandle(1n, 0));
    expect(firstWeight).to.equal(2_000_000n * (firstCutoff - activationTime));
    await waitFor(pool.finalizeSnapshot());
    const firstMetadata = await pool.twabMetadata(0);
    expect(firstMetadata[4]).to.equal(0n);
    expect(firstMetadata[5]).to.equal(true);

    // Epoch 2 is already overdue, but its immutable cutoff is still firstCutoff + duration.
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotCutoffTimestamp()).to.equal(firstCutoff + duration);
    await waitFor(pool.processSnapshotChunk());
    const secondWeight = await decrypt128(await pool.snapshotWeightHandle(2n, 0));
    expect(secondWeight).to.equal(2_000_000n * duration);
    await waitFor(pool.finalizeSnapshot());
    const secondMetadata = await pool.twabMetadata(0);
    expect(secondMetadata[4]).to.equal(1n);
    expect(secondMetadata[5]).to.equal(true);

    // The active epoch is now current again; a normal user operation succeeds.
    const zero = await encryptedInput(await pool.getAddress(), owner, 0n);
    await waitFor(pool.withdraw(zero.handle, zero.proof, 1n, reservationNonce, 0n));
    expect(await pool.nextWithdrawNonce(owner.address)).to.equal(1n);
  });

  it("does not give pending activations any snapshot weight", async function () {
    const { owner, token, pool } = await fixture();
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 100n);
    await waitFor(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const reservationNonce = BigInt(String((await pool.participantMetadata(0))[3]));
    await waitFor(token.mintClear(owner.address, 2_000_000n));
    const latest = await hre.ethers.provider.getBlock("latest");
    await waitFor(
      token.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 3600)),
    );
    const pendingInput = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(
      pool.deposit(
        pendingInput.handle,
        pendingInput.proof,
        owner.address,
        await pool.getAddress(),
        1n,
        reservationNonce,
        0n,
      ),
    );
    await setTimestamp(cutoff - 1n);
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    await waitFor(pool.finalizeSnapshot());
    expect(await decrypt128(await pool.snapshotTotalHandle(1n))).to.equal(0n);
    const threshold = await publicBool(await pool.thresholdHandle(0));
    await waitFor(pool.settleThreshold(0, 1n, reservationNonce, true, threshold.proof));
    expect(await decrypt128(await pool.snapshotTotalHandle(1n))).to.equal(0n);
  });
});
