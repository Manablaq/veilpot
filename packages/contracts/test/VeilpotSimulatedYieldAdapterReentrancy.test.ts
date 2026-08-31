// Gate 1C.1 final audit: reentrancy and representative HCU ceilings.
// TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY.

import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Tx = Promise<ethers.ContractTransactionResponse>;
type Signer = Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

interface AuditToken extends ethers.BaseContract {
  mintClear(to: string, amount: bigint): Tx;
  setOperator(operator: string, until: bigint): Tx;

  configureReentry(target: string, payload: string, enabled: boolean): Tx;

  lastReentrySucceeded(): Promise<boolean>;
}

interface PoolHarness extends ethers.BaseContract {
  recognize(adapter: string, drawId: bigint, encryptedRawTotalTwab: Handle, proof: string): Tx;
}

interface ReserveHarness extends ethers.BaseContract {
  receivedHandle(drawId: bigint): Promise<Handle>;
}

interface YieldAdapter extends ethers.BaseContract {
  fundYieldLiquidity(
    encryptedAmount: Handle,
    proof: string,
    funder: string,
    fundingNonce: bigint,
  ): Tx;

  liquidityHandles(): Promise<readonly [Handle, Handle]>;

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

async function receipt(tx: Tx): Promise<ethers.TransactionReceipt> {
  const result = await (await tx).wait();

  if (result === null) {
    throw new Error("missing transaction receipt");
  }

  return result;
}

async function encrypt64(
  contractAddress: string,
  signer: Signer,
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
  signer: Signer,
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

async function publicStage(
  statusHandle: Handle,
  contextHandle: Handle,
): Promise<{
  status: boolean;
  proof: string;
}> {
  const result = await hre.fhevm.publicDecrypt([statusHandle, contextHandle]);

  const status = result.clearValues[statusHandle];

  if (typeof status !== "boolean") {
    throw new Error("expected public boolean");
  }

  return {
    status,
    proof: result.decryptionProof,
  };
}

function assertHcu(operation: string, result: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(result);

  const globalHCU = hcu.globalHCU;

  const sequentialHCU = hcu.maxHCUDepth;

  console.log(
    JSON.stringify({
      scope: "GATE_1C1_FINAL_AUDIT_LOCAL_ONLY",
      operation,
      globalHCU,
      sequentialHCU,
      evmGasRunSpecific: result.gasUsed.toString(),
    }),
  );

  expect(globalHCU).to.be.lessThan(20_000_000);

  expect(sequentialHCU).to.be.lessThan(5_000_000);
}

async function deployFixture(tokenName: "TestERC7984" | "TestERC7984Reentrant"): Promise<{
  owner: Signer;
  token: AuditToken;
  pool: PoolHarness;
  reserve: ReserveHarness;
  adapter: YieldAdapter;
}> {
  const signers = await hre.ethers.getSigners();

  const owner = signers[0]!;

  const token = (await (
    await hre.ethers.getContractFactory(tokenName)
  ).deploy()) as unknown as AuditToken;

  await token.waitForDeployment();

  const pool = (await (
    await hre.ethers.getContractFactory("Gate1CYieldPoolHarness")
  ).deploy()) as unknown as PoolHarness;

  await pool.waitForDeployment();

  const reserve = (await (
    await hre.ethers.getContractFactory("Gate1CYieldReserveHarness")
  ).deploy()) as unknown as ReserveHarness;

  await reserve.waitForDeployment();

  const adapter = (await (
    await hre.ethers.getContractFactory("VeilpotSimulatedYieldAdapter")
  ).deploy(
    await token.getAddress(),
    await pool.getAddress(),
    await reserve.getAddress(),
  )) as unknown as YieldAdapter;

  await adapter.waitForDeployment();

  await hre.fhevm.assertCoprocessorInitialized(token, tokenName);

  await hre.fhevm.assertCoprocessorInitialized(pool, "Gate1CYieldPoolHarness");

  await hre.fhevm.assertCoprocessorInitialized(reserve, "Gate1CYieldReserveHarness");

  await hre.fhevm.assertCoprocessorInitialized(adapter, "VeilpotSimulatedYieldAdapter");

  return {
    owner,
    token,
    pool,
    reserve,
    adapter,
  };
}

async function approveAdapter(token: AuditToken, adapter: YieldAdapter): Promise<void> {
  const latest = await hre.ethers.provider.getBlock("latest");

  const until = BigInt((latest?.timestamp ?? 0) + 3600);

  await receipt(token.setOperator(await adapter.getAddress(), until));
}

async function prepareFundingInput(
  owner: Signer,
  token: AuditToken,
  adapter: YieldAdapter,
  amount: bigint,
): Promise<{
  handle: Handle;
  proof: string;
}> {
  await receipt(token.mintClear(owner.address, amount));

  await approveAdapter(token, adapter);

  return encrypt64(await adapter.getAddress(), owner, amount);
}

async function recognize(
  owner: Signer,
  pool: PoolHarness,
  adapter: YieldAdapter,
  drawId: bigint,
): Promise<ethers.TransactionReceipt> {
  const input = await encrypt128(await pool.getAddress(), owner, 1_000_000n * 86_400n);

  return receipt(pool.recognize(await adapter.getAddress(), drawId, input.handle, input.proof));
}

async function settleRecognition(
  adapter: YieldAdapter,
  drawId: bigint,
): Promise<ethers.TransactionReceipt> {
  const draw = await adapter.drawYieldHandles(drawId);

  const result = await publicStage(draw[4], draw[5]);

  expect(result.status).to.equal(false);

  return receipt(adapter.settleRecognition(drawId, result.status, result.proof));
}

async function settleSweep(
  adapter: YieldAdapter,
  drawId: bigint,
): Promise<ethers.TransactionReceipt> {
  const draw = await adapter.drawYieldHandles(drawId);

  const result = await publicStage(draw[4], draw[5]);

  expect(result.status).to.equal(true);

  return receipt(adapter.settleSweepCompletion(drawId, draw[6], result.status, result.proof));
}

describe("VeilpotSimulatedYieldAdapter Gate 1C.1 final audit", function () {
  it("blocks token callback reentrancy during funded-liquidity pull without breaking the outer transfer", async function () {
    const { owner, token, adapter } = await deployFixture("TestERC7984Reentrant");

    const input = await prepareFundingInput(owner, token, adapter, 100n);

    const payload = adapter.interface.encodeFunctionData("sweepYield", [999n]);

    await receipt(token.configureReentry(await adapter.getAddress(), payload, true));

    await receipt(adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, 0n));

    expect(await token.lastReentrySucceeded()).to.equal(false);

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(100n);

    expect(await decrypt64(liquidity[1])).to.equal(0n);
  });

  it("blocks token callback reentrancy during reserve sweep while preserving the successful outer payout", async function () {
    const { owner, token, pool, reserve, adapter } = await deployFixture("TestERC7984Reentrant");

    const input = await prepareFundingInput(owner, token, adapter, 100n);

    await receipt(adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, 0n));

    await recognize(owner, pool, adapter, 2n);

    await settleRecognition(adapter, 2n);

    const payload = adapter.interface.encodeFunctionData("sweepYield", [2n]);

    await receipt(token.configureReentry(await adapter.getAddress(), payload, true));

    await receipt(adapter.sweepYield(2n));

    expect(await token.lastReentrySucceeded()).to.equal(false);

    const received = await reserve.receivedHandle(2n);

    expect(await decrypt64(received)).to.equal(100n);

    const draw = await adapter.drawYieldHandles(2n);

    expect(await decrypt64(draw[3])).to.equal(0n);

    await settleSweep(adapter, 2n);
  });

  it("keeps every representative Gate 1C.1 transaction below frozen HCU ceilings", async function () {
    const { owner, token, pool, adapter } = await deployFixture("TestERC7984");

    const input = await prepareFundingInput(owner, token, adapter, 100n);

    const funded = await receipt(
      adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, 0n),
    );

    assertHcu("fundYieldLiquidity", funded);

    const recognized = await recognize(owner, pool, adapter, 30n);

    assertHcu("recognizeDrawYield", recognized);

    const recognitionSettled = await settleRecognition(adapter, 30n);

    assertHcu("settleRecognition", recognitionSettled);

    const swept = await receipt(adapter.sweepYield(30n));

    assertHcu("sweepYield", swept);

    const sweepSettled = await settleSweep(adapter, 30n);

    assertHcu("settleSweepCompletion", sweepSettled);
  });
});
