// Gate 2C-C3B2B schedule/liveness/callback/ACL/rollback adversarial expansion.
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Signer = Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
type Tx = Promise<ethers.ContractTransactionResponse>;

const TEST_PRIZE_RESERVE = "0x2222222222222222222222222222222222222222";
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

interface PausableToken extends Token {
  setPaused(value: boolean): Tx;
}

interface ToggleReturnAclToken extends Token {
  setBreakReturnAcl(value: boolean): Tx;
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
  pausePlan(planId: Handle): Tx;
  resumePlan(planId: Handle): Tx;
  revokePlan(planId: Handle): Tx;
  skipNext(
    planId: Handle,
    index: bigint,
    notBefore: bigint,
    notAfter: bigint,
    proof: readonly Handle[],
  ): Tx;
  advanceMissed(
    planId: Handle,
    index: bigint,
    notBefore: bigint,
    notAfter: bigint,
    proof: readonly Handle[],
  ): Tx;
  withdrawPlanFunds(planId: Handle): Tx;
  onConfidentialTransferReceived(operator: string, from: string, amount: Handle, data: string): Tx;
}

interface NegativeHarness extends ethers.BaseContract {
  pullWithoutOperator(
    slot: bigint,
    reservationNonce: bigint,
    encryptedAmount: Handle,
    inputProof: string,
  ): Tx;
  pullWithoutPoolAcl(
    slot: bigint,
    reservationNonce: bigint,
    encryptedAmount: Handle,
    inputProof: string,
  ): Tx;
}

type TransferAndCall = (
  to: string,
  encryptedAmount: Handle,
  inputProof: string,
  data: string,
) => Tx;

interface RealPair {
  owner: Signer;
  keeper: Signer;
  other: Signer;
  token: Token;
  pool: Pool;
  vault: Vault;
}

interface NegativePair {
  owner: Signer;
  token: Token;
  pool: Pool;
  harness: NegativeHarness;
}

interface Activation {
  reservationNonce: bigint;
  activationTime: bigint;
}

interface WindowSpec {
  notBefore: bigint;
  notAfter: bigint;
}

interface CreatedPlan {
  planId: Handle;
  planNonce: bigint;
  root: Handle;
  windows: readonly WindowSpec[];
  leaves: readonly Handle[];
  proofs: readonly (readonly Handle[])[];
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

  if (typeof value !== "boolean") {
    throw new Error("expected encrypted boolean");
  }

  return {
    value,
    proof: result.decryptionProof,
  };
}

async function setTimestamp(timestamp: bigint): Promise<void> {
  const latest = await hre.ethers.provider.getBlock("latest");
  const current = BigInt(latest?.timestamp ?? 0);

  if (timestamp <= current) return;

  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await hre.network.provider.send("evm_mine");
}

async function setNextTransactionTimestamp(timestamp: bigint): Promise<void> {
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
}

function commutativeHash(a: Handle, b: Handle): Handle {
  const [left, right] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([left, right])) as Handle;
}

function state(metadata: readonly unknown[]): bigint {
  return BigInt(String(metadata[0]));
}

function nextIndex(metadata: readonly unknown[]): bigint {
  return BigInt(String(metadata[8]));
}

function lastWindowNotAfter(metadata: readonly unknown[]): bigint {
  return BigInt(String(metadata[9]));
}

async function deployRealPair(
  tokenFactoryName = "TestERC7984",
  tokenConstructorArgs: readonly unknown[] = [],
): Promise<RealPair> {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;
  const keeper = signers[1]!;
  const other = signers[2]!;

  const token = (await (
    await hre.ethers.getContractFactory(tokenFactoryName)
  ).deploy(...tokenConstructorArgs)) as unknown as Token;

  await token.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(token, tokenFactoryName);

  const poolFactory = await hre.ethers.getContractFactory("VeilpotPool");
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

  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPool");
  await hre.fhevm.assertCoprocessorInitialized(vault, "VeilpotAutopilotVault");

  return {
    owner,
    keeper,
    other,
    token,
    pool,
    vault,
  };
}

async function deployNegativePair(): Promise<NegativePair> {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;

  const token = (await (
    await hre.ethers.getContractFactory("TestERC7984")
  ).deploy()) as unknown as Token;

  await token.waitForDeployment();
  await hre.fhevm.assertCoprocessorInitialized(token, "TestERC7984");

  const poolFactory = await hre.ethers.getContractFactory("VeilpotPool");
  const harnessFactory = await hre.ethers.getContractFactory("TestAutopilotVaultNegativeHarness");

  const nonce = await hre.ethers.provider.getTransactionCount(owner.address, "pending");
  const predictedPool = ethers.getCreateAddress({
    from: owner.address,
    nonce,
  });
  const predictedHarness = ethers.getCreateAddress({
    from: owner.address,
    nonce: nonce + 1,
  });

  const pool = (await poolFactory.deploy(
    await token.getAddress(),
    TEST_PRIZE_RESERVE,
    predictedHarness,
  )) as unknown as Pool;

  await pool.waitForDeployment();

  const harness = (await harnessFactory.deploy(
    await token.getAddress(),
    predictedPool,
  )) as unknown as NegativeHarness;

  await harness.waitForDeployment();

  expect(await pool.getAddress()).to.equal(predictedPool);
  expect(await harness.getAddress()).to.equal(predictedHarness);

  await hre.fhevm.assertCoprocessorInitialized(pool, "VeilpotPool");
  await hre.fhevm.assertCoprocessorInitialized(harness, "TestAutopilotVaultNegativeHarness");

  return {
    owner,
    token,
    pool,
    harness,
  };
}

async function activate(
  pool: Pool,
  token: Token,
  owner: Signer,
  principal: bigint,
): Promise<Activation> {
  const userPool = pool.connect(owner) as unknown as Pool;
  const userToken = token.connect(owner) as unknown as Token;

  await waitFor(userPool.reserveParticipantSlot({ value: 1_000_000_000_000_000n }));

  const metadata = await pool.participantMetadata(SLOT);
  const reservationNonce = BigInt(String(metadata[3]));

  await waitFor(userToken.mintClear(owner.address, principal));

  const latest = await hre.ethers.provider.getBlock("latest");
  await waitFor(
    userToken.setOperator(await pool.getAddress(), BigInt((latest?.timestamp ?? 0) + 3_600)),
  );

  const deposit = await encrypted64(await pool.getAddress(), owner, principal);

  await waitFor(
    userPool.deposit(
      deposit.handle,
      deposit.proof,
      owner.address,
      await pool.getAddress(),
      REGISTRATION_VERSION,
      reservationNonce,
      0n,
    ),
  );

  const threshold = await publicBool(await pool.thresholdHandle(SLOT));
  expect(threshold.value).to.equal(true);

  const activationReceipt = await waitFor(
    userPool.settleThreshold(SLOT, REGISTRATION_VERSION, reservationNonce, true, threshold.proof),
  );

  const activationBlock = await hre.ethers.provider.getBlock(activationReceipt.blockNumber);
  const activationTime = BigInt(activationBlock?.timestamp ?? 0);

  await waitFor(userToken.setOperator(await pool.getAddress(), 0n));

  expect(await token.isOperator(owner.address, await pool.getAddress())).to.equal(false);

  return {
    reservationNonce,
    activationTime,
  };
}

async function defaultWindows(count: 1 | 2): Promise<readonly WindowSpec[]> {
  const latest = await hre.ethers.provider.getBlock("latest");
  const firstNotBefore = BigInt(latest?.timestamp ?? 0) + 300n;
  const first = {
    notBefore: firstNotBefore,
    notAfter: firstNotBefore + 200n,
  };

  if (count === 1) {
    return [first];
  }

  return [
    first,
    {
      notBefore: first.notAfter + 50n,
      notAfter: first.notAfter + 250n,
    },
  ];
}

async function createPlan(
  pair: RealPair,
  reservationNonce: bigint,
  periodAmount: bigint,
  lifetimeCap: bigint,
  windows: readonly WindowSpec[],
): Promise<CreatedPlan> {
  if (windows.length !== 1 && windows.length !== 2) {
    throw new Error("test helper supports exactly one or two windows");
  }

  const ownerVault = pair.vault.connect(pair.owner) as unknown as Vault;
  const planNonce = await pair.vault.nextPlanNonce(pair.owner.address);
  const planId = await pair.vault.planIdFor(
    pair.owner.address,
    REGISTRATION_VERSION,
    reservationNonce,
    planNonce,
  );

  const leaves: Handle[] = [];
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index]!;
    leaves.push(
      await pair.vault.scheduleLeaf(planId, BigInt(index), window.notBefore, window.notAfter),
    );
  }

  const root = leaves.length === 1 ? leaves[0]! : commutativeHash(leaves[0]!, leaves[1]!);

  const proofs: readonly Handle[][] = leaves.length === 1 ? [[]] : [[leaves[1]!], [leaves[0]!]];

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
      root,
      BigInt(windows.length),
      encrypted.first,
      encrypted.second,
      encrypted.proof,
    ),
  );

  return {
    planId,
    planNonce,
    root,
    windows,
    leaves,
    proofs,
  };
}

async function transferAndCallExisting(
  pair: RealPair,
  signer: Signer,
  amount: bigint,
  data: string,
): Promise<ethers.TransactionReceipt> {
  const userToken = pair.token.connect(signer) as unknown as Token;
  const encrypted = await encrypted64(await pair.token.getAddress(), signer, amount);

  const transfer = userToken.getFunction(
    "confidentialTransferAndCall(address,bytes32,bytes,bytes)",
  ) as unknown as TransferAndCall;

  return waitFor(transfer(await pair.vault.getAddress(), encrypted.handle, encrypted.proof, data));
}

async function fundPlan(
  pair: RealPair,
  planId: Handle,
  amount: bigint,
): Promise<ethers.TransactionReceipt> {
  await waitFor(
    (pair.token.connect(pair.owner) as unknown as Token).mintClear(pair.owner.address, amount),
  );

  const data = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [planId]);
  return transferAndCallExisting(pair, pair.owner, amount, data);
}

async function planAmounts(pair: RealPair, planId: Handle) {
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

describe("Veilpot Gate 2C-C3B2B Autopilot adversarial closeout", function () {
  it("matches the exact plan/schedule cryptographic domain and rejects plan-nonce replay", async function () {
    const pair = await deployRealPair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);

    const planNonce = await pair.vault.nextPlanNonce(pair.owner.address);
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;

    const onchainPlanId = await pair.vault.planIdFor(
      pair.owner.address,
      REGISTRATION_VERSION,
      activation.reservationNonce,
      planNonce,
    );

    const expectedPlanId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "address", "address", "address", "uint256", "uint256", "uint256"],
        [
          chainId,
          await pair.vault.getAddress(),
          await pair.pool.getAddress(),
          await pair.token.getAddress(),
          pair.owner.address,
          REGISTRATION_VERSION,
          activation.reservationNonce,
          planNonce,
        ],
      ),
    ) as Handle;

    expect(onchainPlanId).to.equal(expectedPlanId);

    const windows = await defaultWindows(1);
    const window = windows[0]!;
    const onchainLeaf = await pair.vault.scheduleLeaf(
      onchainPlanId,
      0n,
      window.notBefore,
      window.notAfter,
    );

    const inner = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "uint64", "uint64"],
        [onchainPlanId, 0n, window.notBefore, window.notAfter],
      ),
    );
    const expectedLeaf = ethers.keccak256(inner) as Handle;

    expect(onchainLeaf).to.equal(expectedLeaf);
    expect(
      await pair.vault.scheduleLeaf(onchainPlanId, 1n, window.notBefore, window.notAfter),
    ).to.not.equal(onchainLeaf);

    const created = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      windows,
    );

    expect(created.planId).to.equal(onchainPlanId);

    const replayInput = await encrypted64Pair(
      await pair.vault.getAddress(),
      pair.owner,
      500_000n,
      1_000_000n,
    );

    await expect(
      (pair.vault.connect(pair.owner) as unknown as Vault).createPlan(
        SLOT,
        REGISTRATION_VERSION,
        activation.reservationNonce,
        created.planNonce,
        created.root,
        1n,
        replayInput.first,
        replayInput.second,
        replayInput.proof,
      ),
    ).to.be.revertedWithCustomError(pair.vault, "PlanNonceMismatch");
  });

  it("rejects wrong index, wrong Merkle proof, and too-early execution without consuming the slot", async function () {
    const pair = await deployRealPair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      await defaultWindows(2),
    );

    await fundPlan(pair, plan.planId, 700_000n);

    const keeperVault = pair.vault.connect(pair.keeper) as unknown as Vault;
    const first = plan.windows[0]!;
    const second = plan.windows[1]!;

    await expect(
      keeperVault.execute(plan.planId, 1n, second.notBefore, second.notAfter, plan.proofs[1]!),
    ).to.be.revertedWithCustomError(pair.vault, "InvalidExecutionIndex");

    await expect(
      keeperVault.execute(plan.planId, 0n, first.notBefore, first.notAfter, [
        ethers.ZeroHash as Handle,
      ]),
    ).to.be.revertedWithCustomError(pair.vault, "InvalidScheduleProof");

    await expect(
      keeperVault.execute(plan.planId, 0n, first.notBefore, first.notAfter, plan.proofs[0]!),
    ).to.be.revertedWithCustomError(pair.vault, "ExecutionTooEarly");

    const metadata = await pair.vault.planMetadata(plan.planId);
    expect(state(metadata)).to.equal(1n);
    expect(nextIndex(metadata)).to.equal(0n);
    expect(lastWindowNotAfter(metadata)).to.equal(0n);
    expect((await planAmounts(pair, plan.planId)).funds).to.equal(700_000n);
    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(2_000_000n);
    expect(
      await pair.token.isOperator(await pair.vault.getAddress(), await pair.pool.getAddress()),
    ).to.equal(false);
  });

  it("rejects a cryptographically committed overlapping second window after consuming the first", async function () {
    const pair = await deployRealPair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);

    const base = await defaultWindows(1);
    const first = base[0]!;
    const overlapping = {
      notBefore: first.notAfter,
      notAfter: first.notAfter + 200n,
    };

    const plan = await createPlan(pair, activation.reservationNonce, 500_000n, 1_000_000n, [
      first,
      overlapping,
    ]);

    const ownerVault = pair.vault.connect(pair.owner) as unknown as Vault;

    await waitFor(
      ownerVault.skipNext(plan.planId, 0n, first.notBefore, first.notAfter, plan.proofs[0]!),
    );

    await expect(
      ownerVault.skipNext(
        plan.planId,
        1n,
        overlapping.notBefore,
        overlapping.notAfter,
        plan.proofs[1]!,
      ),
    ).to.be.revertedWithCustomError(pair.vault, "InvalidSchedule");

    const metadata = await pair.vault.planMetadata(plan.planId);
    expect(nextIndex(metadata)).to.equal(1n);
    expect(lastWindowNotAfter(metadata)).to.equal(first.notAfter);

    await waitFor(ownerVault.revokePlan(plan.planId));
    expect(state(await pair.vault.planMetadata(plan.planId))).to.equal(3n);
  });

  it("lets only the owner skip the exact first slot and then permits the second slot to execute permissionlessly", async function () {
    const pair = await deployRealPair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      300_000n,
      600_000n,
      await defaultWindows(2),
    );

    await fundPlan(pair, plan.planId, 600_000n);

    const ownerVault = pair.vault.connect(pair.owner) as unknown as Vault;
    const keeperVault = pair.vault.connect(pair.keeper) as unknown as Vault;
    const first = plan.windows[0]!;
    const second = plan.windows[1]!;

    await expect(
      keeperVault.skipNext(plan.planId, 0n, first.notBefore, first.notAfter, plan.proofs[0]!),
    ).to.be.revertedWithCustomError(pair.vault, "InvalidOwner");

    await waitFor(
      ownerVault.skipNext(plan.planId, 0n, first.notBefore, first.notAfter, plan.proofs[0]!),
    );

    expect(nextIndex(await pair.vault.planMetadata(plan.planId))).to.equal(1n);
    expect((await planAmounts(pair, plan.planId)).funds).to.equal(600_000n);

    await setTimestamp(second.notBefore);

    await waitFor(
      keeperVault.execute(plan.planId, 1n, second.notBefore, second.notAfter, plan.proofs[1]!),
    );

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(2_300_000n);
    expect(state(await pair.vault.planMetadata(plan.planId))).to.equal(4n);

    const amounts = await planAmounts(pair, plan.planId);
    expect(amounts.funds).to.equal(300_000n);
    expect(amounts.budget).to.equal(300_000n);
  });

  it("advances an expired slot permissionlessly only after the inclusive notAfter boundary", async function () {
    const pair = await deployRealPair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      await defaultWindows(1),
    );

    const keeperVault = pair.vault.connect(pair.keeper) as unknown as Vault;
    const window = plan.windows[0]!;

    await setNextTransactionTimestamp(window.notAfter);

    await expect(
      keeperVault.advanceMissed(
        plan.planId,
        0n,
        window.notBefore,
        window.notAfter,
        plan.proofs[0]!,
      ),
    ).to.be.revertedWithCustomError(pair.vault, "ExecutionExpired");

    expect(nextIndex(await pair.vault.planMetadata(plan.planId))).to.equal(0n);

    await setNextTransactionTimestamp(window.notAfter + 1n);

    await waitFor(
      keeperVault.advanceMissed(
        plan.planId,
        0n,
        window.notBefore,
        window.notAfter,
        plan.proofs[0]!,
      ),
    );

    const metadata = await pair.vault.planMetadata(plan.planId);
    expect(state(metadata)).to.equal(4n);
    expect(nextIndex(metadata)).to.equal(1n);
  });

  it("makes pause/resume owner-only, blocks execution while paused, and preserves the unconsumed slot", async function () {
    const pair = await deployRealPair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      await defaultWindows(1),
    );

    await fundPlan(pair, plan.planId, 500_000n);

    const ownerVault = pair.vault.connect(pair.owner) as unknown as Vault;
    const keeperVault = pair.vault.connect(pair.keeper) as unknown as Vault;
    const window = plan.windows[0]!;

    await expect(keeperVault.pausePlan(plan.planId)).to.be.revertedWithCustomError(
      pair.vault,
      "InvalidOwner",
    );

    await waitFor(ownerVault.pausePlan(plan.planId));
    expect(state(await pair.vault.planMetadata(plan.planId))).to.equal(2n);

    await setTimestamp(window.notBefore);

    await expect(
      keeperVault.execute(plan.planId, 0n, window.notBefore, window.notAfter, plan.proofs[0]!),
    ).to.be.revertedWithCustomError(pair.vault, "InvalidPlanState");

    expect(nextIndex(await pair.vault.planMetadata(plan.planId))).to.equal(0n);
    expect((await planAmounts(pair, plan.planId)).funds).to.equal(500_000n);

    await expect(keeperVault.resumePlan(plan.planId)).to.be.revertedWithCustomError(
      pair.vault,
      "InvalidOwner",
    );

    await waitFor(ownerVault.resumePlan(plan.planId));

    await waitFor(
      keeperVault.execute(plan.planId, 0n, window.notBefore, window.notAfter, plan.proofs[0]!),
    );

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(2_500_000n);
    expect(state(await pair.vault.planMetadata(plan.planId))).to.equal(4n);
  });

  it("makes revoke terminal, rejects new funding, and returns all residual funds only to the immutable owner", async function () {
    const pair = await deployRealPair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      await defaultWindows(1),
    );

    await fundPlan(pair, plan.planId, 700_000n);

    const ownerVault = pair.vault.connect(pair.owner) as unknown as Vault;
    const otherVault = pair.vault.connect(pair.other) as unknown as Vault;

    await expect(otherVault.revokePlan(plan.planId)).to.be.revertedWithCustomError(
      pair.vault,
      "InvalidOwner",
    );

    await waitFor(ownerVault.revokePlan(plan.planId));
    expect(state(await pair.vault.planMetadata(plan.planId))).to.equal(3n);

    await waitFor(
      (pair.token.connect(pair.owner) as unknown as Token).mintClear(pair.owner.address, 100_000n),
    );

    const ownerBeforeRejectedFunding = await decrypt64(
      await pair.token.confidentialBalanceOf(pair.owner.address),
    );

    const fundingData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [plan.planId]);

    await expect(
      transferAndCallExisting(pair, pair.owner, 100_000n, fundingData),
    ).to.be.revertedWithCustomError(pair.vault, "InvalidPlanState");

    expect(await decrypt64(await pair.token.confidentialBalanceOf(pair.owner.address))).to.equal(
      ownerBeforeRejectedFunding,
    );
    expect((await planAmounts(pair, plan.planId)).funds).to.equal(700_000n);

    await expect(otherVault.withdrawPlanFunds(plan.planId)).to.be.revertedWithCustomError(
      pair.vault,
      "InvalidOwner",
    );

    await waitFor(ownerVault.withdrawPlanFunds(plan.planId));

    expect((await planAmounts(pair, plan.planId)).funds).to.equal(0n);
    expect(await decrypt64(await pair.token.confidentialBalanceOf(pair.owner.address))).to.equal(
      800_000n,
    );
    expect(
      await decrypt64(await pair.token.confidentialBalanceOf(await pair.vault.getAddress())),
    ).to.equal(0n);
  });

  it("keeps completed-plan residual funds owner-recoverable without reopening execution", async function () {
    const pair = await deployRealPair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      await defaultWindows(1),
    );

    await fundPlan(pair, plan.planId, 700_000n);
    const window = plan.windows[0]!;
    await setTimestamp(window.notBefore);

    await waitFor(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        window.notBefore,
        window.notAfter,
        plan.proofs[0]!,
      ),
    );

    expect(state(await pair.vault.planMetadata(plan.planId))).to.equal(4n);
    expect((await planAmounts(pair, plan.planId)).funds).to.equal(200_000n);

    await expect(
      (pair.vault.connect(pair.other) as unknown as Vault).withdrawPlanFunds(plan.planId),
    ).to.be.revertedWithCustomError(pair.vault, "InvalidOwner");

    await waitFor(
      (pair.vault.connect(pair.owner) as unknown as Vault).withdrawPlanFunds(plan.planId),
    );

    expect((await planAmounts(pair, plan.planId)).funds).to.equal(0n);
    expect(await decrypt64(await pair.token.confidentialBalanceOf(pair.owner.address))).to.equal(
      200_000n,
    );

    await expect(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        window.notBefore,
        window.notAfter,
        plan.proofs[0]!,
      ),
    ).to.be.reverted;
  });

  it("preserves residual recovery across a partial owner withdrawal and a later retry", async function () {
    const pair = await deployRealPair("TestERC7984PartialReturn", [MAX_USER_PRINCIPAL]);
    const partial = pair.token as unknown as PartialToken;

    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      await defaultWindows(1),
    );

    await fundPlan(pair, plan.planId, 700_000n);
    await waitFor((pair.vault.connect(pair.owner) as unknown as Vault).revokePlan(plan.planId));

    await waitFor(partial.setPartialCap(200_000n));

    await waitFor(
      (pair.vault.connect(pair.owner) as unknown as Vault).withdrawPlanFunds(plan.planId),
    );

    expect((await planAmounts(pair, plan.planId)).funds).to.equal(500_000n);
    expect(await decrypt64(await pair.token.confidentialBalanceOf(pair.owner.address))).to.equal(
      200_000n,
    );

    await waitFor(partial.setPartialCap(MAX_USER_PRINCIPAL));

    await waitFor(
      (pair.vault.connect(pair.owner) as unknown as Vault).withdrawPlanFunds(plan.planId),
    );

    expect((await planAmounts(pair, plan.planId)).funds).to.equal(0n);
    expect(await decrypt64(await pair.token.confidentialBalanceOf(pair.owner.address))).to.equal(
      700_000n,
    );
  });

  it("rolls back an invalid funding-data callback atomically without moving tokens or changing plan funds", async function () {
    const pair = await deployRealPair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      await defaultWindows(1),
    );

    await waitFor(
      (pair.token.connect(pair.owner) as unknown as Token).mintClear(pair.owner.address, 100_000n),
    );

    const ownerBefore = await decrypt64(await pair.token.confidentialBalanceOf(pair.owner.address));
    const vaultBeforeHandle = await pair.token.confidentialBalanceOf(await pair.vault.getAddress());

    await expect(
      transferAndCallExisting(pair, pair.owner, 100_000n, "0x1234"),
    ).to.be.revertedWithCustomError(pair.vault, "InvalidFundingData");

    expect(await decrypt64(await pair.token.confidentialBalanceOf(pair.owner.address))).to.equal(
      ownerBefore,
    );
    expect(await pair.token.confidentialBalanceOf(await pair.vault.getAddress())).to.equal(
      vaultBeforeHandle,
    );
    expect((await planAmounts(pair, plan.planId)).funds).to.equal(0n);
  });

  it("rejects direct funding-callback impersonation before trusting any supplied ciphertext or plan data", async function () {
    const pair = await deployRealPair();

    await expect(
      (pair.vault.connect(pair.owner) as unknown as Vault).onConfidentialTransferReceived(
        pair.owner.address,
        pair.owner.address,
        ethers.ZeroHash as Handle,
        "0x",
      ),
    ).to.be.revertedWithCustomError(pair.vault, "FundingCallerMismatch");
  });

  it("rolls back schedule consumption, JIT operator state, TWAB, principal, funds, and budget when the token is paused", async function () {
    const pair = await deployRealPair("TestERC7984Pausable");
    const pausable = pair.token as unknown as PausableToken;

    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      await defaultWindows(1),
    );

    await fundPlan(pair, plan.planId, 700_000n);

    const principalBefore = await decrypt64(await pair.pool.principalHandle(SLOT));
    const twabBefore = await decrypt128(await pair.pool.twabAccumulatorHandle(SLOT));
    const canonicalBefore = await decrypt128(await pair.pool.canonicalReceivedHandle());
    const amountsBefore = await planAmounts(pair, plan.planId);
    const metadataBefore = await pair.vault.planMetadata(plan.planId);
    const vaultBalanceBefore = await decrypt64(
      await pair.token.confidentialBalanceOf(await pair.vault.getAddress()),
    );
    const poolBalanceBefore = await decrypt64(
      await pair.token.confidentialBalanceOf(await pair.pool.getAddress()),
    );

    const window = plan.windows[0]!;
    await setTimestamp(window.notBefore);
    await waitFor(pausable.setPaused(true));

    await expect(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        window.notBefore,
        window.notAfter,
        plan.proofs[0]!,
      ),
    ).to.be.revertedWith("TOKEN_PAUSED");

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(principalBefore);
    expect(await decrypt128(await pair.pool.twabAccumulatorHandle(SLOT))).to.equal(twabBefore);
    expect(await decrypt128(await pair.pool.canonicalReceivedHandle())).to.equal(canonicalBefore);

    const amountsAfter = await planAmounts(pair, plan.planId);
    expect(amountsAfter.funds).to.equal(amountsBefore.funds);
    expect(amountsAfter.budget).to.equal(amountsBefore.budget);

    const metadataAfter = await pair.vault.planMetadata(plan.planId);
    expect(state(metadataAfter)).to.equal(state(metadataBefore));
    expect(nextIndex(metadataAfter)).to.equal(nextIndex(metadataBefore));
    expect(lastWindowNotAfter(metadataAfter)).to.equal(lastWindowNotAfter(metadataBefore));

    expect(
      await pair.token.isOperator(await pair.vault.getAddress(), await pair.pool.getAddress()),
    ).to.equal(false);

    expect(
      await decrypt64(await pair.token.confidentialBalanceOf(await pair.vault.getAddress())),
    ).to.equal(vaultBalanceBefore);
    expect(
      await decrypt64(await pair.token.confidentialBalanceOf(await pair.pool.getAddress())),
    ).to.equal(poolBalanceBefore);

    await waitFor(pausable.setPaused(false));

    await waitFor(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        window.notBefore,
        window.notAfter,
        plan.proofs[0]!,
      ),
    );

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(2_500_000n);
  });

  it("fails the real Pool pull when Vault-to-Pool operator authorization is missing and rolls back the checkpoint", async function () {
    const pair = await deployNegativePair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);

    await waitFor(pair.token.mintClear(await pair.harness.getAddress(), 500_000n));

    const amount = await encrypted64(await pair.harness.getAddress(), pair.owner, 500_000n);

    const principalBefore = await decrypt64(await pair.pool.principalHandle(SLOT));
    const twabBefore = await decrypt128(await pair.pool.twabAccumulatorHandle(SLOT));
    const harnessBalanceBefore = await decrypt64(
      await pair.token.confidentialBalanceOf(await pair.harness.getAddress()),
    );

    await expect(
      pair.harness.pullWithoutOperator(
        SLOT,
        activation.reservationNonce,
        amount.handle,
        amount.proof,
      ),
    ).to.be.reverted;

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(principalBefore);
    expect(await decrypt128(await pair.pool.twabAccumulatorHandle(SLOT))).to.equal(twabBefore);
    expect(
      await decrypt64(await pair.token.confidentialBalanceOf(await pair.harness.getAddress())),
    ).to.equal(harnessBalanceBefore);

    expect(
      await pair.token.isOperator(await pair.harness.getAddress(), await pair.pool.getAddress()),
    ).to.equal(false);
  });

  it("fails the real Pool pull when Vault-to-Pool ciphertext ACL is missing and rolls back the temporary operator", async function () {
    const pair = await deployNegativePair();
    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);

    await waitFor(pair.token.mintClear(await pair.harness.getAddress(), 500_000n));

    const amount = await encrypted64(await pair.harness.getAddress(), pair.owner, 500_000n);

    const principalBefore = await decrypt64(await pair.pool.principalHandle(SLOT));
    const twabBefore = await decrypt128(await pair.pool.twabAccumulatorHandle(SLOT));
    const harnessBalanceBefore = await decrypt64(
      await pair.token.confidentialBalanceOf(await pair.harness.getAddress()),
    );

    await expect(
      pair.harness.pullWithoutPoolAcl(
        SLOT,
        activation.reservationNonce,
        amount.handle,
        amount.proof,
      ),
    ).to.be.reverted;

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(principalBefore);
    expect(await decrypt128(await pair.pool.twabAccumulatorHandle(SLOT))).to.equal(twabBefore);
    expect(
      await decrypt64(await pair.token.confidentialBalanceOf(await pair.harness.getAddress())),
    ).to.equal(harnessBalanceBefore);

    expect(
      await pair.token.isOperator(await pair.harness.getAddress(), await pair.pool.getAddress()),
    ).to.equal(false);
  });

  it("rejects an Autopilot token return without the pinned usable returned-handle ACL and rolls the execution back", async function () {
    const pair = await deployRealPair("TestAutopilotToggleReturnAclToken");
    const token = pair.token as unknown as ToggleReturnAclToken;

    const activation = await activate(pair.pool, pair.token, pair.owner, 2_000_000n);
    const plan = await createPlan(
      pair,
      activation.reservationNonce,
      500_000n,
      1_000_000n,
      await defaultWindows(1),
    );

    await fundPlan(pair, plan.planId, 700_000n);

    const principalBefore = await decrypt64(await pair.pool.principalHandle(SLOT));
    const twabBefore = await decrypt128(await pair.pool.twabAccumulatorHandle(SLOT));
    const amountsBefore = await planAmounts(pair, plan.planId);
    const vaultBalanceBefore = await decrypt64(
      await pair.token.confidentialBalanceOf(await pair.vault.getAddress()),
    );
    const poolBalanceBefore = await decrypt64(
      await pair.token.confidentialBalanceOf(await pair.pool.getAddress()),
    );

    await waitFor(token.setBreakReturnAcl(true));

    const window = plan.windows[0]!;
    await setTimestamp(window.notBefore);

    await expect(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        window.notBefore,
        window.notAfter,
        plan.proofs[0]!,
      ),
    ).to.be.reverted;

    expect(nextIndex(await pair.vault.planMetadata(plan.planId))).to.equal(0n);
    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(principalBefore);
    expect(await decrypt128(await pair.pool.twabAccumulatorHandle(SLOT))).to.equal(twabBefore);

    const amountsAfter = await planAmounts(pair, plan.planId);
    expect(amountsAfter.funds).to.equal(amountsBefore.funds);
    expect(amountsAfter.budget).to.equal(amountsBefore.budget);

    expect(
      await decrypt64(await pair.token.confidentialBalanceOf(await pair.vault.getAddress())),
    ).to.equal(vaultBalanceBefore);
    expect(
      await decrypt64(await pair.token.confidentialBalanceOf(await pair.pool.getAddress())),
    ).to.equal(poolBalanceBefore);

    expect(
      await pair.token.isOperator(await pair.vault.getAddress(), await pair.pool.getAddress()),
    ).to.equal(false);

    await waitFor(token.setBreakReturnAcl(false));

    await waitFor(
      (pair.vault.connect(pair.keeper) as unknown as Vault).execute(
        plan.planId,
        0n,
        window.notBefore,
        window.notAfter,
        plan.proofs[0]!,
      ),
    );

    expect(await decrypt64(await pair.pool.principalHandle(SLOT))).to.equal(2_500_000n);
  });
});
