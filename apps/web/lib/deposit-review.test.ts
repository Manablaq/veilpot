import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPOSIT_REVIEW_MAX_AGE_SECONDS,
  MAX_REGISTRATION_DEPOSIT_BASE_UNITS,
  MIN_REGISTRATION_DEPOSIT_BASE_UNITS,
  RESERVED_PARTICIPANT_STATE,
  createDepositReview,
  createDepositSubmissionRecord,
  depositReviewInvalidReason,
  depositTransactionInvalidReason,
  parseDepositSubmissionRecord,
  serializeDepositSubmissionRecord,
  withDepositSubmissionHash,
  type DepositAddress,
} from "./deposit-review";

const HOLDER = "0x1f87Ae197af539253978d435aD45cCf28Fb95024" as DepositAddress;
const TOKEN = "0x4E7B06D78965594eB5EF5414c357ca21E1554491" as DepositAddress;
const POOL = "0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601" as DepositAddress;
const CHAIN_ID = 11155111;

const participant = {
  slotIndex: 1n,
  state: RESERVED_PARTICIPANT_STATE,
  owner: HOLDER,
  registrationVersion: 1n,
  reservationNonce: 3n,
  reservationExpiry: 2_000_000_000n,
  bondHeld: true,
};

function review() {
  return createDepositReview({
    holder: HOLDER,
    token: TOKEN,
    pool: POOL,
    chainId: CHAIN_ID,
    participant,
    amountBaseUnits: 10_000_000n,
    amountDisplay: "10.00",
    tokenSymbol: "cUSDTMock",
    tokenDecimals: 6,
    depositNonce: 2n,
    accountNonce: 519,
    encryptedValue: `0x${"11".repeat(32)}`,
    inputProof: `0x${"22".repeat(96)}`,
    calldata: `0x${"33".repeat(128)}`,
    preparedAt: 1_900_000_000,
    simulatedAt: 1_900_000_001,
  });
}

void test("exact registration deposit bounds are enforced", () => {
  assert.equal(MIN_REGISTRATION_DEPOSIT_BASE_UNITS, 1_000_000n);
  assert.equal(MAX_REGISTRATION_DEPOSIT_BASE_UNITS, 1_000_000_000_000n);

  assert.throws(() =>
    createDepositReview({
      ...review(),
      amountBaseUnits: MIN_REGISTRATION_DEPOSIT_BASE_UNITS - 1n,
    }),
  );
});

void test("review freezes exact user, deployment, participant, amount, nonces, and calldata", () => {
  const value = review();
  assert.equal(value.holder, HOLDER);
  assert.equal(value.token, TOKEN);
  assert.equal(value.pool, POOL);
  assert.equal(value.chainId, CHAIN_ID);
  assert.equal(value.amountBaseUnits, 10_000_000n);
  assert.equal(value.depositNonce, 2n);
  assert.equal(value.accountNonce, 519);
  assert.equal(value.participant.slotIndex, 1n);
  assert.ok(value.calldata.startsWith("0x"));
});

void test("wallet, amount, operator, participant, deposit nonce, account nonce, and calldata changes fail closed", () => {
  const value = review();
  const context = {
    holder: HOLDER,
    chainId: CHAIN_ID,
    participant,
    amountBaseUnits: 10_000_000n,
    depositNonce: 2n,
    accountNonce: 519,
    operatorActive: true,
    currentCalldata: value.calldata,
    nowSeconds: value.preparedAt + 1,
  };

  assert.equal(depositReviewInvalidReason(value, context), null);
  assert.match(
    depositReviewInvalidReason(value, { ...context, amountBaseUnits: 11_000_000n }) ?? "",
    /amount changed/i,
  );
  assert.match(
    depositReviewInvalidReason(value, { ...context, operatorActive: false }) ?? "",
    /operator permission/i,
  );
  assert.match(
    depositReviewInvalidReason(value, { ...context, depositNonce: 3n }) ?? "",
    /deposit nonce/i,
  );
  assert.match(
    depositReviewInvalidReason(value, { ...context, accountNonce: 520 }) ?? "",
    /transaction nonce/i,
  );
  assert.match(
    depositReviewInvalidReason(value, {
      ...context,
      currentCalldata: `0x${"44".repeat(128)}`,
    }) ?? "",
    /calldata changed/i,
  );
});

void test("review expires after five minutes without silently replacing encrypted input", () => {
  const value = review();
  const reason = depositReviewInvalidReason(value, {
    holder: HOLDER,
    chainId: CHAIN_ID,
    participant,
    amountBaseUnits: 10_000_000n,
    depositNonce: 2n,
    accountNonce: 519,
    operatorActive: true,
    currentCalldata: value.calldata,
    nowSeconds: value.preparedAt + DEPOSIT_REVIEW_MAX_AGE_SECONDS + 1,
  });
  assert.match(reason ?? "", /stale/i);
});

void test("unresolved submission persistence contains no plaintext amount and round-trips", () => {
  const value = review();
  const pending = createDepositSubmissionRecord(value, null);
  const serialized = serializeDepositSubmissionRecord(pending);
  const json = JSON.parse(serialized) as Record<string, unknown>;

  assert.equal("amountDisplay" in json, false);
  assert.equal("amountBaseUnits" in json, false);
  assert.deepEqual(parseDepositSubmissionRecord(serialized), pending);

  const hash = "0x5555555555555555555555555555555555555555555555555555555555555555";
  const submitted = withDepositSubmissionHash(pending, hash);
  assert.equal(
    parseDepositSubmissionRecord(serializeDepositSubmissionRecord(submitted))?.hash,
    hash,
  );
});

void test("exact mined identity requires reviewed sender, Pool, calldata, nonce, and zero native ETH", () => {
  const value = review();
  const record = createDepositSubmissionRecord(value, `0x${"66".repeat(32)}`);

  assert.equal(
    depositTransactionInvalidReason(record, {
      from: HOLDER,
      to: POOL,
      input: value.calldata,
      nonce: 519,
      value: 0n,
    }),
    null,
  );

  assert.match(
    depositTransactionInvalidReason(record, {
      from: HOLDER,
      to: POOL,
      input: value.calldata,
      nonce: 520,
      value: 0n,
    }) ?? "",
    /nonce/i,
  );
});
