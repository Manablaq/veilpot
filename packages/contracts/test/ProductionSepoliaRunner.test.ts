import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect } from "chai";
import { ethers } from "ethers";

import {
  BROADCAST_APPROVAL_VALUE,
  assertExactAddress,
  assertExactDeploymentData,
  assertPublicEvidenceOnly,
  assertStableNonceSnapshot,
  compareRuntimeIdentity,
  normalizeRuntimeBytecode,
  planProductionDeployment,
  requireExplicitBroadcastApproval,
  sha256Bytecode,
} from "../scripts/production-sepolia-support";

describe("Production Sepolia runner offline guards", function () {
  it("fails closed unless the exact explicit broadcast approval value is present", function () {
    expect(() => {
      requireExplicitBroadcastApproval({});
    }).to.throw("production Sepolia broadcast is disabled");

    expect(() => {
      requireExplicitBroadcastApproval({
        VEILPOT_PRODUCTION_SEPOLIA_BROADCAST: "yes",
      });
    }).to.throw("production Sepolia broadcast is disabled");

    expect(() => {
      requireExplicitBroadcastApproval({
        VEILPOT_PRODUCTION_SEPOLIA_BROADCAST: BROADCAST_APPROVAL_VALUE,
      });
    }).not.to.throw();
  });

  it("rejects pending or malformed deployer nonce snapshots", function () {
    expect(assertStableNonceSnapshot(17, 17)).to.equal(17);

    expect(() => assertStableNonceSnapshot(17, 18)).to.throw("deployer has pending transactions");

    expect(() => assertStableNonceSnapshot(-1, -1)).to.throw(
      "deployment nonces must be non-negative safe integers",
    );
  });

  it("derives the exact consecutive CREATE addresses N through N+3", function () {
    const deployer = "0x1111111111111111111111111111111111111111";

    const nonce = 42;

    const plan = planProductionDeployment(deployer, nonce);

    expect(plan.pool).to.equal(
      ethers.getCreateAddress({
        from: deployer,
        nonce,
      }),
    );

    expect(plan.vault).to.equal(
      ethers.getCreateAddress({
        from: deployer,
        nonce: nonce + 1,
      }),
    );

    expect(plan.adapter).to.equal(
      ethers.getCreateAddress({
        from: deployer,
        nonce: nonce + 2,
      }),
    );

    expect(plan.reserve).to.equal(
      ethers.getCreateAddress({
        from: deployer,
        nonce: nonce + 3,
      }),
    );
  });

  it("fails closed when an actual deployed address differs from its deterministic prediction", function () {
    const expected = "0x1111111111111111111111111111111111111111";

    const other = "0x2222222222222222222222222222222222222222";

    expect(() => {
      assertExactAddress(expected, expected, "contract");
    }).not.to.throw();

    expect(() => {
      assertExactAddress(other, expected, "contract");
    }).to.throw("contract address differs from deterministic deployment plan");
  });

  it("compares exact deployment input bytes for private immutable constructor binding", function () {
    const expected = "0x6000aabb";
    const other = "0x6000aabc";

    expect(() => {
      assertExactDeploymentData(expected, expected, "VeilpotPool");
    }).not.to.throw();

    expect(() => {
      assertExactDeploymentData(other, expected, "VeilpotPool");
    }).to.throw("VeilpotPool deployment data differs from exact constructor plan");
  });

  it("hashes only valid bytecode and rejects malformed hex", function () {
    const first = sha256Bytecode("0x60006000");

    const second = sha256Bytecode("0x60006000");

    expect(first).to.equal(second);
    expect(first).to.have.length(64);

    expect(() => sha256Bytecode("6000")).to.throw(
      "bytecode must be 0x-prefixed even-length hexadecimal",
    );

    expect(() => sha256Bytecode("0x0")).to.throw(
      "bytecode must be 0x-prefixed even-length hexadecimal",
    );
  });

  it("normalizes only compiler-declared immutable runtime ranges", function () {
    const artifact = "0x6000000000006100";

    const deployed = "0x60aabbccdd006100";

    const ranges = [
      {
        start: 1,
        length: 4,
      },
    ];

    expect(normalizeRuntimeBytecode(artifact, ranges)).to.equal("0x6000000000006100");

    expect(normalizeRuntimeBytecode(deployed, ranges)).to.equal("0x6000000000006100");

    expect(() => {
      normalizeRuntimeBytecode(deployed, [
        {
          start: 100,
          length: 1,
        },
      ]);
    }).to.throw("immutable reference range is outside runtime bytecode");
  });

  it("accepts immutable-only runtime differences and rejects all other byte differences", function () {
    const artifact = "0x6000000000006100";

    const deployed = "0x60aabbccdd006100";

    const identity = compareRuntimeIdentity(
      artifact,
      deployed,
      [
        {
          start: 1,
          length: 4,
        },
      ],
      "test",
    );

    expect(identity.localNormalizedSha256).to.equal(identity.deployedNormalizedSha256);

    expect(identity.localRawSha256).not.to.equal(identity.deployedRawSha256);

    expect(() => {
      compareRuntimeIdentity(
        artifact,
        "0x60aabbccdd006101",
        [
          {
            start: 1,
            length: 4,
          },
        ],
        "test",
      );
    }).to.throw("test deployed runtime differs outside compiler-declared immutable references");
  });

  it("permits public deployment evidence but rejects secret-bearing keys recursively", function () {
    expect(() => {
      assertPublicEvidenceOnly({
        chainId: "11155111",
        deployerAddress: "0x1111111111111111111111111111111111111111",
        runtimeHashes: {
          pool: "abc",
        },
      });
    }).not.to.throw();

    expect(() => {
      assertPublicEvidenceOnly({
        nested: {
          privateKey: "forbidden",
        },
      });
    }).to.throw("deployment evidence contains forbidden secret-bearing key");

    expect(() => {
      assertPublicEvidenceOnly({
        rpcUrl: "forbidden",
      });
    }).to.throw("deployment evidence contains forbidden secret-bearing key");
  });

  it("places explicit approval before the first network read and never reads a raw deployer key", async function () {
    const runner = await readFile(
      resolve(process.cwd(), "scripts/run-production-sepolia.ts"),
      "utf8",
    );

    const approval = runner.indexOf("requireExplicitBroadcastApproval(");

    const network = runner.indexOf("provider.getNetwork()");

    expect(approval).to.be.greaterThan(-1);
    expect(network).to.be.greaterThan(-1);
    expect(approval).to.be.lessThan(network);

    expect(runner).not.to.include('vars.get("DEPLOYER_PRIVATE_KEY")');

    expect(runner).not.to.include("../../evidence/gate0/");

    expect(runner.match(/getTransactionCount\(/g) ?? []).to.have.length(2);
  });

  it("locks production deployment order, bindings, runtime checks, and a separate public evidence namespace", async function () {
    const runner = await readFile(
      resolve(process.cwd(), "scripts/run-production-sepolia.ts"),
      "utf8",
    );

    const pool = runner.indexOf("poolFactory.deploy(");

    const vault = runner.indexOf("vaultFactory.deploy(");

    const adapter = runner.indexOf("adapterFactory.deploy(");

    const reserve = runner.indexOf("reserveFactory.deploy(");

    expect(pool).to.be.greaterThan(-1);
    expect(vault).to.be.greaterThan(pool);
    expect(adapter).to.be.greaterThan(vault);
    expect(reserve).to.be.greaterThan(adapter);

    expect(runner).to.include("poolFactory.deploy(CUSDTMOCK_ADDRESS, plan.reserve, plan.vault)");

    expect(runner).to.include("vaultFactory.deploy(CUSDTMOCK_ADDRESS, plan.pool)");

    expect(runner).to.include("assertExactDeploymentData(");

    expect(runner).to.include('verificationMethod: "EXACT_POOL_DEPLOYMENT_TRANSACTION_INPUT"');

    expect(runner).to.include('await hre.artifacts.readArtifact("VeilpotAutopilotVault")');

    expect(runner).to.include("await provider.getCode(plan.vault)");

    expect(runner).to.include("../../evidence/production-sepolia/deployment.json");

    expect(runner).to.include("await assertBindings(");

    expect(runner).to.include("compareRuntimeIdentity(");

    expect(runner).to.include("immutableRangesForArtifact(");

    expect(runner).to.include("SIMULATED_YIELD_FOR_SEPOLIA_DEMO");
  });
  it("locks evidence recovery to the already-mined nonce 487/488/489 deployment transactions and forbids broadcast", async function () {
    const recovery = await readFile(
      resolve(process.cwd(), "scripts/recover-production-sepolia-evidence.ts"),
      "utf8",
    );

    expect(recovery).to.include("const STARTING_NONCE = 487");

    expect(recovery).to.include(
      "0x14ba134d6b220e9f572ed78ae1e6063c938045e4bef542fdc5122eefe1b492c1",
    );

    expect(recovery).to.include(
      "0x51f872938b4929e1c918d3c8388f5408a4337cd750bbdd31313cc9899c73bf2d",
    );

    expect(recovery).to.include(
      "0x6f00e4c30a4c6725758eea86ad6e6d5e9bb137c043176b6c1afca5746ba29a27",
    );

    expect(recovery).to.include("broadcast approval must be absent during evidence recovery");

    expect(recovery).not.to.include(".deploy(");

    expect(recovery).not.to.include("sendTransaction(");

    expect(recovery).to.include("compareRuntimeIdentity(");

    expect(recovery).to.include("RAW_RUNTIME_HASH_IMMUTABLES_NOT_NORMALIZED");
  });
});
