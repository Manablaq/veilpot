import { expect } from "chai";

import {
  SUPPORTED_REGISTRATION_VERSION,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_SEPOLIA_DEPLOYMENT,
  buildV2AdvanceMissedAutopilotWindowCall,
  buildV2AutopilotFundingCall,
  buildV2AutopilotPlanAmountHandlesCall,
  buildV2AutopilotPlanIdCall,
  buildV2AutopilotPlanMetadataCall,
  buildV2AutopilotScheduleLeafCall,
  buildV2CreateAutopilotPlanCall,
  buildV2ExecuteAutopilotPlanCall,
  buildV2PauseAutopilotPlanCall,
  buildV2ResumeAutopilotPlanCall,
  buildV2RevokeAutopilotPlanCall,
  buildV2SkipAutopilotWindowCall,
  buildV2WithdrawAutopilotPlanFundsCall,
  type Address,
  type EncryptedAutopilotPlanAmounts,
  type EncryptedEuint64Input,
} from "../src/index.js";

describe("Veilpot corrected V2.x Autopilot SDK bindings", function () {
  const owner = "0x1f87Ae197af539253978d435aD45cCf28Fb95024" as Address;

  const planId = `0x${"11".repeat(32)}` as const;

  const scheduleRoot = `0x${"22".repeat(32)}` as const;

  const window = {
    planId,
    index: 0n,
    notBefore: 2_000_000_000n,
    notAfter: 2_000_003_599n,
    proof: [] as const,
  };

  it("creates plans only for the corrected V2.x Vault", function () {
    const encrypted: EncryptedAutopilotPlanAmounts = {
      encryptedPeriodAmount: "0x1111",
      encryptedLifetimeCap: "0x2222",
      inputProof: "0xabcd",
      contractAddress: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
      userAddress: owner,
    };

    const call = buildV2CreateAutopilotPlanCall({
      encrypted,
      owner,
      slotIndex: 7n,
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce: 9n,
      planNonce: 3n,
      scheduleRoot,
      executionCount: 4,
    });

    expect(call.address).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault);

    expect(call.address).to.not.equal(VEILPOT_SEPOLIA_DEPLOYMENT.vault);

    expect(call.functionName).to.equal("createPlan");
  });

  it("rejects historical Vault-bound encrypted plan inputs", function () {
    const encrypted: EncryptedAutopilotPlanAmounts = {
      encryptedPeriodAmount: "0x1111",
      encryptedLifetimeCap: "0x2222",
      inputProof: "0xabcd",
      contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
      userAddress: owner,
    };

    expect(() =>
      buildV2CreateAutopilotPlanCall({
        encrypted,
        owner,
        slotIndex: 7n,
        registrationVersion: SUPPORTED_REGISTRATION_VERSION,
        reservationNonce: 9n,
        planNonce: 3n,
        scheduleRoot,
        executionCount: 4,
      }),
    ).to.throw("wrong Vault or user");
  });

  it("funds only through the active confidential token into the corrected Vault", function () {
    const encrypted: EncryptedEuint64Input = {
      encryptedValue: "0x1234",
      inputProof: "0xabcd",
      contractAddress: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
      userAddress: owner,
    };

    const call = buildV2AutopilotFundingCall({
      encrypted,
      owner,
      planId,
    });

    expect(call.address).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken);

    expect(call.args[0]).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault);

    expect(call.args[0]).to.not.equal(VEILPOT_SEPOLIA_DEPLOYMENT.vault);
  });

  it("rejects funding ciphertext bound to a non-token contract", function () {
    expect(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken).to.equal(
      VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
    );

    const encrypted: EncryptedEuint64Input = {
      encryptedValue: "0x1234",
      inputProof: "0xabcd",
      contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
      userAddress: owner,
    };

    expect(() =>
      buildV2AutopilotFundingCall({
        encrypted,
        owner,
        planId,
      }),
    ).to.throw("wrong contract or user");
  });

  it("targets corrected V2.x Vault for every lifecycle and read helper", function () {
    const calls = [
      buildV2ExecuteAutopilotPlanCall(window),
      buildV2SkipAutopilotWindowCall(window),
      buildV2AdvanceMissedAutopilotWindowCall(window),
      buildV2PauseAutopilotPlanCall(planId),
      buildV2ResumeAutopilotPlanCall(planId),
      buildV2RevokeAutopilotPlanCall(planId),
      buildV2WithdrawAutopilotPlanFundsCall(planId),
      buildV2AutopilotPlanMetadataCall(planId),
      buildV2AutopilotPlanAmountHandlesCall(planId),
      buildV2AutopilotPlanIdCall(owner, SUPPORTED_REGISTRATION_VERSION, 9n, 3n),
      buildV2AutopilotScheduleLeafCall(planId, 0n, window.notBefore, window.notAfter),
    ];

    for (const call of calls) {
      expect(call.address).to.equal(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault);

      expect(call.address).to.not.equal(VEILPOT_SEPOLIA_DEPLOYMENT.vault);
    }
  });
});
