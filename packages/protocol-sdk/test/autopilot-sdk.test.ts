import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect } from "chai";

import {
  AUTOPILOT_PLAN_STATE,
  MAX_AUTOPILOT_EXECUTIONS,
  SUPPORTED_REGISTRATION_VERSION,
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_SEPOLIA_DEPLOYMENT,
  autopilotPlanStateName,
  buildAdvanceMissedAutopilotWindowCall,
  buildAutopilotFundingCall,
  buildAutopilotPlanAmountHandlesCall,
  buildAutopilotPlanIdCall,
  buildAutopilotPlanMetadataCall,
  buildAutopilotPlanValueDecryptionRequest,
  buildAutopilotSchedule,
  buildAutopilotScheduleLeafCall,
  buildCreateAutopilotPlanCall,
  buildExecuteAutopilotPlanCall,
  buildPauseAutopilotPlanCall,
  buildResumeAutopilotPlanCall,
  buildRevokeAutopilotPlanCall,
  buildSkipAutopilotWindowCall,
  buildWithdrawAutopilotPlanFundsCall,
  encryptAutopilotFundingAmount,
  encryptAutopilotPlanAmounts,
  type Address,
  type EncryptedAutopilotPlanAmounts,
  type EncryptedEuint64Input,
  type VeilpotZamaEncryptionClient,
} from "../src/index.js";

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(label + " must be an object");
  }
  return value as Record<string, unknown>;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("Veilpot Autopilot protocol SDK", function () {
  const owner = "0x1f87Ae197af539253978d435aD45cCf28Fb95024" as Address;
  const livePlanId = "0x2c9d9797c99c7b48856127e0cfc47ac3dea70c2091aa49d1f0fd7c8acac4c534" as const;
  const liveRoot = "0xd3dfac053b783e1dfbe0e0df5f070e25b2b9b670ca4c9cc8a226ea95333b093a" as const;

  it("pins the exact Autopilot v3 deployment and runtime evidence", async function () {
    const deployment = asRecord(
      await readJson(
        resolve(process.cwd(), "../../evidence/production-sepolia/autopilot-v3/deployment.json"),
      ),
      "deployment evidence",
    );
    const runtime = asRecord(
      await readJson(
        resolve(process.cwd(), "../../evidence/production-sepolia/autopilot-v3/runtime-smoke.json"),
      ),
      "runtime evidence",
    );
    const deployments = asRecord(deployment.deployments, "deployments");

    expect(VEILPOT_SEPOLIA_DEPLOYMENT.pool).to.equal(asRecord(deployments.pool, "pool").address);
    expect(VEILPOT_SEPOLIA_DEPLOYMENT.vault).to.equal(asRecord(deployments.vault, "vault").address);
    expect(VEILPOT_SEPOLIA_DEPLOYMENT.adapter).to.equal(
      asRecord(deployments.adapter, "adapter").address,
    );
    expect(VEILPOT_SEPOLIA_DEPLOYMENT.reserve).to.equal(
      asRecord(deployments.reserve, "reserve").address,
    );
    expect(VEILPOT_SEPOLIA_DEPLOYMENT.runtimeEvidenceCommit).to.equal(
      "fb417f62db1ba7936b80c7cfb68b0a42c2fd4972",
    );
    expect(VEILPOT_SEPOLIA_DEPLOYMENT.runtimeEvidenceSha256).to.equal(
      "147c83636f21ac13b8e26174cce1abe1a02d18f496d42d00aa53a7e8d0b8729a",
    );
    expect(asRecord(runtime.finalParticipantLifecycle, "lifecycle").state).to.equal("TOMBSTONED");
    expect(asRecord(runtime.autopilotFinalState, "plan").state).to.equal("COMPLETED");
  });

  it("keeps the Vault ABI identical to the compiled frozen source", async function () {
    const artifact = asRecord(
      await readJson(
        resolve(
          process.cwd(),
          "../contracts/artifacts/contracts/VeilpotAutopilotVault.sol/VeilpotAutopilotVault.json",
        ),
      ),
      "Vault artifact",
    );
    expect(VEILPOT_AUTOPILOT_VAULT_ABI).to.deep.equal(artifact.abi);
  });

  it("mirrors exact plan states and hard cap", function () {
    expect(AUTOPILOT_PLAN_STATE).to.deep.equal({
      NONE: 0,
      ACTIVE: 1,
      PAUSED: 2,
      REVOKED: 3,
      COMPLETED: 4,
    });
    expect(autopilotPlanStateName(4)).to.equal("COMPLETED");
    expect(() => autopilotPlanStateName(5)).to.throw("not recognized");
    expect(MAX_AUTOPILOT_EXECUTIONS).to.equal(1024);
  });

  it("reconstructs the exact live one-window Merkle root", function () {
    const schedule = buildAutopilotSchedule(livePlanId, [
      { notBefore: 1_788_313_800n, notAfter: 1_788_321_060n },
    ]);
    expect(schedule.root).to.equal(liveRoot);
    expect(schedule.executionCount).to.equal(1);
    expect(schedule.windows[0]).to.deep.equal({
      index: 0n,
      notBefore: 1_788_313_800n,
      notAfter: 1_788_321_060n,
      proof: [],
    });
    expect(() =>
      buildAutopilotSchedule(livePlanId, [
        { notBefore: 100n, notAfter: 200n },
        { notBefore: 200n, notAfter: 300n },
      ]),
    ).to.throw("strictly after");
  });

  it("builds createPlan only from a shared-proof Vault/user-bound encrypted pair", function () {
    const encrypted: EncryptedAutopilotPlanAmounts = {
      encryptedPeriodAmount: "0x1111",
      encryptedLifetimeCap: "0x2222",
      inputProof: "0xabcd",
      contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
      userAddress: owner,
    };
    const call = buildCreateAutopilotPlanCall({
      encrypted,
      owner,
      slotIndex: 0n,
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce: 1n,
      planNonce: 0n,
      scheduleRoot: liveRoot,
      executionCount: 1,
    });
    expect(call.address).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.vault);
    expect(call.functionName).to.equal("createPlan");
    expect(call.args).to.deep.equal([0n, 1n, 1n, 0n, liveRoot, 1, "0x1111", "0x2222", "0xabcd"]);
  });

  it("builds funding as ERC-7984 confidentialTransferAndCall to the Vault", function () {
    const encrypted: EncryptedEuint64Input = {
      encryptedValue: "0x1234",
      inputProof: "0xabcd",
      contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
      userAddress: owner,
    };
    const call = buildAutopilotFundingCall({ encrypted, owner, planId: livePlanId });
    expect(call.address).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken);
    expect(call.functionName).to.equal("confidentialTransferAndCall");
    expect(call.args).to.deep.equal([
      VEILPOT_SEPOLIA_DEPLOYMENT.vault,
      "0x1234",
      "0xabcd",
      livePlanId,
    ]);
  });

  it("builds exact lifecycle/read/window calls without sending", function () {
    const window = {
      planId: livePlanId,
      index: 0n,
      notBefore: 1_788_313_800n,
      notAfter: 1_788_321_060n,
      proof: [] as const,
    };
    expect(buildExecuteAutopilotPlanCall(window).functionName).to.equal("execute");
    expect(buildSkipAutopilotWindowCall(window).functionName).to.equal("skipNext");
    expect(buildAdvanceMissedAutopilotWindowCall(window).functionName).to.equal("advanceMissed");
    expect(buildPauseAutopilotPlanCall(livePlanId).functionName).to.equal("pausePlan");
    expect(buildResumeAutopilotPlanCall(livePlanId).functionName).to.equal("resumePlan");
    expect(buildRevokeAutopilotPlanCall(livePlanId).functionName).to.equal("revokePlan");
    expect(buildWithdrawAutopilotPlanFundsCall(livePlanId).functionName).to.equal(
      "withdrawPlanFunds",
    );
    expect(buildAutopilotPlanMetadataCall(livePlanId).functionName).to.equal("planMetadata");
    expect(buildAutopilotPlanAmountHandlesCall(livePlanId).functionName).to.equal(
      "planAmountHandles",
    );
    expect(buildAutopilotPlanIdCall(owner, 1n, 1n, 0n).functionName).to.equal("planIdFor");
    expect(
      buildAutopilotScheduleLeafCall(livePlanId, 0n, 1_788_313_800n, 1_788_321_060n).functionName,
    ).to.equal("scheduleLeaf");
  });

  it("binds encryption to Vault/token and keeps plan decryption explicit", async function () {
    const requests: unknown[] = [];
    const sdk = {
      encrypt: (request: unknown) => {
        requests.push(request);
        const values = asRecord(request, "request").values;
        return Promise.resolve({
          encryptedValues:
            Array.isArray(values) && values.length === 2 ? ["0x1111", "0x2222"] : ["0x3333"],
          inputProof: "0xabcd",
        });
      },
    } as unknown as VeilpotZamaEncryptionClient;

    const plan = await encryptAutopilotPlanAmounts(sdk, 100_000n, 100_000n, owner);
    expect(plan.contractAddress).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.vault);
    expect(plan.userAddress).to.equal(owner);

    const funding = await encryptAutopilotFundingAmount(sdk, 100_000n, owner);
    expect(funding.contractAddress).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken);

    const decrypt = buildAutopilotPlanValueDecryptionRequest("0x1234");
    expect(decrypt.contractAddress).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.vault);
    expect(decrypt.purpose).to.equal("AUTOPILOT_PLAN_USER_OPT_IN");
    expect(requests).to.have.length(2);
  });
});
