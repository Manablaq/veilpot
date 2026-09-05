import assert from "node:assert/strict";
import test from "node:test";

import { PARTICIPANT_STATE, SUPPORTED_REGISTRATION_VERSION } from "@veilpot/protocol-sdk";

import {
  REFUND_SETTLEMENT_REVIEW_MAX_AGE_SECONDS,
  createRefundSettlementReview,
  refundSettlementReviewInvalidReason,
  type RecoveryHex,
  type RefundParticipantBinding,
} from "./recovery-review";

const HOLDER = "0x1f87Ae197af539253978d435aD45cCf28Fb95024" as const;

const OTHER = "0x1111111111111111111111111111111111111111" as const;

const POOL = "0x0482DfAeCB4b3B76b9Efd4dEF261445D7bcCFcDA" as const;

const OLD_POOL = "0x6F74fCadDc359159D0799fc9054642aB1f357161" as const;

function isHexFixture(value: string): value is RecoveryHex {
  return /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function hexFixture(value: string): RecoveryHex {
  if (!isHexFixture(value)) {
    throw new Error("Recovery test fixture must be a non-empty even-length 0x-prefixed hex value.");
  }

  return value;
}

const COMPLETE_HANDLE = hexFixture(`0x${"11".repeat(32)}`);

const PROOF = hexFixture(`0x${"22".repeat(96)}`);

const CALLDATA_TRUE = hexFixture(`0x${"33".repeat(160)}`);

const CALLDATA_FALSE = hexFixture(`0x${"44".repeat(160)}`);

const participant: RefundParticipantBinding = {
  slotIndex: 6n,
  state: PARTICIPANT_STATE.REFUND_ATTEMPT_PENDING_PROOF,
  owner: HOLDER,
  registrationVersion: SUPPORTED_REGISTRATION_VERSION,
  reservationNonce: 14n,
  refundAttemptNonce: 3n,
};

function review(clearComplete = true) {
  return createRefundSettlementReview({
    holder: HOLDER,
    pool: POOL,
    chainId: 11155111,
    participant,
    refundCompleteHandle: COMPLETE_HANDLE,
    clearComplete,
    decryptionProof: PROOF,
    calldata: clearComplete ? CALLDATA_TRUE : CALLDATA_FALSE,
    accountNonce: 536,
    preparedAt: 1_900_000_000,
    simulatedAt: 1_900_000_001,
  });
}

function context(value = review()) {
  return {
    holder: HOLDER,
    pool: POOL,
    chainId: 11155111,
    participant,
    refundCompleteHandle: value.refundCompleteHandle,
    currentCalldata: value.calldata,
    accountNonce: value.accountNonce,
    nowSeconds: value.preparedAt + 1,
  };
}

void test("freezes TRUE and FALSE refund-completion consequences without any amount", () => {
  const complete = review(true);
  const incomplete = review(false);

  assert.equal(complete.clearComplete, true);

  assert.equal(incomplete.clearComplete, false);

  assert.equal(complete.participant.refundAttemptNonce, 3n);

  assert.equal(complete.refundCompleteHandle, COMPLETE_HANDLE);

  assert.equal("refundRemaining" in complete, false);
});

void test("rejects wrong lifecycle state, owner, registration version and zero attempt nonce", () => {
  assert.throws(() =>
    createRefundSettlementReview({
      ...review(),
      participant: {
        ...participant,
        state: PARTICIPANT_STATE.PENDING_REFUND,
      },
    }),
  );

  assert.throws(() =>
    createRefundSettlementReview({
      ...review(),
      participant: {
        ...participant,
        owner: OTHER,
      },
    }),
  );

  assert.throws(() =>
    createRefundSettlementReview({
      ...review(),
      participant: {
        ...participant,
        registrationVersion: SUPPORTED_REGISTRATION_VERSION + 1n,
      },
    }),
  );

  assert.throws(() =>
    createRefundSettlementReview({
      ...review(),
      participant: {
        ...participant,
        refundAttemptNonce: 0n,
      },
    }),
  );
});

void test("fails closed when wallet, Pool or refund participant binding changes", () => {
  const value = review();
  const valid = context(value);

  assert.equal(refundSettlementReviewInvalidReason(value, valid), null);

  assert.match(
    refundSettlementReviewInvalidReason(value, {
      ...valid,
      holder: OTHER,
    }) ?? "",
    /wallet changed/i,
  );

  assert.match(
    refundSettlementReviewInvalidReason(value, {
      ...valid,
      pool: OLD_POOL,
    }) ?? "",
    /deployment changed/i,
  );

  assert.match(
    refundSettlementReviewInvalidReason(value, {
      ...valid,
      participant: {
        ...participant,
        refundAttemptNonce: 4n,
      },
    }) ?? "",
    /participant binding/i,
  );
});

void test("invalidates a settlement when the refund-complete handle moves", () => {
  const value = review();
  const valid = context(value);

  assert.match(
    refundSettlementReviewInvalidReason(value, {
      ...valid,
      refundCompleteHandle: hexFixture(`0x${"55".repeat(32)}`),
    }) ?? "",
    /handle changed/i,
  );
});

void test("invalidates changed calldata, wallet nonce and stale time", () => {
  const value = review();
  const valid = context(value);

  assert.match(
    refundSettlementReviewInvalidReason(value, {
      ...valid,
      currentCalldata: hexFixture(`0x${"66".repeat(160)}`),
    }) ?? "",
    /calldata changed/i,
  );

  assert.match(
    refundSettlementReviewInvalidReason(value, {
      ...valid,
      accountNonce: value.accountNonce + 1,
    }) ?? "",
    /transaction nonce/i,
  );

  assert.match(
    refundSettlementReviewInvalidReason(value, {
      ...valid,
      nowSeconds: value.preparedAt + REFUND_SETTLEMENT_REVIEW_MAX_AGE_SECONDS + 1,
    }) ?? "",
    /stale/i,
  );

  assert.match(
    refundSettlementReviewInvalidReason(value, {
      ...valid,
      nowSeconds: value.preparedAt - 1,
    }) ?? "",
    /clock moved backwards/i,
  );
});
