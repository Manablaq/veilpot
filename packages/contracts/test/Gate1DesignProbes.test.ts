// GATE_1_DESIGN_PROBE_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY.
// These tests use only the local Hardhat mock FHEVM; no Sepolia deployment is performed.
import { ethers } from "ethers";
import { expect } from "chai";
import * as hre from "hardhat";

type InputBuilder = ReturnType<typeof hre.fhevm.createEncryptedInput>;
type DesignTransaction = Promise<ethers.ContractTransactionResponse>;
interface DesignProbe {
  waitForDeployment(): Promise<void>;
  getAddress(): Promise<string>;
  widen(handle: ethers.BytesLike, proof: ethers.BytesLike): DesignTransaction;
  pullDeposit(
    handle: ethers.BytesLike,
    proof: ethers.BytesLike,
    token: string,
    depositor: string,
  ): DesignTransaction;
  pullDepositWithoutTokenGrant(
    handle: ethers.BytesLike,
    proof: ethers.BytesLike,
    token: string,
    depositor: string,
  ): DesignTransaction;
  rawTwab(handle: ethers.BytesLike, proof: ethers.BytesLike, elapsed: number): DesignTransaction;
  yieldFromRawTwab(handle: ethers.BytesLike, proof: ethers.BytesLike): DesignTransaction;
  snapshotChunk(handles: readonly ethers.BytesLike[], proof: ethers.BytesLike): DesignTransaction;
  prefixChunk(
    handles: readonly ethers.BytesLike[],
    target: ethers.BytesLike,
    proof: ethers.BytesLike,
  ): DesignTransaction;
  selectEntitlement(
    winner: ethers.BytesLike,
    prize: ethers.BytesLike,
    proof: ethers.BytesLike,
  ): DesignTransaction;
  residual(
    remaining: ethers.BytesLike,
    actual: ethers.BytesLike,
    proof: ethers.BytesLike,
  ): DesignTransaction;
  handoff(
    entitlement: ethers.BytesLike,
    proof: ethers.BytesLike,
    reserve: string,
  ): DesignTransaction;
}

async function encryptedInput(
  address: string,
  signer: { address: string },
  configure: (input: InputBuilder) => void,
) {
  const input = hre.fhevm.createEncryptedInput(address, signer.address);
  configure(input);
  const encrypted = await input.encrypt();
  return {
    handles: encrypted.handles.map((handle) => ethers.hexlify(handle)),
    inputProof: ethers.hexlify(encrypted.inputProof),
  };
}

async function receiptOf(tx: Promise<ethers.ContractTransactionResponse>) {
  const receipt = await (await tx).wait();
  if (receipt === null) throw new Error("missing receipt");
  return receipt;
}

function handleAt(handles: readonly string[], index: number): string {
  const handle = handles[index];
  if (handle === undefined) throw new Error(`missing encrypted handle ${String(index)}`);
  return handle;
}

function report(label: string, receipt: ethers.TransactionReceipt): void {
  const hcu = hre.fhevm.computeTransactionHCU(receipt);
  console.log(
    JSON.stringify({
      probe: "GATE_1_DESIGN_PROBE_ONLY",
      operation: label,
      localGlobalHCU: hcu.globalHCU,
      localSequentialHCU: hcu.maxHCUDepth,
      localEvmGasRunSpecific: receipt.gasUsed.toString(),
    }),
  );
}

describe("GATE_1_DESIGN_PROBE_ONLY local FHE cost probes", function () {
  it("measures widening, raw TWAB, snapshot/prefix chunks, entitlement, residual, and handoff", async function () {
    const signer = (await hre.ethers.getSigners())[0]!;
    const probe = (await (
      await hre.ethers.getContractFactory("Gate1DesignProbeOnly")
    ).deploy()) as unknown as DesignProbe;
    await probe.waitForDeployment();
    const reserve = (await (
      await hre.ethers.getContractFactory("Gate1DesignReserveProbeOnly")
    ).deploy()) as unknown as { waitForDeployment(): Promise<void>; getAddress(): Promise<string> };
    await reserve.waitForDeployment();
    const probeAddress = await probe.getAddress();
    const reserveAddress = await reserve.getAddress();
    const pullToken = (await (
      await hre.ethers.getContractFactory("Gate1DesignPullTokenProbeOnly")
    ).deploy()) as unknown as { waitForDeployment(): Promise<void>; getAddress(): Promise<string> };
    await pullToken.waitForDeployment();
    const pullTokenAddress = await pullToken.getAddress();

    const one64 = await encryptedInput(probeAddress, signer, (input) => input.add64(100n));
    report(
      "euint64-to-euint128-widening",
      await receiptOf(probe.widen(handleAt(one64.handles, 0), one64.inputProof)),
    );

    const pullInput = await encryptedInput(probeAddress, signer, (input) =>
      input.add64(2_000_000n),
    );
    report(
      "pull-deposit-actual-received-threshold",
      await receiptOf(
        probe.pullDeposit(
          handleAt(pullInput.handles, 0),
          pullInput.inputProof,
          pullTokenAddress,
          signer.address,
        ),
      ),
    );

    const twab = await encryptedInput(probeAddress, signer, (input) => input.add128(1_000n));
    report(
      "raw-twab-multiply-add-seal",
      await receiptOf(probe.rawTwab(handleAt(twab.handles, 0), twab.inputProof, 2_592_000)),
    );

    const yieldInput = await encryptedInput(probeAddress, signer, (input) =>
      input.add128(331_776_000_000_000_000_000n),
    );
    report(
      "raw-twab-yield-divide-and-euint64-cast",
      await receiptOf(
        probe.yieldFromRawTwab(handleAt(yieldInput.handles, 0), yieldInput.inputProof),
      ),
    );

    const chunk = await encryptedInput(probeAddress, signer, (input) => {
      for (let i = 0; i < 8; i += 1) input.add128(BigInt(i + 1));
    });
    report(
      "snapshot-chunk-8",
      await receiptOf(probe.snapshotChunk(chunk.handles, chunk.inputProof)),
    );

    const prefixInput = await encryptedInput(probeAddress, signer, (input) => {
      for (let i = 0; i < 8; i += 1) input.add128(BigInt(i + 1));
      input.add128(17n);
    });
    report(
      "winner-prefix-chunk-8",
      await receiptOf(
        probe.prefixChunk(
          prefixInput.handles.slice(0, 8),
          handleAt(prefixInput.handles, 8),
          prefixInput.inputProof,
        ),
      ),
    );

    const winnerAndPrize = await encryptedInput(probeAddress, signer, (input) => {
      input.addBool(true);
      input.add64(500n);
    });
    report(
      "ebool-euint64-select-entitlement",
      await receiptOf(
        probe.selectEntitlement(
          handleAt(winnerAndPrize.handles, 0),
          handleAt(winnerAndPrize.handles, 1),
          winnerAndPrize.inputProof,
        ),
      ),
    );

    const residualInput = await encryptedInput(probeAddress, signer, (input) => {
      input.add64(500n);
      input.add64(125n);
    });
    report(
      "euint64-residual-subtraction-equality",
      await receiptOf(
        probe.residual(
          handleAt(residualInput.handles, 0),
          handleAt(residualInput.handles, 1),
          residualInput.inputProof,
        ),
      ),
    );

    const entitlement = await encryptedInput(probeAddress, signer, (input) => input.add64(500n));
    report(
      "pool-reserve-entitlement-transient-acl-handoff",
      await receiptOf(
        probe.handoff(handleAt(entitlement.handles, 0), entitlement.inputProof, reserveAddress),
      ),
    );
  });

  it("proves the token-side ACL requirement with a negative control", async function () {
    const signer = (await hre.ethers.getSigners())[0]!;
    const probe = (await (
      await hre.ethers.getContractFactory("Gate1DesignProbeOnly")
    ).deploy()) as unknown as DesignProbe;
    await probe.waitForDeployment();
    const pullToken = (await (
      await hre.ethers.getContractFactory("Gate1DesignPullTokenProbeOnly")
    ).deploy()) as unknown as { waitForDeployment(): Promise<void>; getAddress(): Promise<string> };
    await pullToken.waitForDeployment();
    const input = await encryptedInput(await probe.getAddress(), signer, (builder) =>
      builder.add64(2_000_000n),
    );
    await expect(
      probe.pullDepositWithoutTokenGrant(
        handleAt(input.handles, 0),
        input.inputProof,
        await pullToken.getAddress(),
        signer.address,
      ),
    ).to.be.revertedWith("missing transient token ACL");
  });
});
