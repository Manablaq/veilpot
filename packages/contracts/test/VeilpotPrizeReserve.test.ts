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
  tokenName: "TestERC7984" | "TestERC7984PartialReturn" | "TestERC7984Reentrant" = "TestERC7984",
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

  const poolFactory = await hre.ethers.getContractFactory("Gate1CPrizePoolHarness");

  const pool = (await poolFactory.deploy(await token.getAddress())) as unknown as PrizePoolHarness;

  await pool.waitForDeployment();

  const nonce = await hre.ethers.provider.getTransactionCount(owner.address);

  const predictedAdapter = ethers.getCreateAddress({
    from: owner.address,
    nonce,
  });

  const predictedReserve = ethers.getCreateAddress({
    from: owner.address,
    nonce: nonce + 1,
  });

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

    const pool = await (
      await hre.ethers.getContractFactory("Gate1CPrizePoolHarness")
    ).deploy(await token.getAddress());

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
