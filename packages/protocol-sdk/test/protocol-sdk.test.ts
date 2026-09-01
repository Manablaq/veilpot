import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect } from "chai";

import {
  CLAIM_AUTHORIZATION_TYPES,
  CLAIM_EIP712_DOMAIN,
  DRAW_STATE,
  PARTICIPANT_STATE,
  PRIZE_STATE,
  REGISTRATION_BOND_WEI,
  SUPPORTED_REGISTRATION_VERSION,
  VEILPOT_ADAPTER_ABI,
  VEILPOT_POOL_ABI,
  VEILPOT_RESERVE_ABI,
  VEILPOT_SEPOLIA_DEPLOYMENT,
  YIELD_STATE,
  buildAuthorizeEntitlementDecryptionCall,
  buildClaimAuthorization,
  buildClaimPrizeCall,
  buildClaimTypedData,
  buildDepositCall,
  buildEntitlementDecryptionRequest,
  buildReserveParticipantSlotCall,
  buildSponsorFundingCall,
  buildTokenBalanceDecryptionRequest,
  buildWithdrawalCall,
  buildYieldFundingCall,
  drawStateName,
  participantStateName,
  prizeStateName,
  yieldStateName,
  type Address,
  type EncryptedEuint64Input,
} from "../src/index.js";

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(label + " must be an object");
  }

  return value as Record<string, unknown>;
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");

  return JSON.parse(text) as unknown;
}

describe("Veilpot protocol SDK core", function () {
  it("pins the exact frozen Sepolia deployment identity", async function () {
    const raw = await readJson(
      resolve(process.cwd(), "../../evidence/production-sepolia/deployment.json"),
    );

    const evidence = asRecord(raw, "deployment evidence");

    const deployments = asRecord(evidence.deployments, "deployments");

    const pool = asRecord(deployments.pool, "pool deployment");

    const adapter = asRecord(deployments.adapter, "adapter deployment");

    const reserve = asRecord(deployments.reserve, "reserve deployment");

    expect(VEILPOT_SEPOLIA_DEPLOYMENT.chainId).to.equal(11_155_111);

    expect(VEILPOT_SEPOLIA_DEPLOYMENT.pool).to.equal(pool.address);

    expect(VEILPOT_SEPOLIA_DEPLOYMENT.adapter).to.equal(adapter.address);

    expect(VEILPOT_SEPOLIA_DEPLOYMENT.reserve).to.equal(reserve.address);

    expect(VEILPOT_SEPOLIA_DEPLOYMENT.deploymentEvidenceSha256).to.equal(
      "ba6f9d5b35dc7373382b9e49bcb9e6ff4628d0cad106236a4bedd97b7ab64109",
    );
  });

  it("keeps every SDK ABI byte-for-byte structurally equal to the frozen production artifacts", async function () {
    const entries = [
      [VEILPOT_POOL_ABI, "../contracts/artifacts/contracts/VeilpotPool.sol/VeilpotPool.json", 89],
      [
        VEILPOT_ADAPTER_ABI,
        "../contracts/artifacts/contracts/VeilpotSimulatedYieldAdapter.sol/VeilpotSimulatedYieldAdapter.json",
        18,
      ],
      [
        VEILPOT_RESERVE_ABI,
        "../contracts/artifacts/contracts/VeilpotPrizeReserve.sol/VeilpotPrizeReserve.json",
        32,
      ],
    ] as const;

    for (const [sdkAbi, relativePath, expectedFunctionCount] of entries) {
      const raw = await readJson(resolve(process.cwd(), relativePath));

      const artifact = asRecord(raw, "artifact");

      expect(sdkAbi).to.deep.equal(artifact.abi);

      const functions = sdkAbi.filter((entry) => entry.type === "function");

      expect(functions).to.have.length(expectedFunctionCount);
    }
  });

  it("mirrors every production state ordinal exactly", function () {
    expect(PARTICIPANT_STATE).to.deep.equal({
      FREE: 0,
      RESERVED: 1,
      PENDING_ACTIVATION: 2,
      ACTIVE: 3,
      PENDING_REFUND: 4,
      REFUND_ATTEMPT_PENDING_PROOF: 5,
      TOMBSTONED: 6,
    });

    expect(DRAW_STATE.FINALIZED).to.equal(8);

    expect(YIELD_STATE).to.deep.equal({
      NONE: 0,
      RECOGNITION_PROOF_PENDING: 1,
      RECOGNIZED: 2,
      SWEEP_PROOF_PENDING: 3,
      FUNDING_FINALIZED: 4,
    });

    expect(PRIZE_STATE).to.deep.equal({
      UNPREPARED: 0,
      STATUS_PROOF_PENDING: 1,
      ASSIGNING: 2,
      CLAIMABLE: 3,
      CLAIMED: 4,
      NO_PRIZE: 5,
      TRANSFER_PROOF_PENDING: 6,
    });

    expect(participantStateName(3)).to.equal("ACTIVE");

    expect(drawStateName(8)).to.equal("FINALIZED");

    expect(yieldStateName(4)).to.equal("FUNDING_FINALIZED");

    expect(prizeStateName(6)).to.equal("TRANSFER_PROOF_PENDING");

    expect(() => prizeStateName(7)).to.throw("not recognized");
  });

  it("builds only the exact frozen eleven-field historical-owner claim authorization", function () {
    const owner = "0x1111111111111111111111111111111111111111" as Address;

    const authorization = buildClaimAuthorization({
      drawId: 7n,
      slotIndex: 3n,
      owner,
      registrationVersion: 1n,
      reservationNonce: 22n,
      nonce: 4n,
      expiry: 2_000_000_000n,
    });

    expect(Object.keys(authorization)).to.deep.equal([
      "chainId",
      "reserve",
      "pool",
      "drawId",
      "slotIndex",
      "participant",
      "recipient",
      "registrationVersion",
      "reservationNonce",
      "nonce",
      "expiry",
    ]);

    expect(authorization.chainId).to.equal(11_155_111n);

    expect(authorization.reserve).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.reserve);

    expect(authorization.pool).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.pool);

    expect(authorization.participant).to.equal(owner);

    expect(authorization.recipient).to.equal(owner);

    expect(CLAIM_AUTHORIZATION_TYPES.ClaimAuthorization.map(({ name }) => name)).to.deep.equal([
      "chainId",
      "reserve",
      "pool",
      "drawId",
      "slotIndex",
      "participant",
      "recipient",
      "registrationVersion",
      "reservationNonce",
      "nonce",
      "expiry",
    ]);
  });

  it("pins the exact EIP-712 domain and refuses zero expiry", function () {
    const owner = "0x2222222222222222222222222222222222222222" as Address;

    const typed = buildClaimTypedData({
      drawId: 1n,
      slotIndex: 0n,
      owner,
      registrationVersion: 1n,
      reservationNonce: 1n,
      nonce: 0n,
      expiry: 10n,
    });

    expect(typed.domain).to.deep.equal(CLAIM_EIP712_DOMAIN);

    expect(typed.primaryType).to.equal("ClaimAuthorization");

    expect(CLAIM_EIP712_DOMAIN.name).to.equal("VeilpotPrizeReserve");

    expect(CLAIM_EIP712_DOMAIN.version).to.equal("1");

    expect(() =>
      buildClaimAuthorization({
        drawId: 1n,
        slotIndex: 0n,
        owner,
        registrationVersion: 1n,
        reservationNonce: 1n,
        nonce: 0n,
        expiry: 0n,
      }),
    ).to.throw("nonzero");
  });

  it("locks encrypted inputs to the exact Veilpot contract and submitting user", function () {
    const user = "0x3333333333333333333333333333333333333333" as Address;

    const poolEncrypted: EncryptedEuint64Input = {
      encryptedValue: "0x1234",
      inputProof: "0xabcd",
      contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
      userAddress: user,
    };

    const deposit = buildDepositCall({
      encrypted: poolEncrypted,
      depositor: user,
      reservationNonce: 3n,
      depositNonce: 2n,
    });

    expect(deposit.address).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.pool);

    expect(deposit.functionName).to.equal("deposit");

    expect(deposit.args[3]).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.pool);

    expect(deposit.args[4]).to.equal(SUPPORTED_REGISTRATION_VERSION);

    expect(() =>
      buildDepositCall({
        encrypted: {
          ...poolEncrypted,
          contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
        },
        depositor: user,
        reservationNonce: 3n,
        depositNonce: 2n,
      }),
    ).to.throw("wrong contract or user");
  });

  it("builds the core participant, withdrawal, funding, decryption, and claim calls without executing them", function () {
    const user = "0x4444444444444444444444444444444444444444" as Address;

    const poolEncrypted: EncryptedEuint64Input = {
      encryptedValue: "0x1234",
      inputProof: "0xabcd",
      contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
      userAddress: user,
    };

    const adapterEncrypted: EncryptedEuint64Input = {
      ...poolEncrypted,
      contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.adapter,
    };

    const reserveEncrypted: EncryptedEuint64Input = {
      ...poolEncrypted,
      contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
    };

    const reserveSlot = buildReserveParticipantSlotCall();

    expect(reserveSlot.value).to.equal(REGISTRATION_BOND_WEI);

    expect(
      buildWithdrawalCall({
        encrypted: poolEncrypted,
        caller: user,
        registrationVersion: 1n,
        reservationNonce: 4n,
        withdrawalNonce: 2n,
      }).functionName,
    ).to.equal("withdraw");

    expect(
      buildYieldFundingCall({
        encrypted: adapterEncrypted,
        funder: user,
        fundingNonce: 0n,
      }).functionName,
    ).to.equal("fundYieldLiquidity");

    expect(
      buildSponsorFundingCall({
        drawId: 1n,
        encrypted: reserveEncrypted,
        funder: user,
        fundingNonce: 0n,
      }).functionName,
    ).to.equal("fundSponsorForDraw");

    expect(buildAuthorizeEntitlementDecryptionCall(1n, 0n).functionName).to.equal(
      "authorizeEntitlementDecryption",
    );

    const authorization = buildClaimAuthorization({
      drawId: 1n,
      slotIndex: 0n,
      owner: user,
      registrationVersion: 1n,
      reservationNonce: 4n,
      nonce: 0n,
      expiry: 100n,
    });

    expect(buildClaimPrizeCall(authorization, "0x1234").functionName).to.equal("claimPrize");
  });

  it("makes decryption an explicit descriptor instead of an automatic SDK action", function () {
    const entitlement = buildEntitlementDecryptionRequest("0x1234");

    expect(entitlement.contractAddress).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.reserve);

    expect(entitlement.purpose).to.equal("ENTITLEMENT_USER_OPT_IN");

    const balance = buildTokenBalanceDecryptionRequest("0xabcd");

    expect(balance.contractAddress).to.equal(VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken);

    expect(balance.purpose).to.equal("TOKEN_BALANCE_USER_OPT_IN");
  });
});
