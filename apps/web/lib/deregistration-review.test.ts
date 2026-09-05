import assert from "node:assert/strict";
import test from "node:test";

import {
  DEREGISTRATION_REVIEW_MAX_AGE_SECONDS,
  createDeregistrationSettlementReview,
  deregistrationReviewInvalidReason,
  type DeregistrationAddress,
  type DeregistrationParticipantBinding,
} from "./deregistration-review";

const HOLDER = "0x1f87Ae197af539253978d435aD45cCf28Fb95024" as DeregistrationAddress;

const OTHER = "0x1111111111111111111111111111111111111111" as DeregistrationAddress;

const POOL = "0x0482DfAeCB4b3B76b9Efd4dEF261445D7bcCFcDA" as DeregistrationAddress;

const OLD_POOL = "0x6F74fCadDc359159D0799fc9054642aB1f357161" as DeregistrationAddress;

function isHexFixture(value: string): value is `0x${string}` {
  return /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function hexFixture(value: string): `0x${string}` {
  if (!isHexFixture(value)) {
    throw new Error(
      "Deregistration test fixture must be a non-empty even-length 0x-prefixed hex value.",
    );
  }

  return value;
}

const ZERO_HANDLE = hexFixture(`0x${"11".repeat(32)}`);

const PROOF = hexFixture(`0x${"22".repeat(96)}`);

const CALLDATA = hexFixture(`0x${"33".repeat(160)}`);

const participant: DeregistrationParticipantBinding = {
  slotIndex: 7n,
  state: 3,
  owner: HOLDER,
  registrationVersion: 1n,
  reservationNonce: 42n,
};

function review() {
  return createDeregistrationSettlementReview({
    holder: HOLDER,
    pool: POOL,
    chainId: 11155111,
    participant,
    zeroHandle: ZERO_HANDLE,
    clearZero: true,
    decryptionProof: PROOF,
    calldata: CALLDATA,
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
    zeroHandle: value.zeroHandle,
    currentCalldata: value.calldata,
    accountNonce: value.accountNonce,
    nowSeconds: value.preparedAt + 1,
  };
}

void test("freezes the exact ACTIVE V2.x zero-principal settlement identity", () => {
  const value = review();

  assert.equal(value.holder, HOLDER);

  assert.equal(value.pool, POOL);

  assert.equal(value.participant.slotIndex, 7n);

  assert.equal(value.participant.state, 3);

  assert.equal(value.participant.registrationVersion, 1n);

  assert.equal(value.participant.reservationNonce, 42n);

  assert.equal(value.zeroHandle, ZERO_HANDLE);

  assert.equal(value.clearZero, true);

  assert.equal(value.accountNonce, 536);
});

void test("never creates a settlement review from a FALSE public zero consequence", () => {
  assert.throws(() =>
    createDeregistrationSettlementReview({
      ...review(),
      clearZero: false,
    }),
  );
});

void test("rejects non-ACTIVE, wrong-owner and unsupported registrations", () => {
  assert.throws(() =>
    createDeregistrationSettlementReview({
      ...review(),
      participant: {
        ...participant,
        state: 2,
      },
    }),
  );

  assert.throws(() =>
    createDeregistrationSettlementReview({
      ...review(),
      participant: {
        ...participant,
        owner: OTHER,
      },
    }),
  );

  assert.throws(() =>
    createDeregistrationSettlementReview({
      ...review(),
      participant: {
        ...participant,
        registrationVersion: 2n,
      },
    }),
  );
});

void test("fails closed when wallet, Pool or participant binding moves", () => {
  const value = review();
  const valid = context(value);

  assert.equal(deregistrationReviewInvalidReason(value, valid), null);

  assert.match(
    deregistrationReviewInvalidReason(value, {
      ...valid,
      holder: OTHER,
    }) ?? "",
    /wallet changed/i,
  );

  assert.match(
    deregistrationReviewInvalidReason(value, {
      ...valid,
      pool: OLD_POOL,
    }) ?? "",
    /deployment changed/i,
  );

  assert.match(
    deregistrationReviewInvalidReason(value, {
      ...valid,
      participant: {
        ...participant,
        reservationNonce: 43n,
      },
    }) ?? "",
    /participant binding/i,
  );
});

void test("invalidates a proof review when the zero handle changes", () => {
  const value = review();
  const valid = context(value);

  assert.match(
    deregistrationReviewInvalidReason(value, {
      ...valid,
      zeroHandle: `0x${"44".repeat(32)}`,
    }) ?? "",
    /zero handle changed/i,
  );
});

void test("invalidates changed calldata, wallet nonce and stale time", () => {
  const value = review();
  const valid = context(value);

  assert.match(
    deregistrationReviewInvalidReason(value, {
      ...valid,
      currentCalldata: `0x${"55".repeat(160)}`,
    }) ?? "",
    /calldata changed/i,
  );

  assert.match(
    deregistrationReviewInvalidReason(value, {
      ...valid,
      accountNonce: value.accountNonce + 1,
    }) ?? "",
    /transaction nonce/i,
  );

  assert.match(
    deregistrationReviewInvalidReason(value, {
      ...valid,
      nowSeconds: value.preparedAt + DEREGISTRATION_REVIEW_MAX_AGE_SECONDS + 1,
    }) ?? "",
    /stale/i,
  );

  assert.match(
    deregistrationReviewInvalidReason(value, {
      ...valid,
      nowSeconds: value.preparedAt - 1,
    }) ?? "",
    /clock moved backwards/i,
  );
});
