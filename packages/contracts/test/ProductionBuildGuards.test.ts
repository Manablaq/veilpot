import { expect } from "chai";
import hre from "hardhat";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const EIP170_RUNTIME_LIMIT_BYTES = 24_576;
const REVIEWED_RUNTIME_BUDGET_BYTES = 23_500;
const EIP3860_INITCODE_LIMIT_BYTES = 49_152;

function byteLength(bytecode: string): number {
  if (!bytecode.startsWith("0x")) {
    throw new Error("Expected 0x-prefixed bytecode");
  }

  const hex = bytecode.slice(2);

  if (hex.length % 2 !== 0) {
    throw new Error("Bytecode hex length must be even");
  }

  return hex.length / 2;
}

describe("Veilpot production build guards", function () {
  it("pins the reviewed production compiler pipeline and forbids a size bypass", async function () {
    const hardhatConfig = await readFile(resolve(process.cwd(), "hardhat.config.ts"), "utf8");

    expect(hardhatConfig).to.include('version: "0.8.27"');
    expect(hardhatConfig).to.include('evmVersion: "cancun"');
    expect(hardhatConfig).to.include('metadata: { bytecodeHash: "none" }');
    expect(hardhatConfig).to.include("optimizer: { enabled: true, runs: 800 }");
    expect(hardhatConfig).to.match(/^[ \t]*viaIR[ \t]*:[ \t]*true[ \t]*,?[ \t]*$/m);
    expect(hardhatConfig).not.to.match(/^[ \t]*allowUnlimitedContractSize[ \t]*:/m);
  });

  it("keeps VeilpotPool below the reviewed runtime budget and protocol deployment limits", async function () {
    const artifact = await hre.artifacts.readArtifact("VeilpotPool");

    const creationBytes = byteLength(artifact.bytecode);
    const runtimeBytes = byteLength(artifact.deployedBytecode);

    process.stdout.write(
      `${JSON.stringify({
        scope: "GATE_1B.3_PRODUCTION_BUILD_GUARD",
        creationBytes,
        runtimeBytes,
        reviewedRuntimeBudgetBytes: REVIEWED_RUNTIME_BUDGET_BYTES,
        eip170RuntimeLimitBytes: EIP170_RUNTIME_LIMIT_BYTES,
        eip3860InitcodeLimitBytes: EIP3860_INITCODE_LIMIT_BYTES,
        reviewedRuntimeHeadroomBytes: REVIEWED_RUNTIME_BUDGET_BYTES - runtimeBytes,
        protocolRuntimeHeadroomBytes: EIP170_RUNTIME_LIMIT_BYTES - runtimeBytes,
      })}\n`,
    );

    expect(creationBytes).to.be.greaterThan(0);
    expect(runtimeBytes).to.be.greaterThan(0);

    expect(
      runtimeBytes,
      "VeilpotPool exceeded the reviewed 23,500-byte production budget",
    ).to.be.at.most(REVIEWED_RUNTIME_BUDGET_BYTES);

    expect(runtimeBytes, "VeilpotPool exceeded the EIP-170 runtime limit").to.be.at.most(
      EIP170_RUNTIME_LIMIT_BYTES,
    );

    expect(creationBytes, "VeilpotPool exceeded the EIP-3860 initcode limit").to.be.at.most(
      EIP3860_INITCODE_LIMIT_BYTES,
    );
  });

  it("records the complete compiler pipeline in Sepolia evidence", async function () {
    const runner = await readFile(resolve(process.cwd(), "scripts/run-sepolia.ts"), "utf8");

    expect(runner).to.include('solidityCompilerVersion: "0.8.27"');
    expect(runner).to.include("optimizer: { enabled: true, runs: 800 }");
    expect(runner).to.include("viaIR: true");
    expect(runner).to.include('metadata: { bytecodeHash: "none" }');
    expect(runner).to.include('evmVersion: "cancun"');
  });

  it("prevents ordinary probe runs from overwriting frozen Gate 0 HCU evidence", async function () {
    const probe = await readFile(resolve(process.cwd(), "test/VeilDrawProbe.test.ts"), "utf8");

    expect(probe).to.include("process.env.VEILPOT_GATE0_HCU_OUTPUT");
    expect(probe).to.include("if (output === undefined || output.trim().length === 0) return;");
    expect(probe).to.include("Refusing to overwrite frozen Gate 0 HCU evidence");
    expect(probe).to.include("await writeFile(outputPath");
    expect(probe).not.to.include('resolve(evidenceDirectory, "hcu.json")');
  });
});
