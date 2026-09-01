import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect } from "chai";
import { ethers } from "ethers";

import {
  BROADCAST_APPROVAL_VALUE,
  assertExactAddress,
  assertPublicEvidenceOnly,
  assertStableNonceSnapshot,
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

  it("derives the exact consecutive CREATE addresses N, N+1, and N+2", function () {
    const deployer = "0x1111111111111111111111111111111111111111";

    const nonce = 42;

    const plan = planProductionDeployment(deployer, nonce);

    expect(plan.pool).to.equal(
      ethers.getCreateAddress({
        from: deployer,
        nonce,
      }),
    );

    expect(plan.adapter).to.equal(
      ethers.getCreateAddress({
        from: deployer,
        nonce: nonce + 1,
      }),
    );

    expect(plan.reserve).to.equal(
      ethers.getCreateAddress({
        from: deployer,
        nonce: nonce + 2,
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

    const adapter = runner.indexOf("adapterFactory.deploy(");

    const reserve = runner.indexOf("reserveFactory.deploy(");

    expect(pool).to.be.greaterThan(-1);
    expect(adapter).to.be.greaterThan(pool);
    expect(reserve).to.be.greaterThan(adapter);

    expect(runner).to.include("../../evidence/production-sepolia/deployment.json");

    expect(runner).to.include("await assertBindings(");

    expect(runner).to.include(
      "deployed runtime bytecode differs from the locally compiled production artifacts",
    );

    expect(runner).to.include("SIMULATED_YIELD_FOR_SEPOLIA_DEMO");
  });
});
