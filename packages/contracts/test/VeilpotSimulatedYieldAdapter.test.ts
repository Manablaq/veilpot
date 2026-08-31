// Gate 1C.1 production simulated-yield adapter integration tests.
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

interface PartialToken extends TestToken {
  setPartialCap(cap: bigint): Tx;
}

interface PoolHarness extends ethers.BaseContract {
  recognize(adapter: string, drawId: bigint, encryptedRawTotalTwab: Handle, proof: string): Tx;

  recognizeWithoutGrant(
    adapter: string,
    drawId: bigint,
    encryptedRawTotalTwab: Handle,
    proof: string,
  ): Tx;
}

interface ReserveHarness extends ethers.BaseContract {
  receivedHandle(drawId: bigint): Promise<Handle>;
}

interface ReentrantReserveHarness extends ReserveHarness {
  configureReentry(adapter: string, enabled: boolean): Tx;
  lastReentrySucceeded(): Promise<boolean>;
}

interface YieldAdapter extends ethers.BaseContract {
  fundYieldLiquidity(
    encryptedAmount: Handle,
    proof: string,
    funder: string,
    fundingNonce: bigint,
  ): Tx;

  nextFundingNonce(funder: string): Promise<bigint>;

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
  if (result === null) throw new Error("transaction receipt missing");
  return result;
}

async function encrypt64(
  contractAddress: string,
  signer: { address: string },
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
  signer: { address: string },
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

async function fixture(
  partialCap?: bigint,
  reserveName = "Gate1CYieldReserveHarness",
): Promise<{
  owner: Signer;
  other: Signer;
  token: TestToken;
  partialToken: PartialToken | undefined;
  pool: PoolHarness;
  reserve: ReserveHarness;
  adapter: YieldAdapter;
}> {
  const signers = await hre.ethers.getSigners();
  const owner = signers[0]!;
  const other = signers[1]!;

  const tokenName = partialCap === undefined ? "TestERC7984" : "TestERC7984PartialReturn";

  const tokenFactory = await hre.ethers.getContractFactory(tokenName);

  const deployedToken =
    partialCap === undefined ? await tokenFactory.deploy() : await tokenFactory.deploy(partialCap);

  const token = deployedToken as unknown as TestToken;

  const partialToken =
    partialCap === undefined ? undefined : (deployedToken as unknown as PartialToken);

  await token.waitForDeployment();

  const pool = (await (
    await hre.ethers.getContractFactory("Gate1CYieldPoolHarness")
  ).deploy()) as unknown as PoolHarness;

  await pool.waitForDeployment();

  const reserve = (await (
    await hre.ethers.getContractFactory(reserveName)
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

  await hre.fhevm.assertCoprocessorInitialized(reserve, reserveName);

  await hre.fhevm.assertCoprocessorInitialized(adapter, "VeilpotSimulatedYieldAdapter");

  return {
    owner,
    other,
    token,
    partialToken,
    pool,
    reserve,
    adapter,
  };
}

async function approveAdapter(token: TestToken, adapterAddress: string): Promise<void> {
  const latest = await hre.ethers.provider.getBlock("latest");
  const until = BigInt((latest?.timestamp ?? 0) + 3600);

  await receipt(token.setOperator(adapterAddress, until));
}

async function fundAdapter(
  owner: Signer,
  token: TestToken,
  adapter: YieldAdapter,
  amount: bigint,
  nonce = 0n,
): Promise<void> {
  await receipt(token.mintClear(owner.address, amount));

  await approveAdapter(token, await adapter.getAddress());

  const input = await encrypt64(await adapter.getAddress(), owner, amount);

  await receipt(adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, nonce));
}

async function recognize(
  owner: Signer,
  pool: PoolHarness,
  adapter: YieldAdapter,
  drawId: bigint,
  rawTotalTwab: bigint,
): Promise<void> {
  const input = await encrypt128(await pool.getAddress(), owner, rawTotalTwab);

  await receipt(pool.recognize(await adapter.getAddress(), drawId, input.handle, input.proof));
}

async function settleRecognition(adapter: YieldAdapter, drawId: bigint): Promise<boolean> {
  const handles = await adapter.drawYieldHandles(drawId);

  const decrypted = await publicStage(handles[4], handles[5]);

  await receipt(adapter.settleRecognition(drawId, decrypted.status, decrypted.proof));

  return decrypted.status;
}

async function settleSweep(adapter: YieldAdapter, drawId: bigint): Promise<boolean> {
  const handles = await adapter.drawYieldHandles(drawId);

  const decrypted = await publicStage(handles[4], handles[5]);

  await receipt(
    adapter.settleSweepCompletion(drawId, handles[6], decrypted.status, decrypted.proof),
  );

  return decrypted.status;
}

describe("VeilpotSimulatedYieldAdapter Gate 1C.1", function () {
  it("funds only through the explicit operator pull and consumes the application nonce", async function () {
    const { owner, token, adapter } = await fixture();

    await receipt(token.mintClear(owner.address, 150n));

    const input = await encrypt64(await adapter.getAddress(), owner, 150n);

    await expect(
      adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, 0n),
    ).to.be.revertedWithCustomError(adapter, "OperatorUnauthorized");

    await approveAdapter(token, await adapter.getAddress());

    await receipt(adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, 0n));

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(150n);
    expect(await decrypt64(liquidity[1])).to.equal(0n);

    expect(await adapter.nextFundingNonce(owner.address)).to.equal(1n);

    await expect(
      adapter.fundYieldLiquidity(input.handle, input.proof, owner.address, 0n),
    ).to.be.revertedWithCustomError(adapter, "FundingNonceMismatch");
  });

  it("does not reinterpret a direct confidential token send as funded yield", async function () {
    const { owner, token, adapter } = await fixture();

    await receipt(token.mintClear(owner.address, 1_000n));

    const input = await encrypt64(await token.getAddress(), owner, 1_000n);

    await receipt(
      token["confidentialTransfer(address,bytes32,bytes)"](
        await adapter.getAddress(),
        input.handle,
        input.proof,
      ),
    );

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(0n);
    expect(await decrypt64(liquidity[1])).to.equal(0n);
  });

  it("recognizes deterministic yield and reserves backing against double counting", async function () {
    const { owner, token, pool, adapter } = await fixture();

    await fundAdapter(owner, token, adapter, 150n);

    const day = 86_400n;

    await recognize(owner, pool, adapter, 1n, 1_000_000n * day);

    let draw = await adapter.drawYieldHandles(1n);

    expect(await decrypt64(draw[1])).to.equal(100n);
    expect(await decrypt64(draw[2])).to.equal(100n);
    expect(await decrypt64(draw[3])).to.equal(100n);

    expect(await settleRecognition(adapter, 1n)).to.equal(false);

    await recognize(owner, pool, adapter, 2n, 1_000_000n * day);

    draw = await adapter.drawYieldHandles(2n);

    expect(await decrypt64(draw[2])).to.equal(50n);

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(0n);
    expect(await decrypt64(liquidity[1])).to.equal(150n);
  });

  it("finalizes zero recognized yield without requiring an ERC-7984 transfer", async function () {
    const { owner, pool, adapter } = await fixture();

    await recognize(owner, pool, adapter, 7n, 1_000_000n * 86_400n);

    expect(await settleRecognition(adapter, 7n)).to.equal(true);

    const draw = await adapter.drawYieldHandles(7n);

    expect(draw[0]).to.equal(4n);
    expect(await decrypt64(draw[2])).to.equal(0n);
  });

  it("rejects unauthorized pool callers and missing pool-to-adapter ACL", async function () {
    const { owner, other, pool, adapter } = await fixture();

    const otherPool = (await (
      await hre.ethers.getContractFactory("Gate1CYieldPoolHarness", other)
    ).deploy()) as unknown as PoolHarness;

    await otherPool.waitForDeployment();

    await hre.fhevm.assertCoprocessorInitialized(otherPool, "Gate1CYieldPoolHarness");

    const unauthorizedInput = await encrypt128(
      await otherPool.getAddress(),
      other,
      86_400_000_000n,
    );

    await expect(
      otherPool.recognize(
        await adapter.getAddress(),
        1n,
        unauthorizedInput.handle,
        unauthorizedInput.proof,
      ),
    ).to.be.revertedWithCustomError(adapter, "OnlyPool");

    const missingAclInput = await encrypt128(await pool.getAddress(), owner, 86_400_000_000n);

    await expect(
      pool.recognizeWithoutGrant(
        await adapter.getAddress(),
        1n,
        missingAclInput.handle,
        missingAclInput.proof,
      ),
    ).to.be.reverted;
  });

  it("sweeps the token-returned actual amount into the reserve and finalizes a full transfer", async function () {
    const { owner, token, pool, reserve, adapter } = await fixture();

    await fundAdapter(owner, token, adapter, 100n);

    await recognize(owner, pool, adapter, 3n, 1_000_000n * 86_400n);

    expect(await settleRecognition(adapter, 3n)).to.equal(false);

    await receipt(adapter.sweepYield(3n));

    const reserveHandle = await reserve.receivedHandle(3n);

    expect(await decrypt64(reserveHandle)).to.equal(100n);

    let draw = await adapter.drawYieldHandles(3n);

    expect(await decrypt64(draw[3])).to.equal(0n);

    expect(await settleSweep(adapter, 3n)).to.equal(true);

    draw = await adapter.drawYieldHandles(3n);

    expect(draw[0]).to.equal(4n);
  });

  it("preserves unswept residual across partial ERC-7984 transfers", async function () {
    const { owner, token, partialToken, pool, reserve, adapter } = await fixture(200n);

    if (partialToken === undefined) {
      throw new Error("partial token fixture missing");
    }

    await fundAdapter(owner, token, adapter, 100n);

    await recognize(owner, pool, adapter, 4n, 1_000_000n * 86_400n);

    expect(await settleRecognition(adapter, 4n)).to.equal(false);

    await receipt(partialToken.setPartialCap(40n));

    await receipt(adapter.sweepYield(4n));

    let reserveHandle = await reserve.receivedHandle(4n);

    expect(await decrypt64(reserveHandle)).to.equal(40n);

    let draw = await adapter.drawYieldHandles(4n);

    expect(await decrypt64(draw[3])).to.equal(60n);

    expect(await settleSweep(adapter, 4n)).to.equal(false);

    await receipt(partialToken.setPartialCap(60n));

    await receipt(adapter.sweepYield(4n));

    reserveHandle = await reserve.receivedHandle(4n);

    expect(await decrypt64(reserveHandle)).to.equal(100n);

    draw = await adapter.drawYieldHandles(4n);

    expect(await decrypt64(draw[3])).to.equal(0n);

    expect(await settleSweep(adapter, 4n)).to.equal(true);
  });

  it("preserves the entire recognized residual when ERC-7984 reports zero actual transfer", async function () {
    const { owner, token, partialToken, pool, reserve, adapter } = await fixture(200n);

    if (partialToken === undefined) {
      throw new Error("partial token fixture missing");
    }

    await fundAdapter(owner, token, adapter, 100n);

    await recognize(owner, pool, adapter, 22n, 1_000_000n * 86_400n);

    expect(await settleRecognition(adapter, 22n)).to.equal(false);

    await receipt(partialToken.setPartialCap(0n));

    await receipt(adapter.sweepYield(22n));

    const reserveHandle = await reserve.receivedHandle(22n);

    expect(await decrypt64(reserveHandle)).to.equal(0n);

    let draw = await adapter.drawYieldHandles(22n);

    expect(draw[6]).to.equal(1n);
    expect(await decrypt64(draw[3])).to.equal(100n);

    let liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(0n);
    expect(await decrypt64(liquidity[1])).to.equal(100n);

    expect(await settleSweep(adapter, 22n)).to.equal(false);

    draw = await adapter.drawYieldHandles(22n);

    expect(draw[0]).to.equal(2n);
    expect(draw[6]).to.equal(1n);
    expect(await decrypt64(draw[3])).to.equal(100n);

    liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[1])).to.equal(100n);
  });

  it("rejects stale sweep proofs across attempt nonces and proof contexts", async function () {
    const { owner, token, partialToken, pool, adapter } = await fixture(200n);

    if (partialToken === undefined) {
      throw new Error("partial token fixture missing");
    }

    await fundAdapter(owner, token, adapter, 100n);

    await recognize(owner, pool, adapter, 23n, 1_000_000n * 86_400n);

    expect(await settleRecognition(adapter, 23n)).to.equal(false);

    await receipt(partialToken.setPartialCap(0n));

    await receipt(adapter.sweepYield(23n));

    const firstAttempt = await adapter.drawYieldHandles(23n);

    expect(firstAttempt[6]).to.equal(1n);
    expect(await decrypt64(firstAttempt[3])).to.equal(100n);

    const staleProof = await publicStage(firstAttempt[4], firstAttempt[5]);

    expect(staleProof.status).to.equal(false);

    await receipt(
      adapter.settleSweepCompletion(23n, firstAttempt[6], staleProof.status, staleProof.proof),
    );

    await receipt(partialToken.setPartialCap(100n));

    await receipt(adapter.sweepYield(23n));

    const secondAttempt = await adapter.drawYieldHandles(23n);

    expect(secondAttempt[6]).to.equal(2n);
    expect(await decrypt64(secondAttempt[3])).to.equal(0n);

    await expect(
      adapter.settleSweepCompletion(23n, firstAttempt[6], staleProof.status, staleProof.proof),
    ).to.be.revertedWithCustomError(adapter, "SweepAttemptMismatch");

    await expect(
      adapter.settleSweepCompletion(23n, secondAttempt[6], staleProof.status, staleProof.proof),
    ).to.be.reverted;

    const currentProof = await publicStage(secondAttempt[4], secondAttempt[5]);

    expect(currentProof.status).to.equal(true);

    await receipt(
      adapter.settleSweepCompletion(23n, secondAttempt[6], currentProof.status, currentProof.proof),
    );

    const finalized = await adapter.drawYieldHandles(23n);

    expect(finalized[0]).to.equal(4n);
  });

  it("blocks reserve callback reentrancy while preserving the successful outer sweep", async function () {
    const { owner, token, pool, reserve, adapter } = await fixture(
      undefined,
      "Gate1CYieldReentrantReserveHarness",
    );

    const reentrantReserve = reserve as ReentrantReserveHarness;

    await fundAdapter(owner, token, adapter, 100n);

    await recognize(owner, pool, adapter, 24n, 1_000_000n * 86_400n);

    expect(await settleRecognition(adapter, 24n)).to.equal(false);

    await receipt(reentrantReserve.configureReentry(await adapter.getAddress(), true));

    await receipt(adapter.sweepYield(24n));

    expect(await reentrantReserve.lastReentrySucceeded()).to.equal(false);

    const reserveHandle = await reentrantReserve.receivedHandle(24n);

    expect(await decrypt64(reserveHandle)).to.equal(100n);

    let draw = await adapter.drawYieldHandles(24n);

    expect(draw[6]).to.equal(1n);
    expect(await decrypt64(draw[3])).to.equal(0n);

    expect(await settleSweep(adapter, 24n)).to.equal(true);

    draw = await adapter.drawYieldHandles(24n);

    expect(draw[0]).to.equal(4n);
  });

  it("rejects proof replay across different draw recognition contexts", async function () {
    const { owner, token, pool, adapter } = await fixture();

    await fundAdapter(owner, token, adapter, 200n);

    await recognize(owner, pool, adapter, 10n, 1_000_000n * 86_400n);

    await recognize(owner, pool, adapter, 11n, 1_000_000n * 86_400n);

    const first = await adapter.drawYieldHandles(10n);

    const firstProof = await publicStage(first[4], first[5]);

    await expect(adapter.settleRecognition(11n, firstProof.status, firstProof.proof)).to.be
      .reverted;

    await receipt(adapter.settleRecognition(10n, firstProof.status, firstProof.proof));

    const second = await adapter.drawYieldHandles(11n);

    const secondProof = await publicStage(second[4], second[5]);

    await receipt(adapter.settleRecognition(11n, secondProof.status, secondProof.proof));
  });

  it("caps impossible out-of-envelope gross yield before euint64 narrowing", async function () {
    const { owner, token, pool, adapter } = await fixture();

    const maxGross = 384_000_000_000n;
    const denominator = 10_000n * 86_400n;

    await fundAdapter(owner, token, adapter, maxGross + 1n);

    await recognize(owner, pool, adapter, 20n, (maxGross + 12_345n) * denominator);

    const draw = await adapter.drawYieldHandles(20n);

    expect(await decrypt64(draw[1])).to.equal(maxGross);

    expect(await decrypt64(draw[2])).to.equal(maxGross);

    expect(await decrypt64(draw[3])).to.equal(maxGross);

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(1n);

    expect(await decrypt64(liquidity[1])).to.equal(maxGross);
  });

  it("rejects a reserve that does not acknowledge accounting and rolls back atomically", async function () {
    const { owner, token, pool, adapter } = await fixture(
      undefined,
      "Gate1CYieldWrongAckReserveHarness",
    );

    await fundAdapter(owner, token, adapter, 100n);

    await recognize(owner, pool, adapter, 21n, 1_000_000n * 86_400n);

    expect(await settleRecognition(adapter, 21n)).to.equal(false);

    await expect(adapter.sweepYield(21n)).to.be.revertedWithCustomError(
      adapter,
      "InvalidReserveAcknowledgement",
    );

    const draw = await adapter.drawYieldHandles(21n);

    // RECOGNIZED: the failed reserve acknowledgement
    // must roll the complete sweep transaction back.
    expect(draw[0]).to.equal(2n);

    expect(await decrypt64(draw[3])).to.equal(100n);

    const liquidity = await adapter.liquidityHandles();

    expect(await decrypt64(liquidity[0])).to.equal(0n);

    expect(await decrypt64(liquidity[1])).to.equal(100n);
  });
});
