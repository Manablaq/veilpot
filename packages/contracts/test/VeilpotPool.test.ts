// Gate 1B.1 production-core tests. All execution is local Hardhat FHEVM only.
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type InputBuilder = ReturnType<typeof hre.fhevm.createEncryptedInput>;
type Handle = `0x${string}`;
type Tx = Promise<ethers.ContractTransactionResponse>;

interface TestToken extends ethers.BaseContract {
  mint(to: string, handle: Handle, proof: string): Tx;
  mintClear(to: string, amount: bigint): Tx;
  setOperator(operator: string, until: bigint): Tx;
  isOperator(holder: string, spender: string): Promise<boolean>;
  confidentialBalanceOf(account: string): Promise<Handle>;
  confidentialTransfer(to: string, amount: Handle, proof: string): Tx;
}

interface PausableToken extends TestToken {
  setPaused(value: boolean): Tx;
}

interface PartialToken extends TestToken {
  setPartialCap(cap: bigint): Tx;
}

interface ReentrantToken extends TestToken {
  configureReentry(target: string, payload: string, enabled: boolean): Tx;
  lastReentrySucceeded(): Promise<boolean>;
}

interface RejectingBondReceiver extends ethers.BaseContract {
  reserve(pool: string, overrides: { value: bigint }): Tx;
  withdraw(pool: string): Tx;
}

interface ReentrantBondReceiver extends ethers.BaseContract {
  reserve(overrides: { value: bigint }): Tx;
  withdraw(): Tx;
  nestedCallSucceeded(): Promise<boolean>;
}

interface NoAclCaller extends ethers.BaseContract {
  pullWithoutGrant(token: string, from: string, handle: Handle, proof: string): Tx;
}

type DirectTransfer = (to: string, amount: Handle, proof: string) => Tx;

interface Pool extends ethers.BaseContract {
  reserveParticipantSlot(overrides: { value: bigint }): Tx;
  expireReservation(slot: number): Tx;
  withdrawBond(): Tx;
  pendingBondRefund(owner: string): Promise<bigint>;
  participantMetadata(slot: number): Promise<readonly unknown[]>;
  participantState(slot: number): Promise<bigint>;
  pendingAmountHandle(slot: number): Promise<Handle>;
  principalHandle(slot: number): Promise<Handle>;
  refundRemainingHandle(slot: number): Promise<Handle>;
  thresholdHandle(slot: number): Promise<Handle>;
  refundCompleteHandle(slot: number): Promise<Handle>;
  aggregatePrincipalHandle(): Promise<Handle>;
  aggregatePendingHandle(): Promise<Handle>;
  canonicalReceivedHandle(): Promise<Handle>;
  activeParticipantCount(): Promise<bigint>;
  nextDepositNonce(owner: string): Promise<bigint>;
  deposit(
    encryptedAmount: Handle,
    proof: string,
    depositor: string,
    claimedPool: string,
    claimedVersion: bigint,
    reservationNonce: bigint,
    depositNonce: bigint,
  ): Tx;
  settleThreshold(
    slot: number,
    registrationVersion: bigint,
    reservationNonce: bigint,
    clearSatisfied: boolean,
    proof: string,
  ): Tx;
  expirePendingActivation(slot: number): Tx;
  refundAttempt(slot: number): Tx;
  settleRefundCompletion(
    slot: number,
    registrationVersion: bigint,
    reservationNonce: bigint,
    refundAttemptNonce: bigint,
    clearComplete: boolean,
    proof: string,
  ): Tx;
}

async function receipt(tx: Tx): Promise<ethers.TransactionReceipt> {
  const result = await (await tx).wait();
  if (result === null) throw new Error("missing receipt");
  return result;
}

function reportLocalCost(operation: string, result: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(result);
  console.log(
    JSON.stringify({
      scope: "GATE_1B.1_PRODUCTION_CORE_LOCAL_ONLY",
      operation,
      localGlobalHCU: hcu.globalHCU,
      localSequentialHCU: hcu.maxHCUDepth,
      localEvmGasRunSpecific: result.gasUsed.toString(),
    }),
  );
}

async function encryptedInput(address: string, signer: { address: string }, amount: bigint) {
  const input: InputBuilder = hre.fhevm.createEncryptedInput(address, signer.address);
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

async function publicBool(handle: Handle): Promise<{ value: boolean; proof: string }> {
  const result = await hre.fhevm.publicDecrypt([handle]);
  const value = result.clearValues[handle];
  if (typeof value !== "boolean") throw new Error("expected public boolean");
  return { value, proof: result.decryptionProof };
}

async function expectRejected(action: () => Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await action();
  } catch {
    rejected = true;
  }
  expect(rejected).to.equal(true);
}

async function deployFixture(): Promise<{
  owner: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  other: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  token: TestToken;
  pool: Pool;
}> {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;
  const other = signers[1]!;
  const token = (await (
    await hre.ethers.getContractFactory("TestERC7984")
  ).deploy()) as unknown as TestToken;
  await token.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(token, "TestERC7984");
  const pool = (await (
    await hre.ethers.getContractFactory("VeilpotPool")
  ).deploy(
    await token.getAddress(),
    owner.address,
    "0x1111111111111111111111111111111111111111",
  )) as unknown as Pool;
  await pool.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPool");
  return { owner, other, token, pool };
}

async function deployCustomTokenFixture(
  factoryName: string,
  constructorArgs: readonly unknown[] = [],
): Promise<{
  owner: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  other: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  token: TestToken;
  pool: Pool;
}> {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;
  const other = signers[1]!;
  const token = (await (
    await hre.ethers.getContractFactory(factoryName)
  ).deploy(...constructorArgs)) as unknown as TestToken;
  await token.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(token, factoryName);
  const pool = (await (
    await hre.ethers.getContractFactory("VeilpotPool")
  ).deploy(
    await token.getAddress(),
    owner.address,
    "0x1111111111111111111111111111111111111111",
  )) as unknown as Pool;
  await pool.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPool");
  return { owner, other, token, pool };
}

async function reserveAndApprove(pool: Pool, token: TestToken) {
  await receipt(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
  const metadata = await pool.participantMetadata(0);
  const reservationNonce = BigInt(String(metadata[3]));
  const latest = await hre.ethers.provider.getBlock("latest");
  const until = BigInt((latest?.timestamp ?? 0) + 3600);
  await receipt(token.setOperator(await pool.getAddress(), until));
  return reservationNonce;
}

describe("VeilpotPool Gate 1B.1 production core", function () {
  it("measures representative complete Gate 1B.1 transactions locally", async function () {
    const { owner, token, pool } = await deployFixture();
    reportLocalCost(
      "reserveParticipantSlot",
      await receipt(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n })),
    );
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = BigInt(String((await pool.participantMetadata(0))[3]));
    const latest = await hre.ethers.provider.getBlock("latest");
    await receipt(
      token.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 3600)),
    );
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    reportLocalCost(
      "deposit",
      await receipt(
        pool.deposit(
          input.handle,
          input.proof,
          owner.address,
          await pool.getAddress(),
          1n,
          reservationNonce,
          0n,
        ),
      ),
    );
    const threshold = await publicBool(await pool.thresholdHandle(0));
    reportLocalCost(
      "settleThresholdTrue",
      await receipt(pool.settleThreshold(0, 1n, reservationNonce, true, threshold.proof)),
    );
    reportLocalCost("withdrawBond", await receipt(pool.withdrawBond()));
  });

  it("fails closed when an external token is paused during deposit", async function () {
    const { owner, token, pool } = await deployCustomTokenFixture("TestERC7984Pausable");
    const pausable = token as unknown as PausableToken;
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await receipt(pausable.setPaused(true));
    await expect(
      pool.deposit(
        input.handle,
        input.proof,
        owner.address,
        await pool.getAddress(),
        1n,
        reservationNonce,
        0n,
      ),
    ).to.be.reverted;
    expect(await pool.nextDepositNonce(owner.address)).to.equal(0n);
    expect(await decrypt128(await pool.canonicalReceivedHandle())).to.equal(0n);
    expect((await pool.participantMetadata(0))[0]).to.equal(1n); // RESERVED
    expect((await pool.participantMetadata(0))[6]).to.equal(0n); // no activation deadline
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(0n);
    expect(await decrypt128(await pool.aggregatePrincipalHandle())).to.equal(0n);
  });

  it("preserves pending refund state when the external token is paused", async function () {
    const { owner, other, token, pool } = await deployCustomTokenFixture("TestERC7984Pausable");
    const pausable = token as unknown as PausableToken;
    await receipt(token.mintClear(owner.address, 500_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 500_000n);
    await receipt(
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
    await receipt(pool.settleThreshold(0, 1n, reservationNonce, false, threshold.proof));
    const residualBefore = await pool.refundRemainingHandle(0);
    await expectRejected(async () =>
      hre.fhevm.userDecryptEuint(FhevmType.euint64, residualBefore, await pool.getAddress(), other),
    );
    await receipt(pausable.setPaused(true));
    await expect(pool.refundAttempt(0)).to.be.reverted;
    expect((await pool.participantMetadata(0))[0]).to.equal(4n); // PENDING_REFUND
    expect((await pool.participantMetadata(0))[7]).to.equal(0n);
    expect(await pool.refundRemainingHandle(0)).to.equal(residualBefore);
    await receipt(pausable.setPaused(false));
    await receipt(pool.refundAttempt(0));
    expect((await pool.participantMetadata(0))[0]).to.equal(5n);
  });

  it("preserves active principal obligations while an external token is paused", async function () {
    const { owner, token, pool } = await deployCustomTokenFixture("TestERC7984Pausable");
    const pausable = token as unknown as PausableToken;
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await receipt(
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
    await receipt(pool.settleThreshold(0, 1n, reservationNonce, true, threshold.proof));
    const principal = await decrypt64(await pool.principalHandle(0));
    await receipt(pausable.setPaused(true));
    expect((await pool.participantMetadata(0))[0]).to.equal(3n); // ACTIVE
    expect(await decrypt64(await pool.principalHandle(0))).to.equal(principal);
  });

  it("accounts a partial canonical deposit from the token-returned amount", async function () {
    const { owner, token, pool } = await deployCustomTokenFixture("TestERC7984PartialReturn", [
      1_500_000n,
    ]);
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await receipt(
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
    expect(await decrypt64(await pool.pendingAmountHandle(0))).to.equal(1_500_000n);
    expect(await decrypt128(await pool.canonicalReceivedHandle())).to.equal(1_500_000n);
    expect(await pool.nextDepositNonce(owner.address)).to.equal(1n);
  });

  it("executes partial refund, false completion, retry, and final release", async function () {
    const { owner, token, pool } = await deployCustomTokenFixture("TestERC7984PartialReturn", [
      300_000n,
    ]);
    const partial = token as unknown as PartialToken;
    await receipt(token.mintClear(owner.address, 500_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 500_000n);
    await receipt(
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
    await receipt(pool.settleThreshold(0, 1n, reservationNonce, false, threshold.proof));
    expect(await decrypt64(await pool.refundRemainingHandle(0))).to.equal(300_000n);
    expect(await decrypt64(await token.confidentialBalanceOf(await pool.getAddress()))).to.equal(
      300_000n,
    );

    await receipt(partial.setPartialCap(100_000n));
    reportLocalCost("refundAttemptPartial", await receipt(pool.refundAttempt(0)));
    const residualAfterPartial = await decrypt64(await pool.refundRemainingHandle(0));
    expect(residualAfterPartial).to.equal(200_000n);
    expect(residualAfterPartial).to.be.lessThan(300_000n);
    expect((await pool.participantMetadata(0))[0]).to.equal(5n);
    const falseCompletion = await publicBool(await pool.refundCompleteHandle(0));
    expect(falseCompletion.value).to.equal(false);
    reportLocalCost(
      "settleRefundCompletionFalse",
      await receipt(
        pool.settleRefundCompletion(0, 1n, reservationNonce, 1n, false, falseCompletion.proof),
      ),
    );
    expect((await pool.participantMetadata(0))[0]).to.equal(4n); // PENDING_REFUND
    expect(await decrypt64(await pool.refundRemainingHandle(0))).to.equal(200_000n);
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(200_000n);
    expect(await decrypt64(await token.confidentialBalanceOf(await pool.getAddress()))).to.equal(
      200_000n,
    );

    await receipt(partial.setPartialCap(1_000_000n));
    await receipt(pool.refundAttempt(0));
    const trueCompletion = await publicBool(await pool.refundCompleteHandle(0));
    expect(trueCompletion.value).to.equal(true);
    reportLocalCost(
      "settleRefundCompletionTruePartialRetry",
      await receipt(
        pool.settleRefundCompletion(0, 1n, reservationNonce, 2n, true, trueCompletion.proof),
      ),
    );
    expect(await pool.participantState(0)).to.equal(0n); // FREE
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(0n);
    expect(await decrypt64(await token.confidentialBalanceOf(await pool.getAddress()))).to.equal(
      0n,
    );

    const donation = await encryptedInput(await token.getAddress(), owner, 100n);
    const directTransfer = token.getFunction(
      "confidentialTransfer(address,bytes32,bytes)",
    ) as unknown as DirectTransfer;
    await receipt(directTransfer(await pool.getAddress(), donation.handle, donation.proof));
    expect(await decrypt64(await token.confidentialBalanceOf(await pool.getAddress()))).to.equal(
      100n,
    );
    expect(await decrypt128(await pool.canonicalReceivedHandle())).to.equal(300_000n);
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(0n);
    expect(await decrypt128(await pool.aggregatePrincipalHandle())).to.equal(0n);
  });

  it("rejects token-side reentrancy during deposit without duplicate accounting", async function () {
    const { owner, token, pool } = await deployCustomTokenFixture("TestERC7984Reentrant");
    const reentrant = token as unknown as ReentrantToken;
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    const payload = pool.interface.encodeFunctionData("deposit", [
      input.handle,
      input.proof,
      owner.address,
      await pool.getAddress(),
      1n,
      reservationNonce,
      0n,
    ]);
    await receipt(reentrant.configureReentry(await pool.getAddress(), payload, true));
    await receipt(
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
    expect(await reentrant.lastReentrySucceeded()).to.equal(false);
    expect(await pool.nextDepositNonce(owner.address)).to.equal(1n);
    expect((await pool.participantMetadata(0))[0]).to.equal(2n); // PENDING_ACTIVATION
  });

  it("rejects token-side reentrancy during refund without double subtraction", async function () {
    const { owner, token, pool } = await deployCustomTokenFixture("TestERC7984Reentrant");
    const reentrant = token as unknown as ReentrantToken;
    await receipt(token.mintClear(owner.address, 500_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 500_000n);
    await receipt(
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
    await receipt(pool.settleThreshold(0, 1n, reservationNonce, false, threshold.proof));
    const payload = pool.interface.encodeFunctionData("refundAttempt", [0]);
    await receipt(reentrant.configureReentry(await pool.getAddress(), payload, true));
    await receipt(pool.refundAttempt(0));
    expect(await reentrant.lastReentrySucceeded()).to.equal(false);
    expect((await pool.participantMetadata(0))[0]).to.equal(5n);
    expect((await pool.participantMetadata(0))[7]).to.equal(1n);
  });

  it("retains a failed bond receiver credit and permits other progression", async function () {
    const { owner, pool } = await deployFixture();
    const receiver = (await (
      await hre.ethers.getContractFactory("TestRejectingBondReceiver")
    ).deploy()) as unknown as RejectingBondReceiver;
    await receiver.waitForDeployment();
    await receipt(receiver.reserve(await pool.getAddress(), { value: 1_000_000_000_000_000n }));
    const expiry = BigInt(String((await pool.participantMetadata(0))[4]));
    await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(expiry + 1n)]);
    await receipt(pool.expireReservation(0));
    await expect(receiver.withdraw(await pool.getAddress())).to.be.reverted;
    expect(await pool.pendingBondRefund(await receiver.getAddress())).to.equal(
      1_000_000_000_000_000n,
    );
    await receipt(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    expect((await pool.participantMetadata(0))[0]).to.equal(1n);
    expect((await pool.participantMetadata(0))[1]).to.equal(owner.address);
  });

  it("blocks reentrant bond withdrawal and withdraws exactly once", async function () {
    const { pool } = await deployFixture();
    const receiver = (await (
      await hre.ethers.getContractFactory("TestReentrantBondReceiver")
    ).deploy(await pool.getAddress())) as unknown as ReentrantBondReceiver;
    await receiver.waitForDeployment();
    await receipt(receiver.reserve({ value: 1_000_000_000_000_000n }));
    const expiry = BigInt(String((await pool.participantMetadata(0))[4]));
    await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(expiry + 1n)]);
    await receipt(pool.expireReservation(0));
    const before = await hre.ethers.provider.getBalance(await receiver.getAddress());
    await receipt(receiver.withdraw());
    const after = await hre.ethers.provider.getBalance(await receiver.getAddress());
    expect(await receiver.nestedCallSucceeded()).to.equal(false);
    expect(after - before).to.equal(1_000_000_000_000_000n);
    expect(await pool.pendingBondRefund(await receiver.getAddress())).to.equal(0n);
  });

  it("fails closed if a token omits the pinned returned-handle ACL", async function () {
    const { owner, token, pool } = await deployCustomTokenFixture("TestERC7984NoReturnAcl");
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await expect(
      pool.deposit(
        input.handle,
        input.proof,
        owner.address,
        await pool.getAddress(),
        1n,
        reservationNonce,
        0n,
      ),
    ).to.be.reverted;
    expect(await pool.nextDepositNonce(owner.address)).to.equal(0n);
    expect((await pool.participantMetadata(0))[0]).to.equal(1n);
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(0n);
  });

  it("executes the exact pinned ERC-7984 operator and actual-return pull path", async function () {
    const { owner, token, pool } = await deployFixture();
    await receipt(token.mintClear(owner.address, 3_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    expect(await token.isOperator(owner.address, await pool.getAddress())).to.equal(true);
    const input = await encryptedInput(await pool.getAddress(), owner, 10_000_000n);
    await receipt(
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
    // Pinned ERC-7984 uses an encrypted all-or-nothing decrease: over-balance returns zero.
    expect(await decrypt64(await pool.pendingAmountHandle(0))).to.equal(0n);
    expect(await pool.nextDepositNonce(owner.address)).to.equal(1n);
    expect((await pool.participantMetadata(0))[0]).to.equal(2n); // PENDING_ACTIVATION
  });

  it("records pinned all-or-nothing actual returns at zero, below, equal, and above balance", async function () {
    const cases = [
      { requested: 0n, expected: 0n },
      { requested: 2_000_000n, expected: 2_000_000n },
      { requested: 5_000_000n, expected: 5_000_000n },
      { requested: 6_000_000n, expected: 0n },
    ];
    for (const { requested, expected } of cases) {
      const { owner, token, pool } = await deployFixture();
      await receipt(token.mintClear(owner.address, 5_000_000n));
      const reservationNonce = await reserveAndApprove(pool, token);
      const input = await encryptedInput(await pool.getAddress(), owner, requested);
      await receipt(
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
      expect(await decrypt64(await pool.pendingAmountHandle(0))).to.equal(expected);
    }
  });

  it("maintains encrypted multi-user solvency accounting and ignores direct donations", async function () {
    const { owner, other, token, pool } = await deployFixture();
    await receipt(token.mintClear(owner.address, 2_000_000n));
    await receipt(token.mintClear(other.address, 500_000n));
    const ownerReservation = await reserveAndApprove(pool, token);
    const otherPool = pool.connect(other) as unknown as Pool;
    const otherToken = token.connect(other) as unknown as TestToken;
    await receipt(otherPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const otherReservation = BigInt(String((await pool.participantMetadata(1))[3]));
    const latest = await hre.ethers.provider.getBlock("latest");
    await receipt(
      otherToken.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 3600)),
    );

    const ownerInput = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await receipt(
      pool.deposit(
        ownerInput.handle,
        ownerInput.proof,
        owner.address,
        await pool.getAddress(),
        1n,
        ownerReservation,
        0n,
      ),
    );
    const ownerThreshold = await publicBool(await pool.thresholdHandle(0));
    await receipt(pool.settleThreshold(0, 1n, ownerReservation, true, ownerThreshold.proof));

    const otherInput = await encryptedInput(await pool.getAddress(), other, 500_000n);
    await receipt(
      otherPool.deposit(
        otherInput.handle,
        otherInput.proof,
        other.address,
        await pool.getAddress(),
        1n,
        otherReservation,
        0n,
      ),
    );
    const otherThreshold = await publicBool(await pool.thresholdHandle(1));
    await receipt(pool.settleThreshold(1, 1n, otherReservation, false, otherThreshold.proof));
    expect(await decrypt128(await pool.aggregatePrincipalHandle())).to.equal(2_000_000n);
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(500_000n);
    expect(await decrypt128(await pool.canonicalReceivedHandle())).to.equal(2_500_000n);

    await receipt(pool.refundAttempt(1));
    const completion = await publicBool(await pool.refundCompleteHandle(1));
    await receipt(pool.settleRefundCompletion(1, 1n, otherReservation, 1n, true, completion.proof));
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(0n);
    expect(await decrypt128(await pool.aggregatePrincipalHandle())).to.equal(2_000_000n);
    expect(await decrypt128(await pool.canonicalReceivedHandle())).to.equal(2_500_000n);

    const direct = await encryptedInput(await token.getAddress(), owner, 100n);
    const directTransfer = token.getFunction(
      "confidentialTransfer(address,bytes32,bytes)",
    ) as unknown as DirectTransfer;
    await receipt(directTransfer(await pool.getAddress(), direct.handle, direct.proof));
    expect(await decrypt128(await pool.canonicalReceivedHandle())).to.equal(2_500_000n);
  });

  it("rejects missing, expired, and revoked operators before accounting mutation", async function () {
    const { owner, other, token, pool } = await deployFixture();
    const reservationNonce = await reserveAndApprove(pool, token);
    await receipt(token.setOperator(await pool.getAddress(), 0n));
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await expect(
      pool.deposit(
        input.handle,
        input.proof,
        owner.address,
        await pool.getAddress(),
        1n,
        reservationNonce,
        0n,
      ),
    ).to.be.reverted;
    expect(await pool.nextDepositNonce(owner.address)).to.equal(0n);
    expect((await pool.participantMetadata(0))[0]).to.equal(1n); // RESERVED

    const latest = await hre.ethers.provider.getBlock("latest");
    const current = latest?.timestamp ?? 0;
    await receipt(token.setOperator(await pool.getAddress(), BigInt(current + 1)));
    const expired = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await hre.network.provider.send("evm_setNextBlockTimestamp", [current + 2]);
    await expect(
      pool.deposit(
        expired.handle,
        expired.proof,
        owner.address,
        await pool.getAddress(),
        1n,
        reservationNonce,
        0n,
      ),
    ).to.be.reverted;
    expect(await pool.nextDepositNonce(owner.address)).to.equal(0n);

    const foreign = await encryptedInput(await pool.getAddress(), other, 2_000_000n);
    const foreignPool = pool.connect(other) as unknown as Pool;
    await expect(
      foreignPool.deposit(
        foreign.handle,
        foreign.proof,
        owner.address,
        await pool.getAddress(),
        1n,
        reservationNonce,
        0n,
      ),
    ).to.be.reverted;
    expect(await pool.nextDepositNonce(owner.address)).to.equal(0n);
  });

  it("rejects caller, domain, version, reservation, and nonce mismatches before pulling", async function () {
    const { owner, other, token, pool } = await deployFixture();
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    const base = [owner.address, await pool.getAddress(), 1n, reservationNonce, 0n] as const;
    const attempts = [
      [other, owner.address, base[1], base[2], base[3], base[4]],
      [owner, owner.address, other.address, base[2], base[3], base[4]],
      [owner, owner.address, base[1], 2n, base[3], base[4]],
      [owner, owner.address, base[1], base[2], base[3] + 1n, base[4]],
      [owner, owner.address, base[1], base[2], base[3], base[4] + 1n],
    ] as const;
    for (const [signer, depositor, claimedPool, version, nonce, depositNonce] of attempts) {
      const connected = pool.connect(signer) as unknown as Pool;
      await expect(
        connected.deposit(
          input.handle,
          input.proof,
          depositor,
          claimedPool,
          version,
          nonce,
          depositNonce,
        ),
      ).to.be.reverted;
      expect(await pool.nextDepositNonce(owner.address)).to.equal(0n);
      expect((await pool.participantMetadata(0))[0]).to.equal(1n); // RESERVED
    }
  });

  it("matches pinned inclusive operator expiry and revocation", async function () {
    const { owner, token, pool } = await deployFixture();
    await receipt(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const latest = await hre.ethers.provider.getBlock("latest");
    const until = (latest?.timestamp ?? 0) + 10;
    await receipt(token.setOperator(await pool.getAddress(), BigInt(until)));
    await hre.network.provider.send("evm_setNextBlockTimestamp", [until]);
    await hre.network.provider.send("evm_mine");
    expect(await token.isOperator(owner.address, await pool.getAddress())).to.equal(true);
    await receipt(token.setOperator(await pool.getAddress(), 0n));
    expect(await token.isOperator(owner.address, await pool.getAddress())).to.equal(false);
  });

  it("returns encrypted zero for a zero-balance pull without creating principal", async function () {
    const { owner, token, pool } = await deployFixture();
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await receipt(
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
    expect(await decrypt64(await pool.pendingAmountHandle(0))).to.equal(0n);
    expect(await decrypt128(await pool.canonicalReceivedHandle())).to.equal(0n);
  });

  it("keeps pending amounts private while exposing only the threshold predicate", async function () {
    const { owner, other, token, pool } = await deployFixture();
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await receipt(
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
    const pending = await pool.pendingAmountHandle(0);
    await expectRejected(() => hre.fhevm.publicDecrypt([pending]));
    await expectRejected(() =>
      hre.fhevm.userDecryptEuint(FhevmType.euint64, pending, pool.getAddress(), other),
    );
    const threshold = await publicBool(await pool.thresholdHandle(0));
    expect(threshold.value).to.equal(true);
  });

  it("settles true threshold into principal without retroactive accounting", async function () {
    const { owner, other, token, pool } = await deployFixture();
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await receipt(
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
    expect(threshold.value).to.equal(true);
    await receipt(pool.settleThreshold(0, 1n, reservationNonce, threshold.value, threshold.proof));
    expect((await pool.participantMetadata(0))[0]).to.equal(3n); // ACTIVE
    expect(await pool.pendingBondRefund(owner.address)).to.equal(1_000_000_000_000_000n);
    expect(await decrypt64(await pool.principalHandle(0))).to.equal(2_000_000n);
    await expectRejected(async () =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        await pool.principalHandle(0),
        await pool.getAddress(),
        other,
      ),
    );
    expect(await decrypt64(await pool.pendingAmountHandle(0))).to.equal(0n);
    expect(await decrypt128(await pool.aggregatePrincipalHandle())).to.equal(2_000_000n);
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(0n);
    expect(await decrypt128(await pool.canonicalReceivedHandle())).to.equal(2_000_000n);
  });

  it("supports false threshold, partial/zero refund, residual proof, and slot release", async function () {
    const { owner, token, pool } = await deployFixture();
    await receipt(token.mintClear(owner.address, 500_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 500_000n);
    await receipt(
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
    reportLocalCost(
      "settleThresholdFalse",
      await receipt(pool.settleThreshold(0, 1n, reservationNonce, false, threshold.proof)),
    );
    expect((await pool.participantMetadata(0))[0]).to.equal(4n); // PENDING_REFUND
    expect(await pool.pendingBondRefund(owner.address)).to.equal(1_000_000_000_000_000n);
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(500_000n);
    reportLocalCost("refundAttempt", await receipt(pool.refundAttempt(0)));
    expect((await pool.participantMetadata(0))[0]).to.equal(5n); // REFUND_ATTEMPT_PENDING_PROOF
    await expect(pool.refundAttempt(0)).to.be.reverted;
    const complete = await publicBool(await pool.refundCompleteHandle(0));
    expect(complete.value).to.equal(true);
    expect(await decrypt128(await pool.aggregatePendingHandle())).to.equal(0n);
    expect(await decrypt128(await pool.canonicalReceivedHandle())).to.equal(500_000n);
    reportLocalCost(
      "settleRefundCompletionTrue",
      await receipt(pool.settleRefundCompletion(0, 1n, reservationNonce, 1n, true, complete.proof)),
    );
    expect(await pool.participantState(0)).to.equal(0n); // FREE
  });

  it("returns the registration bond through pull accounting on reservation expiry", async function () {
    const { owner, pool } = await deployFixture();
    await receipt(pool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));
    const expiry = BigInt(String((await pool.participantMetadata(0))[4]));
    await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(expiry + 1n)]);
    await receipt(pool.expireReservation(0));
    expect(await pool.pendingBondRefund(owner.address)).to.equal(1_000_000_000_000_000n);
    await receipt(pool.withdrawBond());
    expect(await pool.pendingBondRefund(owner.address)).to.equal(0n);
    expect(await pool.participantState(0)).to.equal(0n); // FREE
  });

  it("times out activation and cannot settle a late proof", async function () {
    const { owner, token, pool } = await deployFixture();
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const reservationNonce = await reserveAndApprove(pool, token);
    const input = await encryptedInput(await pool.getAddress(), owner, 2_000_000n);
    await receipt(
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
    const thresholdHandle = await pool.thresholdHandle(0);
    const deadline = BigInt(String((await pool.participantMetadata(0))[6]));
    const threshold = await publicBool(thresholdHandle);
    await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(deadline + 1n)]);
    await expect(pool.settleThreshold(0, 1n, reservationNonce, threshold.value, threshold.proof)).to
      .be.reverted;
    reportLocalCost("expirePendingActivation", await receipt(pool.expirePendingActivation(0)));
    expect((await pool.participantMetadata(0))[0]).to.equal(4n); // PENDING_REFUND
    expect(await pool.pendingBondRefund(owner.address)).to.equal(1_000_000_000_000_000n);
  });

  it("does not account unsupported direct token sends", async function () {
    const { owner, token, pool } = await deployFixture();
    await receipt(token.mintClear(owner.address, 100n));
    const amount = await encryptedInput(await token.getAddress(), owner, 100n);
    const directTransfer = token.getFunction(
      "confidentialTransfer(address,bytes32,bytes)",
    ) as unknown as DirectTransfer;
    await receipt(directTransfer(await pool.getAddress(), amount.handle, amount.proof));
    expect(await pool.activeParticipantCount()).to.equal(0n);
    expect(await pool.nextDepositNonce(owner.address)).to.equal(0n);
  });

  it("proves the exact pinned token overload requires caller ACL", async function () {
    const { owner, token } = await deployFixture();
    await receipt(token.mintClear(owner.address, 2_000_000n));
    const caller = (await (
      await hre.ethers.getContractFactory("TestERC7984NoAclCaller")
    ).deploy()) as unknown as NoAclCaller;
    await caller.waitForDeployment();
    await hre.fhevm.assertCoprocessorInitialized(caller, "TestERC7984NoAclCaller");
    const latest = await hre.ethers.provider.getBlock("latest");
    await receipt(
      token.setOperator(await caller.getAddress(), BigInt((latest?.timestamp ?? 0) + 3600)),
    );
    const input = await encryptedInput(await caller.getAddress(), owner, 1_000_000n);
    await expect(
      caller.pullWithoutGrant(await token.getAddress(), owner.address, input.handle, input.proof),
    ).to.be.reverted;
  });
});
