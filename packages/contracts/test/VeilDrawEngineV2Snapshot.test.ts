import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Tx = Promise<ethers.ContractTransactionResponse>;

interface Host extends ethers.BaseContract {
  engine(): Promise<string>;
  setWeight(slotIndex: bigint, encryptedWeight: Handle, proof: string): Tx;
  beginSnapshotImport(snapshotId: bigint, participantCount: bigint): Tx;
  syncSnapshotChunk(snapshotId: bigint, start: bigint, participantCount: bigint): Tx;
  syncSnapshotChunkWithoutGrant(snapshotId: bigint, start: bigint, participantCount: bigint): Tx;
  sealSnapshotImport(snapshotId: bigint): Tx;
}

interface Engine extends ethers.BaseContract {
  beginSnapshotImport(snapshotId: bigint, participantCount: bigint): Tx;
  snapshotMetadata(snapshotId: bigint): Promise<readonly [bigint, bigint, boolean, boolean]>;
  snapshotWeightHandle(snapshotId: bigint, slotIndex: bigint): Promise<Handle>;
  snapshotShardTotalHandle(snapshotId: bigint, shardIndex: bigint): Promise<Handle>;
  snapshotTotalHandle(snapshotId: bigint): Promise<Handle>;
}

async function waitFor(tx: Tx): Promise<ethers.TransactionReceipt> {
  const receipt = await (await tx).wait();

  if (receipt === null) {
    throw new Error("missing receipt");
  }

  return receipt;
}

async function decrypt128(handle: Handle): Promise<bigint> {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);
}

async function encrypted64(
  address: string,
  signer: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number],
  value: bigint,
): Promise<{ handle: Handle; proof: string }> {
  const input = hre.fhevm.createEncryptedInput(address, signer.address);

  input.add64(value);

  const encrypted = await input.encrypt();

  return {
    handle: ethers.hexlify(encrypted.handles[0]!) as Handle,
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

async function fixture() {
  const signers = await hre.ethers.getSigners();

  const alice = signers[0]!;

  const host = (await (
    await hre.ethers.getContractFactory("TestVeilDrawEngineV2Host")
  ).deploy()) as unknown as Host;

  await host.waitForDeployment();

  const engineAddress = await host.engine();

  const engine = (await hre.ethers.getContractAt(
    "VeilDrawEngineV2",
    engineAddress,
  )) as unknown as Engine;

  await hre.fhevm.assertCoprocessorInitialized(host, "TestVeilDrawEngineV2Host");

  await hre.fhevm.assertCoprocessorInitialized(engine, "VeilDrawEngineV2");

  return {
    alice,
    host,
    engine,
  };
}

async function setWeight(
  host: Host,
  signer: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number],
  slotIndex: number,
  value: bigint,
): Promise<void> {
  const input = await encrypted64(await host.getAddress(), signer, value);

  const userHost = host.connect(signer) as unknown as Host;

  await waitFor(userHost.setWeight(BigInt(slotIndex), input.handle, input.proof));
}

describe("VeilDrawEngineV2 encrypted snapshot/shard layer", function () {
  it("imports a 9-seat snapshot as exact 8+1 private shards and conserves the encrypted total", async function () {
    const { alice, host, engine } = await fixture();

    for (let index = 0; index < 9; index += 1) {
      await setWeight(host, alice, index, BigInt(index + 1));
    }

    await waitFor(host.beginSnapshotImport(1n, 9n));

    const firstReceipt = await waitFor(host.syncSnapshotChunk(1n, 0n, 9n));

    const firstHcu = hre.fhevm.computeTransactionHCU(firstReceipt);

    process.stdout.write(
      `${JSON.stringify({
        scope: "VEILDRAW_V2_SNAPSHOT_LOCAL_ONLY",
        operation: "importPrivateShard8",
        globalHCU: firstHcu.globalHCU,
        sequentialHCU: firstHcu.maxHCUDepth,
        gas: firstReceipt.gasUsed.toString(),
      })}\n`,
    );

    await waitFor(host.syncSnapshotChunk(1n, 8n, 9n));

    await waitFor(host.sealSnapshotImport(1n));

    const metadata = await engine.snapshotMetadata(1n);

    expect(metadata[0]).to.equal(9n);
    expect(metadata[1]).to.equal(9n);
    expect(metadata[2]).to.equal(true);
    expect(metadata[3]).to.equal(true);

    expect(await decrypt128(await engine.snapshotShardTotalHandle(1n, 0n))).to.equal(36n);

    expect(await decrypt128(await engine.snapshotShardTotalHandle(1n, 1n))).to.equal(9n);

    expect(await decrypt128(await engine.snapshotTotalHandle(1n))).to.equal(45n);

    expect(await decrypt128(await engine.snapshotWeightHandle(1n, 8n))).to.equal(9n);
  });

  it("enforces sequential immutable shard imports and rejects replay", async function () {
    const { alice, host } = await fixture();

    for (let index = 0; index < 9; index += 1) {
      await setWeight(host, alice, index, 1n);
    }

    await waitFor(host.beginSnapshotImport(2n, 9n));

    await expect(host.syncSnapshotChunk(2n, 8n, 9n)).to.be.reverted;

    await waitFor(host.syncSnapshotChunk(2n, 0n, 9n));

    await expect(host.syncSnapshotChunk(2n, 0n, 9n)).to.be.reverted;

    await waitFor(host.syncSnapshotChunk(2n, 8n, 9n));

    await waitFor(host.sealSnapshotImport(2n));

    await expect(host.syncSnapshotChunk(2n, 8n, 9n)).to.be.reverted;

    await expect(host.sealSnapshotImport(2n)).to.be.reverted;
  });

  it("fails closed when the Pool omits transient ciphertext grants", async function () {
    const { alice, host } = await fixture();

    await setWeight(host, alice, 0, 7n);

    await waitFor(host.beginSnapshotImport(3n, 1n));

    await expect(host.syncSnapshotChunkWithoutGrant(3n, 0n, 1n)).to.be.reverted;
  });

  it("supports a zero-seat zero-total finalized snapshot without importing randomness or fake weights", async function () {
    const { host, engine } = await fixture();

    await waitFor(host.beginSnapshotImport(4n, 0n));

    await waitFor(host.sealSnapshotImport(4n));

    const metadata = await engine.snapshotMetadata(4n);

    expect(metadata).to.deep.equal([0n, 0n, true, true]);

    expect(await decrypt128(await engine.snapshotTotalHandle(4n))).to.equal(0n);
  });

  it("locks the 128-seat envelope and rejects direct non-Pool control", async function () {
    const { alice, host, engine } = await fixture();

    await expect(host.beginSnapshotImport(5n, 129n)).to.be.reverted;

    await expect(
      engine.connect(alice).getFunction("beginSnapshotImport").staticCall(5n, 1n),
    ).to.be.revertedWithCustomError(engine, "OnlyPool");
  });

  it("stays independently deployable below Ethereum runtime and initcode limits", async function () {
    const artifact = await hre.artifacts.readArtifact("VeilDrawEngineV2");

    const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;

    const creationBytes = (artifact.bytecode.length - 2) / 2;

    process.stdout.write(
      `${JSON.stringify({
        scope: "VEILDRAW_V2_ENGINE_BUILD_GUARD",
        creationBytes,
        runtimeBytes,
        eip170RuntimeLimitBytes: 24_576,
        eip3860InitcodeLimitBytes: 49_152,
      })}\n`,
    );

    expect(runtimeBytes).to.be.greaterThan(0);

    expect(creationBytes).to.be.greaterThan(0);

    expect(runtimeBytes, "VeilDrawEngineV2 exceeded EIP-170").to.be.at.most(24_576);

    expect(creationBytes, "VeilDrawEngineV2 exceeded EIP-3860").to.be.at.most(49_152);
  });
});
