import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect } from "chai";

import {
  VEILDRAW_ENGINE_V2_ABI,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_ADAPTER_V2_ABI,
  VEILPOT_POOL_V2_ABI,
  VEILPOT_SEPOLIA_DEPLOYMENT,
  VEILPOT_SEPOLIA_V1_DEPLOYMENT,
  VEILPOT_SEPOLIA_V2_DEPLOYMENT,
} from "../src/index.js";

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

describe("VeilDraw V2 protocol SDK identity", function () {
  it("preserves the frozen V1 deployment alias while making V2 the explicit integration target", function () {
    expect(VEILPOT_SEPOLIA_DEPLOYMENT).to.equal(VEILPOT_SEPOLIA_V1_DEPLOYMENT);

    expect(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT);

    expect(VEILPOT_SEPOLIA_V1_DEPLOYMENT.pool).to.equal(
      "0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601",
    );

    expect(VEILPOT_SEPOLIA_V2_DEPLOYMENT.pool).to.equal(
      "0x6F74fCadDc359159D0799fc9054642aB1f357161",
    );
  });

  it("pins the V2 deployment profile to the committed Sepolia deployment evidence", async function () {
    const evidencePath = resolve(
      process.cwd(),
      "../../evidence/production-sepolia/veildraw-v2/deployment.json",
    );

    const journalPath = resolve(
      process.cwd(),
      "../../evidence/production-sepolia/veildraw-v2/deployment-journal.json",
    );

    expect(await sha256File(evidencePath)).to.equal(
      VEILPOT_SEPOLIA_V2_DEPLOYMENT.deploymentEvidenceSha256,
    );

    expect(await sha256File(journalPath)).to.equal(
      VEILPOT_SEPOLIA_V2_DEPLOYMENT.deploymentJournalSha256,
    );

    const evidence = asRecord(await readJson(evidencePath), "V2 deployment evidence");

    expect(evidence.profile).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.profile);

    expect(evidence.network).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.network);

    expect(evidence.chainId).to.equal(String(VEILPOT_SEPOLIA_V2_DEPLOYMENT.chainId));

    expect(evidence.sourceCommit).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.deploymentSourceCommit);

    expect(evidence.deploymentPlanSha256).to.equal(
      VEILPOT_SEPOLIA_V2_DEPLOYMENT.deploymentPlanSha256,
    );

    expect(evidence.deployerAddress).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.deployer);

    expect(evidence.wrappersRegistry).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.wrappersRegistry);

    expect(evidence.yieldProfile).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.yieldProfile);

    const token = asRecord(evidence.token, "token");

    expect(token.address).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.confidentialToken);

    expect(token.classification).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.assetClassification);

    const planned = asRecord(evidence.plannedAddresses, "planned addresses");

    expect(planned.poolV2).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.pool);

    expect(planned.drawEngineV2).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.engine);

    expect(planned.autopilotVault).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.vault);

    expect(planned.yieldAdapterV2).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.adapter);

    expect(planned.prizeReserve).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.reserve);

    const deployments = asRecord(evidence.deployments, "deployments");

    const pool = asRecord(deployments.VeilpotPoolV2, "PoolV2 deployment");

    const vault = asRecord(deployments.VeilpotAutopilotVault, "Vault deployment");

    const adapter = asRecord(deployments.VeilpotSimulatedYieldAdapterV2, "AdapterV2 deployment");

    const reserve = asRecord(deployments.VeilpotPrizeReserve, "Reserve deployment");

    expect(pool.address).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.pool);

    expect(pool.transactionHash).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.transactions.pool);

    expect(pool.blockNumber).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.blocks.pool);

    expect(vault.address).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.vault);

    expect(vault.transactionHash).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.transactions.vault);

    expect(vault.blockNumber).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.blocks.vault);

    expect(adapter.address).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.adapter);

    expect(adapter.transactionHash).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.transactions.adapter);

    expect(adapter.blockNumber).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.blocks.adapter);

    expect(reserve.address).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.reserve);

    expect(reserve.transactionHash).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.transactions.reserve);

    expect(reserve.blockNumber).to.equal(VEILPOT_SEPOLIA_V2_DEPLOYMENT.blocks.reserve);

    expect(VEILPOT_SEPOLIA_V2_DEPLOYMENT.engineCreation.method).to.equal("POOL_CREATE");

    expect(VEILPOT_SEPOLIA_V2_DEPLOYMENT.engineCreation.parentTransaction).to.equal(
      VEILPOT_SEPOLIA_V2_DEPLOYMENT.transactions.pool,
    );

    expect(VEILPOT_SEPOLIA_V2_DEPLOYMENT.engineCreation.parentBlock).to.equal(
      VEILPOT_SEPOLIA_V2_DEPLOYMENT.blocks.pool,
    );
  });

  it("keeps each generated V2 SDK ABI structurally identical to its exact compiled artifact", async function () {
    const entries = [
      [
        VEILPOT_POOL_V2_ABI,
        "../contracts/artifacts/contracts/VeilpotPoolV2.sol/VeilpotPoolV2.json",
        93,
      ],
      [
        VEILDRAW_ENGINE_V2_ABI,
        "../contracts/artifacts/contracts/VeilDrawEngineV2.sol/VeilDrawEngineV2.json",
        45,
      ],
      [
        VEILPOT_ADAPTER_V2_ABI,
        "../contracts/artifacts/contracts/VeilpotSimulatedYieldAdapterV2.sol/VeilpotSimulatedYieldAdapterV2.json",
        22,
      ],
    ] as const;

    for (const [sdkAbi, relativePath, expectedFunctionCount] of entries) {
      const raw = await readJson(resolve(process.cwd(), relativePath));

      const artifact = asRecord(raw, "compiled artifact");

      expect(sdkAbi).to.deep.equal(artifact.abi);

      const functions = sdkAbi.filter((entry) => entry.type === "function");

      expect(functions).to.have.length(expectedFunctionCount);
    }
  });

  it("contains the exact V2 draw and round surfaces required by the frontend migration", function () {
    const poolFunctions = new Set<string>(
      VEILPOT_POOL_V2_ABI.filter((entry) => entry.type === "function").map((entry) => entry.name),
    );

    const required = [
      "beginDrawSnapshotImport",
      "processDrawSnapshotImportChunk",
      "finalizeDrawSnapshotImport",
      "drawSnapshotImportMetadata",
      "startDraw",
      "snapshotPrizeDrawId",
      "prepareDrawBucketEvidence",
      "submitDrawBucketEvidence",
      "generateDrawCandidateBatch",
      "reduceDrawCandidateBatch",
      "submitDrawBatchEvidence",
      "startWinnerResolution",
      "processDrawShardSelectionChunk",
      "processDrawWinnerShard",
      "finalizeDraw",
      "recognizeRoundYield",
    ] as const;

    for (const functionName of required) {
      expect(poolFunctions.has(functionName), functionName).to.equal(true);
    }

    expect(poolFunctions.has("processDrawWinnerChunk")).to.equal(false);
  });
});
