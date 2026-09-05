import { expect } from "chai";

import {
  REGISTRATION_BOND_WEI,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_POOL_V2_ABI,
  VEILPOT_SEPOLIA_V1_DEPLOYMENT,
  buildV2AdvanceMissedAutopilotWindowCall,
  buildV2AutopilotFundingCall,
  buildV2AutopilotPlanAmountHandlesCall,
  buildV2AutopilotPlanIdCall,
  buildV2AutopilotPlanMetadataCall,
  buildV2AutopilotScheduleLeafCall,
  buildV2CreateAutopilotPlanCall,
  buildV2DepositCall,
  buildV2ExecuteAutopilotPlanCall,
  buildV2PauseAutopilotPlanCall,
  buildV2ReserveParticipantSlotCall,
  buildV2ResumeAutopilotPlanCall,
  buildV2RevokeAutopilotPlanCall,
  buildV2SkipAutopilotWindowCall,
  buildV2WithdrawAutopilotPlanFundsCall,
  buildV2WithdrawalCall,
  buildV2AutopilotPlanValueDecryptionRequest,
  encryptV2AutopilotFundingAmount,
  encryptV2AutopilotPlanAmounts,
  encryptV2PoolAmount,
  type Address,
  type EncryptedAutopilotPlanAmounts,
  type EncryptedEuint64Input,
  type Hex,
  type VeilpotZamaEncryptionClient,
} from "../src/index.js";

const USER = "0x1111111111111111111111111111111111111111" as Address;

const WRONG_USER = "0x2222222222222222222222222222222222222222" as Address;

const VALUE = "0x12";
const PROOF = "0x34";
const ROOT: Hex = `0x${"56".repeat(32)}`;
const PLAN_ID: Hex = `0x${"78".repeat(32)}`;

function encryptedFor(contractAddress: Address, userAddress = USER): EncryptedEuint64Input {
  return {
    encryptedValue: VALUE,
    inputProof: PROOF,
    contractAddress,
    userAddress,
  };
}

function encryptedPlanFor(
  contractAddress: Address,
  userAddress = USER,
): EncryptedAutopilotPlanAmounts {
  return {
    encryptedPeriodAmount: VALUE,
    encryptedLifetimeCap: "0x56",
    inputProof: PROOF,
    contractAddress,
    userAddress,
  };
}

describe("Veilpot V2 user-flow SDK", function () {
  it("targets PoolV2 for registration, deposit and withdrawal", function () {
    const reservation = buildV2ReserveParticipantSlotCall();

    expect(reservation.address).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool);
    expect(reservation.abi).to.equal(VEILPOT_POOL_V2_ABI);
    expect(reservation.value).to.equal(REGISTRATION_BOND_WEI);

    const deposit = buildV2DepositCall({
      encrypted: encryptedFor(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool),
      depositor: USER,
      reservationNonce: 4n,
      depositNonce: 7n,
    });

    expect(deposit.address).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool);
    expect(deposit.abi).to.equal(VEILPOT_POOL_V2_ABI);
    expect(deposit.functionName).to.equal("deposit");
    expect(deposit.args[3]).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool);

    const withdrawal = buildV2WithdrawalCall({
      encrypted: encryptedFor(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool),
      caller: USER,
      registrationVersion: 1n,
      reservationNonce: 4n,
      withdrawalNonce: 9n,
    });

    expect(withdrawal.address).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool);
    expect(withdrawal.abi).to.equal(VEILPOT_POOL_V2_ABI);
    expect(withdrawal.functionName).to.equal("withdraw");
  });

  it("rejects stale V1, wrong-contract and wrong-user ciphertext bindings", function () {
    expect(() =>
      buildV2DepositCall({
        encrypted: encryptedFor(VEILPOT_SEPOLIA_V1_DEPLOYMENT.pool),
        depositor: USER,
        reservationNonce: 1n,
        depositNonce: 1n,
      }),
    ).to.throw(/wrong contract or user/);

    expect(() =>
      buildV2WithdrawalCall({
        encrypted: encryptedFor(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool, WRONG_USER),
        caller: USER,
        registrationVersion: 1n,
        reservationNonce: 1n,
        withdrawalNonce: 1n,
      }),
    ).to.throw(/wrong contract or user/);

    expect(() =>
      buildV2CreateAutopilotPlanCall({
        encrypted: encryptedPlanFor(VEILPOT_SEPOLIA_V1_DEPLOYMENT.vault),
        owner: USER,
        slotIndex: 0n,
        registrationVersion: 1n,
        reservationNonce: 1n,
        planNonce: 0n,
        scheduleRoot: ROOT,
        executionCount: 1,
      }),
    ).to.throw(/wrong Vault or user/);
  });

  it("targets the new V2-bound Vault for every Autopilot lifecycle call", function () {
    const create = buildV2CreateAutopilotPlanCall({
      encrypted: encryptedPlanFor(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault),
      owner: USER,
      slotIndex: 2n,
      registrationVersion: 1n,
      reservationNonce: 3n,
      planNonce: 0n,
      scheduleRoot: ROOT,
      executionCount: 2,
    });

    expect(create.address).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault);
    expect(create.abi).to.equal(VEILPOT_AUTOPILOT_VAULT_ABI);

    const funding = buildV2AutopilotFundingCall({
      encrypted: encryptedFor(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken),
      owner: USER,
      planId: PLAN_ID,
    });

    expect(funding.address).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken);
    expect(funding.args[0]).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault);

    const window = {
      planId: PLAN_ID,
      index: 0n,
      notBefore: 100n,
      notAfter: 199n,
      proof: [] as readonly Hex[],
    };

    const calls = [
      buildV2ExecuteAutopilotPlanCall(window),
      buildV2SkipAutopilotWindowCall(window),
      buildV2AdvanceMissedAutopilotWindowCall(window),
      buildV2PauseAutopilotPlanCall(PLAN_ID),
      buildV2ResumeAutopilotPlanCall(PLAN_ID),
      buildV2RevokeAutopilotPlanCall(PLAN_ID),
      buildV2WithdrawAutopilotPlanFundsCall(PLAN_ID),
      buildV2AutopilotPlanMetadataCall(PLAN_ID),
      buildV2AutopilotPlanAmountHandlesCall(PLAN_ID),
      buildV2AutopilotPlanIdCall(USER, 1n, 3n, 0n),
      buildV2AutopilotScheduleLeafCall(PLAN_ID, 0n, 100n, 199n),
    ];

    for (const call of calls) {
      expect(call.address).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault);
    }
  });

  it("encrypts every V2 amount against its exact receiving contract", async function () {
    const observed: {
      readonly contractAddress: string;
      readonly userAddress: string;
      readonly valueCount: number;
    }[] = [];

    const sdk = {
      encrypt: (input: {
        readonly values: readonly unknown[];
        readonly contractAddress: string;
        readonly userAddress: string;
      }) => {
        observed.push({
          contractAddress: input.contractAddress,
          userAddress: input.userAddress,
          valueCount: input.values.length,
        });

        return Promise.resolve({
          encryptedValues: input.values.map((_, index) => (index === 0 ? "0x12" : "0x56")),
          inputProof: "0x34",
        });
      },
    } as unknown as VeilpotZamaEncryptionClient;

    const pool = await encryptV2PoolAmount(sdk, 1n, USER);

    const funding = await encryptV2AutopilotFundingAmount(sdk, 2n, USER);

    const plan = await encryptV2AutopilotPlanAmounts(sdk, 3n, 4n, USER);

    expect(pool.contractAddress).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool);

    expect(funding.contractAddress).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken);

    expect(plan.contractAddress).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault);

    expect(observed.map((entry) => entry.contractAddress)).to.deep.equal([
      VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
      VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    ]);

    expect(
      observed.every((entry) => entry.userAddress.toLowerCase() === USER.toLowerCase()),
    ).to.equal(true);

    expect(observed.map((entry) => entry.valueCount)).to.deep.equal([1, 1, 2]);
  });

  it("binds V2 Autopilot opt-in decryption to the new Vault only", function () {
    const descriptor = buildV2AutopilotPlanValueDecryptionRequest(VALUE);

    expect(descriptor.contractAddress).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault);

    expect(descriptor.purpose).to.equal("AUTOPILOT_PLAN_USER_OPT_IN");
  });
});
