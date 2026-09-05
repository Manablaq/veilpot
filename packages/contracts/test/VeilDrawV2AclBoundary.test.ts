import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import * as hre from "hardhat";

type Handle = `0x${string}`;

describe("VeilDraw V2 cross-contract FHE ACL boundary", function () {
  async function fixture() {
    const [alice] = await hre.ethers.getSigners();

    const host = await (await hre.ethers.getContractFactory("TestVeilDrawV2AclHost")).deploy();

    await host.waitForDeployment();

    const engineAddress = await host.engine();

    const engine = await hre.ethers.getContractAt("TestVeilDrawV2AclEngine", engineAddress);

    await hre.fhevm.assertCoprocessorInitialized(host, "TestVeilDrawV2AclHost");

    await hre.fhevm.assertCoprocessorInitialized(engine, "TestVeilDrawV2AclEngine");

    return { alice, host, engine };
  }

  async function encrypted64(
    contractAddress: string,
    signerAddress: string,
    value: bigint,
  ): Promise<{ handle: Handle; proof: string }> {
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

    const imported = (await engine.storedTotalHandle()) as Handle;

    expect(await decrypt128(imported)).to.equal(41n);

    // This is deliberately a separate transaction.
    await (await host.bumpEngineTotal()).wait();

    const bumped = (await engine.storedTotalHandle()) as Handle;

    expect(await decrypt128(bumped)).to.equal(42n);
  });

  it("returns an engine-derived ciphertext through transient ACL and persists only a fresh Pool-owned derivative", async function () {
    const { alice, host } = await fixture();

    const hostAddress = await host.getAddress();

    const input = await encrypted64(hostAddress, alice.address, 77n);

    await (await host.importAndForward(input.handle, input.proof)).wait();

    await (await host.pullEngineTotal()).wait();

    const returned = (await host.receivedTotalHandle()) as Handle;

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

    const stored = (await engine.storedTotalHandle()) as Handle;

    await expect(engine.connect(alice).importTotal(stored)).to.be.revertedWithCustomError(
      engine,
      "OnlyPool",
    );
  });
});
