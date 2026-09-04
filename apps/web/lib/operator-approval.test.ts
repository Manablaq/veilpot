import assert from "node:assert/strict";
import test from "node:test";

import { decodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import {
  OPERATOR_APPROVAL_DURATION_SECONDS,
  OPERATOR_APPROVAL_REVIEW_MAX_AGE_SECONDS,
  SET_OPERATOR_SELECTOR,
  createOperatorApprovalReview,
  createOperatorApprovalSubmissionRecord,
  operatorApprovalReviewInvalidReason,
  operatorApprovalTransactionInvalidReason,
  parseOperatorApprovalSubmissionRecord,
  serializeOperatorApprovalSubmissionRecord,
  transactionReceiptStatus,
} from "./operator-approval";

const holder = "0x1f87Ae197af539253978d435aD45cCf28Fb95024" as Address;
const token = "0x4E7B06D78965594eB5EF5414c357ca21E1554491" as Address;
const pool = "0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601" as Address;
const chainId = 11_155_111;
const nowSeconds = 1_800_000_000;

const participant = {
  slotIndex: 1n,
  state: 1,
  owner: holder,
  registrationVersion: 1n,
  reservationNonce: 3n,
  reservationExpiry: BigInt(nowSeconds + 3_600),
  bondHeld: true,
} as const;

function buildReview() {
  return createOperatorApprovalReview({
    holder,
    token,
    operator: pool,
    chainId,
    participant,
    nowSeconds,
  });
}

function validContext(now = nowSeconds + 1) {
  return {
    holder,
    token,
    operator: pool,
    chainId,
    participant,
    nowSeconds: now,
  } as const;
}

void test("review freezes exact Sepolia token, Pool, selector, and 30-minute expiry", () => {
  const review = buildReview();

  assert.equal(review.holder, holder);
  assert.equal(review.token, token);
  assert.equal(review.operator, pool);
  assert.equal(review.chainId, chainId);
  assert.equal(review.network, "Ethereum Sepolia");
  assert.equal(review.selector, SET_OPERATOR_SELECTOR);
  assert.equal(review.until, nowSeconds + OPERATOR_APPROVAL_DURATION_SECONDS);
  assert.equal(review.untilUtc, new Date(review.until * 1000).toISOString());
  assert.equal(Object.isFrozen(review), true);
  assert.equal(Object.isFrozen(review.participant), true);
});

void test("calldata encodes the exact reviewed Pool and exact reviewed uint48 expiry", () => {
  const review = buildReview();
  const abi = parseAbi(["function setOperator(address operator,uint48 until)"]);

  const decoded = decodeFunctionData({
    abi,
    data: review.calldata,
  });

  assert.equal(decoded.functionName, "setOperator");
  assert.equal(decoded.args[0], review.operator);
  assert.equal(decoded.args[1], review.until);
  assert.equal(review.calldata.slice(0, 10), SET_OPERATOR_SELECTOR);
});

void test("review expiry is never silently recomputed and stale reviews fail closed", () => {
  const review = buildReview();
  const frozenUntil = review.until;

  assert.equal(
    operatorApprovalReviewInvalidReason(
      review,
      validContext(nowSeconds + OPERATOR_APPROVAL_REVIEW_MAX_AGE_SECONDS - 1),
    ),
    null,
  );
  assert.equal(review.until, frozenUntil);

  assert.match(
    operatorApprovalReviewInvalidReason(
      review,
      validContext(nowSeconds + OPERATOR_APPROVAL_REVIEW_MAX_AGE_SECONDS),
    ) ?? "",
    /stale/i,
  );
  assert.equal(review.until, frozenUntil);

  assert.match(
    operatorApprovalReviewInvalidReason(review, validContext(review.until)) ?? "",
    /expired/i,
  );
  assert.equal(review.until, frozenUntil);
});

void test("holder, network, token, and Pool changes invalidate the review", () => {
  const review = buildReview();
  const other = "0x0000000000000000000000000000000000000001" as Address;

  assert.match(
    operatorApprovalReviewInvalidReason(review, {
      ...validContext(),
      holder: other,
    }) ?? "",
    /wallet/i,
  );
  assert.match(
    operatorApprovalReviewInvalidReason(review, {
      ...validContext(),
      chainId: 1,
    }) ?? "",
    /network/i,
  );
  assert.match(
    operatorApprovalReviewInvalidReason(review, {
      ...validContext(),
      token: other,
    }) ?? "",
    /token/i,
  );
  assert.match(
    operatorApprovalReviewInvalidReason(review, {
      ...validContext(),
      operator: other,
    }) ?? "",
    /Pool/i,
  );
});

void test("participant binding and reservation expiry invalidate the review", () => {
  const review = buildReview();

  assert.match(
    operatorApprovalReviewInvalidReason(review, {
      ...validContext(),
      participant: {
        ...participant,
        reservationNonce: 4n,
      },
    }) ?? "",
    /registration/i,
  );

  const expiredParticipant = {
    ...participant,
    reservationExpiry: BigInt(nowSeconds),
  };
  const expiredReview = createOperatorApprovalReview({
    holder,
    token,
    operator: pool,
    chainId,
    participant: expiredParticipant,
    nowSeconds: nowSeconds - 10,
  });

  assert.match(
    operatorApprovalReviewInvalidReason(expiredReview, {
      holder,
      token,
      operator: pool,
      chainId,
      participant: expiredParticipant,
      nowSeconds,
    }) ?? "",
    /reservation has expired/i,
  );
});

void test("submission record round-trips without private data and rejects corruption", () => {
  const review = buildReview();
  const hash = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
  const record = createOperatorApprovalSubmissionRecord(review, hash);
  const serialized = serializeOperatorApprovalSubmissionRecord(record);
  const parsed = parseOperatorApprovalSubmissionRecord(serialized);

  assert.deepEqual(parsed, record);
  assert.equal(serialized.includes("pendingAmount"), false);
  assert.equal(serialized.includes("principal"), false);
  assert.equal(serialized.includes("balance"), false);

  const corrupted = JSON.stringify({
    ...JSON.parse(serialized),
    calldata: "0x1234",
  });
  assert.equal(parseOperatorApprovalSubmissionRecord(corrupted), null);
});

void test("exact transaction identity must match holder, token, and frozen calldata", () => {
  const review = buildReview();
  const record = createOperatorApprovalSubmissionRecord(
    review,
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  );

  assert.equal(
    operatorApprovalTransactionInvalidReason(record, {
      from: holder,
      to: token,
      input: review.calldata,
    }),
    null,
  );

  assert.match(
    operatorApprovalTransactionInvalidReason(record, {
      from: "0x0000000000000000000000000000000000000001",
      to: token,
      input: review.calldata,
    }) ?? "",
    /sender/i,
  );
  assert.match(
    operatorApprovalTransactionInvalidReason(record, {
      from: holder,
      to: pool,
      input: review.calldata,
    }) ?? "",
    /target/i,
  );
  assert.match(
    operatorApprovalTransactionInvalidReason(record, {
      from: holder,
      to: token,
      input: "0x1234",
    }) ?? "",
    /calldata/i,
  );
});

void test("receipt status parser never invents success", () => {
  assert.equal(transactionReceiptStatus({ status: "success" }), "success");
  assert.equal(transactionReceiptStatus({ status: "reverted" }), "reverted");
  assert.equal(transactionReceiptStatus({ status: "pending" }), "unknown");
  assert.equal(transactionReceiptStatus(null), "unknown");
});
