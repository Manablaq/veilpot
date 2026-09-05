import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAIM_AUTHORIZATION_PRIMARY_TYPE,
  CLAIM_AUTHORIZATION_TYPES,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
} from "@veilpot/protocol-sdk";
import type { Address } from "viem";

import {
  PRIZE_V2_STATE,
  V2X_CLAIM_EIP712_DOMAIN,
  YIELD_V2_STATE,
  assertV2xClaimAuthorization,
  buildV2xClaimAuthorization,
  buildV2xClaimTypedData,
  nextChildYieldV2Action,
  nextPrizeV2Action,
  nextRoundYieldV2Action,
  roundReadyForYield,
} from "./prize-v2";
import { VEILDRAW_V2_DRAW_STATE } from "./veildraw-v2";

const SNAPSHOT_ID = 7n;

const FINALIZED_CHILDREN = [
  {
    prizeIndex: 0,
    drawId: 40n,
    snapshotId: SNAPSHOT_ID,
    state: VEILDRAW_V2_DRAW_STATE.FINALIZED,
  },
  {
    prizeIndex: 1,
    drawId: 41n,
    snapshotId: SNAPSHOT_ID,
    state: VEILDRAW_V2_DRAW_STATE.FINALIZED,
  },
  {
    prizeIndex: 2,
    drawId: 42n,
    snapshotId: SNAPSHOT_ID,
    state: VEILDRAW_V2_DRAW_STATE.FINALIZED,
  },
] as const;

const OWNER = "0x1111111111111111111111111111111111111111" as Address;

const OTHER = "0x2222222222222222222222222222222222222222" as Address;

void test("pins the exact corrected V2.x Pool and Prize Reserve", () => {
  assert.equal(
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase(),
    "0x0482dfaecb4b3b76b9efd4def261445d7bccfcda",
  );

  assert.equal(
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve.toLowerCase(),
    "0x553542d5b47b64973d99c04d83991f4ae2b307b2",
  );
});

void test("requires exactly three consecutive finalized child draws before round yield", () => {
  assert.equal(roundReadyForYield(SNAPSHOT_ID, FINALIZED_CHILDREN), true);
  assert.equal(
    nextRoundYieldV2Action(false, SNAPSHOT_ID, FINALIZED_CHILDREN),
    "recognize-round-yield",
  );

  assert.equal(nextRoundYieldV2Action(true, SNAPSHOT_ID, FINALIZED_CHILDREN), null);

  assert.equal(roundReadyForYield(SNAPSHOT_ID, FINALIZED_CHILDREN.slice(0, 2)), false);

  assert.equal(
    roundReadyForYield(SNAPSHOT_ID, [
      FINALIZED_CHILDREN[0],
      {
        ...FINALIZED_CHILDREN[1],
        state: VEILDRAW_V2_DRAW_STATE.WINNER_RESOLUTION,
      },
      FINALIZED_CHILDREN[2],
    ]),
    false,
  );

  assert.equal(
    roundReadyForYield(SNAPSHOT_ID, [
      FINALIZED_CHILDREN[0],
      {
        ...FINALIZED_CHILDREN[1],
        drawId: 99n,
      },
      FINALIZED_CHILDREN[2],
    ]),
    false,
  );

  assert.equal(roundReadyForYield(SNAPSHOT_ID + 1n, FINALIZED_CHILDREN), false);
});

void test("preserves the exact V2 yield proof and sweep progression", () => {
  assert.equal(nextChildYieldV2Action(YIELD_V2_STATE.NONE), null);

  assert.equal(
    nextChildYieldV2Action(YIELD_V2_STATE.RECOGNITION_PROOF_PENDING),
    "settle-recognition",
  );

  assert.equal(nextChildYieldV2Action(YIELD_V2_STATE.RECOGNIZED), "sweep-yield");

  assert.equal(nextChildYieldV2Action(YIELD_V2_STATE.SWEEP_PROOF_PENDING), "settle-sweep");

  assert.equal(nextChildYieldV2Action(YIELD_V2_STATE.FUNDING_FINALIZED), null);
});

void test("does not prepare a prize until its child yield funding is finalized", () => {
  assert.equal(
    nextPrizeV2Action({
      state: PRIZE_V2_STATE.UNPREPARED,
      yieldState: YIELD_V2_STATE.RECOGNIZED,
      participantCount: 12n,
      assignmentCursor: 0n,
      statusProofDeadline: 0n,
      transferProofDeadline: 0n,
      nowSeconds: 100n,
    }),
    null,
  );

  assert.equal(
    nextPrizeV2Action({
      state: PRIZE_V2_STATE.UNPREPARED,
      yieldState: YIELD_V2_STATE.FUNDING_FINALIZED,
      participantCount: 12n,
      assignmentCursor: 0n,
      statusProofDeadline: 0n,
      transferProofDeadline: 0n,
      nowSeconds: 100n,
    }),
    "prepare-prize",
  );
});

void test("keeps inclusive proof deadlines exact and exposes only protocol liveness paths", () => {
  assert.equal(
    nextPrizeV2Action({
      state: PRIZE_V2_STATE.STATUS_PROOF_PENDING,
      yieldState: YIELD_V2_STATE.FUNDING_FINALIZED,
      participantCount: 12n,
      assignmentCursor: 0n,
      statusProofDeadline: 500n,
      transferProofDeadline: 0n,
      nowSeconds: 500n,
    }),
    "settle-prize-status",
  );

  assert.equal(
    nextPrizeV2Action({
      state: PRIZE_V2_STATE.STATUS_PROOF_PENDING,
      yieldState: YIELD_V2_STATE.FUNDING_FINALIZED,
      participantCount: 12n,
      assignmentCursor: 0n,
      statusProofDeadline: 500n,
      transferProofDeadline: 0n,
      nowSeconds: 501n,
    }),
    "refresh-prize-status-evidence",
  );

  assert.equal(
    nextPrizeV2Action({
      state: PRIZE_V2_STATE.TRANSFER_PROOF_PENDING,
      yieldState: YIELD_V2_STATE.FUNDING_FINALIZED,
      participantCount: 12n,
      assignmentCursor: 12n,
      statusProofDeadline: 0n,
      transferProofDeadline: 700n,
      nowSeconds: 700n,
    }),
    "settle-claim-completion",
  );

  assert.equal(
    nextPrizeV2Action({
      state: PRIZE_V2_STATE.TRANSFER_PROOF_PENDING,
      yieldState: YIELD_V2_STATE.FUNDING_FINALIZED,
      participantCount: 12n,
      assignmentCursor: 12n,
      statusProofDeadline: 0n,
      transferProofDeadline: 700n,
      nowSeconds: 701n,
    }),
    "refresh-claim-completion-evidence",
  );
});

void test("fixed entitlement assignment cannot skip or fabricate completion", () => {
  assert.equal(
    nextPrizeV2Action({
      state: PRIZE_V2_STATE.ASSIGNING,
      yieldState: YIELD_V2_STATE.FUNDING_FINALIZED,
      participantCount: 17n,
      assignmentCursor: 8n,
      statusProofDeadline: 0n,
      transferProofDeadline: 0n,
      nowSeconds: 100n,
    }),
    "assign-entitlement-chunk",
  );

  assert.equal(
    nextPrizeV2Action({
      state: PRIZE_V2_STATE.ASSIGNING,
      yieldState: YIELD_V2_STATE.FUNDING_FINALIZED,
      participantCount: 17n,
      assignmentCursor: 17n,
      statusProofDeadline: 0n,
      transferProofDeadline: 0n,
      nowSeconds: 100n,
    }),
    null,
  );

  for (const state of [PRIZE_V2_STATE.CLAIMABLE, PRIZE_V2_STATE.CLAIMED, PRIZE_V2_STATE.NO_PRIZE]) {
    assert.equal(
      nextPrizeV2Action({
        state,
        yieldState: YIELD_V2_STATE.FUNDING_FINALIZED,
        participantCount: 17n,
        assignmentCursor: 17n,
        statusProofDeadline: 0n,
        transferProofDeadline: 0n,
        nowSeconds: 100n,
      }),
      null,
    );
  }
});

void test("builds claims against corrected V2.x while reusing the frozen SDK authorization shape", () => {
  const authorization = buildV2xClaimAuthorization({
    drawId: 40n,
    slotIndex: 3n,
    owner: OWNER,
    registrationVersion: 1n,
    reservationNonce: 9n,
    nonce: 4n,
    expiry: 1_800_000_000n,
  });

  assert.equal(authorization.chainId, BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId));

  assert.equal(
    authorization.reserve.toLowerCase(),
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve.toLowerCase(),
  );

  assert.equal(
    authorization.pool.toLowerCase(),
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase(),
  );

  assert.equal(authorization.participant, OWNER);
  assert.equal(authorization.recipient, OWNER);
  assert.equal(authorization.drawId, 40n);
  assert.equal(authorization.slotIndex, 3n);
  assert.equal(authorization.registrationVersion, 1n);
  assert.equal(authorization.reservationNonce, 9n);
  assert.equal(authorization.nonce, 4n);

  assert.doesNotThrow(() => {
    assertV2xClaimAuthorization(authorization);
  });
});

void test("constructs the exact corrected V2.x EIP-712 domain without using the historical SDK domain", () => {
  const typedData = buildV2xClaimTypedData({
    drawId: 40n,
    slotIndex: 3n,
    owner: OWNER,
    registrationVersion: 1n,
    reservationNonce: 9n,
    nonce: 4n,
    expiry: 1_800_000_000n,
  });

  assert.equal(V2X_CLAIM_EIP712_DOMAIN.name, "VeilpotPrizeReserve");
  assert.equal(V2X_CLAIM_EIP712_DOMAIN.version, "1");

  assert.equal(V2X_CLAIM_EIP712_DOMAIN.chainId, BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId));

  assert.equal(
    V2X_CLAIM_EIP712_DOMAIN.verifyingContract.toLowerCase(),
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve.toLowerCase(),
  );

  assert.equal(typedData.primaryType, CLAIM_AUTHORIZATION_PRIMARY_TYPE);

  assert.equal(typedData.types, CLAIM_AUTHORIZATION_TYPES);

  assert.equal(
    typedData.message.reserve.toLowerCase(),
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve.toLowerCase(),
  );

  assert.equal(
    typedData.message.pool.toLowerCase(),
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase(),
  );
});

void test("rejects claim identity mutation, zero expiry and malformed uint256 fields", () => {
  const authorization = buildV2xClaimAuthorization({
    drawId: 40n,
    slotIndex: 3n,
    owner: OWNER,
    registrationVersion: 1n,
    reservationNonce: 9n,
    nonce: 4n,
    expiry: 1_800_000_000n,
  });

  assert.throws(() => {
    assertV2xClaimAuthorization({
      ...authorization,
      recipient: OTHER,
    });
  }, /historical owner/);

  assert.throws(() => {
    assertV2xClaimAuthorization({
      ...authorization,
      pool: OTHER,
    });
  }, /active corrected V2\.x deployment/);

  assert.throws(
    () =>
      buildV2xClaimAuthorization({
        drawId: 40n,
        slotIndex: 3n,
        owner: OWNER,
        registrationVersion: 1n,
        reservationNonce: 9n,
        nonce: 4n,
        expiry: 0n,
      }),
    /nonzero/,
  );

  assert.throws(
    () =>
      buildV2xClaimAuthorization({
        drawId: 40n,
        slotIndex: 3n,
        owner: OWNER,
        registrationVersion: 1n,
        reservationNonce: 9n,
        nonce: -1n,
        expiry: 1_800_000_000n,
      }),
    /uint256/,
  );
});
