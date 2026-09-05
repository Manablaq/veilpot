// Gate 8C real PoolV2 + frozen Vault Autopilot integration tests. Local Hardhat FHEVM only.
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Signer = Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
type Tx = Promise<ethers.ContractTransactionResponse>;

const TEST_PRIZE_RESERVE = "0x2222222222222222222222222222222222222222";
const TEST_YIELD_ADAPTER = "0x3333333333333333333333333333333333333333";
const REGISTRATION_VERSION = 1n;
const SLOT = 0n;
const MAX_USER_PRINCIPAL = 1_000_000_000_000n;

interface Token extends ethers.BaseContract {
  mintClear(to: string, amount: bigint): Tx;
  setOperator(operator: string, until: bigint): Tx;
  isOperator(holder: string, spender: string): Promise<boolean>;
  confidentialBalanceOf(account: string): Promise<Handle>;
}

interface PartialToken extends Token {
  setPartialCap(cap: bigint): Tx;
}

interface ReentrantToken extends Token {
  configureReentry(target: string, payload: string, enabled: boolean): Tx;
  lastReentrySucceeded(): Promise<boolean>;
}

interface Pool extends ethers.BaseContract {
  reserveParticipantSlot(overrides: { value: bigint }): Tx;
  participantMetadata(slot: bigint): Promise<readonly unknown[]>;
  deposit(
    amount: Handle,
    proof: string,
    depositor: string,
    claimedPool: string,
    registrationVersion: bigint,
    reservationNonce: bigint,
    depositNonce: bigint,
  ): Tx;
  settleThreshold(
    slot: bigint,
    registrationVersion: bigint,
    reservationNonce: bigint,
    clearSatisfied: boolean,
    proof: string,
  ): Tx;
  thresholdHandle(slot: bigint): Promise<Handle>;
  principalHandle(slot: bigint): Promise<Handle>;
  twabAccumulatorHandle(slot: bigint): Promise<Handle>;
  canonicalReceivedHandle(): Promise<Handle>;
  withdraw(
    amount: Handle,
    proof: string,
    registrationVersion: bigint,
    reservationNonce: bigint,
    withdrawalNonce: bigint,
  ): Tx;
  deregistrationZeroHandle(slot: bigint): Promise<Handle>;
  prepareDeregistration(slot: bigint): Tx;
  settleDeregistration(slot: bigint, clearZero: boolean, proof: string): Tx;
  pullAutopilotContribution(slot: bigint, reservationNonce: bigint, authorizedAmount: Handle): Tx;
}

interface Vault extends ethers.BaseContract {
  confidentialToken(): Promise<string>;
  pool(): Promise<string>;
  nextPlanNonce(owner: string): Promise<bigint>;
  planIdFor(
    owner: string,
    registrationVersion: bigint,
    reservationNonce: bigint,
    planNonce: bigint,
  ): Promise<Handle>;
  scheduleLeaf(planId: Handle, index: bigint, notBefore: bigint, notAfter: bigint): Promise<Handle>;
  createPlan(
    slot: bigint,
    registrationVersion: bigint,
    reservationNonce: bigint,
    planNonce: bigint,
    scheduleRoot: Handle,
    executionCount: bigint,
    encryptedPeriodAmount: Handle,
    encryptedLifetimeCap: Handle,
    inputProof: string,
  ): Tx;
  planMetadata(planId: Handle): Promise<readonly unknown[]>;
  planAmountHandles(planId: Handle): Promise<readonly [Handle, Handle, Handle]>;
  execute(
    planId: Handle,
    index: bigint,
    notBefore: bigint,
    notAfter: bigint,
    proof: readonly Handle[],
  ): Tx;
}

type TransferAndCall = (
  to: string,
  encryptedAmount: Handle,
  inputProof: string,
  data: string,
) => Tx;

interface Pair {
  owner: Signer;
  keeper: Signer;
  other: Signer;
  token: Token;
  pool: Pool;
  vault: Vault;
  predictedPool: string;
  predictedVault: string;
}

interface Activation {
  reservationNonce: bigint;
  activationTime: bigint;
}

interface PlanWindow {
  planId: Handle;
  notBefore: bigint;
  notAfter: bigint;
}

async function waitFor(tx: Tx): Promise<ethers.TransactionReceipt> {
  const receipt = await (await tx).wait();
  if (receipt === null) throw new Error("missing receipt");
  return receipt;
}

async function decrypt64(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint64, handle);
}

async function decrypt128(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);
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

async function encrypted64(address: string, signer: Signer, amount: bigint) {
  const input = hre.fhevm.createEncryptedInput(address, signer.address);
  input.add64(amount);
  const encrypted = await input.encrypt();
  return {
    handle: ethers.hexlify(encrypted.handles[0]!) as Handle,
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

async function encrypted64Pair(address: string, signer: Signer, first: bigint, second: bigint) {
  const input = hre.fhevm.createEncryptedInput(address, signer.address);
  input.add64(first);
  input.add64(second);
  const encrypted = await input.encrypt();

  if (encrypted.handles.length !== 2) {
    throw new Error("expected exactly two encrypted handles");
  }

  return {
    first: ethers.hexlify(encrypted.handles[0]!) as Handle,
    second: ethers.hexlify(encrypted.handles[1]!) as Handle,
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

async function publicBool(handle: Handle): Promise<{ value: boolean; proof: string }> {
  const result = await hre.fhevm.publicDecrypt([handle]);
  const value = result.clearValues[handle];
  if (typeof value !== "boolean") throw new Error("expected encrypted boolean");
  return { value, proof: result.decryptionProof };
}

async function setTimestamp(timestamp: bigint): Promise<void> {
  const latest = await hre.ethers.provider.getBlock("latest");
  const current = BigInt(latest?.timestamp ?? 0);

  if (timestamp <= current) return;

  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await hre.network.provider.send("evm_mine");
}

async function deployPair(
  tokenFactoryName = "TestERC7984",
  tokenConstructorArgs: readonly unknown[] = [],
): Promise<Pair> {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;
  const keeper = signers[1]!;
  const other = signers[2]!;

  const token = (await (
    await hre.ethers.getContractFactory(tokenFactoryName)
  ).deploy(...tokenConstructorArgs)) as unknown as Token;

  await token.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(token, tokenFactoryName);

  const poolFactory = await hre.ethers.getContractFactory("VeilpotPoolV2");
  const vaultFactory = await hre.ethers.getContractFactory("VeilpotAutopilotVault");

  const nonce = await hre.ethers.provider.getTransactionCount(owner.address, "pending");

  const predictedPool = ethers.getCreateAddress({
    from: owner.address,
    nonce,
  });

  const predictedVault = ethers.getCreateAddress({
    from: owner.address,
    nonce: nonce + 1,
  });

  const pool = (await poolFactory.deploy(
    await token.getAddress(),
    TEST_PRIZE_RESERVE,
    predictedVault,
    TEST_YIELD_ADAPTER,
  )) as unknown as Pool;

  await pool.waitForDeployment();

  const vault = (await vaultFactory.deploy(
    await token.getAddress(),
    predictedPool,
  )) as unknown as Vault;

  await vault.waitForDeployment();

  expect(await pool.getAddress()).to.equal(predictedPool);
  expect(await vault.getAddress()).to.equal(predictedVault);
  expect(await vault.pool()).to.equal(predictedPool);
  expect(await vault.confidentialToken()).to.equal(await token.getAddress());

  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPoolV2");
  await hre.fhevm.assertCoprocessorInitialized(vault, "VeilpotAutopilotVault");

  return {
    owner,
    keeper,
    other,
    token,
    pool,
    vault,
    predictedPool,
    predictedVault,
  };
}

async function activate(pair: Pair, principal: bigint): Promise<Activation> {
  const userPool = pair.pool.connect(pair.owner) as unknown as Pool;
  const userToken = pair.token.connect(pair.owner) as unknown as Token;

  await waitFor(userPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));

  const metadata = await pair.pool.participantMetadata(SLOT);
  const reservationNonce = BigInt(String(metadata[3]));

  await waitFor(userToken.mintClear(pair.owner.address, principal));

  const latest = await hre.ethers.provider.getBlock("latest");
  await waitFor(
    userToken.setOperator(await pair.pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 3_600)),
  );

  const depositInput = await encrypted64(await pair.pool.getAddress(), pair.owner, principal);

  await waitFor(
    userPool.deposit(
      depositInput.handle,
      depositInput.proof,
      pair.owner.address,
      await pair.pool.getAddress(),
      REGISTRATION_VERSION,
      reservationNonce,
      0n,
    ),
  );

  const threshold = await publicBool(await pair.pool.thresholdHandle(SLOT));
  expect(threshold.value).to.equal(true);

  const activationReceipt = await waitFor(
    userPool.settleThreshold(SLOT, REGISTRATION_VERSION, reservationNonce, true, threshold.proof),
  );

  const activationBlock = await hre.ethers.provider.getBlock(activationReceipt.blockNumber);
  const activationTime = BigInt(activationBlock?.timestamp ?? 0);

  await waitFor(userToken.setOperator(await pair.pool.getAddress(), 0n));

  expect(await pair.token.isOperator(pair.owner.address, await pair.pool.getAddress())).to.equal(
    false,
  );

  return {
    reservationNonce,
    activationTime,
  };
}

async function createSingleExecutionPlan(
  pair: Pair,
  reservationNonce: bigint,
  periodAmount: bigint,
  lifetimeCap: bigint,
): Promise<PlanWindow> {
  const ownerVault = pair.vault.connect(pair.owner) as unknown as Vault;
  const planNonce = await pair.vault.nextPlanNonce(pair.owner.address);
  const planId = await pair.vault.planIdFor(
    pair.owner.address,
    REGISTRATION_VERSION,
    reservationNonce,
    planNonce,
  );

  const latest = await hre.ethers.provider.getBlock("latest");
  const notBefore = BigInt(latest?.timestamp ?? 0) + 100n;
  const notAfter = notBefore + 1_000n;

  const scheduleRoot = await pair.vault.scheduleLeaf(planId, 0n, notBefore, notAfter);

  const encrypted = await encrypted64Pair(
    await pair.vault.getAddress(),
    pair.owner,
    periodAmount,
    lifetimeCap,
  );

  await waitFor(
    ownerVault.createPlan(
      SLOT,
      REGISTRATION_VERSION,
      reservationNonce,
      planNonce,
      scheduleRoot,
      1n,
      encrypted.first,
      encrypted.second,
      encrypted.proof,
    ),
  );

  return {
    planId,
    notBefore,
    notAfter,
  };
}

async function fundPlan(
  pair: Pair,
  planId: Handle,
  amount: bigint,
  signer: Signer = pair.owner,
): Promise<ethers.TransactionReceipt> {
  const userToken = pair.token.connect(signer) as unknown as Token;

  await waitFor(userToken.mintClear(signer.address, amount));

  const encrypted = await encrypted64(await pair.token.getAddress(), signer, amount);

  const data = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [planId]);

  const transferAndCall = userToken.getFunction(
    "confidentialTransferAndCall(address,bytes32,bytes,bytes)",
  ) as unknown as TransferAndCall;

  return waitFor(
    transferAndCall(await pair.vault.getAddress(), encrypted.handle, encrypted.proof, data),
  );
}

async function planAmounts(pair: Pair, planId: Handle) {
  const [periodHandle, budgetHandle, fundsHandle] = await pair.vault.planAmountHandles(planId);

  return {
    periodHandle,
    budgetHandle,
    fundsHandle,
    period: await decrypt64(periodHandle),
    budget: await decrypt64(budgetHandle),
    funds: await decrypt64(fundsHandle),
  };
}

function planState(metadata: readonly unknown[]): bigint {
  return BigInt(String(metadata[0]));
}

function nextExecutionIndex(metadata: readonly unknown[]): bigint {
  return BigInt(String(metadata[8]));
}

async function tokenLogs(
  token: Token,
  receipt: ethers.TransactionReceipt,
): Promise<ethers.LogDescription[]> {
  const tokenAddress = (await token.getAddress()).toLowerCase();
  const parsed: ethers.LogDescription[] = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== tokenAddress) continue;

    try {
      const event = token.interface.parseLog(log);
      if (event !== null) parsed.push(event);
    } catch {
      // Ignore non-token ABI logs defensively.
    }
  }

  return parsed;
}

describe("Veilpot Gate 8C frozen AutopilotVault against PoolV2", function () {
  it("deploys a mutually immutable-bound Pool+Vault pair and rejects non-Vault Pool callers", async function () {
    const pair = await deployPair();

    expect(await pair.pool.getAddress()).to.equal(pair.predictedPool);
    expect(await pair.vault.getAddress()).to.equal(pair.predictedVault);

    expect(await pair.token.isOperator(pair.owner.address, await pair.vault.getAddress())).to.equal(
      false,
    );

    expect(await pair.token.isOperator(pair.owner.address, await pair.pool.getAddress())).to.equal(
      false,
    );

    await expect(
      pair.pool.pullAutopilotContribution(SLOT, 0n, ethers.ZeroHash as Handle),
    ).to.be.revertedWithCustomError(pair.pool, "OperatorUnauthorized");
  });

  it("binds plans to the active participant, funds directly without wallet operators, and withholds keeper decryption", async function () {
    const pair = await deployPair();
    const activation = await activate(pair, 2_000_000n);

    const otherVault = pair.vault.connect(pair.other) as unknown as Vault;
    const otherNonce = await pair.vault.nextPlanNonce(pair.other.address);
    const otherPlanId = await pair.vault.planIdFor(
      pair.other.address,
      REGISTRATION_VERSION,
      activation.reservationNonce,
      otherNonce,
    );

    const latest = await hre.ethers.provider.getBlock("latest");
    const otherNotBefore = BigInt(latest?.timestamp ?? 0) + 100n;
    const otherNotAfter = otherNotBefore + 1_000n;
    const otherRoot = await pair.vault.scheduleLeaf(otherPlanId, 0n, otherNotBefore, otherNotAfter);

    const otherEncrypted = await encrypted64Pair(
      await pair.vault.getAddress(),
      pair.other,
      500_000n,
      1_000_000n,
    );

    await expect(
      otherVault.createPlan(
        SLOT,
        REGISTRATION_VERSION,
        activation.reservationNonce,
        otherNonce,
        otherRoot,
        1n,
        otherEncrypted.first,
        otherEncrypted.second,
        otherEncrypted.proof,
      ),
    ).to.be.revertedWithCustomError(pair.vault, "InvalidParticipantBinding");

    const plan = await createSingleExecutionPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
    );

    const initialAmounts = await planAmounts(pair, plan.planId);
    expect(initialAmounts.period).to.equal(500_000n);
    expect(initialAmounts.budget).to.equal(1_000_000n);
    expect(initialAmounts.funds).to.equal(0n);

    const ownerPeriod = await hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      initialAmounts.periodHandle,
      await pair.vault.getAddress(),
      pair.owner,
    );
    expect(ownerPeriod).to.equal(500_000n);

    await expectRejected(() =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        initialAmounts.periodHandle,
        pair.vault.getAddress(),
        pair.keeper,
      ),
    );

    await waitFor(
      (pair.token.connect(pair.other) as unknown as Token).mintClear(pair.other.address, 100_000n),
    );

    const wrongBefore = await decrypt64(await pair.token.confidentialBalanceOf(pair.other.address));

    const wrongInput = await encrypted64(await pair.token.getAddress(), pair.other, 100_000n);

    const wrongData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [plan.planId]);

    const wrongTransfer = (pair.token.connect(pair.other) as unknown as Token).getFunction(
      "confidentialTransferAndCall(address,bytes32,bytes,bytes)",
    ) as unknown as TransferAndCall;

    await expect(
      wrongTransfer(await pair.vault.getAddress(), wrongInput.handle, wrongInput.proof, wrongData),
    ).to.be.reverted;

    expect(await decrypt64(await pair.token.confidentialBalanceOf(pair.other.address))).to.equal(
      wrongBefore,
    );

    await fundPlan(pair, plan.planId, 600_000n);

    expect(await pair.token.isOperator(pair.owner.address, await pair.vault.getAddress())).to.equal(
      false,
    );

    expect(await pair.token.isOperator(pair.owner.address, await pair.pool.getAddress())).to.equal(
      false,
    );

    expect((await planAmounts(pair, plan.planId)).funds).to.equal(600_000n);
  });

  it("executes one full contribution with JIT grant-pull-revoke ordering, old-principal TWAB, actual accounting, and replay closure", async function () {
    const pair = await deployPair();
    const activation = await activate(pair, 2_000_000n);
    const plan = await createSingleExecutionPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
    );

    await fundPlan(pair, plan.planId, 700_000n);
    await setTimestamp(plan.notBefore);

    const keeperVault = pair.vault.connect(pair.keeper) as unknown as Vault;
    const executionReceipt = await waitFor(
      keeperVault.execute(plan.planId, 0n, plan.notBefore, plan.notAfter, []),
    );

    const executionBlock = await hre.ethers.provider.getBlock(executionReceipt.blockNumber);
    const executionTime = BigInt(executionBlock?.timestamp ?? 0);

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(2_500_000n);
    expect(await decrypt128(await pair.pool.canonicalReceivedHandle())).to.equal(2_500_000n);

    const amounts = await planAmounts(pair, plan.planId);
    expect(amounts.period).to.equal(500_000n);
    expect(amounts.budget).to.equal(500_000n);
    expect(amounts.funds).to.equal(200_000n);

    const metadata = await pair.vault.planMetadata(plan.planId);
    expect(planState(metadata)).to.equal(4n);
    expect(nextExecutionIndex(metadata)).to.equal(1n);

    expect(
      await pair.token.isOperator(await pair.vault.getAddress(), await pair.pool.getAddress()),
    ).to.equal(false);

    const parsed = await tokenLogs(pair.token, executionReceipt);
    expect(parsed.map((event) => event.name)).to.deep.equal([
      "OperatorSet",
      "ConfidentialTransfer",
      "OperatorSet",
    ]);

    const grant = parsed[0]!;
    const transfer = parsed[1]!;
    const revoke = parsed[2]!;

    expect(String(grant.args[0]).toLowerCase()).to.equal(
      (await pair.vault.getAddress()).toLowerCase(),
    );
    expect(String(grant.args[1]).toLowerCase()).to.equal(
      (await pair.pool.getAddress()).toLowerCase(),
    );
    expect(BigInt(String(grant.args[2]))).to.equal(executionTime);

    expect(String(transfer.args[0]).toLowerCase()).to.equal(
      (await pair.vault.getAddress()).toLowerCase(),
    );
    expect(String(transfer.args[1]).toLowerCase()).to.equal(
      (await pair.pool.getAddress()).toLowerCase(),
    );

    expect(String(revoke.args[0]).toLowerCase()).to.equal(
      (await pair.vault.getAddress()).toLowerCase(),
    );
    expect(String(revoke.args[1]).toLowerCase()).to.equal(
      (await pair.pool.getAddress()).toLowerCase(),
    );
    expect(BigInt(String(revoke.args[2]))).to.equal(0n);

    expect(await decrypt128(await pair.pool.twabAccumulatorHandle(SLOT))).to.equal(
      2_000_000n * (executionTime - activation.activationTime),
    );

    await expect(keeperVault.execute(plan.planId, 0n, plan.notBefore, plan.notAfter, [])).to.be
      .reverted;

    await expectRejected(() =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        amounts.fundsHandle,
        pair.vault.getAddress(),
        pair.keeper,
      ),
    );
  });

  it("invalidates a previously TRUE deregistration proof after a positive Autopilot principal credit", async function () {
    const pair = await deployPair();
    const activation = await activate(pair, 2_000_000n);

    const plan = await createSingleExecutionPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      500_000n,
    );

    await fundPlan(pair, plan.planId, 500_000n);

    const userPool = pair.pool.connect(pair.owner) as unknown as Pool;

    const withdrawal = await encrypted64(await pair.pool.getAddress(), pair.owner, 2_000_000n);

    await waitFor(
      userPool.withdraw(
        withdrawal.handle,
        withdrawal.proof,
        REGISTRATION_VERSION,
        activation.reservationNonce,
        0n,
      ),
    );

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(0n);

    const staleZeroHandle = await pair.pool.deregistrationZeroHandle(SLOT);

    const staleZero = await publicBool(staleZeroHandle);

    expect(staleZero.value).to.equal(true);

    await setTimestamp(plan.notBefore);

    await waitFor(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        plan.notBefore,
        plan.notAfter,
        [],
      ),
    );

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(500_000n);

    await expect(userPool.settleDeregistration(SLOT, true, staleZero.proof)).to.be.reverted;

    const metadataAfterStaleProof = await pair.pool.participantMetadata(SLOT);

    expect(BigInt(String(metadataAfterStaleProof[0]))).to.equal(3n);

    expect(String(metadataAfterStaleProof[1]).toLowerCase()).to.equal(
      pair.owner.address.toLowerCase(),
    );

    await waitFor(userPool.prepareDeregistration(SLOT));

    const freshZeroHandle = await pair.pool.deregistrationZeroHandle(SLOT);

    expect(freshZeroHandle.toLowerCase()).not.to.equal(staleZeroHandle.toLowerCase());

    const freshZero = await publicBool(freshZeroHandle);

    expect(freshZero.value).to.equal(false);

    await expect(
      userPool.settleDeregistration(SLOT, false, freshZero.proof),
    ).to.be.revertedWithCustomError(pair.pool, "DeregistrationNotActive");

    const finalMetadata = await pair.pool.participantMetadata(SLOT);

    expect(BigInt(String(finalMetadata[0]))).to.equal(3n);

    expect(String(finalMetadata[1]).toLowerCase()).to.equal(pair.owner.address.toLowerCase());

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(500_000n);
  });

  it("debits Vault funds and lifetime budget only by a partial token actual return", async function () {
    const pair = await deployPair("TestERC7984PartialReturn", [MAX_USER_PRINCIPAL]);
    const partial = pair.token as unknown as PartialToken;

    const activation = await activate(pair, 2_000_000n);
    const plan = await createSingleExecutionPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
    );

    await fundPlan(pair, plan.planId, 700_000n);
    await waitFor(partial.setPartialCap(200_000n));
    await setTimestamp(plan.notBefore);

    await waitFor(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        plan.notBefore,
        plan.notAfter,
        [],
      ),
    );

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(2_200_000n);

    const amounts = await planAmounts(pair, plan.planId);
    expect(amounts.funds).to.equal(500_000n);
    expect(amounts.budget).to.equal(800_000n);

    expect(
      await decrypt64(await pair.token.confidentialBalanceOf(await pair.pool.getAddress())),
    ).to.equal(2_200_000n);

    expect(
      await pair.token.isOperator(await pair.vault.getAddress(), await pair.pool.getAddress()),
    ).to.equal(false);
  });

  it("consumes a valid schedule slot on zero actual transfer without creating principal or debiting encrypted plan balances", async function () {
    const pair = await deployPair("TestERC7984PartialReturn", [MAX_USER_PRINCIPAL]);
    const partial = pair.token as unknown as PartialToken;

    const activation = await activate(pair, 2_000_000n);
    const plan = await createSingleExecutionPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
    );

    await fundPlan(pair, plan.planId, 700_000n);
    await waitFor(partial.setPartialCap(0n));
    await setTimestamp(plan.notBefore);

    const keeperVault = pair.vault.connect(pair.keeper) as unknown as Vault;

    await waitFor(keeperVault.execute(plan.planId, 0n, plan.notBefore, plan.notAfter, []));

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(2_000_000n);

    const amounts = await planAmounts(pair, plan.planId);
    expect(amounts.funds).to.equal(700_000n);
    expect(amounts.budget).to.equal(1_000_000n);

    const metadata = await pair.vault.planMetadata(plan.planId);
    expect(planState(metadata)).to.equal(4n);
    expect(nextExecutionIndex(metadata)).to.equal(1n);

    await expect(keeperVault.execute(plan.planId, 0n, plan.notBefore, plan.notAfter, [])).to.be
      .reverted;

    expect(
      await pair.token.isOperator(await pair.vault.getAddress(), await pair.pool.getAddress()),
    ).to.equal(false);
  });

  it("clamps the encrypted Autopilot contribution to the exact remaining principal capacity", async function () {
    const pair = await deployPair();
    const initialPrincipal = MAX_USER_PRINCIPAL - 100_000n;

    const activation = await activate(pair, initialPrincipal);
    const plan = await createSingleExecutionPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      500_000n,
    );

    await fundPlan(pair, plan.planId, 500_000n);
    await setTimestamp(plan.notBefore);

    await waitFor(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        plan.notBefore,
        plan.notAfter,
        [],
      ),
    );

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(MAX_USER_PRINCIPAL);

    const amounts = await planAmounts(pair, plan.planId);
    expect(amounts.funds).to.equal(400_000n);
    expect(amounts.budget).to.equal(400_000n);

    expect(
      await decrypt64(await pair.token.confidentialBalanceOf(await pair.pool.getAddress())),
    ).to.equal(MAX_USER_PRINCIPAL);
  });

  it("blocks token-side nested execution while preserving exactly one successful outer Autopilot credit", async function () {
    const pair = await deployPair("TestERC7984Reentrant");
    const reentrant = pair.token as unknown as ReentrantToken;

    const activation = await activate(pair, 2_000_000n);
    const plan = await createSingleExecutionPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
    );

    await fundPlan(pair, plan.planId, 700_000n);

    const payload = pair.vault.interface.encodeFunctionData("execute", [
      plan.planId,
      0n,
      plan.notBefore,
      plan.notAfter,
      [],
    ]);

    await waitFor(reentrant.configureReentry(await pair.vault.getAddress(), payload, true));

    await setTimestamp(plan.notBefore);

    await waitFor(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        plan.notBefore,
        plan.notAfter,
        [],
      ),
    );

    expect(await reentrant.lastReentrySucceeded()).to.equal(false);
    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(2_500_000n);

    const amounts = await planAmounts(pair, plan.planId);
    expect(amounts.funds).to.equal(200_000n);
    expect(amounts.budget).to.equal(500_000n);

    const metadata = await pair.vault.planMetadata(plan.planId);
    expect(nextExecutionIndex(metadata)).to.equal(1n);
    expect(planState(metadata)).to.equal(4n);

    expect(
      await pair.token.isOperator(await pair.vault.getAddress(), await pair.pool.getAddress()),
    ).to.equal(false);
  });
});
