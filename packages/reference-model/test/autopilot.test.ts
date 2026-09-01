import { expect } from "chai";
import {
  AutopilotVaultPlanModel,
  MAX_AUTOPILOT_EXECUTIONS,
  type AutopilotExecutionAttempt,
  type AutopilotPlanConfig,
  type AutopilotScheduleWindow,
} from "../src/autopilot.js";

const windows: readonly AutopilotScheduleWindow[] = [
  {
    index: 0,
    notBefore: 1_000n,
    notAfter: 1_099n,
  },
  {
    index: 1,
    notBefore: 2_000n,
    notAfter: 2_099n,
  },
  {
    index: 2,
    notBefore: 3_000n,
    notAfter: 3_099n,
  },
];

const baseConfig: AutopilotPlanConfig = {
  chainId: 11_155_111n,
  managerDomain: "VeilpotAutopilotVault",
  poolDomain: "VeilpotPoolV2",
  tokenDomain: "Zama-cUSDTMock",
  owner: "alice",
  registrationVersion: 1n,
  reservationNonce: 41n,
  planNonce: 7n,
  scheduleCommitment: "schedule-root-A",
  periodAmount: 20n,
  lifetimeCap: 50n,
  initialPrincipal: 100n,
  maxUserPrincipal: 1_000n,
  windows,
};

function makeModel(overrides: Partial<AutopilotPlanConfig> = {}): AutopilotVaultPlanModel {
  return new AutopilotVaultPlanModel({
    ...baseConfig,
    ...overrides,
  });
}

function fund(model: AutopilotVaultPlanModel, amount = 100n): void {
  model.fundViaConfidentialCallback({
    tokenCaller: baseConfig.tokenDomain,
    operator: baseConfig.owner,
    from: baseConfig.owner,
    planNonce: baseConfig.planNonce,
    actualReceived: amount,
  });
}

function attempt(
  model: AutopilotVaultPlanModel,
  overrides: Partial<AutopilotExecutionAttempt> = {},
): AutopilotExecutionAttempt {
  const window = model.currentWindow();

  if (window === undefined) {
    throw new Error("test requires an active window");
  }

  return {
    executor: "permissionless-keeper",
    now: window.notBefore,
    policyIdentity: model.policyIdentity(),
    scheduleCommitment: baseConfig.scheduleCommitment,
    owner: baseConfig.owner,
    chainId: baseConfig.chainId,
    managerDomain: baseConfig.managerDomain,
    poolDomain: baseConfig.poolDomain,
    tokenDomain: baseConfig.tokenDomain,
    registrationVersion: baseConfig.registrationVersion,
    reservationNonce: baseConfig.reservationNonce,
    planNonce: baseConfig.planNonce,
    index: window.index,
    notBefore: window.notBefore,
    notAfter: window.notAfter,
    tokenActualTransferred: 20n,
    ...overrides,
  };
}

describe("Gate 2C-A Zama Autopilot drain-resistance oracle", function () {
  it("rejects empty, malformed, overlapping, and unbounded schedules", function () {
    expect(() =>
      makeModel({
        windows: [],
      }),
    ).to.throw("invalid schedule window count");

    expect(() =>
      makeModel({
        windows: [
          {
            index: 1,
            notBefore: 1n,
            notAfter: 2n,
          },
        ],
      }),
    ).to.throw("schedule index mismatch");

    expect(() =>
      makeModel({
        windows: [
          {
            index: 0,
            notBefore: 2n,
            notAfter: 1n,
          },
        ],
      }),
    ).to.throw("invalid schedule window");

    expect(() =>
      makeModel({
        windows: [
          {
            index: 0,
            notBefore: 1n,
            notAfter: 10n,
          },
          {
            index: 1,
            notBefore: 10n,
            notAfter: 20n,
          },
        ],
      }),
    ).to.throw("schedule windows overlap");

    const tooMany = Array.from(
      {
        length: MAX_AUTOPILOT_EXECUTIONS + 1,
      },
      (_, index) => ({
        index,
        notBefore: BigInt(index * 2),
        notAfter: BigInt(index * 2 + 1),
      }),
    );

    expect(() =>
      makeModel({
        windows: tooMany,
      }),
    ).to.throw("invalid schedule window count");
  });

  it("supports exact arbitrary calendar windows instead of assuming thirty-day months", function () {
    const calendar = makeModel({
      windows: [
        {
          index: 0,
          notBefore: 100n,
          notAfter: 199n,
        },
        {
          index: 1,
          notBefore: 2_778_000n,
          notAfter: 2_778_099n,
        },
        {
          index: 2,
          notBefore: 5_197_000n,
          notAfter: 5_197_099n,
        },
      ],
    });

    expect(calendar.currentWindow()?.notBefore).to.equal(100n);

    calendar.skipNext("alice", 0);

    expect(calendar.currentWindow()?.notBefore).to.equal(2_778_000n);

    calendar.skipNext("alice", 1);

    expect(calendar.currentWindow()?.notBefore).to.equal(5_197_000n);
  });

  it("funds only through the canonical confidential-token direct-owner callback", function () {
    const model = makeModel();

    expect(() => {
      model.fundViaConfidentialCallback({
        tokenCaller: "fake-token",
        operator: "alice",
        from: "alice",
        planNonce: 7n,
        actualReceived: 10n,
      });
    }).to.throw("noncanonical token callback");

    expect(() => {
      model.fundViaConfidentialCallback({
        tokenCaller: baseConfig.tokenDomain,
        operator: "mallory",
        from: "alice",
        planNonce: 7n,
        actualReceived: 10n,
      });
    }).to.throw("funding must be direct owner transfer");

    expect(() => {
      model.fundViaConfidentialCallback({
        tokenCaller: baseConfig.tokenDomain,
        operator: "alice",
        from: "mallory",
        planNonce: 7n,
        actualReceived: 10n,
      });
    }).to.throw("funding must be direct owner transfer");

    fund(model, 13n);

    expect(model.planFunds()).to.equal(13n);
  });

  it("does not reinterpret unsupported direct token donations as plan funds", function () {
    const model = makeModel();

    model.recordUnsupportedDirectDonation(900n);

    expect(model.planFunds()).to.equal(0n);

    expect(model.unsupportedDonations()).to.equal(900n);
  });

  it("lets an arbitrary permissionless keeper execute only a valid due slot", function () {
    const model = makeModel();
    fund(model);

    const result = model.execute(
      attempt(model, {
        executor: "untrusted-third-party",
      }),
    );

    expect(result.actualTransferred).to.equal(20n);

    expect(model.principal()).to.equal(120n);

    expect(model.nextIndex()).to.equal(1);
  });

  it("derives the transfer amount internally and fixes the destination to the pool", function () {
    const model = makeModel();
    fund(model, 100n);

    expect(model.fixedDestination()).to.equal(baseConfig.poolDomain);

    const result = model.execute(attempt(model));

    expect(result.requested).to.equal(baseConfig.periodAmount);
  });

  it("caps each execution by the confidential funds actually assigned to the plan", function () {
    const model = makeModel();
    fund(model, 7n);

    const result = model.execute(
      attempt(model, {
        tokenActualTransferred: 7n,
      }),
    );

    expect(result.requested).to.equal(7n);

    expect(model.planFunds()).to.equal(0n);
  });

  it("caps all executions by the plan lifetime authorization budget", function () {
    const model = makeModel({
      lifetimeCap: 25n,
    });

    fund(model, 100n);

    model.execute(attempt(model));

    const second = model.execute(
      attempt(model, {
        tokenActualTransferred: 5n,
      }),
    );

    expect(second.requested).to.equal(5n);

    expect(model.remainingBudget()).to.equal(0n);
  });

  it("caps scheduled saving by the participant's remaining protocol principal capacity", function () {
    const model = makeModel({
      initialPrincipal: 995n,
      maxUserPrincipal: 1_000n,
    });

    fund(model, 100n);

    const result = model.execute(
      attempt(model, {
        tokenActualTransferred: 5n,
      }),
    );

    expect(result.requested).to.equal(5n);

    expect(model.principal()).to.equal(1_000n);
  });

  it("accounts only the confidential token's actual returned transfer amount", function () {
    const model = makeModel();
    fund(model, 100n);

    const result = model.execute(
      attempt(model, {
        tokenActualTransferred: 3n,
      }),
    );

    expect(result.requested).to.equal(20n);

    expect(result.actualTransferred).to.equal(3n);

    expect(model.principal()).to.equal(103n);

    expect(model.aggregatePrincipal()).to.equal(103n);

    expect(model.canonicalReceived()).to.equal(3n);

    expect(model.planFunds()).to.equal(97n);

    expect(model.remainingBudget()).to.equal(47n);
  });

  it("rejects a malformed token result that exceeds the authorized request", function () {
    const model = makeModel();
    fund(model, 100n);

    expect(() =>
      model.execute(
        attempt(model, {
          tokenActualTransferred: 21n,
        }),
      ),
    ).to.throw("token actual exceeds authorized request");

    expect(model.nextIndex()).to.equal(0);

    expect(model.principal()).to.equal(100n);
  });

  it("binds execution to the exact chain, vault, pool, token, owner, registration, and plan identity", function () {
    const mutations: readonly Partial<AutopilotExecutionAttempt>[] = [
      {
        chainId: baseConfig.chainId + 1n,
      },
      {
        managerDomain: "OtherManager",
      },
      {
        poolDomain: "OtherPool",
      },
      {
        tokenDomain: "OtherToken",
      },
      {
        owner: "bob",
      },
      {
        registrationVersion: 2n,
      },
      {
        reservationNonce: 42n,
      },
      {
        planNonce: 8n,
      },
      {
        policyIdentity: "forged-policy",
      },
      {
        scheduleCommitment: "different-root",
      },
    ];

    for (const mutation of mutations) {
      const model = makeModel();
      fund(model);

      expect(() => model.execute(attempt(model, mutation))).to.throw();

      expect(model.nextIndex()).to.equal(0);

      expect(model.principal()).to.equal(100n);
    }
  });

  it("rejects mutation of a committed execution window without consuming it", function () {
    const model = makeModel();
    fund(model);

    expect(() =>
      model.execute(
        attempt(model, {
          notBefore: 999n,
        }),
      ),
    ).to.throw("schedule window mismatch");

    expect(model.nextIndex()).to.equal(0);
  });

  it("consumes each schedule index exactly once and rejects replay", function () {
    const model = makeModel();
    fund(model);

    const first = attempt(model);

    model.execute(first);

    expect(() => model.execute(first)).to.throw();

    expect(model.nextIndex()).to.equal(1);
  });

  it("rejects early and expired execution while allowing permissionless missed-window advancement", function () {
    const early = makeModel();
    fund(early);

    expect(() =>
      early.execute(
        attempt(early, {
          now: 999n,
        }),
      ),
    ).to.throw("execution too early");

    const late = makeModel();
    fund(late);

    expect(() =>
      late.execute(
        attempt(late, {
          now: 1_100n,
        }),
      ),
    ).to.throw("execution window expired");

    expect(() => {
      late.advanceMissed(0, 1_099n);
    }).to.throw("window not expired");

    late.advanceMissed(0, 1_100n);

    expect(late.nextIndex()).to.equal(1);
  });

  it("forces sequential progression so later schedule slots cannot bypass an unresolved earlier slot", function () {
    const model = makeModel();
    fund(model);

    expect(() =>
      model.execute(
        attempt(model, {
          index: 1,
          notBefore: 2_000n,
          notAfter: 2_099n,
          now: 2_000n,
        }),
      ),
    ).to.throw("execution index mismatch");

    model.advanceMissed(0, 1_100n);

    expect(model.nextIndex()).to.equal(1);
  });

  it("makes pause an immediate execution gate and resume owner-only", function () {
    const model = makeModel();
    fund(model);

    model.pause("alice");

    expect(model.state()).to.equal("PAUSED");

    expect(() => model.execute(attempt(model))).to.throw("plan paused");

    expect(() => {
      model.resume("mallory");
    }).to.throw("owner authorization required");

    model.resume("alice");

    expect(model.state()).to.equal("ACTIVE");

    model.execute(attempt(model));

    expect(model.nextIndex()).to.equal(1);
  });

  it("allows only the owner to skip the exact next scheduled slot", function () {
    const model = makeModel();

    expect(() => {
      model.skipNext("mallory", 0);
    }).to.throw("owner authorization required");

    expect(() => {
      model.skipNext("alice", 1);
    }).to.throw("skip index mismatch");

    model.skipNext("alice", 0);

    expect(model.nextIndex()).to.equal(1);
  });

  it("makes revocation terminal even when confidential funds remain in the vault", function () {
    const model = makeModel();
    fund(model, 100n);

    model.revoke("alice");

    expect(model.state()).to.equal("REVOKED");

    expect(model.planFunds()).to.equal(100n);

    expect(() => model.execute(attempt(model))).to.throw("plan revoked");

    expect(() => {
      model.resume("alice");
    }).to.throw("plan revoked");
  });

  it("keeps residual vault funds withdrawable by the owner after revocation without touching pool principal", function () {
    const model = makeModel();
    fund(model, 100n);

    model.revoke("alice");

    expect(() => {
      model.withdrawPlanFunds("mallory", 10n);
    }).to.throw("owner authorization required");

    model.withdrawPlanFunds("alice", 100n);

    expect(model.planFunds()).to.equal(0n);

    expect(model.principal()).to.equal(100n);
  });

  it("consumes a zero-transfer period once so later funding cannot turn the same keeper call into a repeated debit", function () {
    const model = makeModel();

    const result = model.execute(
      attempt(model, {
        tokenActualTransferred: 0n,
      }),
    );

    expect(result.requested).to.equal(0n);

    expect(model.nextIndex()).to.equal(1);

    fund(model, 100n);

    expect(() =>
      model.execute(
        attempt(model, {
          index: 0,
          notBefore: 1_000n,
          notAfter: 1_099n,
          now: 1_050n,
        }),
      ),
    ).to.throw();

    expect(model.planFunds()).to.equal(100n);
  });

  it("checkpoints the old principal before every successful scheduled principal mutation", function () {
    const model = makeModel();
    fund(model, 100n);

    model.execute(
      attempt(model, {
        tokenActualTransferred: 8n,
      }),
    );

    expect(model.checkpointCount()).to.equal(1);

    expect(model.lastCheckpointedPrincipal()).to.equal(100n);

    expect(model.principal()).to.equal(108n);
  });

  it("keeps independent plans isolated by owner and plan nonce", function () {
    const alice = makeModel();

    const bob = makeModel({
      owner: "bob",
      planNonce: 99n,
      scheduleCommitment: "schedule-root-B",
    });

    fund(alice, 40n);

    bob.fundViaConfidentialCallback({
      tokenCaller: baseConfig.tokenDomain,
      operator: "bob",
      from: "bob",
      planNonce: 99n,
      actualReceived: 70n,
    });

    alice.execute(attempt(alice));

    expect(alice.planFunds()).to.equal(20n);

    expect(bob.planFunds()).to.equal(70n);

    expect(bob.principal()).to.equal(100n);
  });

  it("does not require an ERC-7984 operator approval over the user's wallet", function () {
    const model = makeModel();

    expect(model.requiresUserTokenOperator()).to.equal(false);
  });

  it("exposes no automation method capable of withdrawing pool principal, claiming prizes, or selecting an arbitrary recipient", function () {
    const model = makeModel();

    expect("withdrawPrincipal" in model).to.equal(false);

    expect("claimPrize" in model).to.equal(false);

    expect("setDestination" in model).to.equal(false);

    expect(model.fixedDestination()).to.equal(baseConfig.poolDomain);
  });
});
