import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_STATE,
  PENDING_ACTIVATION_STATE,
  THRESHOLD_REVIEW_MAX_AGE_SECONDS,
  createThresholdSettlementReview,
  createThresholdSubmissionRecord,
  parsePublicBoolean,
  parseThresholdSubmissionRecord,
  serializeThresholdSubmissionRecord,
  thresholdReviewInvalidReason,
  thresholdSettlementTransactionInvalidReason,
  withThresholdSubmissionHash,
  type ThresholdAddress,
  type ThresholdHex,
  type ThresholdParticipantBinding,
  type ThresholdReviewContext,
} from "./threshold-settlement";

const HOLDER: ThresholdAddress = "0x1f87Ae197af539253978d435aD45cCf28Fb95024";
const POOL: ThresholdAddress = "0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601";

function repeatedHex(byte: string, count: number): ThresholdHex {
  const value = `0x${byte.repeat(count)}`;
  if (!value.startsWith("0x")) throw new Error("invalid test hex");
  return value as ThresholdHex;
}

const HANDLE = repeatedHex("11", 32);
const PROOF = repeatedHex("22", 65);
const CALLDATA = repeatedHex("33", 160);

const participant: ThresholdParticipantBinding = {
  slotIndex: 1n,
  state: PENDING_ACTIVATION_STATE,
  owner: HOLDER,
  registrationVersion: 1n,
  reservationNonce: 3n,
  activationDeadline: 2_000_000_000n,
};

function review() {
  return createThresholdSettlementReview({
    holder: HOLDER,
    pool: POOL,
    chainId: 11155111,
    participant,
    thresholdHandle: HANDLE,
    clearSatisfied: true,
    decryptionProof: PROOF,
    calldata: CALLDATA,
    accountNonce: 522,
    preparedAt: 1_900_000_000,
    simulatedAt: 1_900_000_001,
  });
}

void test("canonical public boolean parsing is strict", () => {
  assert.equal(parsePublicBoolean(true), true);
  assert.equal(parsePublicBoolean(false), false);
  assert.equal(parsePublicBoolean(1n), true);
  assert.equal(parsePublicBoolean(0n), false);
  assert.equal(parsePublicBoolean("true"), true);
  assert.equal(parsePublicBoolean("0"), false);
  assert.throws(() => parsePublicBoolean(2n));
});

void test("review freezes exact pending-activation and proof transaction identity", () => {
  const value = review();
  assert.equal(value.participant.state, PENDING_ACTIVATION_STATE);
  assert.equal(value.participant.slotIndex, 1n);
  assert.equal(value.participant.registrationVersion, 1n);
  assert.equal(value.participant.reservationNonce, 3n);
  assert.equal(value.clearSatisfied, true);
  assert.equal(value.accountNonce, 522);
});

void test("wallet, state, handle, nonce, calldata, and deadline changes fail closed", () => {
  const value = review();
  const context: ThresholdReviewContext = {
    holder: HOLDER,
    chainId: 11155111,
    participant,
    thresholdHandle: HANDLE,
    currentCalldata: CALLDATA,
    accountNonce: 522,
    nowSeconds: value.preparedAt + 1,
  };

  assert.equal(thresholdReviewInvalidReason(value, context), null);
  assert.match(
    thresholdReviewInvalidReason(value, {
      ...context,
      participant: { ...participant, state: ACTIVE_STATE },
    }) ?? "",
    /binding changed/i,
  );
  assert.match(
    thresholdReviewInvalidReason(value, {
      ...context,
      thresholdHandle: repeatedHex("44", 32),
    }) ?? "",
    /handle changed/i,
  );
  assert.match(
    thresholdReviewInvalidReason(value, { ...context, accountNonce: 523 }) ?? "",
    /nonce changed/i,
  );
  assert.match(
    thresholdReviewInvalidReason(value, {
      ...context,
      currentCalldata: repeatedHex("55", 160),
    }) ?? "",
    /calldata changed/i,
  );
});

void test("review becomes stale after five minutes", () => {
  const value = review();
  const context: ThresholdReviewContext = {
    holder: HOLDER,
    chainId: 11155111,
    participant,
    thresholdHandle: HANDLE,
    currentCalldata: CALLDATA,
    accountNonce: 522,
    nowSeconds: value.preparedAt + THRESHOLD_REVIEW_MAX_AGE_SECONDS + 1,
  };
  assert.match(thresholdReviewInvalidReason(value, context) ?? "", /stale/i);
});

void test("submission record round-trips without storing any confidential amount", () => {
  const value = review();
  const pending = createThresholdSubmissionRecord(value, null);
  const serialized = serializeThresholdSubmissionRecord(pending);
  const json = JSON.parse(serialized) as Record<string, unknown>;
  assert.equal("amount" in json, false);
  assert.equal("pendingAmount" in json, false);
  assert.deepEqual(parseThresholdSubmissionRecord(serialized), pending);

  const hash = repeatedHex("66", 32);
  const submitted = withThresholdSubmissionHash(pending, hash);
  assert.equal(
    parseThresholdSubmissionRecord(serializeThresholdSubmissionRecord(submitted))?.hash,
    hash,
  );
});

void test("exact mined settlement identity requires sender, Pool, calldata, nonce, and zero ETH", () => {
  const value = review();
  const record = createThresholdSubmissionRecord(value, repeatedHex("77", 32));

  assert.equal(
    thresholdSettlementTransactionInvalidReason(record, {
      from: HOLDER,
      to: POOL,
      input: CALLDATA,
      nonce: 522,
      value: 0n,
    }),
    null,
  );

  assert.match(
    thresholdSettlementTransactionInvalidReason(record, {
      from: HOLDER,
      to: POOL,
      input: CALLDATA,
      nonce: 523,
      value: 0n,
    }) ?? "",
    /nonce/i,
  );
});
