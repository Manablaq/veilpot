// Gate 1B.2S historical snapshot beneficiary storage tests. Local FHEVM only.
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Signer = Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

interface Token extends ethers.BaseContract {
  mintClear(to: string, amount: bigint): Promise<ethers.ContractTransactionResponse>;
  setOperator(operator: string, until: bigint): Promise<ethers.ContractTransactionResponse>;
}

interface ReservationPreview {
  reserveParticipantSlot: {
    staticCall(overrides: { value: bigint }): Promise<bigint>;
  };
}

interface Pool extends ethers.BaseContract {
  reserveParticipantSlot(overrides: { value: bigint }): Promise<ethers.ContractTransactionResponse>;
  participantMetadata(slot: number): Promise<readonly unknown[]>;
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
  thresholdHandle(slot: number): Promise<Handle>;
  withdraw(
    amount: Handle,
    proof: string,
    version: bigint,
    reservationNonce: bigint,
    withdrawalNonce: bigint,
  ): Promise<ethers.ContractTransactionResponse>;
  prepareDeregistration(slot: number): Promise<ethers.ContractTransactionResponse>;
  deregistrationZeroHandle(slot: number): Promise<Handle>;
  settleDeregistration(
    slot: number,
    clearZero: boolean,
    proof: string,
  ): Promise<ethers.ContractTransactionResponse>;
  startSnapshot(): Promise<ethers.ContractTransactionResponse>;
  processSnapshotChunk(): Promise<ethers.ContractTransactionResponse>;
  finalizeSnapshot(): Promise<ethers.ContractTransactionResponse>;
  activeEpochEnd(): Promise<bigint>;
  snapshotEpoch(snapshotId: bigint): Promise<bigint>;
  snapshotParticipantCount(): Promise<bigint>;
  snapshotCursor(): Promise<bigint>;
  participantState(slot: number): Promise<bigint>;
  twabAccumulatorHandle(slot: number): Promise<Handle>;
  twabMetadata(slot: number): Promise<readonly [Handle, bigint, bigint, Handle, bigint, boolean]>;
  epochBeneficiary(
    epochId: bigint,
    slot: number,
  ): Promise<readonly [string, bigint, bigint, boolean]>;
  snapshotBeneficiary(
    snapshotId: bigint,
    slot: number,
  ): Promise<readonly [string, bigint, bigint, boolean]>;
  snapshotWeightHandle(snapshotId: bigint, slot: number): Promise<Handle>;
  epochSnapshotWeightHandle(epochId: bigint, slot: number): Promise<Handle>;
  epochSnapshotWeightBound(epochId: bigint, slot: number): Promise<boolean>;
  epochParticipantBound(epochId: bigint): Promise<bigint>;
  slotReusableAfter(slot: number): Promise<bigint>;
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

async function publicBool(handle: Handle): Promise<{ value: boolean; proof: string }> {
  const result = await hre.fhevm.publicDecrypt([handle]);
  const value = result.clearValues[handle];
  if (typeof value !== "boolean") throw new Error("expected boolean");
  return { value, proof: result.decryptionProof };
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

function reportLocalCost(operation: string, receipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);
  console.log(
    JSON.stringify({
      scope: "GATE_1B.2S_PRODUCTION_LOCAL_ONLY",
      operation,
      localGlobalHCU: hcu.globalHCU,
      localSequentialHCU: hcu.maxHCUDepth,
      localEvmGasRunSpecific: receipt.gasUsed.toString(),
    }),
  );
}

async function setTimestamp(timestamp: bigint): Promise<void> {
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await hre.network.provider.send("evm_mine");
}

async function setNextTransactionTimestamp(timestamp: bigint): Promise<void> {
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
}

async function previewReservationSlot(pool: Pool, signer: Signer): Promise<bigint> {
  const connected = pool.connect(signer) as unknown as ReservationPreview;
  return connected.reserveParticipantSlot.staticCall({
    value: 1_000_000_000_000_000n,
  });
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
  ).deploy(await token.getAddress(), owner.address)) as unknown as Pool;
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

describe("VeilpotPool historical snapshot beneficiaries", function () {
  it("lazily binds the current eligible registration with the snapshot weight", async function () {
    const { owner, token, pool } = await fixture();
    const nonce = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 1n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotEpoch(1n)).to.equal(0n);
    await waitFor(pool.processSnapshotChunk());
    const historical = await pool.snapshotBeneficiary(1n, 0);
    expect(historical[0]).to.equal(owner.address);
    expect(historical[1]).to.equal(1n);
    expect(historical[2]).to.equal(nonce);
    expect(historical[3]).to.equal(true);
  });

  it("pre-seals the beneficiary before a late snapshot starts", async function () {
    const { owner, token, pool } = await fixture();
    const nonce = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff + 30n);
    const zero = await encryptedInput(await pool.getAddress(), owner, 0n);
    reportLocalCost(
      "preSnapshotBeneficiarySealWithdrawal",
      await waitFor(pool.withdraw(zero.handle, zero.proof, 1n, nonce, 0n)),
    );
    const prebound = await pool.epochBeneficiary(0n, 0);
    expect(prebound[0]).to.equal(owner.address);
    expect(prebound[1]).to.equal(1n);
    expect(prebound[2]).to.equal(nonce);
    expect(prebound[3]).to.equal(true);
    await setTimestamp(cutoff + 60n);
    await waitFor(pool.startSnapshot());
    reportLocalCost("beneficiarySnapshotChunk8", await waitFor(pool.processSnapshotChunk()));
    const historical = await pool.snapshotBeneficiary(1n, 0);
    expect(historical).to.deep.equal(prebound);
  });

  it("keeps Alice's historical tuple when Bob reuses the slot", async function () {
    const { owner, other, token, pool } = await fixture();
    const aliceNonce = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 1n);
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    await waitFor(pool.finalizeSnapshot());
    const nextCutoff = await pool.activeEpochEnd();
    await setTimestamp(nextCutoff + 1n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(pool.withdraw(full.handle, full.proof, 1n, aliceNonce, 0n));
    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    await waitFor(pool.settleDeregistration(0, true, zeroProof.proof));
    const reuseAfter = await pool.slotReusableAfter(0);
    await setTimestamp(reuseAfter + 1n);
    const bobPool = pool.connect(other) as unknown as Pool;
    await waitFor(bobPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const bobMetadata = await pool.participantMetadata(0);
    expect(bobMetadata[1]).to.equal(other.address);
    expect(BigInt(String(bobMetadata[3]))).to.not.equal(aliceNonce);
    const historical = await pool.snapshotBeneficiary(1n, 0);
    expect(historical[0]).to.equal(owner.address);
    expect(historical[1]).to.equal(1n);
    expect(historical[2]).to.equal(aliceNonce);
    expect(historical[3]).to.equal(true);
  });

  it("seals Alice's weight and beneficiary before pre-snapshot clear and Bob reuse", async function () {
    const { owner, other, token, pool } = await fixture();
    const aliceNonce = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();

    // Alice's principal is zero before the cutoff, but her closing-epoch TWAB is positive.
    await setTimestamp(cutoff - 100n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(pool.withdraw(full.handle, full.proof, 1n, aliceNonce, 0n));
    await setTimestamp(cutoff + 10n);

    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    reportLocalCost(
      "preSnapshotClearBeneficiarySeal",
      await waitFor(pool.settleDeregistration(0, true, zeroProof.proof)),
    );

    // The historical record must exist before any snapshot object or slot reuse.
    const prebound = await pool.epochBeneficiary(0n, 0);
    expect(prebound[0]).to.equal(owner.address);
    expect(prebound[1]).to.equal(1n);
    expect(prebound[2]).to.equal(aliceNonce);
    expect(prebound[3]).to.equal(true);
    expect(await pool.epochSnapshotWeightBound(0n, 0)).to.equal(true);
    const aliceWeight = await decrypt128(await pool.epochSnapshotWeightHandle(0n, 0));
    expect(aliceWeight).to.be.greaterThan(0n);
    await expectRejected(async () =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint128,
        await pool.epochSnapshotWeightHandle(0n, 0),
        await pool.getAddress(),
        other,
      ),
    );

    const bobPool = pool.connect(other) as unknown as Pool;
    await waitFor(bobPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const bobMetadata = await pool.participantMetadata(0);
    expect(bobMetadata[1]).to.equal(other.address);
    expect(BigInt(String(bobMetadata[3]))).to.not.equal(aliceNonce);

    // Start and materialize the old epoch only after Bob occupies the reused slot.
    await setTimestamp(cutoff + 60n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotEpoch(1n)).to.equal(0n);
    await waitFor(pool.processSnapshotChunk());
    const historical = await pool.snapshotBeneficiary(1n, 0);
    expect(historical).to.deep.equal(prebound);
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(aliceWeight);
  });

  it("retains registration A when Alice re-registers before the old snapshot starts", async function () {
    const { owner, token, pool } = await fixture();
    const nonceA = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();

    await setTimestamp(cutoff - 100n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(pool.withdraw(full.handle, full.proof, 1n, nonceA, 0n));
    await setTimestamp(cutoff + 10n);
    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    await waitFor(pool.settleDeregistration(0, true, zeroProof.proof));
    const aliceWeight = await decrypt128(await pool.epochSnapshotWeightHandle(0n, 0));
    expect(aliceWeight).to.be.greaterThan(0n);

    await waitFor(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const current = await pool.participantMetadata(0);
    const nonceB = BigInt(String(current[3]));
    expect(nonceB).to.not.equal(nonceA);

    await setTimestamp(cutoff + 60n);
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    const historical = await pool.snapshotBeneficiary(1n, 0);
    expect(historical[0]).to.equal(owner.address);
    expect(historical[1]).to.equal(1n);
    expect(historical[2]).to.equal(nonceA);
    expect(historical[3]).to.equal(true);
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(aliceWeight);
  });

  it("keeps a pre-sealed historical high slot in the delayed snapshot bound", async function () {
    const { token, pool } = await fixture();
    const signers = await hre.ethers.getSigners();
    // Keep slots 0..7 occupied by legitimate reservations while Alice uses slot 8.
    for (let index = 0; index < 8; index += 1) {
      const userPool = pool.connect(signers[index]!) as unknown as Pool;
      await waitFor(userPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    }
    const alice = signers[8]!;
    const aliceNonce = await activate(pool, token, alice, 2_000_000n, 8);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 200n);
    const full = await encryptedInput(await pool.getAddress(), alice, 2_000_000n);
    await waitFor(
      (pool.connect(alice) as unknown as Pool).withdraw(
        full.handle,
        full.proof,
        1n,
        aliceNonce,
        0n,
      ),
    );
    await setTimestamp(cutoff - 100n);
    await waitFor(pool.prepareDeregistration(8));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(8));
    await waitFor(pool.settleDeregistration(8, true, zeroProof.proof));

    expect(await pool.participantState(8)).to.equal(6n); // TOMBSTONED, no current occupant
    expect(await pool.epochParticipantBound(0n)).to.equal(9n);
    expect(await pool.epochSnapshotWeightBound(0n, 8)).to.equal(true);
    const aliceWeight = await decrypt128(await pool.epochSnapshotWeightHandle(0n, 8));
    expect(aliceWeight).to.be.greaterThan(0n);

    await setTimestamp(cutoff + 60n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotParticipantCount()).to.equal(9n);
    await waitFor(pool.processSnapshotChunk());
    expect(await pool.snapshotCursor()).to.equal(8n);
    await waitFor(pool.processSnapshotChunk());
    expect(await pool.snapshotCursor()).to.equal(9n);
    await expect(pool.processSnapshotChunk()).to.be.reverted;
    const historical = await pool.snapshotBeneficiary(1n, 8);
    expect(historical[0]).to.equal(alice.address);
    expect(historical[1]).to.equal(1n);
    expect(historical[2]).to.equal(aliceNonce);
    expect(historical[3]).to.equal(true);
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 8))).to.equal(aliceWeight);
  });

  it("preserves accrued weight and blocks same-epoch reuse after a pre-cutoff exit", async function () {
    const { owner, other, token, pool } = await fixture();
    const aliceNonce = await activate(pool, token, owner, 2_000_000n);
    // Occupy every other physical slot so Bob cannot silently receive a different slot.
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
    await setTimestamp(cutoff - 200n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(pool.withdraw(full.handle, full.proof, 1n, aliceNonce, 0n));
    const accruedBeforeClear = await decrypt128(await pool.twabAccumulatorHandle(0));
    expect(accruedBeforeClear).to.be.greaterThan(0n);

    await setTimestamp(cutoff - 100n);
    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    reportLocalCost(
      "preCutoffDeregistrationHistoricalSeal",
      await waitFor(pool.settleDeregistration(0, true, zeroProof.proof)),
    );
    expect(await pool.epochParticipantBound(0n)).to.equal(1n);
    expect(await pool.slotReusableAfter(0)).to.equal(cutoff);
    expect(await decrypt128(await pool.epochSnapshotWeightHandle(0n, 0))).to.equal(
      accruedBeforeClear,
    );

    const bobPool = pool.connect(other) as unknown as Pool;
    await setNextTransactionTimestamp(cutoff - 1n);
    await expect(bobPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n })).to.be.reverted;
    await setNextTransactionTimestamp(cutoff);
    await expect(bobPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n })).to.be.reverted;
    await setNextTransactionTimestamp(cutoff + 1n);
    await waitFor(bobPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const bobMetadata = await pool.participantMetadata(0);
    expect(bobMetadata[1]).to.equal(other.address);

    await setTimestamp(cutoff + 3n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotParticipantCount()).to.equal(128n);
    await waitFor(pool.processSnapshotChunk());
    const historical = await pool.snapshotBeneficiary(1n, 0);
    expect(historical[0]).to.equal(owner.address);
    expect(historical[2]).to.equal(aliceNonce);
    expect(historical[3]).to.equal(true);
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.equal(accruedBeforeClear);
  });

  it("retains a historical bound when the current registry becomes empty", async function () {
    const { owner, token, pool } = await fixture();
    const nonce = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 100n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(pool.withdraw(full.handle, full.proof, 1n, nonce, 0n));
    await setTimestamp(cutoff + 10n);
    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    await waitFor(pool.settleDeregistration(0, true, zeroProof.proof));
    expect(await pool.participantState(0)).to.equal(6n);
    expect(await pool.epochParticipantBound(0n)).to.equal(1n);

    await setTimestamp(cutoff + 60n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotParticipantCount()).to.equal(1n);
    await waitFor(pool.processSnapshotChunk());
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.be.greaterThan(0n);
    await expect(pool.processSnapshotChunk()).to.be.reverted;
  });

  it("keeps registration A when Alice re-registers as registration B", async function () {
    const { owner, token, pool } = await fixture();
    const nonceA = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 1n);
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    await waitFor(pool.finalizeSnapshot());
    const nextCutoff = await pool.activeEpochEnd();
    await setTimestamp(nextCutoff + 1n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(pool.withdraw(full.handle, full.proof, 1n, nonceA, 0n));
    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    await waitFor(pool.settleDeregistration(0, true, zeroProof.proof));
    const reuseAfter = await pool.slotReusableAfter(0);
    await setTimestamp(reuseAfter + 1n);
    await waitFor(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const current = await pool.participantMetadata(0);
    const nonceB = BigInt(String(current[3]));
    expect(nonceB).to.not.equal(nonceA);
    const historical = await pool.snapshotBeneficiary(1n, 0);
    expect(historical[0]).to.equal(owner.address);
    expect(historical[1]).to.equal(1n);
    expect(historical[2]).to.equal(nonceA);
    expect(historical[3]).to.equal(true);
  });

  it("does not bind an activation that settles after the cutoff", async function () {
    const { owner, token, pool } = await fixture();
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff - 100n);
    await waitFor(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const nonce = BigInt(String((await pool.participantMetadata(0))[3]));
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
        nonce,
        0n,
      ),
    );
    const threshold = await publicBool(await pool.thresholdHandle(0));
    await setTimestamp(cutoff + 10n);
    await waitFor(pool.startSnapshot());
    await setTimestamp(cutoff + 20n);
    await waitFor(pool.settleThreshold(0, 1n, nonce, true, threshold.proof));
    await waitFor(pool.processSnapshotChunk());
    const historical = await pool.snapshotBeneficiary(1n, 0);
    expect(historical[0]).to.equal(ethers.ZeroAddress);
    expect(historical[1]).to.equal(0n);
    expect(historical[2]).to.equal(0n);
    expect(historical[3]).to.equal(false);
    expect(await pool.epochParticipantBound(0n)).to.equal(0n);
  });

  it("preserves a logical N+1 TWAB when Alice exits before snapshot N starts", async function () {
    const { owner, other, token, pool } = await fixture();
    const nonce = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();
    const duration = 2_592_000n;
    const nextCutoff = cutoff + duration;

    await setTimestamp(cutoff + 10n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    const withdrawalReceipt = await waitFor(pool.withdraw(full.handle, full.proof, 1n, nonce, 0n));
    const withdrawalBlock = await hre.ethers.provider.getBlock(withdrawalReceipt.blockNumber);
    const withdrawalTimestamp = BigInt(withdrawalBlock?.timestamp ?? 0);
    const logicalNextWeight = 2_000_000n * (withdrawalTimestamp - cutoff);

    const twab = await pool.twabMetadata(0);
    expect(twab[2]).to.equal(1n);
    expect(twab[1]).to.equal(withdrawalTimestamp);
    expect(await decrypt128(twab[0])).to.equal(logicalNextWeight);
    expect(await pool.epochSnapshotWeightBound(0n, 0)).to.equal(true);

    await setTimestamp(cutoff + 20n);
    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    reportLocalCost(
      "postCutoffNextEpochDeregistrationSeal",
      await waitFor(pool.settleDeregistration(0, true, zeroProof.proof)),
    );

    expect(await pool.epochSnapshotWeightBound(1n, 0)).to.equal(true);
    expect(await decrypt128(await pool.epochSnapshotWeightHandle(1n, 0))).to.equal(
      logicalNextWeight,
    );
    await expectRejected(async () =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint128,
        await pool.epochSnapshotWeightHandle(1n, 0),
        await pool.getAddress(),
        other,
      ),
    );
    const epoch0Beneficiary = await pool.epochBeneficiary(0n, 0);
    const epoch1Beneficiary = await pool.epochBeneficiary(1n, 0);
    expect(epoch0Beneficiary[0]).to.equal(owner.address);
    expect(epoch0Beneficiary[2]).to.equal(nonce);
    expect(epoch1Beneficiary).to.deep.equal(epoch0Beneficiary);
    expect(await pool.epochParticipantBound(0n)).to.equal(1n);
    expect(await pool.epochParticipantBound(1n)).to.equal(1n);
    expect(await pool.slotReusableAfter(0)).to.equal(nextCutoff);

    const bobPool = pool.connect(other) as unknown as Pool;
    await setTimestamp(cutoff + 30n);
    expect(await previewReservationSlot(pool, other)).to.equal(1n);

    await setTimestamp(cutoff + 40n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotEpoch(1n)).to.equal(0n);
    await waitFor(pool.processSnapshotChunk());
    expect(await pool.snapshotBeneficiary(1n, 0)).to.deep.equal(epoch0Beneficiary);
    expect(await decrypt128(await pool.snapshotWeightHandle(1n, 0))).to.be.greaterThan(0n);
    await waitFor(pool.finalizeSnapshot());

    await setTimestamp(nextCutoff);
    expect(await previewReservationSlot(pool, other)).to.equal(1n);
    await setTimestamp(nextCutoff + 1n);
    expect(await previewReservationSlot(pool, other)).to.equal(0n);
    await waitFor(bobPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    expect((await pool.participantMetadata(0))[1]).to.equal(other.address);

    await setTimestamp(nextCutoff + 3n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotEpoch(2n)).to.equal(1n);
    await waitFor(pool.processSnapshotChunk());
    expect(await pool.snapshotBeneficiary(2n, 0)).to.deep.equal(epoch1Beneficiary);
    expect(await decrypt128(await pool.snapshotWeightHandle(2n, 0))).to.equal(logicalNextWeight);
  });

  it("assigns a late pre-snapshot activation only to N+1 and preserves it on exit", async function () {
    const { owner, token, pool } = await fixture();
    const cutoff = await pool.activeEpochEnd();
    const duration = 2_592_000n;
    const nextCutoff = cutoff + duration;

    await setTimestamp(cutoff + 10n);
    await waitFor(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const nonce = BigInt(String((await pool.participantMetadata(0))[3]));
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
        nonce,
        0n,
      ),
    );
    const threshold = await publicBool(await pool.thresholdHandle(0));
    const activationReceipt = await waitFor(
      pool.settleThreshold(0, 1n, nonce, true, threshold.proof),
    );
    const activationBlock = await hre.ethers.provider.getBlock(activationReceipt.blockNumber);
    const activationTimestamp = BigInt(activationBlock?.timestamp ?? 0);
    expect((await pool.twabMetadata(0))[2]).to.equal(1n);

    await setTimestamp(cutoff + 40n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    const withdrawalReceipt = await waitFor(pool.withdraw(full.handle, full.proof, 1n, nonce, 0n));
    const withdrawalBlock = await hre.ethers.provider.getBlock(withdrawalReceipt.blockNumber);
    const withdrawalTimestamp = BigInt(withdrawalBlock?.timestamp ?? 0);
    const expectedWeight = 2_000_000n * (withdrawalTimestamp - activationTimestamp);
    expect(await decrypt128(await pool.twabAccumulatorHandle(0))).to.equal(expectedWeight);

    await setTimestamp(cutoff + 50n);
    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    await waitFor(pool.settleDeregistration(0, true, zeroProof.proof));

    expect((await pool.epochBeneficiary(0n, 0))[3]).to.equal(false);
    expect(await pool.epochSnapshotWeightBound(0n, 0)).to.equal(false);
    const nextBeneficiary = await pool.epochBeneficiary(1n, 0);
    expect(nextBeneficiary[0]).to.equal(owner.address);
    expect(nextBeneficiary[2]).to.equal(nonce);
    expect(nextBeneficiary[3]).to.equal(true);
    expect(await decrypt128(await pool.epochSnapshotWeightHandle(1n, 0))).to.equal(expectedWeight);
    expect(await pool.slotReusableAfter(0)).to.equal(nextCutoff);

    await setTimestamp(cutoff + 60n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotParticipantCount()).to.equal(0n);
    await waitFor(pool.finalizeSnapshot());

    await setTimestamp(nextCutoff + 1n);
    await waitFor(pool.startSnapshot());
    expect(await pool.snapshotParticipantCount()).to.equal(1n);
    await waitFor(pool.processSnapshotChunk());
    expect(await pool.snapshotBeneficiary(2n, 0)).to.deep.equal(nextBeneficiary);
    expect(await decrypt128(await pool.snapshotWeightHandle(2n, 0))).to.equal(expectedWeight);
  });

  it("preserves N+1 when Alice exits while snapshot N is in progress", async function () {
    const { owner, token, pool } = await fixture();
    const nonce = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();
    const duration = 2_592_000n;
    const nextCutoff = cutoff + duration;

    await setTimestamp(cutoff + 1n);
    await waitFor(pool.startSnapshot());

    await setTimestamp(cutoff + 10n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    const withdrawalReceipt = await waitFor(pool.withdraw(full.handle, full.proof, 1n, nonce, 0n));
    const withdrawalBlock = await hre.ethers.provider.getBlock(withdrawalReceipt.blockNumber);
    const withdrawalTimestamp = BigInt(withdrawalBlock?.timestamp ?? 0);
    const expectedNextWeight = 2_000_000n * (withdrawalTimestamp - cutoff);
    expect(await decrypt128(await pool.twabAccumulatorHandle(0))).to.equal(expectedNextWeight);

    await setTimestamp(cutoff + 20n);
    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    await waitFor(pool.settleDeregistration(0, true, zeroProof.proof));

    expect(await pool.epochSnapshotWeightBound(0n, 0)).to.equal(true);
    expect(await pool.epochSnapshotWeightBound(1n, 0)).to.equal(true);
    expect(await decrypt128(await pool.epochSnapshotWeightHandle(1n, 0))).to.equal(
      expectedNextWeight,
    );
    expect(await pool.slotReusableAfter(0)).to.equal(nextCutoff);

    const oldBeneficiary = await pool.epochBeneficiary(0n, 0);
    const nextBeneficiary = await pool.epochBeneficiary(1n, 0);
    expect(oldBeneficiary[0]).to.equal(owner.address);
    expect(nextBeneficiary).to.deep.equal(oldBeneficiary);

    await waitFor(pool.processSnapshotChunk());
    expect(await pool.snapshotBeneficiary(1n, 0)).to.deep.equal(oldBeneficiary);
    await waitFor(pool.finalizeSnapshot());

    await setTimestamp(nextCutoff + 1n);
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    expect(await pool.snapshotBeneficiary(2n, 0)).to.deep.equal(nextBeneficiary);
    expect(await decrypt128(await pool.snapshotWeightHandle(2n, 0))).to.equal(expectedNextWeight);
  });

  it("keeps distinct historical identities across overdue epochs", async function () {
    const { owner, token, pool } = await fixture();
    const nonce = await activate(pool, token, owner, 2_000_000n);
    const firstCutoff = await pool.activeEpochEnd();
    const duration = 2_592_000n;
    await setTimestamp(firstCutoff + duration + 60n);
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    await waitFor(pool.finalizeSnapshot());
    await waitFor(pool.startSnapshot());
    await waitFor(pool.processSnapshotChunk());
    await waitFor(pool.finalizeSnapshot());
    expect(await pool.snapshotEpoch(1n)).to.equal(0n);
    expect(await pool.snapshotEpoch(2n)).to.equal(1n);
    const first = await pool.snapshotBeneficiary(1n, 0);
    const second = await pool.snapshotBeneficiary(2n, 0);
    expect(first[0]).to.equal(owner.address);
    expect(first[1]).to.equal(1n);
    expect(first[2]).to.equal(nonce);
    expect(first[3]).to.equal(true);
    expect(second).to.deep.equal(first);
  });

  it("seals identity before clearing an active slot during snapshotting", async function () {
    const { owner, token, pool } = await fixture();
    const nonce = await activate(pool, token, owner, 2_000_000n);
    const cutoff = await pool.activeEpochEnd();
    await setTimestamp(cutoff + 1n);
    await waitFor(pool.startSnapshot());
    await setTimestamp(cutoff + 10n);
    const full = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await waitFor(pool.withdraw(full.handle, full.proof, 1n, nonce, 0n));
    await waitFor(pool.prepareDeregistration(0));
    const zeroProof = await publicBool(await pool.deregistrationZeroHandle(0));
    await waitFor(pool.settleDeregistration(0, true, zeroProof.proof));
    const prebound = await pool.epochBeneficiary(0n, 0);
    expect(prebound[0]).to.equal(owner.address);
    expect(prebound[2]).to.equal(nonce);
    expect(prebound[3]).to.equal(true);
    await waitFor(pool.processSnapshotChunk());
    expect(await pool.snapshotBeneficiary(1n, 0)).to.deep.equal(prebound);
  });
});
