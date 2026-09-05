import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_WITHDRAWAL_REQUEST_BASE_UNITS,
  WITHDRAWAL_REVIEW_MAX_AGE_SECONDS,
  createWithdrawalReview,
  withdrawalReviewInvalidReason,
  type WithdrawalAddress,
  type WithdrawalParticipantBinding,
} from "./withdrawal-review";

const HOLDER = "0x1f87Ae197af539253978d435aD45cCf28Fb95024" as WithdrawalAddress;
const OTHER = "0x1111111111111111111111111111111111111111" as WithdrawalAddress;
const POOL = "0x6F74fCadDc359159D0799fc9054642aB1f357161" as WithdrawalAddress;
const WRONG_POOL = "0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601" as WithdrawalAddress;
const CHAIN_ID = 11155111;

const participant: WithdrawalParticipantBinding = {
  slotIndex: 4n,
  state: 3,
  owner: HOLDER,
  registrationVersion: 1n,
  reservationNonce: 9n,
};

function review() {
  return createWithdrawalReview({
    holder: HOLDER,
    pool: POOL,
    chainId: CHAIN_ID,
    participant,
    amountBaseUnits: 25_000_000n,
    amountDisplay: "25.000000",
    tokenSymbol: "cUSDT",
    tokenDecimals: 6,
    withdrawalNonce: 7n,
    accountNonce: 524,
    encryptedValue: `0x${"11".repeat(32)}`,
    inputProof: `0x${"22".repeat(96)}`,
    calldata: `0x${"33".repeat(160)}`,
    preparedAt: 1_900_000_000,
    simulatedAt: 1_900_000_001,
  });
}

function validContext(value = review()) {
  return {
    holder: HOLDER,
    pool: POOL,
    chainId: CHAIN_ID,
    participant,
    amountBaseUnits: value.amountBaseUnits,
    withdrawalNonce: value.withdrawalNonce,
    accountNonce: value.accountNonce,
    currentCalldata: value.calldata,
    nowSeconds: value.preparedAt + 1,
  };
}

void test("freezes the exact ACTIVE V2 withdrawal identity", () => {
  const value = review();

  assert.equal(value.holder, HOLDER);
  assert.equal(value.pool, POOL);
  assert.equal(value.chainId, CHAIN_ID);
  assert.equal(value.participant.slotIndex, 4n);
  assert.equal(value.participant.state, 3);
  assert.equal(value.participant.registrationVersion, 1n);
  assert.equal(value.participant.reservationNonce, 9n);
  assert.equal(value.amountBaseUnits, 25_000_000n);
  assert.equal(value.withdrawalNonce, 7n);
  assert.equal(value.accountNonce, 524);
  assert.equal(value.network, "Ethereum Sepolia");
});

void test("accepts only positive euint64-compatible withdrawal requests", () => {
  assert.equal(MAX_WITHDRAWAL_REQUEST_BASE_UNITS, (1n << 64n) - 1n);

  assert.throws(() =>
    createWithdrawalReview({
      ...review(),
      amountBaseUnits: 0n,
    }),
  );

  assert.throws(() =>
    createWithdrawalReview({
      ...review(),
      amountBaseUnits: MAX_WITHDRAWAL_REQUEST_BASE_UNITS + 1n,
    }),
  );
});

void test("rejects non-ACTIVE, wrong-owner and unsupported registration bindings", () => {
  assert.throws(() =>
    createWithdrawalReview({
      ...review(),
      participant: {
        ...participant,
        state: 1,
      },
    }),
  );

  assert.throws(() =>
    createWithdrawalReview({
      ...review(),
      participant: {
        ...participant,
        owner: OTHER,
      },
    }),
  );

  assert.throws(() =>
    createWithdrawalReview({
      ...review(),
      participant: {
        ...participant,
        registrationVersion: 2n,
      },
    }),
  );
});

void test("wallet, Pool, participant, amount and both nonces fail closed before wallet opening", () => {
  const value = review();
  const context = validContext(value);

  assert.equal(withdrawalReviewInvalidReason(value, context), null);

  assert.match(
    withdrawalReviewInvalidReason(value, {
      ...context,
      holder: OTHER,
    }) ?? "",
    /wallet changed/i,
  );

  assert.match(
    withdrawalReviewInvalidReason(value, {
      ...context,
      pool: WRONG_POOL,
    }) ?? "",
    /deployment changed/i,
  );

  assert.match(
    withdrawalReviewInvalidReason(value, {
      ...context,
      participant: {
        ...participant,
        reservationNonce: 10n,
      },
    }) ?? "",
    /participant binding/i,
  );

  assert.match(
    withdrawalReviewInvalidReason(value, {
      ...context,
      amountBaseUnits: value.amountBaseUnits + 1n,
    }) ?? "",
    /amount changed/i,
  );

  assert.match(
    withdrawalReviewInvalidReason(value, {
      ...context,
      withdrawalNonce: value.withdrawalNonce + 1n,
    }) ?? "",
    /withdrawal nonce/i,
  );

  assert.match(
    withdrawalReviewInvalidReason(value, {
      ...context,
      accountNonce: value.accountNonce + 1,
    }) ?? "",
    /transaction nonce/i,
  );
});

void test("changed calldata and stale reviews cannot be reused", () => {
  const value = review();
  const context = validContext(value);

  assert.match(
    withdrawalReviewInvalidReason(value, {
      ...context,
      currentCalldata: `0x${"44".repeat(160)}`,
    }) ?? "",
    /calldata changed/i,
  );

  assert.match(
    withdrawalReviewInvalidReason(value, {
      ...context,
      nowSeconds: value.preparedAt + WITHDRAWAL_REVIEW_MAX_AGE_SECONDS + 1,
    }) ?? "",
    /stale/i,
  );

  assert.match(
    withdrawalReviewInvalidReason(value, {
      ...context,
      nowSeconds: value.preparedAt - 1,
    }) ?? "",
    /clock moved backwards/i,
  );
});
