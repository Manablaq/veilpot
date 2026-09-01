// Gate 1C.2A production prize-reserve integration and adversarial tests.
// Local Hardhat FHEVM execution only.

import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Tx = Promise<ethers.ContractTransactionResponse>;
type Signer = Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

interface TestToken extends ethers.BaseContract {
  mintClear(to: string, amount: bigint): Tx;

  setOperator(operator: string, until: bigint): Tx;

  ["confidentialTransfer(address,bytes32,bytes)"](to: string, amount: Handle, proof: string): Tx;
}

interface ReentrantToken extends TestToken {
  configureReentry(target: string, payload: string, enabled: boolean): Tx;

  lastReentrySucceeded(): Promise<boolean>;
}

interface PrizePoolHarness extends ethers.BaseContract {
  setFinalizedDraw(drawId: bigint, participantCount: bigint): Tx;

  setDrawMetadata(
    drawId: bigint,
    state: bigint,
    snapshotId: bigint,
    snapshotEpochId: bigint,
    participantCount: bigint,
    batchId: bigint,
    bucketExponent: bigint,
    winnerCursor: bigint,
  ): Tx;

  recognize(adapter: string, drawId: bigint, encryptedRawTotalTwab: Handle, inputProof: string): Tx;
}

interface PrizeAdapterHarness extends ethers.BaseContract {
  setDrawState(drawId: bigint, state: bigint): Tx;

  recordYieldWithAcl(drawId: bigint, clearAmount: bigint): Tx;

  recordYieldWithoutAcl(drawId: bigint, clearAmount: bigint): Tx;
}

interface YieldAdapter extends ethers.BaseContract {
  fundYieldLiquidity(
    encryptedAmount: Handle,
    proof: string,
    funder: string,
    fundingNonce: bigint,
  ): Tx;

  drawYieldHandles(
    drawId: bigint,
  ): Promise<readonly [bigint, Handle, Handle, Handle, Handle, Handle, bigint]>;

  settleRecognition(drawId: bigint, clearZeroYield: boolean, proof: string): Tx;

  sweepYield(drawId: bigint): Tx;

  settleSweepCompletion(
    drawId: bigint,
    sweepAttemptNonce: bigint,
    clearComplete: boolean,
    proof: string,
  ): Tx;
}

interface PrizeReserve extends ethers.BaseContract {
  pool(): Promise<string>;
  adapter(): Promise<string>;
  confidentialToken(): Promise<string>;

  nextSponsorFundingNonce(funder: string): Promise<bigint>;

  recordYield(drawId: bigint, actualTransferred: Handle): Tx;

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
    decryptionProof: string,
  ): Tx;

  refreshPrizeStatusEvidence(drawId: bigint): Tx;

  prizeHandles(
    drawId: bigint,
  ): Promise<
    readonly [bigint, Handle, Handle, Handle, Handle, Handle, bigint, bigint, bigint, bigint]
  >;

  reserveAccountingHandles(): Promise<readonly [Handle, Handle]>;
}

async function receipt(tx: Tx): Promise<ethers.TransactionReceipt> {
  const result = await (await tx).wait();

  if (result === null) {
    throw new Error("transaction receipt missing");
  }

  return result;
}

function recordHcu(label: string, txReceipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(txReceipt);

  console.log(
    `HCU ${label} global=${String(hcu.globalHCU)} depth=${String(hcu.maxHCUDepth)} gas=${txReceipt.gasUsed.toString()}`,
  );

  expect(hcu.globalHCU, `${label} global HCU`).to.be.lessThan(20_000_000);

  expect(hcu.maxHCUDepth, `${label} sequential HCU depth`).to.be.lessThan(5_000_000);
}

async function encrypt64(
  contractAddress: string,
  signer: { address: string },
  value: bigint,
): Promise<{
  handle: Handle;
  proof: string;
}> {
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
  signer: { address: string },
  value: bigint,
): Promise<{
  handle: Handle;
  proof: string;
}> {
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

async function decrypt128(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);
}

async function publicStage(
  statusHandle: Handle,
  contextHandle: Handle,
): Promise<{
  status: boolean;
  context: bigint;
  proof: string;
}> {
  const result = await hre.fhevm.publicDecrypt([statusHandle, contextHandle]);

  const status = result.clearValues[statusHandle];

  const context = result.clearValues[contextHandle];

  if (typeof status !== "boolean") {
    throw new Error("expected public boolean");
  }

  if (typeof context !== "bigint") {
    throw new Error("expected public proof context");
  }

  return {
    status,
    context,
    proof: result.decryptionProof,
  };
}

async function approveOperator(token: TestToken, operator: string): Promise<void> {
  const latest = await hre.ethers.provider.getBlock("latest");

  const until = BigInt((latest?.timestamp ?? 0) + 3600);

  await receipt(token.setOperator(operator, until));
}

async function deployPair(
  adapterName: "VeilpotSimulatedYieldAdapter" | "Gate1CPrizeAdapterHarness",
  tokenName:
    | "TestERC7984"
    | "TestERC7984PartialReturn"
    | "TestERC7984Reentrant"
    | "TestERC7984Pausable"
    | "TestERC7984DirectNoReturnAcl" = "TestERC7984",
  tokenArgs: readonly bigint[] = [],
): Promise<{
  owner: Signer;
  other: Signer;
  token: TestToken;
  pool: PrizePoolHarness;
  adapter: ethers.BaseContract;
  reserve: PrizeReserve;
  predictedAdapter: string;
  predictedReserve: string;
}> {
  const signers = await hre.ethers.getSigners();

  const owner = signers[0]!;
  const other = signers[1]!;

  const tokenFactory = await hre.ethers.getContractFactory(tokenName);

  const token = (await tokenFactory.deploy(...tokenArgs)) as unknown as TestToken;

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

  const poolFactory = await hre.ethers.getContractFactory("Gate1CPrizePoolHarness");

  const pool = (await poolFactory.deploy(
    await token.getAddress(),
    predictedReserve,
  )) as unknown as PrizePoolHarness;

  await pool.waitForDeployment();

  expect(await pool.getAddress()).to.equal(predictedPool);

  const adapterFactory = await hre.ethers.getContractFactory(adapterName);

  const adapter = await adapterFactory.deploy(
    await token.getAddress(),
    await pool.getAddress(),
    predictedReserve,
  );

  await adapter.waitForDeployment();

  expect(await adapter.getAddress()).to.equal(predictedAdapter);

  const reserveFactory = await hre.ethers.getContractFactory("VeilpotPrizeReserve");

  const reserve = (await reserveFactory.deploy(
    await pool.getAddress(),
    await adapter.getAddress(),
  )) as unknown as PrizeReserve;

  await reserve.waitForDeployment();

  expect(await reserve.getAddress()).to.equal(predictedReserve);

  expect(await reserve.pool()).to.equal(await pool.getAddress());

  expect(await reserve.adapter()).to.equal(await adapter.getAddress());

  expect(await reserve.confidentialToken()).to.equal(await token.getAddress());

  await hre.fhevm.assertCoprocessorInitialized(token, tokenName);

  await hre.fhevm.assertCoprocessorInitialized(pool, "Gate1CPrizePoolHarness");

  await hre.fhevm.assertCoprocessorInitialized(adapter, adapterName);

  await hre.fhevm.assertCoprocessorInitialized(reserve, "VeilpotPrizeReserve");

  return {
    owner,
    other,
    token,
    pool,
    adapter,
    reserve,
    predictedAdapter,
    predictedReserve,
  };
}

async function fundAdapter(
  owner: Signer,
  token: TestToken,
  adapter: YieldAdapter,
  amount: bigint,
): Promise<void> {
  await receipt(token.mintClear(owner.address, amount));

  await approveOperator(token, await adapter.getAddress());

  const input = await encrypt64(await adapter.getAddress(), owner, amount);

  await receipt(adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, 0n));
}

async function recognize(
  owner: Signer,
  pool: PrizePoolHarness,
  adapter: YieldAdapter,
  drawId: bigint,
  rawTotalTwab: bigint,
): Promise<void> {
  const input = await encrypt128(await pool.getAddress(), owner, rawTotalTwab);

  await receipt(pool.recognize(await adapter.getAddress(), drawId, input.handle, input.proof));
}

async function settleRecognition(adapter: YieldAdapter, drawId: bigint): Promise<boolean> {
  const handles = await adapter.drawYieldHandles(drawId);

  const stage = await publicStage(handles[4], handles[5]);

  await receipt(adapter.settleRecognition(drawId, stage.status, stage.proof));

  return stage.status;
}

async function settleSweep(adapter: YieldAdapter, drawId: bigint): Promise<boolean> {
  const handles = await adapter.drawYieldHandles(drawId);

  const stage = await publicStage(handles[4], handles[5]);

  await receipt(adapter.settleSweepCompletion(drawId, handles[6], stage.status, stage.proof));

  return stage.status;
}

async function sponsor(
  owner: Signer,
  reserve: PrizeReserve,
  drawId: bigint,
  amount: bigint,
  nonce: bigint,
): Promise<ethers.TransactionReceipt> {
  const input = await encrypt64(await reserve.getAddress(), owner, amount);

  return receipt(
    reserve.fundSponsorForDraw(drawId, input.handle, input.proof, owner.address, nonce),
  );
}

describe("VeilpotPrizeReserve Gate 1C.2A", function () {
  it("uses the deterministic adapter-reserve deployment cycle and preserves recognized yield across a premature reserve sweep", async function () {
    const {
      owner,
      token,
      pool,
      adapter: deployedAdapter,
      reserve,
      predictedAdapter,
      predictedReserve,
    } = await deployPair("VeilpotSimulatedYieldAdapter");

    const adapter = deployedAdapter as unknown as YieldAdapter;

    expect(await adapter.getAddress()).to.equal(predictedAdapter);

    expect(await reserve.getAddress()).to.equal(predictedReserve);

    await fundAdapter(owner, token, adapter, 100n);

    await recognize(owner, pool, adapter, 1n, 1_000_000n * 86_400n);

    expect(await settleRecognition(adapter, 1n)).to.equal(false);

    await expect(adapter.sweepYield(1n)).to.be.revertedWithCustomError(reserve, "DrawNotFinalized");

    let draw = await adapter.drawYieldHandles(1n);

    expect(draw[0]).to.equal(2n);
    expect(await decrypt64(draw[3])).to.equal(100n);

    await receipt(pool.setFinalizedDraw(1n, 8n));

    recordHcu("adapterSweepToReserve", await receipt(adapter.sweepYield(1n)));

    let prize = await reserve.prizeHandles(1n);

    expect(await decrypt64(prize[1])).to.equal(100n);

    expect(await decrypt64(prize[2])).to.equal(0n);

    let accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(100n);

    expect(await decrypt128(accounting[1])).to.equal(0n);

    expect(await settleSweep(adapter, 1n)).to.equal(true);

    draw = await adapter.drawYieldHandles(1n);

    expect(draw[0]).to.equal(4n);

    recordHcu("preparePrize", await receipt(reserve.preparePrize(1n)));

    prize = await reserve.prizeHandles(1n);

    expect(prize[0]).to.equal(1n);
    expect(prize[6]).to.equal(8n);

    expect(await decrypt64(prize[3])).to.equal(100n);

    accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(100n);

    expect(await decrypt128(accounting[1])).to.equal(100n);
  });

  it("rejects a reserve deployment whose adapter immutable reserve binding is wrong", async function () {
    const signers = await hre.ethers.getSigners();

    const owner = signers[0]!;
    const other = signers[1]!;

    const token = await (await hre.ethers.getContractFactory("TestERC7984")).deploy();

    await token.waitForDeployment();

    const nonce = await hre.ethers.provider.getTransactionCount(owner.address);

    const predictedReserve = ethers.getCreateAddress({
      from: owner.address,
      nonce: nonce + 2,
    });

    const pool = await (
      await hre.ethers.getContractFactory("Gate1CPrizePoolHarness")
    ).deploy(await token.getAddress(), predictedReserve);

    await pool.waitForDeployment();

    const adapter = await (
      await hre.ethers.getContractFactory("Gate1CPrizeAdapterHarness")
    ).deploy(await token.getAddress(), await pool.getAddress(), other.address);

    await adapter.waitForDeployment();

    const reserveFactory = await hre.ethers.getContractFactory("VeilpotPrizeReserve");

    await expect(reserveFactory.deploy(await pool.getAddress(), await adapter.getAddress())).to.be
      .reverted;

    expect(owner.address).to.not.equal(other.address);
  });

  it("accepts yield only from the immutable adapter with the exact transient ACL handoff", async function () {
    const {
      pool,
      adapter: deployedAdapter,
      reserve,
    } = await deployPair("Gate1CPrizeAdapterHarness");

    const adapter = deployedAdapter as unknown as PrizeAdapterHarness;

    await receipt(pool.setFinalizedDraw(2n, 8n));

    await expect(reserve.recordYield(2n, ethers.ZeroHash as Handle)).to.be.revertedWithCustomError(
      reserve,
      "OnlyAdapter",
    );

    await expect(adapter.recordYieldWithoutAcl(2n, 10n)).to.be.revertedWithCustomError(
      reserve,
      "MissingYieldAcl",
    );

    await receipt(adapter.recordYieldWithAcl(2n, 10n));

    const prize = await reserve.prizeHandles(2n);

    expect(await decrypt64(prize[1])).to.equal(10n);

    const accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(10n);

    expect(await decrypt128(accounting[1])).to.equal(0n);
  });

  it("records only the ERC-7984 actual sponsor transfer and enforces caller, operator, and nonce boundaries", async function () {
    const {
      owner,
      other,
      token,
      pool,
      adapter: deployedAdapter,
      reserve,
    } = await deployPair("Gate1CPrizeAdapterHarness", "TestERC7984PartialReturn", [40n]);

    const adapter = deployedAdapter as unknown as PrizeAdapterHarness;

    await receipt(pool.setFinalizedDraw(3n, 8n));

    await receipt(adapter.setDrawState(3n, 4n));

    await receipt(token.mintClear(owner.address, 100n));

    let input = await encrypt64(await reserve.getAddress(), owner, 100n);

    const reserveAsOther = reserve.connect(other) as unknown as PrizeReserve;

    await expect(
      reserveAsOther.fundSponsorForDraw(3n, input.handle, input.proof, owner.address, 0n),
    ).to.be.revertedWithCustomError(reserve, "CallerFunderMismatch");

    await expect(
      reserve.fundSponsorForDraw(3n, input.handle, input.proof, owner.address, 0n),
    ).to.be.revertedWithCustomError(reserve, "OperatorUnauthorized");

    await approveOperator(token, await reserve.getAddress());

    input = await encrypt64(await reserve.getAddress(), owner, 100n);

    await receipt(reserve.fundSponsorForDraw(3n, input.handle, input.proof, owner.address, 0n));

    const prize = await reserve.prizeHandles(3n);

    expect(await decrypt64(prize[2])).to.equal(40n);

    expect(await reserve.nextSponsorFundingNonce(owner.address)).to.equal(1n);

    const accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(40n);

    await expect(
      reserve.fundSponsorForDraw(3n, input.handle, input.proof, owner.address, 0n),
    ).to.be.revertedWithCustomError(reserve, "SponsorFundingNonceMismatch");
  });

  it("never reinterprets a direct confidential token donation as reserve funding or prize liability", async function () {
    const {
      owner,
      token,
      pool,
      adapter: deployedAdapter,
      reserve,
    } = await deployPair("VeilpotSimulatedYieldAdapter");

    const adapter = deployedAdapter as unknown as YieldAdapter;

    await receipt(pool.setFinalizedDraw(4n, 8n));

    await recognize(owner, pool, adapter, 4n, 0n);

    expect(await settleRecognition(adapter, 4n)).to.equal(true);

    await receipt(token.mintClear(owner.address, 75n));

    const donation = await encrypt64(await token.getAddress(), owner, 75n);

    await receipt(
      token["confidentialTransfer(address,bytes32,bytes)"](
        await reserve.getAddress(),
        donation.handle,
        donation.proof,
      ),
    );

    let accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(0n);

    expect(await decrypt128(accounting[1])).to.equal(0n);

    await receipt(reserve.preparePrize(4n));

    const prize = await reserve.prizeHandles(4n);

    expect(await decrypt64(prize[3])).to.equal(0n);

    const stage = await publicStage(prize[4], prize[5]);

    expect(stage.status).to.equal(true);

    await receipt(reserve.settlePrizeStatus(4n, prize[8], stage.status, stage.proof));

    const settled = await reserve.prizeHandles(4n);

    expect(settled[0]).to.equal(5n);

    accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(0n);

    expect(await decrypt128(accounting[1])).to.equal(0n);
  });

  it("freezes all funding at prize preparation and settles a nonzero prize only through proof-backed status", async function () {
    const {
      owner,
      token,
      pool,
      adapter: deployedAdapter,
      reserve,
    } = await deployPair("Gate1CPrizeAdapterHarness");

    const adapter = deployedAdapter as unknown as PrizeAdapterHarness;

    await receipt(pool.setFinalizedDraw(5n, 8n));

    await receipt(adapter.setDrawState(5n, 4n));

    await receipt(adapter.recordYieldWithAcl(5n, 60n));

    await receipt(token.mintClear(owner.address, 40n));

    await approveOperator(token, await reserve.getAddress());

    recordHcu("fundSponsorForDraw", await sponsor(owner, reserve, 5n, 40n, 0n));

    await receipt(reserve.preparePrize(5n));

    let prize = await reserve.prizeHandles(5n);

    expect(prize[0]).to.equal(1n);

    expect(await decrypt64(prize[1])).to.equal(60n);

    expect(await decrypt64(prize[2])).to.equal(40n);

    expect(await decrypt64(prize[3])).to.equal(100n);

    let accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(100n);

    expect(await decrypt128(accounting[1])).to.equal(100n);

    await expect(adapter.recordYieldWithAcl(5n, 1n)).to.be.revertedWithCustomError(
      reserve,
      "PrizeFundingFrozen",
    );

    const lateSponsor = await encrypt64(await reserve.getAddress(), owner, 1n);

    await expect(
      reserve.fundSponsorForDraw(5n, lateSponsor.handle, lateSponsor.proof, owner.address, 1n),
    ).to.be.revertedWithCustomError(reserve, "PrizeFundingFrozen");

    const stage = await publicStage(prize[4], prize[5]);

    expect(stage.status).to.equal(false);

    await receipt(reserve.settlePrizeStatus(5n, prize[8], stage.status, stage.proof));

    prize = await reserve.prizeHandles(5n);

    expect(prize[0]).to.equal(2n);

    accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(100n);

    expect(await decrypt128(accounting[1])).to.equal(100n);
  });

  it("rejects stale prize-status proofs across the inclusive deadline and refreshed attempt nonce", async function () {
    const {
      pool,
      adapter: deployedAdapter,
      reserve,
    } = await deployPair("Gate1CPrizeAdapterHarness");

    const adapter = deployedAdapter as unknown as PrizeAdapterHarness;

    await receipt(pool.setFinalizedDraw(6n, 8n));

    await receipt(adapter.setDrawState(6n, 4n));

    await receipt(adapter.recordYieldWithAcl(6n, 1n));

    await receipt(reserve.preparePrize(6n));

    const initial = await reserve.prizeHandles(6n);

    expect(initial[8]).to.equal(1n);

    const staleStage = await publicStage(initial[4], initial[5]);

    await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(initial[9])]);

    await expect(reserve.refreshPrizeStatusEvidence(6n)).to.be.revertedWithCustomError(
      reserve,
      "StatusProofNotExpired",
    );

    await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(initial[9]) + 1]);

    recordHcu("refreshPrizeStatusEvidence", await receipt(reserve.refreshPrizeStatusEvidence(6n)));

    const refreshed = await reserve.prizeHandles(6n);

    expect(refreshed[8]).to.equal(2n);

    await expect(
      reserve.settlePrizeStatus(6n, 1n, staleStage.status, staleStage.proof),
    ).to.be.revertedWithCustomError(reserve, "StatusAttemptMismatch");

    await expect(reserve.settlePrizeStatus(6n, 2n, staleStage.status, staleStage.proof)).to.be
      .reverted;

    const freshStage = await publicStage(refreshed[4], refreshed[5]);

    expect(freshStage.status).to.equal(false);

    await receipt(reserve.settlePrizeStatus(6n, 2n, freshStage.status, freshStage.proof));

    const settled = await reserve.prizeHandles(6n);

    expect(settled[0]).to.equal(2n);
  });

  it("rejects prize preparation until both draw finality and adapter funding finality are exact", async function () {
    const {
      pool,
      adapter: deployedAdapter,
      reserve,
    } = await deployPair("Gate1CPrizeAdapterHarness");

    const adapter = deployedAdapter as unknown as PrizeAdapterHarness;

    await receipt(pool.setDrawMetadata(7n, 7n, 7n, 7n, 8n, 1n, 1n, 8n));

    await receipt(adapter.setDrawState(7n, 4n));

    await expect(reserve.preparePrize(7n)).to.be.revertedWithCustomError(
      reserve,
      "DrawNotFinalized",
    );

    await receipt(pool.setFinalizedDraw(7n, 8n));

    await receipt(adapter.setDrawState(7n, 2n));

    await expect(reserve.preparePrize(7n)).to.be.revertedWithCustomError(
      reserve,
      "AdapterFundingNotFinalized",
    );

    await receipt(adapter.setDrawState(7n, 4n));

    await receipt(reserve.preparePrize(7n));

    const prize = await reserve.prizeHandles(7n);

    expect(prize[0]).to.equal(1n);
  });

  it("blocks confidential-token callback reentrancy during sponsor funding while preserving the outer funding transfer", async function () {
    const {
      owner,
      token: deployedToken,
      pool,
      adapter: deployedAdapter,
      reserve,
    } = await deployPair("Gate1CPrizeAdapterHarness", "TestERC7984Reentrant");

    const token = deployedToken as unknown as ReentrantToken;

    const adapter = deployedAdapter as unknown as PrizeAdapterHarness;

    await receipt(pool.setFinalizedDraw(8n, 8n));

    await receipt(adapter.setDrawState(8n, 4n));

    await receipt(token.mintClear(owner.address, 50n));

    await approveOperator(token, await reserve.getAddress());

    const payload = reserve.interface.encodeFunctionData("preparePrize", [8n]);

    await receipt(token.configureReentry(await reserve.getAddress(), payload, true));

    await sponsor(owner, reserve, 8n, 50n, 0n);

    expect(await token.lastReentrySucceeded()).to.equal(false);

    const prize = await reserve.prizeHandles(8n);

    expect(prize[0]).to.equal(0n);

    expect(await decrypt64(prize[2])).to.equal(50n);

    const accounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(50n);

    expect(await decrypt128(accounting[1])).to.equal(0n);
  });
});

interface PrizePoolHarness {
  setAssignmentSlot(
    drawId: bigint,
    slotIndex: bigint,
    owner: string,
    registrationVersion: bigint,
    reservationNonce: bigint,
    bound: boolean,
    winner: boolean,
  ): Tx;
}

interface PrizeReserve {
  ASSIGNMENT_CHUNK_SIZE(): Promise<bigint>;

  assignPrizeEntitlementChunk(drawId: bigint, expectedCursor: bigint): Tx;

  prizeEntitlementRecord(
    drawId: bigint,
    slotIndex: bigint,
  ): Promise<readonly [boolean, boolean, string, bigint, bigint, Handle]>;

  prizeAssignmentTotalHandle(drawId: bigint): Promise<Handle>;
}

async function prepareGate1C2BAssignment(
  drawId: bigint,
  participantCount: bigint,
  prizeAmount: bigint,
  winnerSlot: bigint,
  unboundWinnerSlot: bigint | null = null,
): Promise<{
  owner: Signer;
  other: Signer;
  pool: PrizePoolHarness;
  adapter: PrizeAdapterHarness;
  reserve: PrizeReserve;
}> {
  const pair = await deployPair("Gate1CPrizeAdapterHarness");

  const adapter = pair.adapter as unknown as PrizeAdapterHarness;

  await receipt(pair.pool.setFinalizedDraw(drawId, participantCount));

  for (let index = 0; index < Number(participantCount); index += 1) {
    const slotIndex = BigInt(index);

    const isUnboundWinner = unboundWinnerSlot !== null && slotIndex === unboundWinnerSlot;

    const isWinner = slotIndex === winnerSlot || isUnboundWinner;

    const beneficiary = isUnboundWinner
      ? ethers.ZeroAddress
      : slotIndex === winnerSlot
        ? pair.other.address
        : pair.owner.address;

    await receipt(
      pair.pool.setAssignmentSlot(
        drawId,
        slotIndex,
        beneficiary,
        1_000n + slotIndex,
        2_000n + slotIndex,
        !isUnboundWinner,
        isWinner,
      ),
    );
  }

  await receipt(adapter.setDrawState(drawId, 4n));

  await receipt(adapter.recordYieldWithAcl(drawId, prizeAmount));

  await receipt(pair.reserve.preparePrize(drawId));

  const pending = await pair.reserve.prizeHandles(drawId);

  expect(pending[0]).to.equal(1n);

  const stage = await publicStage(pending[4], pending[5]);

  expect(stage.status).to.equal(false);

  await receipt(pair.reserve.settlePrizeStatus(drawId, pending[8], stage.status, stage.proof));

  const assigning = await pair.reserve.prizeHandles(drawId);

  expect(assigning[0]).to.equal(2n);

  expect(assigning[6]).to.equal(participantCount);

  expect(assigning[7]).to.equal(0n);

  return {
    owner: pair.owner,
    other: pair.other,
    pool: pair.pool,
    adapter,
    reserve: pair.reserve,
  };
}

describe("Gate 1C.2B reserve entitlement assignment", function () {
  it("processes fixed 8+1 chunks permissionlessly, never early-stops after the winner, and preserves reserve accounting", async function () {
    const drawId = 101n;

    const { owner, other, reserve } = await prepareGate1C2BAssignment(drawId, 9n, 100n, 0n);

    expect(await reserve.ASSIGNMENT_CHUNK_SIZE()).to.equal(8n);

    const beforePrize = await reserve.prizeHandles(drawId);

    const beforeAccounting = await reserve.reserveAccountingHandles();

    expect(await decrypt64(beforePrize[3])).to.equal(100n);

    expect(await decrypt128(beforeAccounting[0])).to.equal(100n);

    expect(await decrypt128(beforeAccounting[1])).to.equal(100n);

    const permissionlessReserve = reserve.connect(other) as unknown as PrizeReserve;

    const firstReceipt = await receipt(
      permissionlessReserve.assignPrizeEntitlementChunk(drawId, 0n),
    );

    recordHcu("assignPrizeEntitlementChunk8", firstReceipt);

    const afterFirst = await reserve.prizeHandles(drawId);

    expect(afterFirst[0]).to.equal(2n);

    expect(afterFirst[7]).to.equal(8n);

    expect(await decrypt64(afterFirst[3])).to.equal(100n);

    expect(await decrypt128(await reserve.prizeAssignmentTotalHandle(drawId))).to.equal(100n);

    const winner = await reserve.prizeEntitlementRecord(drawId, 0n);

    expect(winner[0]).to.equal(true);

    expect(winner[1]).to.equal(true);

    expect(winner[2]).to.equal(other.address);

    expect(winner[3]).to.equal(1_000n);

    expect(winner[4]).to.equal(2_000n);

    expect(await decrypt64(winner[5])).to.equal(100n);

    const firstChunkNonwinner = await reserve.prizeEntitlementRecord(drawId, 7n);

    expect(await decrypt64(firstChunkNonwinner[5])).to.equal(0n);

    const secondReceipt = await receipt(
      (reserve.connect(owner) as unknown as PrizeReserve).assignPrizeEntitlementChunk(drawId, 8n),
    );

    recordHcu("assignPrizeEntitlementChunk1", secondReceipt);

    const completed = await reserve.prizeHandles(drawId);

    expect(completed[0]).to.equal(3n);

    expect(completed[7]).to.equal(9n);

    expect(await decrypt64(completed[3])).to.equal(100n);

    expect(await decrypt128(await reserve.prizeAssignmentTotalHandle(drawId))).to.equal(100n);

    const finalSlot = await reserve.prizeEntitlementRecord(drawId, 8n);

    expect(finalSlot[0]).to.equal(true);

    expect(await decrypt64(finalSlot[5])).to.equal(0n);

    const afterAccounting = await reserve.reserveAccountingHandles();

    expect(await decrypt128(afterAccounting[0])).to.equal(await decrypt128(beforeAccounting[0]));

    expect(await decrypt128(afterAccounting[1])).to.equal(await decrypt128(beforeAccounting[1]));
  });

  it("rejects out-of-order and replayed cursors and refuses assignment after CLAIMABLE", async function () {
    const drawId = 102n;

    const { reserve } = await prepareGate1C2BAssignment(drawId, 9n, 70n, 4n);

    await expect(reserve.assignPrizeEntitlementChunk(drawId, 1n)).to.be.revertedWithCustomError(
      reserve,
      "AssignmentCursorMismatch",
    );

    await receipt(reserve.assignPrizeEntitlementChunk(drawId, 0n));

    await expect(reserve.assignPrizeEntitlementChunk(drawId, 0n)).to.be.revertedWithCustomError(
      reserve,
      "AssignmentCursorMismatch",
    );

    const middle = await reserve.prizeHandles(drawId);

    expect(middle[7]).to.equal(8n);

    await receipt(reserve.assignPrizeEntitlementChunk(drawId, 8n));

    const completed = await reserve.prizeHandles(drawId);

    expect(completed[0]).to.equal(3n);

    expect(completed[7]).to.equal(9n);

    await expect(reserve.assignPrizeEntitlementChunk(drawId, 9n)).to.be.revertedWithCustomError(
      reserve,
      "InvalidPrizeState",
    );
  });

  it("forces an unbound historical slot to encrypted zero even when its harness winner bit is true", async function () {
    const drawId = 103n;

    const { reserve } = await prepareGate1C2BAssignment(drawId, 8n, 90n, 5n, 2n);

    await receipt(reserve.assignPrizeEntitlementChunk(drawId, 0n));

    const unbound = await reserve.prizeEntitlementRecord(drawId, 2n);

    expect(unbound[0]).to.equal(true);

    expect(unbound[1]).to.equal(false);

    expect(unbound[2]).to.equal(ethers.ZeroAddress);

    expect(await decrypt64(unbound[5])).to.equal(0n);

    const winner = await reserve.prizeEntitlementRecord(drawId, 5n);

    expect(winner[0]).to.equal(true);

    expect(winner[1]).to.equal(true);

    expect(await decrypt64(winner[5])).to.equal(90n);

    expect(await decrypt128(await reserve.prizeAssignmentTotalHandle(drawId))).to.equal(90n);

    const completed = await reserve.prizeHandles(drawId);

    expect(completed[0]).to.equal(3n);
  });

  it("persists the frozen historical beneficiary identity after assignment even if the test harness is later mutated", async function () {
    const drawId = 104n;

    const { owner, other, pool, reserve } = await prepareGate1C2BAssignment(drawId, 8n, 80n, 3n);

    await receipt(reserve.assignPrizeEntitlementChunk(drawId, 0n));

    const before = await reserve.prizeEntitlementRecord(drawId, 3n);

    expect(before[2]).to.equal(other.address);

    expect(before[3]).to.equal(1_003n);

    expect(before[4]).to.equal(2_003n);

    expect(await decrypt64(before[5])).to.equal(80n);

    await receipt(pool.setAssignmentSlot(drawId, 3n, owner.address, 9_999n, 8_888n, true, false));

    const after = await reserve.prizeEntitlementRecord(drawId, 3n);

    expect(after[2]).to.equal(other.address);

    expect(after[3]).to.equal(1_003n);

    expect(after[4]).to.equal(2_003n);

    expect(await decrypt64(after[5])).to.equal(80n);
  });

  it("atomically rejects a bound historical slot with the zero address without advancing cursor or assigned total", async function () {
    const drawId = 105n;

    const { pool, reserve } = await prepareGate1C2BAssignment(drawId, 8n, 60n, 3n);

    await receipt(
      pool.setAssignmentSlot(drawId, 1n, ethers.ZeroAddress, 1_001n, 2_001n, true, false),
    );

    expect(await decrypt128(await reserve.prizeAssignmentTotalHandle(drawId))).to.equal(0n);

    await expect(reserve.assignPrizeEntitlementChunk(drawId, 0n)).to.be.revertedWithCustomError(
      reserve,
      "InvalidHistoricalBeneficiary",
    );

    const after = await reserve.prizeHandles(drawId);

    expect(after[0]).to.equal(2n);

    expect(after[7]).to.equal(0n);

    expect(await decrypt64(after[3])).to.equal(60n);

    expect(await decrypt128(await reserve.prizeAssignmentTotalHandle(drawId))).to.equal(0n);

    const rolledBack = await reserve.prizeEntitlementRecord(drawId, 0n);

    expect(rolledBack[0]).to.equal(false);
  });
});

interface ClaimAuthorizationInput {
  chainId: bigint;
  reserve: string;
  pool: string;
  drawId: bigint;
  slotIndex: bigint;
  participant: string;
  recipient: string;
  registrationVersion: bigint;
  reservationNonce: bigint;
  nonce: bigint;
  expiry: bigint;
}

interface PrizeReserve {
  CLAIM_AUTHORIZATION_TYPEHASH(): Promise<string>;

  nextClaimNonce(participant: string): Promise<bigint>;

  claimAuthorizationDigest(authorization: ClaimAuthorizationInput): Promise<string>;

  validateClaimAuthorization(
    authorization: ClaimAuthorizationInput,
    signature: string,
  ): Promise<string>;
}

const claimAuthorizationTypes: Record<string, { name: string; type: string }[]> = {
  ClaimAuthorization: [
    { name: "chainId", type: "uint256" },
    { name: "reserve", type: "address" },
    { name: "pool", type: "address" },
    { name: "drawId", type: "uint256" },
    { name: "slotIndex", type: "uint256" },
    { name: "participant", type: "address" },
    { name: "recipient", type: "address" },
    { name: "registrationVersion", type: "uint256" },
    { name: "reservationNonce", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

const claimAuthorizationTypeString =
  "ClaimAuthorization(uint256 chainId,address reserve,address pool,uint256 drawId,uint256 slotIndex,address participant,address recipient,uint256 registrationVersion,uint256 reservationNonce,uint256 nonce,uint256 expiry)";

async function prepareGate1C2CAuthorization(
  drawId: bigint,
  winnerSlot = 3n,
  unboundWinnerSlot: bigint | null = null,
): Promise<{
  owner: Signer;
  other: Signer;
  pool: PrizePoolHarness;
  reserve: PrizeReserve;
  domain: ethers.TypedDataDomain;
  authorization: ClaimAuthorizationInput;
}> {
  const prepared = await prepareGate1C2BAssignment(drawId, 8n, 100n, winnerSlot, unboundWinnerSlot);

  await receipt(prepared.reserve.assignPrizeEntitlementChunk(drawId, 0n));

  const prize = await prepared.reserve.prizeHandles(drawId);

  expect(prize[0]).to.equal(3n);

  const network = await hre.ethers.provider.getNetwork();

  const latest = await hre.ethers.provider.getBlock("latest");

  const expiry = BigInt(latest?.timestamp ?? 0) + 3_600n;

  const domain: ethers.TypedDataDomain = {
    name: "VeilpotPrizeReserve",
    version: "1",
    chainId: network.chainId,
    verifyingContract: await prepared.reserve.getAddress(),
  };

  const authorization: ClaimAuthorizationInput = {
    chainId: network.chainId,
    reserve: await prepared.reserve.getAddress(),
    pool: await prepared.pool.getAddress(),
    drawId,
    slotIndex: winnerSlot,
    participant: prepared.other.address,
    recipient: prepared.other.address,
    registrationVersion: 1_000n + winnerSlot,
    reservationNonce: 2_000n + winnerSlot,
    nonce: 0n,
    expiry,
  };

  return {
    owner: prepared.owner,
    other: prepared.other,
    pool: prepared.pool,
    reserve: prepared.reserve,
    domain,
    authorization,
  };
}

describe("Gate 1C.2C production EIP-712 authorization surface", function () {
  it("matches the exact eleven-field EIP-712 digest and validates the frozen historical owner signature permissionlessly", async function () {
    const { owner, other, reserve, domain, authorization } =
      await prepareGate1C2CAuthorization(201n);

    const expectedTypeHash = ethers.keccak256(ethers.toUtf8Bytes(claimAuthorizationTypeString));

    expect(await reserve.CLAIM_AUTHORIZATION_TYPEHASH()).to.equal(expectedTypeHash);

    const expectedDigest = ethers.TypedDataEncoder.hash(
      domain,
      claimAuthorizationTypes,
      authorization,
    );

    expect(await reserve.claimAuthorizationDigest(authorization)).to.equal(expectedDigest);

    const signature = await other.signTypedData(domain, claimAuthorizationTypes, authorization);

    const permissionless = reserve.connect(owner) as unknown as PrizeReserve;

    expect(await permissionless.validateClaimAuthorization(authorization, signature)).to.equal(
      expectedDigest,
    );

    expect(await reserve.nextClaimNonce(other.address)).to.equal(0n);
  });

  it("rejects mutation of every consequential authorization field and rejects signatures from the wrong EIP-712 domain", async function () {
    const { owner, other, reserve, domain, authorization } =
      await prepareGate1C2CAuthorization(202n);

    const signature = await other.signTypedData(domain, claimAuthorizationTypes, authorization);

    const mutations: ClaimAuthorizationInput[] = [
      {
        ...authorization,
        chainId: authorization.chainId + 1n,
      },
      {
        ...authorization,
        reserve: owner.address,
      },
      {
        ...authorization,
        pool: owner.address,
      },
      {
        ...authorization,
        drawId: authorization.drawId + 1n,
      },
      {
        ...authorization,
        slotIndex: 4n,
      },
      {
        ...authorization,
        participant: owner.address,
      },
      {
        ...authorization,
        recipient: owner.address,
      },
      {
        ...authorization,
        registrationVersion: authorization.registrationVersion + 1n,
      },
      {
        ...authorization,
        reservationNonce: authorization.reservationNonce + 1n,
      },
      {
        ...authorization,
        nonce: 1n,
      },
      {
        ...authorization,
        expiry: authorization.expiry + 1n,
      },
    ];

    for (const changed of mutations) {
      await expect(reserve.validateClaimAuthorization(changed, signature)).to.be.reverted;
    }

    const wrongChainSignature = await other.signTypedData(
      {
        ...domain,
        chainId: authorization.chainId + 1n,
      },
      claimAuthorizationTypes,
      authorization,
    );

    await expect(
      reserve.validateClaimAuthorization(authorization, wrongChainSignature),
    ).to.be.revertedWithCustomError(reserve, "InvalidClaimSignature");

    const wrongReserveSignature = await other.signTypedData(
      {
        ...domain,
        verifyingContract: owner.address,
      },
      claimAuthorizationTypes,
      authorization,
    );

    await expect(
      reserve.validateClaimAuthorization(authorization, wrongReserveSignature),
    ).to.be.revertedWithCustomError(reserve, "InvalidClaimSignature");

    expect(await reserve.nextClaimNonce(other.address)).to.equal(0n);
  });

  it("requires a nonzero unexpired authorization and exact participant-global nonce without consuming validation", async function () {
    const { other, reserve, domain, authorization } = await prepareGate1C2CAuthorization(203n);

    const zeroExpiry = {
      ...authorization,
      expiry: 0n,
    };

    const zeroExpirySignature = await other.signTypedData(
      domain,
      claimAuthorizationTypes,
      zeroExpiry,
    );

    await expect(
      reserve.validateClaimAuthorization(zeroExpiry, zeroExpirySignature),
    ).to.be.revertedWithCustomError(reserve, "ClaimAuthorizationExpiryRequired");

    const latest = await hre.ethers.provider.getBlock("latest");

    const expired = {
      ...authorization,
      expiry: BigInt(latest?.timestamp ?? 0) - 1n,
    };

    const expiredSignature = await other.signTypedData(domain, claimAuthorizationTypes, expired);

    await expect(
      reserve.validateClaimAuthorization(expired, expiredSignature),
    ).to.be.revertedWithCustomError(reserve, "ClaimAuthorizationExpired");

    const wrongNonce = {
      ...authorization,
      nonce: 1n,
    };

    const wrongNonceSignature = await other.signTypedData(
      domain,
      claimAuthorizationTypes,
      wrongNonce,
    );

    await expect(
      reserve.validateClaimAuthorization(wrongNonce, wrongNonceSignature),
    ).to.be.revertedWithCustomError(reserve, "ClaimNonceMismatch");

    const validSignature = await other.signTypedData(
      domain,
      claimAuthorizationTypes,
      authorization,
    );

    expect(await reserve.validateClaimAuthorization(authorization, validSignature)).to.equal(
      ethers.TypedDataEncoder.hash(domain, claimAuthorizationTypes, authorization),
    );

    expect(await reserve.nextClaimNonce(other.address)).to.equal(0n);
  });

  it("requires CLAIMABLE state and rejects an unbound historical entitlement before signature acceptance", async function () {
    const assigning = await prepareGate1C2BAssignment(204n, 8n, 100n, 3n);

    const network = await hre.ethers.provider.getNetwork();

    const latest = await hre.ethers.provider.getBlock("latest");

    const assigningAuthorization: ClaimAuthorizationInput = {
      chainId: network.chainId,
      reserve: await assigning.reserve.getAddress(),
      pool: await assigning.pool.getAddress(),
      drawId: 204n,
      slotIndex: 3n,
      participant: assigning.other.address,
      recipient: assigning.other.address,
      registrationVersion: 1_003n,
      reservationNonce: 2_003n,
      nonce: 0n,
      expiry: BigInt(latest?.timestamp ?? 0) + 3_600n,
    };

    const assigningDomain: ethers.TypedDataDomain = {
      name: "VeilpotPrizeReserve",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await assigning.reserve.getAddress(),
    };

    const assigningSignature = await assigning.other.signTypedData(
      assigningDomain,
      claimAuthorizationTypes,
      assigningAuthorization,
    );

    await expect(
      assigning.reserve.validateClaimAuthorization(assigningAuthorization, assigningSignature),
    ).to.be.revertedWithCustomError(assigning.reserve, "InvalidPrizeState");

    const unbound = await prepareGate1C2CAuthorization(205n, 3n, 2n);

    const unboundAuthorization: ClaimAuthorizationInput = {
      ...unbound.authorization,
      slotIndex: 2n,
      participant: unbound.other.address,
      recipient: unbound.other.address,
      registrationVersion: 1_002n,
      reservationNonce: 2_002n,
    };

    const unboundSignature = await unbound.other.signTypedData(
      unbound.domain,
      claimAuthorizationTypes,
      unboundAuthorization,
    );

    await expect(
      unbound.reserve.validateClaimAuthorization(unboundAuthorization, unboundSignature),
    ).to.be.revertedWithCustomError(unbound.reserve, "ClaimEntitlementUnbound");
  });
});

interface PartialReturnToken extends TestToken {
  setPartialCap(cap: bigint): Tx;
}

interface PausableToken extends TestToken {
  setPaused(value: boolean): Tx;
}

interface PrizeReserve {
  claimPrize(authorization: ClaimAuthorizationInput, signature: string): Tx;
}

interface Gate1C2CPayoutSetup {
  owner: Signer;
  winner: Signer;
  token: TestToken;
  pool: PrizePoolHarness;
  adapter: PrizeAdapterHarness;
  reserve: PrizeReserve;
  drawId: bigint;
}

async function prepareGate1C2CPayout(
  drawId: bigint,
  tokenName:
    | "TestERC7984"
    | "TestERC7984PartialReturn"
    | "TestERC7984Reentrant"
    | "TestERC7984Pausable"
    | "TestERC7984DirectNoReturnAcl" = "TestERC7984",
  tokenArgs: readonly bigint[] = [],
  winnerSlots: readonly bigint[] = [3n],
  prizeAmount = 100n,
): Promise<Gate1C2CPayoutSetup> {
  const pair = await deployPair("Gate1CPrizeAdapterHarness", tokenName, tokenArgs);

  const adapter = pair.adapter as unknown as PrizeAdapterHarness;

  await receipt(pair.pool.setFinalizedDraw(drawId, 8n));

  for (let index = 0; index < 8; index += 1) {
    const slotIndex = BigInt(index);

    const winner = winnerSlots.includes(slotIndex);

    const beneficiary = slotIndex === 3n ? pair.other.address : pair.owner.address;

    await receipt(
      pair.pool.setAssignmentSlot(
        drawId,
        slotIndex,
        beneficiary,
        1_000n + slotIndex,
        2_000n + slotIndex,
        true,
        winner,
      ),
    );
  }

  await receipt(adapter.setDrawState(drawId, 4n));

  await receipt(pair.token.mintClear(pair.owner.address, prizeAmount));

  await approveOperator(pair.token, await pair.reserve.getAddress());

  await sponsor(pair.owner, pair.reserve, drawId, prizeAmount, 0n);

  await receipt(pair.reserve.preparePrize(drawId));

  const pending = await pair.reserve.prizeHandles(drawId);

  const status = await publicStage(pending[4], pending[5]);

  expect(status.status).to.equal(false);

  await receipt(pair.reserve.settlePrizeStatus(drawId, pending[8], status.status, status.proof));

  await receipt(pair.reserve.assignPrizeEntitlementChunk(drawId, 0n));

  const claimable = await pair.reserve.prizeHandles(drawId);

  expect(claimable[0]).to.equal(3n);
  expect(await decrypt64(claimable[3])).to.equal(prizeAmount);

  const accounting = await pair.reserve.reserveAccountingHandles();

  expect(await decrypt128(accounting[0])).to.equal(prizeAmount);
  expect(await decrypt128(accounting[1])).to.equal(prizeAmount);

  return {
    owner: pair.owner,
    winner: pair.other,
    token: pair.token,
    pool: pair.pool,
    adapter,
    reserve: pair.reserve,
    drawId,
  };
}

async function signClaimForSlot(
  setup: Gate1C2CPayoutSetup,
  signer: Signer,
  slotIndex: bigint,
  nonce: bigint,
): Promise<{
  authorization: ClaimAuthorizationInput;
  signature: string;
}> {
  const record = await setup.reserve.prizeEntitlementRecord(setup.drawId, slotIndex);

  expect(record[0]).to.equal(true);
  expect(record[1]).to.equal(true);
  expect(record[2]).to.equal(signer.address);

  const network = await hre.ethers.provider.getNetwork();

  const latest = await hre.ethers.provider.getBlock("latest");

  const domain: ethers.TypedDataDomain = {
    name: "VeilpotPrizeReserve",
    version: "1",
    chainId: network.chainId,
    verifyingContract: await setup.reserve.getAddress(),
  };

  const authorization: ClaimAuthorizationInput = {
    chainId: network.chainId,
    reserve: await setup.reserve.getAddress(),
    pool: await setup.pool.getAddress(),
    drawId: setup.drawId,
    slotIndex,
    participant: signer.address,
    recipient: signer.address,
    registrationVersion: record[3],
    reservationNonce: record[4],
    nonce,
    expiry: BigInt(latest?.timestamp ?? 0) + 3_600n,
  };

  return {
    authorization,
    signature: await signer.signTypedData(domain, claimAuthorizationTypes, authorization),
  };
}

interface PrizeReserve {
  CLAIM_COMPLETION_PROOF_TTL_SECONDS(): Promise<bigint>;

  claimCompletionHandles(
    drawId: bigint,
  ): Promise<readonly [bigint, bigint, string, bigint, bigint, bigint, Handle, Handle]>;

  settleClaimCompletion(
    drawId: bigint,
    attemptNonce: bigint,
    clearComplete: boolean,
    decryptionProof: string,
  ): Tx;

  refreshClaimCompletionEvidence(drawId: bigint): Tx;
}

interface ClaimCompletionSnapshot {
  state: bigint;
  slotIndex: bigint;
  participant: string;
  claimNonce: bigint;
  attemptNonce: bigint;
  deadline: bigint;
  status: boolean;
  context: bigint;
  proof: string;
}

async function currentClaimCompletion(
  reserve: PrizeReserve,
  drawId: bigint,
): Promise<ClaimCompletionSnapshot> {
  const handles = await reserve.claimCompletionHandles(drawId);

  const stage = await publicStage(handles[6], handles[7]);

  return {
    state: handles[0],
    slotIndex: handles[1],
    participant: handles[2],
    claimNonce: handles[3],
    attemptNonce: handles[4],
    deadline: handles[5],
    status: stage.status,
    context: stage.context,
    proof: stage.proof,
  };
}

async function settleCurrentClaimCompletion(
  reserve: PrizeReserve,
  drawId: bigint,
): Promise<ClaimCompletionSnapshot> {
  const stage = await currentClaimCompletion(reserve, drawId);

  await receipt(
    reserve.settleClaimCompletion(drawId, stage.attemptNonce, stage.status, stage.proof),
  );

  return stage;
}

function claimCompletionContextValue(
  chainId: bigint,
  reserve: string,
  pool: string,
  drawId: bigint,
  slotIndex: bigint,
  participant: string,
  claimNonce: bigint,
  attemptNonce: bigint,
): bigint {
  const domain = ethers.keccak256(ethers.toUtf8Bytes("VEILPOT_CLAIM_COMPLETION_V1"));

  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "bytes32",
      "uint256",
      "address",
      "address",
      "uint256",
      "uint256",
      "address",
      "uint256",
      "uint256",
    ],
    [domain, chainId, reserve, pool, drawId, slotIndex, participant, claimNonce, attemptNonce],
  );

  return BigInt(ethers.keccak256(encoded));
}

describe("Gate 1C.2C confidential payout actual-return accounting", function () {
  it("pays the full encrypted entitlement from real reserve custody and starts completion evidence without mutating assigned total", async function () {
    const setup = await prepareGate1C2CPayout(301n);

    const assignedBefore = await decrypt128(
      await setup.reserve.prizeAssignmentTotalHandle(setup.drawId),
    );

    expect(assignedBefore).to.equal(100n);

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    const payoutReceipt = await receipt(
      (setup.reserve.connect(setup.owner) as unknown as PrizeReserve).claimPrize(
        claim.authorization,
        claim.signature,
      ),
    );

    recordHcu("claimPrizeFull", payoutReceipt);

    const winner = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(winner[5])).to.equal(0n);

    const prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(6n);
    expect(await decrypt64(prize[3])).to.equal(0n);

    const accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(0n);
    expect(await decrypt128(accounting[1])).to.equal(0n);

    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(1n);

    expect(await decrypt128(await setup.reserve.prizeAssignmentTotalHandle(setup.drawId))).to.equal(
      assignedBefore,
    );

    await expect(
      setup.reserve.claimPrize(claim.authorization, claim.signature),
    ).to.be.revertedWithCustomError(setup.reserve, "InvalidPrizeState");
  });

  it("preserves encrypted residuals across partial and zero actual transfers while each successful token call enters proof-pending state", async function () {
    const setup = await prepareGate1C2CPayout(302n, "TestERC7984PartialReturn", [100n]);

    const token = setup.token as unknown as PartialReturnToken;

    await receipt(token.setPartialCap(40n));

    let claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    recordHcu(
      "claimPrizePartial",
      await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature)),
    );

    let winner = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(winner[5])).to.equal(60n);

    let prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(6n);
    expect(await decrypt64(prize[3])).to.equal(60n);

    let accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(60n);
    expect(await decrypt128(accounting[1])).to.equal(60n);
    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(1n);

    let completion = await settleCurrentClaimCompletion(setup.reserve, setup.drawId);

    expect(completion.status).to.equal(false);

    prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(3n);

    await receipt(token.setPartialCap(0n));

    claim = await signClaimForSlot(setup, setup.winner, 3n, 1n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    winner = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(winner[5])).to.equal(60n);

    prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(6n);
    expect(await decrypt64(prize[3])).to.equal(60n);

    accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(60n);
    expect(await decrypt128(accounting[1])).to.equal(60n);
    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(2n);

    completion = await settleCurrentClaimCompletion(setup.reserve, setup.drawId);

    expect(completion.status).to.equal(false);

    await receipt(token.setPartialCap(100n));

    claim = await signClaimForSlot(setup, setup.winner, 3n, 2n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    winner = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(winner[5])).to.equal(0n);

    prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(6n);
    expect(await decrypt64(prize[3])).to.equal(0n);

    accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(0n);
    expect(await decrypt128(accounting[1])).to.equal(0n);
    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(3n);

    expect(await decrypt128(await setup.reserve.prizeAssignmentTotalHandle(setup.drawId))).to.equal(
      100n,
    );
  });

  it("rolls back nonce, entitlement residual, accounting, and proof state when the canonical token reverts", async function () {
    const setup = await prepareGate1C2CPayout(303n, "TestERC7984Pausable");

    const token = setup.token as unknown as PausableToken;

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(token.setPaused(true));

    await expect(setup.reserve.claimPrize(claim.authorization, claim.signature)).to.be.revertedWith(
      "TOKEN_PAUSED",
    );

    const winner = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(winner[5])).to.equal(100n);

    const prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(3n);
    expect(await decrypt64(prize[3])).to.equal(100n);

    const accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(100n);
    expect(await decrypt128(accounting[1])).to.equal(100n);
    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(0n);
  });

  it("rejects a direct payout return without reserve ACL and atomically rolls back token transfer and proof state", async function () {
    const setup = await prepareGate1C2CPayout(304n, "TestERC7984DirectNoReturnAcl");

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await expect(
      setup.reserve.claimPrize(claim.authorization, claim.signature),
    ).to.be.revertedWithCustomError(setup.reserve, "MissingClaimTransferAcl");

    const winner = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(winner[5])).to.equal(100n);

    const prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(3n);
    expect(await decrypt64(prize[3])).to.equal(100n);

    const accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(100n);
    expect(await decrypt128(accounting[1])).to.equal(100n);
    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(0n);
  });

  it("blocks token-side reentrancy while preserving the successful outer payout and pending completion evidence", async function () {
    const setup = await prepareGate1C2CPayout(305n, "TestERC7984Reentrant");

    const token = setup.token as unknown as ReentrantToken;

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    const payload = setup.reserve.interface.encodeFunctionData("claimPrize", [
      claim.authorization,
      claim.signature,
    ]);

    await receipt(token.configureReentry(await setup.reserve.getAddress(), payload, true));

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    expect(await token.lastReentrySucceeded()).to.equal(false);

    const winner = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(winner[5])).to.equal(0n);

    const prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(6n);

    const accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(0n);
    expect(await decrypt128(accounting[1])).to.equal(0n);
    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(1n);
  });

  it("caps a malformed second entitlement by the draw-global residual instead of allowing cross-liability drain", async function () {
    const setup = await prepareGate1C2CPayout(306n, "TestERC7984PartialReturn", [100n], [3n, 4n]);

    const token = setup.token as unknown as PartialReturnToken;

    expect(await decrypt128(await setup.reserve.prizeAssignmentTotalHandle(setup.drawId))).to.equal(
      200n,
    );

    await receipt(token.setPartialCap(40n));

    const firstWinner = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(firstWinner.authorization, firstWinner.signature));

    const firstRecord = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(firstRecord[5])).to.equal(60n);

    let prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(await decrypt64(prize[3])).to.equal(60n);

    let accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(60n);
    expect(await decrypt128(accounting[1])).to.equal(60n);

    const firstCompletion = await settleCurrentClaimCompletion(setup.reserve, setup.drawId);

    expect(firstCompletion.status).to.equal(false);

    await receipt(token.setPartialCap(100n));

    const secondWinner = await signClaimForSlot(setup, setup.owner, 4n, 0n);

    await receipt(setup.reserve.claimPrize(secondWinner.authorization, secondWinner.signature));

    const secondRecord = await setup.reserve.prizeEntitlementRecord(setup.drawId, 4n);

    expect(await decrypt64(secondRecord[5])).to.equal(40n);

    prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(6n);
    expect(await decrypt64(prize[3])).to.equal(0n);

    accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(0n);
    expect(await decrypt128(accounting[1])).to.equal(0n);

    expect(await decrypt128(await setup.reserve.prizeAssignmentTotalHandle(setup.drawId))).to.equal(
      200n,
    );
  });
});

describe("Gate 1C.2C transfer completion proof and refresh liveness", function () {
  it("moves a full payout into TRANSFER_PROOF_PENDING and marks CLAIMED only after the authenticated global-zero proof", async function () {
    const setup = await prepareGate1C2CPayout(401n);

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    const completion = await currentClaimCompletion(setup.reserve, setup.drawId);

    expect(completion.state).to.equal(6n);
    expect(completion.slotIndex).to.equal(3n);
    expect(completion.participant).to.equal(setup.winner.address);
    expect(completion.claimNonce).to.equal(0n);
    expect(completion.attemptNonce).to.equal(1n);
    expect(completion.status).to.equal(true);

    recordHcu(
      "settleClaimCompletionTrue",
      await receipt(
        setup.reserve.settleClaimCompletion(
          setup.drawId,
          completion.attemptNonce,
          completion.status,
          completion.proof,
        ),
      ),
    );

    const settled = await setup.reserve.prizeHandles(setup.drawId);

    expect(settled[0]).to.equal(4n);
  });

  it("returns a partial payout to CLAIMABLE only after a proof that the global residual is still nonzero", async function () {
    const setup = await prepareGate1C2CPayout(402n, "TestERC7984PartialReturn", [100n]);

    const token = setup.token as unknown as PartialReturnToken;

    await receipt(token.setPartialCap(40n));

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    const completion = await currentClaimCompletion(setup.reserve, setup.drawId);

    expect(completion.status).to.equal(false);

    await receipt(
      setup.reserve.settleClaimCompletion(
        setup.drawId,
        completion.attemptNonce,
        completion.status,
        completion.proof,
      ),
    );

    const prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(3n);
    expect(await decrypt64(prize[3])).to.equal(60n);

    const winner = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(winner[5])).to.equal(60n);
  });

  it("cannot let a zero-entitlement nonwinner mark the draw claimed while a global residual remains", async function () {
    const setup = await prepareGate1C2CPayout(403n);

    const claim = await signClaimForSlot(setup, setup.owner, 0n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    const completion = await currentClaimCompletion(setup.reserve, setup.drawId);

    expect(completion.status).to.equal(false);

    await receipt(
      setup.reserve.settleClaimCompletion(
        setup.drawId,
        completion.attemptNonce,
        completion.status,
        completion.proof,
      ),
    );

    const prize = await setup.reserve.prizeHandles(setup.drawId);

    expect(prize[0]).to.equal(3n);
    expect(await decrypt64(prize[3])).to.equal(100n);

    const accounting = await setup.reserve.reserveAccountingHandles();

    expect(await decrypt128(accounting[0])).to.equal(100n);
    expect(await decrypt128(accounting[1])).to.equal(100n);

    expect(await setup.reserve.nextClaimNonce(setup.owner.address)).to.equal(1n);
  });

  it("accepts authentic completion evidence exactly at the inclusive proof deadline", async function () {
    const setup = await prepareGate1C2CPayout(404n);

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    const completion = await currentClaimCompletion(setup.reserve, setup.drawId);

    expect(completion.status).to.equal(true);

    await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(completion.deadline)]);

    await receipt(
      setup.reserve.settleClaimCompletion(
        setup.drawId,
        completion.attemptNonce,
        completion.status,
        completion.proof,
      ),
    );

    const settled = await setup.reserve.prizeHandles(setup.drawId);

    expect(settled[0]).to.equal(4n);
  });

  it("rejects settlement after expiry and permits a permissionless refresh only after that deadline", async function () {
    const setup = await prepareGate1C2CPayout(405n);

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    const original = await currentClaimCompletion(setup.reserve, setup.drawId);

    await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(original.deadline) + 1]);

    await expect(
      setup.reserve.settleClaimCompletion(
        setup.drawId,
        original.attemptNonce,
        original.status,
        original.proof,
      ),
    ).to.be.revertedWithCustomError(setup.reserve, "TransferProofExpired");

    const permissionless = setup.reserve.connect(setup.owner) as unknown as PrizeReserve;

    recordHcu(
      "refreshClaimCompletionEvidence",
      await receipt(permissionless.refreshClaimCompletionEvidence(setup.drawId)),
    );

    const refreshed = await currentClaimCompletion(setup.reserve, setup.drawId);

    expect(refreshed.state).to.equal(6n);
    expect(refreshed.attemptNonce).to.equal(2n);
    expect(refreshed.deadline).to.be.greaterThan(original.deadline);
  });

  it("rejects stale completion evidence after refresh by both attempt nonce and cryptographic context", async function () {
    const setup = await prepareGate1C2CPayout(406n);

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    const stale = await currentClaimCompletion(setup.reserve, setup.drawId);

    await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(stale.deadline) + 1]);

    await receipt(setup.reserve.refreshClaimCompletionEvidence(setup.drawId));

    const fresh = await currentClaimCompletion(setup.reserve, setup.drawId);

    expect(fresh.attemptNonce).to.equal(2n);

    await expect(
      setup.reserve.settleClaimCompletion(setup.drawId, 1n, stale.status, stale.proof),
    ).to.be.revertedWithCustomError(setup.reserve, "TransferAttemptMismatch");

    await expect(setup.reserve.settleClaimCompletion(setup.drawId, 2n, stale.status, stale.proof))
      .to.be.reverted;

    await receipt(
      setup.reserve.settleClaimCompletion(
        setup.drawId,
        fresh.attemptNonce,
        fresh.status,
        fresh.proof,
      ),
    );

    const settled = await setup.reserve.prizeHandles(setup.drawId);

    expect(settled[0]).to.equal(4n);
  });

  it("binds the public completion context to chain, reserve, pool, draw, slot, participant, claim nonce, and attempt nonce", async function () {
    const setup = await prepareGate1C2CPayout(407n);

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    const completion = await currentClaimCompletion(setup.reserve, setup.drawId);

    const network = await hre.ethers.provider.getNetwork();

    const reserveAddress = await setup.reserve.getAddress();
    const poolAddress = await setup.pool.getAddress();

    const expected = claimCompletionContextValue(
      network.chainId,
      reserveAddress,
      poolAddress,
      setup.drawId,
      completion.slotIndex,
      completion.participant,
      completion.claimNonce,
      completion.attemptNonce,
    );

    expect(completion.context).to.equal(expected);

    const mutations = [
      claimCompletionContextValue(
        network.chainId + 1n,
        reserveAddress,
        poolAddress,
        setup.drawId,
        completion.slotIndex,
        completion.participant,
        completion.claimNonce,
        completion.attemptNonce,
      ),
      claimCompletionContextValue(
        network.chainId,
        setup.owner.address,
        poolAddress,
        setup.drawId,
        completion.slotIndex,
        completion.participant,
        completion.claimNonce,
        completion.attemptNonce,
      ),
      claimCompletionContextValue(
        network.chainId,
        reserveAddress,
        setup.owner.address,
        setup.drawId,
        completion.slotIndex,
        completion.participant,
        completion.claimNonce,
        completion.attemptNonce,
      ),
      claimCompletionContextValue(
        network.chainId,
        reserveAddress,
        poolAddress,
        setup.drawId + 1n,
        completion.slotIndex,
        completion.participant,
        completion.claimNonce,
        completion.attemptNonce,
      ),
      claimCompletionContextValue(
        network.chainId,
        reserveAddress,
        poolAddress,
        setup.drawId,
        completion.slotIndex + 1n,
        completion.participant,
        completion.claimNonce,
        completion.attemptNonce,
      ),
      claimCompletionContextValue(
        network.chainId,
        reserveAddress,
        poolAddress,
        setup.drawId,
        completion.slotIndex,
        setup.owner.address,
        completion.claimNonce,
        completion.attemptNonce,
      ),
      claimCompletionContextValue(
        network.chainId,
        reserveAddress,
        poolAddress,
        setup.drawId,
        completion.slotIndex,
        completion.participant,
        completion.claimNonce + 1n,
        completion.attemptNonce,
      ),
      claimCompletionContextValue(
        network.chainId,
        reserveAddress,
        poolAddress,
        setup.drawId,
        completion.slotIndex,
        completion.participant,
        completion.claimNonce,
        completion.attemptNonce + 1n,
      ),
    ];

    for (const mutation of mutations) {
      expect(mutation).to.not.equal(expected);
    }

    const otherSetup = await prepareGate1C2CPayout(408n);

    const otherClaim = await signClaimForSlot(otherSetup, otherSetup.winner, 3n, 0n);

    await receipt(otherSetup.reserve.claimPrize(otherClaim.authorization, otherClaim.signature));

    const otherCompletion = await currentClaimCompletion(otherSetup.reserve, otherSetup.drawId);

    await expect(
      setup.reserve.settleClaimCompletion(
        setup.drawId,
        completion.attemptNonce,
        otherCompletion.status,
        otherCompletion.proof,
      ),
    ).to.be.reverted;
  });

  it("serializes the draw by rejecting a second claim while completion evidence is pending", async function () {
    const setup = await prepareGate1C2CPayout(409n);

    const zeroClaim = await signClaimForSlot(setup, setup.owner, 0n, 0n);

    await receipt(setup.reserve.claimPrize(zeroClaim.authorization, zeroClaim.signature));

    const winnerClaim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await expect(
      setup.reserve.claimPrize(winnerClaim.authorization, winnerClaim.signature),
    ).to.be.revertedWithCustomError(setup.reserve, "InvalidPrizeState");

    const completion = await currentClaimCompletion(setup.reserve, setup.drawId);

    expect(completion.state).to.equal(6n);
    expect(completion.status).to.equal(false);
  });

  it("refreshes only evidence and leaves residuals, accounting, assigned total, and participant nonce unchanged", async function () {
    const setup = await prepareGate1C2CPayout(410n, "TestERC7984PartialReturn", [100n]);

    const token = setup.token as unknown as PartialReturnToken;

    await receipt(token.setPartialCap(40n));

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    const beforeCompletion = await currentClaimCompletion(setup.reserve, setup.drawId);

    const beforePrize = await setup.reserve.prizeHandles(setup.drawId);

    const beforeRecord = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    const beforeAccounting = await setup.reserve.reserveAccountingHandles();

    const beforeAssigned = await decrypt128(
      await setup.reserve.prizeAssignmentTotalHandle(setup.drawId),
    );

    const beforeNonce = await setup.reserve.nextClaimNonce(setup.winner.address);

    await hre.network.provider.send("evm_setNextBlockTimestamp", [
      Number(beforeCompletion.deadline) + 1,
    ]);

    await receipt(setup.reserve.refreshClaimCompletionEvidence(setup.drawId));

    const afterCompletion = await currentClaimCompletion(setup.reserve, setup.drawId);

    const afterPrize = await setup.reserve.prizeHandles(setup.drawId);

    const afterRecord = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    const afterAccounting = await setup.reserve.reserveAccountingHandles();

    expect(afterCompletion.attemptNonce).to.equal(2n);
    expect(await decrypt64(afterPrize[3])).to.equal(await decrypt64(beforePrize[3]));
    expect(await decrypt64(afterRecord[5])).to.equal(await decrypt64(beforeRecord[5]));

    expect(await decrypt128(afterAccounting[0])).to.equal(await decrypt128(beforeAccounting[0]));

    expect(await decrypt128(afterAccounting[1])).to.equal(await decrypt128(beforeAccounting[1]));

    expect(await decrypt128(await setup.reserve.prizeAssignmentTotalHandle(setup.drawId))).to.equal(
      beforeAssigned,
    );

    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(beforeNonce);
  });

  it("makes CLAIMED terminal so even a fresh correctly signed nonce cannot initiate another claim", async function () {
    const setup = await prepareGate1C2CPayout(411n);

    const first = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(first.authorization, first.signature));

    const completion = await settleCurrentClaimCompletion(setup.reserve, setup.drawId);

    expect(completion.status).to.equal(true);

    const claimed = await setup.reserve.prizeHandles(setup.drawId);

    expect(claimed[0]).to.equal(4n);

    const second = await signClaimForSlot(setup, setup.winner, 3n, 1n);

    await expect(
      setup.reserve.claimPrize(second.authorization, second.signature),
    ).to.be.revertedWithCustomError(setup.reserve, "InvalidPrizeState");

    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(1n);
  });
});

interface PrizeReserve {
  authorizeEntitlementDecryption(drawId: bigint, slotIndex: bigint): Tx;
}

async function expectOptInDecryptRejected(action: () => Promise<unknown>): Promise<void> {
  let rejected = false;

  try {
    await action();
  } catch {
    rejected = true;
  }

  expect(rejected).to.equal(true);
}

describe("Gate 1C.2C opt-in entitlement decryption", function () {
  it("does not grant the beneficiary entitlement-decryption ACL automatically", async function () {
    const setup = await prepareGate1C2CPayout(501n);

    const record = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(record[0]).to.equal(true);
    expect(record[1]).to.equal(true);
    expect(record[2]).to.equal(setup.winner.address);

    await expectOptInDecryptRejected(() =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        record[5],
        setup.reserve.getAddress(),
        setup.winner,
      ),
    );

    expect(await decrypt64(record[5])).to.equal(100n);
  });

  it("lets only the frozen historical owner opt into private decryption of the current entitlement handle", async function () {
    const setup = await prepareGate1C2CPayout(502n);

    const before = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    await expectOptInDecryptRejected(() =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        before[5],
        setup.reserve.getAddress(),
        setup.winner,
      ),
    );

    await receipt(
      (
        setup.reserve.connect(setup.winner) as unknown as PrizeReserve
      ).authorizeEntitlementDecryption(setup.drawId, 3n),
    );

    const clear = await hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      before[5],
      await setup.reserve.getAddress(),
      setup.winner,
    );

    expect(clear).to.equal(100n);
  });

  it("rejects a non-owner and does not grant that caller decryption access", async function () {
    const setup = await prepareGate1C2CPayout(503n);

    const record = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    await expect(
      (
        setup.reserve.connect(setup.owner) as unknown as PrizeReserve
      ).authorizeEntitlementDecryption(setup.drawId, 3n),
    ).to.be.revertedWithCustomError(setup.reserve, "OnlyEntitlementOwner");

    await expectOptInDecryptRejected(() =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        record[5],
        setup.reserve.getAddress(),
        setup.owner,
      ),
    );
  });

  it("rejects both uninitialized and historically unbound entitlement records", async function () {
    const uninitialized = await prepareGate1C2BAssignment(504n, 8n, 100n, 3n);

    await expect(
      (
        uninitialized.reserve.connect(uninitialized.other) as unknown as PrizeReserve
      ).authorizeEntitlementDecryption(504n, 3n),
    ).to.be.revertedWithCustomError(uninitialized.reserve, "ClaimEntitlementNotInitialized");

    const unbound = await prepareGate1C2BAssignment(505n, 8n, 100n, 5n, 5n);

    await receipt(unbound.reserve.assignPrizeEntitlementChunk(505n, 0n));

    const unboundRecord = await unbound.reserve.prizeEntitlementRecord(505n, 5n);

    expect(unboundRecord[0]).to.equal(true);
    expect(unboundRecord[1]).to.equal(false);
    expect(unboundRecord[2]).to.equal(ethers.ZeroAddress);

    await expect(
      (
        unbound.reserve.connect(unbound.owner) as unknown as PrizeReserve
      ).authorizeEntitlementDecryption(505n, 5n),
    ).to.be.revertedWithCustomError(unbound.reserve, "ClaimEntitlementUnbound");
  });

  it("keeps claiming completely independent from decryption opt-in and permits opt-in after terminal settlement", async function () {
    const setup = await prepareGate1C2CPayout(506n);

    const before = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    await expectOptInDecryptRejected(() =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        before[5],
        setup.reserve.getAddress(),
        setup.winner,
      ),
    );

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    expect(await setup.reserve.nextClaimNonce(setup.winner.address)).to.equal(1n);

    const completion = await settleCurrentClaimCompletion(setup.reserve, setup.drawId);

    expect(completion.status).to.equal(true);

    const claimed = await setup.reserve.prizeHandles(setup.drawId);

    expect(claimed[0]).to.equal(4n);

    const after = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(await decrypt64(after[5])).to.equal(0n);

    await receipt(
      (
        setup.reserve.connect(setup.winner) as unknown as PrizeReserve
      ).authorizeEntitlementDecryption(setup.drawId, 3n),
    );

    const clear = await hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      after[5],
      await setup.reserve.getAddress(),
      setup.winner,
    );

    expect(clear).to.equal(0n);
  });

  it("requires a fresh opt-in when a partial claim replaces the entitlement with a new residual handle", async function () {
    const setup = await prepareGate1C2CPayout(507n, "TestERC7984PartialReturn", [100n]);

    const token = setup.token as unknown as PartialReturnToken;

    await receipt(token.setPartialCap(40n));

    const before = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    await receipt(
      (
        setup.reserve.connect(setup.winner) as unknown as PrizeReserve
      ).authorizeEntitlementDecryption(setup.drawId, 3n),
    );

    expect(
      await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        before[5],
        await setup.reserve.getAddress(),
        setup.winner,
      ),
    ).to.equal(100n);

    const claim = await signClaimForSlot(setup, setup.winner, 3n, 0n);

    await receipt(setup.reserve.claimPrize(claim.authorization, claim.signature));

    const after = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    expect(after[5]).to.not.equal(before[5]);
    expect(await decrypt64(after[5])).to.equal(60n);

    const pending = await setup.reserve.prizeHandles(setup.drawId);

    expect(pending[0]).to.equal(6n);

    await expectOptInDecryptRejected(() =>
      hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        after[5],
        setup.reserve.getAddress(),
        setup.winner,
      ),
    );

    await receipt(
      (
        setup.reserve.connect(setup.winner) as unknown as PrizeReserve
      ).authorizeEntitlementDecryption(setup.drawId, 3n),
    );

    expect(
      await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        after[5],
        await setup.reserve.getAddress(),
        setup.winner,
      ),
    ).to.equal(60n);
  });

  it("changes only the current-handle ACL and leaves every financial, nonce, state, and completion value untouched", async function () {
    const setup = await prepareGate1C2CPayout(508n);

    const beforeRecord = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    const beforePrize = await setup.reserve.prizeHandles(setup.drawId);

    const beforeAccounting = await setup.reserve.reserveAccountingHandles();

    const beforeAssigned = await setup.reserve.prizeAssignmentTotalHandle(setup.drawId);

    const beforeNonce = await setup.reserve.nextClaimNonce(setup.winner.address);

    const beforeCompletion = await setup.reserve.claimCompletionHandles(setup.drawId);

    const optInReceipt = await receipt(
      (
        setup.reserve.connect(setup.winner) as unknown as PrizeReserve
      ).authorizeEntitlementDecryption(setup.drawId, 3n),
    );

    recordHcu("authorizeEntitlementDecryption", optInReceipt);

    const afterRecord = await setup.reserve.prizeEntitlementRecord(setup.drawId, 3n);

    const afterPrize = await setup.reserve.prizeHandles(setup.drawId);

    const afterAccounting = await setup.reserve.reserveAccountingHandles();

    const afterAssigned = await setup.reserve.prizeAssignmentTotalHandle(setup.drawId);

    const afterNonce = await setup.reserve.nextClaimNonce(setup.winner.address);

    const afterCompletion = await setup.reserve.claimCompletionHandles(setup.drawId);

    expect(afterRecord[5]).to.equal(beforeRecord[5]);
    expect(await decrypt64(afterRecord[5])).to.equal(100n);

    expect(afterPrize[0]).to.equal(beforePrize[0]);
    expect(afterPrize[3]).to.equal(beforePrize[3]);
    expect(await decrypt64(afterPrize[3])).to.equal(100n);

    expect(afterAccounting[0]).to.equal(beforeAccounting[0]);
    expect(afterAccounting[1]).to.equal(beforeAccounting[1]);

    expect(await decrypt128(afterAccounting[0])).to.equal(100n);
    expect(await decrypt128(afterAccounting[1])).to.equal(100n);

    expect(afterAssigned).to.equal(beforeAssigned);
    expect(await decrypt128(afterAssigned)).to.equal(100n);

    expect(afterNonce).to.equal(beforeNonce);

    expect(Array.from(afterCompletion)).to.deep.equal(Array.from(beforeCompletion));

    expect(
      await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        afterRecord[5],
        await setup.reserve.getAddress(),
        setup.winner,
      ),
    ).to.equal(100n);
  });
});
