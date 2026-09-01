import { expect } from "chai";

import {
  GATE1C2C_CLAIM_AUTHORIZATION_TYPE,
  GATE1C2C_CLAIM_PROOF_TTL_SECONDS,
  GATE1C2C_EIP712_NAME,
  GATE1C2C_EIP712_VERSION,
  Gate1C2CClaimAuthorizationModel,
  type Gate1C2CClaimAuthorization,
  type Gate1C2CClaimProofContext,
  type Gate1C2CHistoricalEntitlementInput,
  type Gate1C2CTokenOutcome,
} from "../src/gate1c2c-claim-authorization.js";

const CHAIN_ID = 11_155_111n;
const RESERVE = "reserve";
const POOL = "pool";
const ALICE = "alice";
const BOB = "bob";
const RELAYER = "relayer";

const successful = (actualTransferred: bigint): Gate1C2CTokenOutcome => ({
  succeeded: true,
  returnAclPresent: true,
  actualTransferred,
});

const authorization = (
  overrides: Partial<Gate1C2CClaimAuthorization> = {},
): Gate1C2CClaimAuthorization => ({
  chainId: CHAIN_ID,
  reserve: RESERVE,
  pool: POOL,
  drawId: 7n,
  slotIndex: 3n,
  participant: ALICE,
  recipient: ALICE,
  registrationVersion: 2n,
  reservationNonce: 19n,
  nonce: 0n,
  expiry: 1_000n,
  ...overrides,
});

const winner = (
  overrides: Partial<Gate1C2CHistoricalEntitlementInput> = {},
): Gate1C2CHistoricalEntitlementInput => ({
  slotIndex: 3n,
  participant: ALICE,
  registrationVersion: 2n,
  reservationNonce: 19n,
  initialized: true,
  beneficiaryBound: true,
  residual: 100n,
  ...overrides,
});

const modelWithOneDraw = (): Gate1C2CClaimAuthorizationModel => {
  const model = new Gate1C2CClaimAuthorizationModel(CHAIN_ID, RESERVE, POOL);

  model.fundReserve(100n);

  model.addClaimableDraw(7n, 100n, 100n, [
    winner(),
    {
      slotIndex: 4n,
      participant: BOB,
      registrationVersion: 5n,
      reservationNonce: 29n,
      initialized: true,
      beneficiaryBound: true,
      residual: 0n,
    },
  ]);

  return model;
};

describe("Gate 1C.2C independent claim-authorization oracle", function () {
  it("locks the exact EIP-712 metadata and eleven-field claim authorization shape", function () {
    expect(GATE1C2C_EIP712_NAME).to.equal("VeilpotPrizeReserve");

    expect(GATE1C2C_EIP712_VERSION).to.equal("1");

    expect(GATE1C2C_CLAIM_AUTHORIZATION_TYPE).to.equal(
      "ClaimAuthorization(uint256 chainId,address reserve,address pool,uint256 drawId,uint256 slotIndex,address participant,address recipient,uint256 registrationVersion,uint256 reservationNonce,uint256 nonce,uint256 expiry)",
    );

    expect(GATE1C2C_CLAIM_PROOF_TTL_SECONDS).to.equal(86_400n);

    const fields = Object.keys(authorization());

    expect(fields).to.deep.equal([
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

  it("allows a permissionless relayer but fixes signer and recipient to the frozen historical owner", function () {
    const model = modelWithOneDraw();

    model.beginClaim(RELAYER, authorization(), ALICE, successful(40n), 10n);

    expect(model.nextClaimNonce(ALICE)).to.equal(1n);

    expect(model.entitlement(7n, 3n).residual).to.equal(60n);

    expect(model.snapshot(7n).remaining).to.equal(60n);
  });

  it("rejects mutation of every consequential authorization-domain component", function () {
    const model = modelWithOneDraw();

    const mutations: Gate1C2CClaimAuthorization[] = [
      authorization({ chainId: 1n }),
      authorization({ reserve: "other-reserve" }),
      authorization({ pool: "other-pool" }),
      authorization({ drawId: 8n }),
      authorization({ slotIndex: 4n }),
      authorization({ participant: BOB }),
      authorization({ recipient: BOB }),
      authorization({ registrationVersion: 3n }),
      authorization({ reservationNonce: 20n }),
      authorization({ nonce: 1n }),
      authorization({ expiry: 9n }),
    ];

    for (const changed of mutations) {
      expect(() => {
        model.beginClaim(RELAYER, changed, ALICE, successful(0n), 10n);
      }).to.throw();
    }

    expect(() => {
      model.beginClaim(RELAYER, authorization(), BOB, successful(0n), 10n);
    }).to.throw("invalid claim authorization");

    expect(model.nextClaimNonce(ALICE)).to.equal(0n);

    expect(model.snapshot(7n).remaining).to.equal(100n);
  });

  it("uses one participant-global nonce across draws and rejects replay", function () {
    const model = new Gate1C2CClaimAuthorizationModel(CHAIN_ID, RESERVE, POOL);

    model.fundReserve(200n);

    model.addClaimableDraw(7n, 100n, 100n, [winner()]);

    model.addClaimableDraw(8n, 100n, 100n, [
      winner({
        residual: 100n,
      }),
    ]);

    model.beginClaim(RELAYER, authorization(), ALICE, successful(0n), 10n);

    model.settleClaim(7n, model.currentProofContext(7n), false, 11n);

    expect(model.nextClaimNonce(ALICE)).to.equal(1n);

    expect(() => {
      model.beginClaim(
        RELAYER,
        authorization({
          drawId: 8n,
          nonce: 0n,
        }),
        ALICE,
        successful(0n),
        12n,
      );
    }).to.throw("invalid claim authorization");

    model.beginClaim(
      RELAYER,
      authorization({
        drawId: 8n,
        nonce: 1n,
      }),
      ALICE,
      successful(0n),
      12n,
    );

    expect(model.nextClaimNonce(ALICE)).to.equal(2n);
  });

  it("preserves entitlement, global remaining, assets, and liabilities on a successful zero actual return", function () {
    const model = modelWithOneDraw();

    model.beginClaim(RELAYER, authorization(), ALICE, successful(0n), 10n);

    expect(model.entitlement(7n, 3n).residual).to.equal(100n);

    expect(model.snapshot(7n).remaining).to.equal(100n);

    expect(model.accountedReserveAssets).to.equal(100n);

    expect(model.outstandingPrizeLiabilities).to.equal(100n);

    expect(model.nextClaimNonce(ALICE)).to.equal(1n);

    expect(model.snapshot(7n).state).to.equal("TransferProofPending");

    expect(() => {
      model.settleClaim(7n, model.currentProofContext(7n), true, 11n);
    }).to.throw("invalid claim completion proof");

    model.settleClaim(7n, model.currentProofContext(7n), false, 11n);

    expect(model.snapshot(7n).state).to.equal("Claimable");
  });

  it("accounts only an actual partial transfer and preserves both entitlement and global residual", function () {
    const model = modelWithOneDraw();

    model.beginClaim(RELAYER, authorization(), ALICE, successful(40n), 10n);

    expect(model.entitlement(7n, 3n).residual).to.equal(60n);

    expect(model.snapshot(7n).remaining).to.equal(60n);

    expect(model.snapshot(7n).assignedTotal).to.equal(100n);

    expect(model.accountedReserveAssets).to.equal(60n);

    expect(model.outstandingPrizeLiabilities).to.equal(60n);

    model.settleClaim(7n, model.currentProofContext(7n), false, 11n);

    expect(model.snapshot(7n).state).to.equal("Claimable");
  });

  it("requires proof of the global zero residual before a full payout becomes terminal", function () {
    const model = modelWithOneDraw();

    model.beginClaim(RELAYER, authorization(), ALICE, successful(100n), 10n);

    expect(model.snapshot(7n).remaining).to.equal(0n);

    expect(model.snapshot(7n).state).to.equal("TransferProofPending");

    expect(model.accountedReserveAssets).to.equal(0n);

    expect(model.outstandingPrizeLiabilities).to.equal(0n);

    model.settleClaim(7n, model.currentProofContext(7n), true, 11n);

    expect(model.snapshot(7n).state).to.equal("Claimed");
  });

  it("caps every entitlement by the draw-global residual so malformed multiple entitlements cannot drain other draws", function () {
    const model = new Gate1C2CClaimAuthorizationModel(CHAIN_ID, RESERVE, POOL);

    model.fundReserve(150n);

    model.addClaimableDraw(7n, 100n, 200n, [
      winner(),
      {
        slotIndex: 4n,
        participant: BOB,
        registrationVersion: 5n,
        reservationNonce: 29n,
        initialized: true,
        beneficiaryBound: true,
        residual: 100n,
      },
    ]);

    model.addClaimableDraw(8n, 50n, 50n, [
      {
        slotIndex: 1n,
        participant: "carol",
        registrationVersion: 1n,
        reservationNonce: 1n,
        initialized: true,
        beneficiaryBound: true,
        residual: 50n,
      },
    ]);

    model.beginClaim(RELAYER, authorization(), ALICE, successful(70n), 10n);

    model.settleClaim(7n, model.currentProofContext(7n), false, 11n);

    expect(() => {
      model.beginClaim(
        RELAYER,
        authorization({
          slotIndex: 4n,
          participant: BOB,
          recipient: BOB,
          registrationVersion: 5n,
          reservationNonce: 29n,
          nonce: 0n,
        }),
        BOB,
        successful(31n),
        12n,
      );
    }).to.throw("actual transfer exceeds authorized residual");

    model.beginClaim(
      RELAYER,
      authorization({
        slotIndex: 4n,
        participant: BOB,
        recipient: BOB,
        registrationVersion: 5n,
        reservationNonce: 29n,
        nonce: 0n,
      }),
      BOB,
      successful(30n),
      12n,
    );

    model.settleClaim(7n, model.currentProofContext(7n), true, 13n);

    expect(model.snapshot(7n).remaining).to.equal(0n);

    expect(model.snapshot(8n).remaining).to.equal(50n);

    expect(model.accountedReserveAssets).to.equal(50n);

    expect(model.outstandingPrizeLiabilities).to.equal(50n);

    model.assertSolvent();
  });

  it("rolls back nonce, residual, and accounting when the token reverts or omits returned-handle ACL", function () {
    const model = modelWithOneDraw();

    expect(() => {
      model.beginClaim(
        RELAYER,
        authorization(),
        ALICE,
        {
          succeeded: false,
          returnAclPresent: true,
          actualTransferred: 40n,
        },
        10n,
      );
    }).to.throw("token transfer reverted");

    expect(() => {
      model.beginClaim(
        RELAYER,
        authorization(),
        ALICE,
        {
          succeeded: true,
          returnAclPresent: false,
          actualTransferred: 40n,
        },
        10n,
      );
    }).to.throw("missing token return acl");

    expect(model.nextClaimNonce(ALICE)).to.equal(0n);

    expect(model.entitlement(7n, 3n).residual).to.equal(100n);

    expect(model.snapshot(7n).remaining).to.equal(100n);

    expect(model.accountedReserveAssets).to.equal(100n);

    expect(model.outstandingPrizeLiabilities).to.equal(100n);

    expect(model.snapshot(7n).state).to.equal("Claimable");
  });

  it("cannot let a zero-entitlement nonwinner close a prize owned by another slot", function () {
    const model = modelWithOneDraw();

    model.beginClaim(
      RELAYER,
      authorization({
        slotIndex: 4n,
        participant: BOB,
        recipient: BOB,
        registrationVersion: 5n,
        reservationNonce: 29n,
      }),
      BOB,
      successful(0n),
      10n,
    );

    expect(model.snapshot(7n).remaining).to.equal(100n);

    expect(() => {
      model.settleClaim(7n, model.currentProofContext(7n), true, 11n);
    }).to.throw("invalid claim completion proof");

    model.settleClaim(7n, model.currentProofContext(7n), false, 11n);

    expect(model.snapshot(7n).state).to.equal("Claimable");

    expect(model.outstandingPrizeLiabilities).to.equal(100n);
  });

  it("binds completion evidence to chain, reserve, pool, draw, slot, participant, claim nonce, and attempt nonce", function () {
    const model = modelWithOneDraw();

    model.beginClaim(RELAYER, authorization(), ALICE, successful(40n), 10n);

    const context = model.currentProofContext(7n);

    const mutations: Gate1C2CClaimProofContext[] = [
      { ...context, chainId: 1n },
      { ...context, reserve: "other-reserve" },
      { ...context, pool: "other-pool" },
      { ...context, drawId: 8n },
      { ...context, slotIndex: 4n },
      { ...context, participant: BOB },
      { ...context, claimNonce: 1n },
      { ...context, attemptNonce: context.attemptNonce + 1n },
    ];

    for (const changed of mutations) {
      expect(() => {
        model.settleClaim(7n, changed, false, 11n);
      }).to.throw("claim proof domain mismatch");
    }

    model.settleClaim(7n, context, false, 11n);

    expect(model.snapshot(7n).state).to.equal("Claimable");
  });

  it("refreshes expired completion evidence permissionlessly and rejects stale proof attempts", function () {
    const model = modelWithOneDraw();

    model.beginClaim(RELAYER, authorization(), ALICE, successful(40n), 10n);

    const initial = model.currentProofContext(7n);

    const deadline = model.snapshot(7n).proofDeadline;

    expect(() => {
      model.refreshClaimCompletionEvidence(7n, initial.attemptNonce, deadline);
    }).to.throw("claim proof not expired");

    expect(() => {
      model.settleClaim(7n, initial, false, deadline + 1n);
    }).to.throw("claim proof expired");

    model.refreshClaimCompletionEvidence(7n, initial.attemptNonce, deadline + 1n);

    const refreshed = model.currentProofContext(7n);

    expect(refreshed.attemptNonce).to.equal(initial.attemptNonce + 1n);

    expect(() => {
      model.settleClaim(7n, initial, false, deadline + 2n);
    }).to.throw("claim proof domain mismatch");

    model.settleClaim(7n, refreshed, false, deadline + 2n);

    expect(model.snapshot(7n).state).to.equal("Claimable");
  });

  it("accepts completion evidence at the inclusive deadline", function () {
    const model = modelWithOneDraw();

    model.beginClaim(RELAYER, authorization(), ALICE, successful(40n), 10n);

    const context = model.currentProofContext(7n);

    const deadline = model.snapshot(7n).proofDeadline;

    model.settleClaim(7n, context, false, deadline);

    expect(model.snapshot(7n).state).to.equal("Claimable");
  });

  it("requires nonzero authorization expiry, rejects expired signatures, and accepts the exact expiry timestamp", function () {
    const zeroExpiry = modelWithOneDraw();

    expect(() => {
      zeroExpiry.beginClaim(
        RELAYER,
        authorization({
          expiry: 0n,
        }),
        ALICE,
        successful(0n),
        10n,
      );
    }).to.throw("invalid claim authorization");

    const expired = modelWithOneDraw();

    expect(() => {
      expired.beginClaim(
        RELAYER,
        authorization({
          expiry: 9n,
        }),
        ALICE,
        successful(0n),
        10n,
      );
    }).to.throw("invalid claim authorization");

    const inclusive = modelWithOneDraw();

    inclusive.beginClaim(
      RELAYER,
      authorization({
        expiry: 10n,
      }),
      ALICE,
      successful(0n),
      10n,
    );

    expect(inclusive.nextClaimNonce(ALICE)).to.equal(1n);
  });

  it("copies frozen historical identity and maintains multi-draw solvency while direct donations stay unaccounted", function () {
    const mutableInput = {
      slotIndex: 3n,
      participant: ALICE,
      registrationVersion: 2n,
      reservationNonce: 19n,
      initialized: true,
      beneficiaryBound: true,
      residual: 100n,
    };

    const model = new Gate1C2CClaimAuthorizationModel(CHAIN_ID, RESERVE, POOL);

    model.fundReserve(150n);
    model.directDonation(1_000n);

    model.addClaimableDraw(7n, 100n, 100n, [mutableInput]);

    model.addClaimableDraw(8n, 50n, 50n, [
      {
        slotIndex: 1n,
        participant: BOB,
        registrationVersion: 5n,
        reservationNonce: 29n,
        initialized: true,
        beneficiaryBound: true,
        residual: 50n,
      },
    ]);

    mutableInput.participant = BOB;
    mutableInput.registrationVersion = 999n;
    mutableInput.reservationNonce = 888n;

    expect(model.entitlement(7n, 3n).participant).to.equal(ALICE);

    expect(model.entitlement(7n, 3n).registrationVersion).to.equal(2n);

    expect(model.entitlement(7n, 3n).reservationNonce).to.equal(19n);

    model.beginClaim(RELAYER, authorization(), ALICE, successful(40n), 10n);

    model.settleClaim(7n, model.currentProofContext(7n), false, 11n);

    model.beginClaim(
      RELAYER,
      authorization({
        drawId: 8n,
        slotIndex: 1n,
        participant: BOB,
        recipient: BOB,
        registrationVersion: 5n,
        reservationNonce: 29n,
        nonce: 0n,
      }),
      BOB,
      successful(50n),
      12n,
    );

    model.settleClaim(8n, model.currentProofContext(8n), true, 13n);

    expect(model.snapshot(7n).assignedTotal).to.equal(100n);

    expect(model.snapshot(8n).assignedTotal).to.equal(50n);

    expect(model.accountedReserveAssets).to.equal(60n);

    expect(model.outstandingPrizeLiabilities).to.equal(60n);

    expect(model.rawTokenBalance).to.equal(1_060n);

    model.assertSolvent();
  });

  it("binds a validated historical-owner signature to every exact authorization field", function () {
    const mutations: Gate1C2CClaimAuthorization[] = [
      authorization({ chainId: 1n }),
      authorization({ reserve: "other-reserve" }),
      authorization({ pool: "other-pool" }),
      authorization({ drawId: 8n }),
      authorization({ slotIndex: 4n }),
      authorization({ participant: BOB }),
      authorization({ recipient: BOB }),
      authorization({ registrationVersion: 3n }),
      authorization({ reservationNonce: 20n }),
      authorization({ nonce: 1n }),
      authorization({ expiry: 999n }),
    ];

    for (const signedAuthorization of mutations) {
      const model = modelWithOneDraw();

      expect(() => {
        model.beginClaim(RELAYER, authorization(), ALICE, successful(0n), 10n, signedAuthorization);
      }).to.throw("signed authorization payload mismatch");

      expect(model.nextClaimNonce(ALICE)).to.equal(0n);

      expect(model.snapshot(7n).remaining).to.equal(100n);

      expect(model.entitlement(7n, 3n).residual).to.equal(100n);

      expect(model.accountedReserveAssets).to.equal(100n);

      expect(model.outstandingPrizeLiabilities).to.equal(100n);
    }
  });

  it("rejects cross-draw and cross-slot reuse of an otherwise valid historical-owner signature", function () {
    const crossDraw = new Gate1C2CClaimAuthorizationModel(CHAIN_ID, RESERVE, POOL);

    crossDraw.fundReserve(200n);

    crossDraw.addClaimableDraw(7n, 100n, 100n, [winner()]);

    crossDraw.addClaimableDraw(8n, 100n, 100n, [winner()]);

    const signedForDrawSeven = authorization();

    const submittedForDrawEight = authorization({
      drawId: 8n,
    });

    expect(() => {
      crossDraw.beginClaim(
        RELAYER,
        submittedForDrawEight,
        ALICE,
        successful(0n),
        10n,
        signedForDrawSeven,
      );
    }).to.throw("signed authorization payload mismatch");

    expect(crossDraw.snapshot(7n).remaining).to.equal(100n);

    expect(crossDraw.snapshot(8n).remaining).to.equal(100n);

    expect(crossDraw.nextClaimNonce(ALICE)).to.equal(0n);

    const crossSlot = new Gate1C2CClaimAuthorizationModel(CHAIN_ID, RESERVE, POOL);

    crossSlot.fundReserve(100n);

    crossSlot.addClaimableDraw(7n, 100n, 200n, [
      winner(),
      {
        slotIndex: 4n,
        participant: ALICE,
        registrationVersion: 2n,
        reservationNonce: 19n,
        initialized: true,
        beneficiaryBound: true,
        residual: 100n,
      },
    ]);

    const signedForSlotThree = authorization();

    const submittedForSlotFour = authorization({
      slotIndex: 4n,
    });

    expect(() => {
      crossSlot.beginClaim(
        RELAYER,
        submittedForSlotFour,
        ALICE,
        successful(0n),
        10n,
        signedForSlotThree,
      );
    }).to.throw("signed authorization payload mismatch");

    expect(crossSlot.snapshot(7n).remaining).to.equal(100n);

    expect(crossSlot.entitlement(7n, 3n).residual).to.equal(100n);

    expect(crossSlot.entitlement(7n, 4n).residual).to.equal(100n);

    expect(crossSlot.nextClaimNonce(ALICE)).to.equal(0n);
  });
});
