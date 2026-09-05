import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers } from "ethers";
import * as hre from "hardhat";

type Handle = `0x${string}`;
type Tx = Promise<ethers.ContractTransactionResponse>;

interface AclHost extends ethers.BaseContract {
  engine(): Promise<string>;

  importAndForward(encryptedValue: Handle, inputProof: string): Tx;

  importWithoutGrant(encryptedValue: Handle, inputProof: string): Tx;

  bumpEngineTotal(): Tx;

  pullEngineTotal(): Tx;

  receivedTotalHandle(): Promise<Handle>;
}

interface AclEngine extends ethers.BaseContract {
  importTotal(transientTotal: Handle): Tx;

  storedTotalHandle(): Promise<Handle>;
}

describe("VeilDraw V2 cross-contract FHE ACL boundary", function () {
  async function fixture() {
    const signers = await hre.ethers.getSigners();
    const alice = signers[0];

    if (alice === undefined) {
      throw new Error("missing local test signer");
    }

    const host = (await (
      await hre.ethers.getContractFactory("TestVeilDrawV2AclHost")
    ).deploy()) as unknown as AclHost;

    await host.waitForDeployment();

    const engineAddress = await host.engine();

    const engine = (await hre.ethers.getContractAt(
      "TestVeilDrawV2AclEngine",
      engineAddress,
    )) as unknown as AclEngine;

    await hre.fhevm.assertCoprocessorInitialized(host, "TestVeilDrawV2AclHost");

    await hre.fhevm.assertCoprocessorInitialized(engine, "TestVeilDrawV2AclEngine");

    return {
      alice,
      host,
      engine,
    };
  }

  async function encrypted64(
    contractAddress: string,
    signerAddress: string,
    value: bigint,
  ): Promise<{
    handle: Handle;
    proof: string;
  }> {
    const input = hre.fhevm.createEncryptedInput(contractAddress, signerAddress);

    input.add64(value);

    const encrypted = await input.encrypt();

    return {
      handle: hre.ethers.hexlify(encrypted.handles[0]!) as Handle,

      proof: hre.ethers.hexlify(encrypted.inputProof),
    };
  }

  async function decrypt128(handle: Handle): Promise<bigint> {
    return hre.fhevm.debugger.decryptEuint(FhevmType.euint128, handle);
  }

  it("uses transient Pool→Engine ACL, persists only an engine-owned derivative, and works in a later transaction", async function () {
    const { alice, host, engine } = await fixture();

    const hostAddress = await host.getAddress();

    const input = await encrypted64(hostAddress, alice.address, 41n);

    await (await host.importAndForward(input.handle, input.proof)).wait();

    const imported = await engine.storedTotalHandle();

    expect(await decrypt128(imported)).to.equal(41n);

    // Deliberately a separate transaction.
    await (await host.bumpEngineTotal()).wait();

    const bumped = await engine.storedTotalHandle();

    expect(await decrypt128(bumped)).to.equal(42n);
  });

  it("returns an engine-derived ciphertext through transient ACL and persists only a fresh Pool-owned derivative", async function () {
    const { alice, host } = await fixture();

    const hostAddress = await host.getAddress();

    const input = await encrypted64(hostAddress, alice.address, 77n);

    await (await host.importAndForward(input.handle, input.proof)).wait();

    await (await host.pullEngineTotal()).wait();

    const returned = await host.receivedTotalHandle();

    expect(await decrypt128(returned)).to.equal(77n);
  });

  it("fails closed when the Pool omits the explicit transient Engine grant", async function () {
    const { alice, host } = await fixture();

    const hostAddress = await host.getAddress();

    const input = await encrypted64(hostAddress, alice.address, 5n);

    await expect(host.importWithoutGrant(input.handle, input.proof)).to.be.reverted;
  });

  it("rejects direct callers so the Engine cannot be driven around the Pool boundary", async function () {
    const { alice, host, engine } = await fixture();

    const hostAddress = await host.getAddress();

    const input = await encrypted64(hostAddress, alice.address, 12n);

    await (await host.importAndForward(input.handle, input.proof)).wait();

    const stored = await engine.storedTotalHandle();

    const aliceEngine = engine.connect(alice) as unknown as AclEngine;

    await expect(aliceEngine.importTotal(stored)).to.be.revertedWithCustomError(engine, "OnlyPool");
  });
});
