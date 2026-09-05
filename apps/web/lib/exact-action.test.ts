import assert from "node:assert/strict";
import test from "node:test";

import {
  EXACT_ACTION_REVIEW_MAX_AGE_SECONDS,
  createExactActionAttempt,
  createExactActionReview,
  exactActionReviewInvalidReason,
  exactActionTransactionInvalidReason,
  isExplicitWalletRejection,
  parseExactActionAttempt,
  serializeExactActionAttempt,
  withExactActionHash,
} from "./exact-action";

const SENDER = "0x1f87Ae197af539253978d435aD45cCf28Fb95024" as const;
const TO = "0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601" as const;
const DATA: `0x${string}` = `0x${"12".repeat(80)}`;

function review() {
  return createExactActionReview({
    key: "bond-withdrawal",
    label: "Withdraw exact registration bond credit",
    consequence: "Return the public pull-refund credit to the authenticated wallet.",
    sender: SENDER,
    to: TO,
    data: DATA,
    value: 0n,
    chainId: 11155111,
    accountNonce: 523,
    preparedAt: 1_900_000_000,
  });
}

void test("exact review freezes sender, destination, calldata, nonce and value", () => {
  const value = review();
  assert.equal(value.sender, SENDER);
  assert.equal(value.to, TO);
  assert.equal(value.accountNonce, 523);
  assert.equal(value.value, 0n);
});

void test("stale or changed transaction context fails closed", () => {
  const value = review();
  const base = {
    sender: SENDER,
    chainId: 11155111,
    accountNonce: 523,
    nowSeconds: value.preparedAt + 1,
    to: TO,
    data: DATA,
    value: 0n,
  };
  assert.equal(exactActionReviewInvalidReason(value, base), null);
  assert.match(
    exactActionReviewInvalidReason(value, { ...base, accountNonce: 524 }) ?? "",
    /nonce/i,
  );
  assert.match(
    exactActionReviewInvalidReason(value, {
      ...base,
      nowSeconds: value.preparedAt + EXACT_ACTION_REVIEW_MAX_AGE_SECONDS + 1,
    }) ?? "",
    /stale/i,
  );
});

void test("attempt persistence round-trips exact raw identity", () => {
  const pending = createExactActionAttempt(review(), null);
  assert.deepEqual(parseExactActionAttempt(serializeExactActionAttempt(pending)), pending);
  const submitted = withExactActionHash(pending, `0x${"ab".repeat(32)}`);
  assert.equal(
    parseExactActionAttempt(serializeExactActionAttempt(submitted))?.hash,
    submitted.hash,
  );
});

void test("mined identity requires exact sender, destination, calldata, nonce and value", () => {
  const attempt = createExactActionAttempt(review(), `0x${"ab".repeat(32)}`);
  assert.equal(
    exactActionTransactionInvalidReason(attempt, {
      from: SENDER,
      to: TO,
      input: DATA,
      nonce: 523,
      value: 0n,
    }),
    null,
  );
  assert.match(
    exactActionTransactionInvalidReason(attempt, {
      from: SENDER,
      to: TO,
      input: DATA,
      nonce: 524,
      value: 0n,
    }) ?? "",
    /nonce/i,
  );
});

void test("only an explicit wallet rejection can conclusively clear a no-hash attempt", () => {
  assert.equal(isExplicitWalletRejection({ code: 4001 }), true);
  assert.equal(
    isExplicitWalletRejection({
      name: "TransactionExecutionError",
      cause: { name: "UserRejectedRequestError", code: 4001 },
    }),
    true,
  );
  assert.equal(isExplicitWalletRejection({ code: -32000 }), false);
  assert.equal(isExplicitWalletRejection(new Error("User rejected something")), false);
  assert.equal(isExplicitWalletRejection(null), false);
});
