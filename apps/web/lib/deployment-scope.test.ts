import assert from "node:assert/strict";
import test from "node:test";

import {
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_SEPOLIA_DEPLOYMENT,
} from "@veilpot/protocol-sdk";

import {
  createExactActionAttempt,
  createExactActionReview,
  exactActionAttemptMatchesScope,
  exactActionDestinationAllowed,
  exactActionStorageKey,
} from "./exact-action";
import {
  VEILPOT_V1_EXACT_ACTION_SCOPE,
  VEILPOT_V2_EXACT_ACTION_SCOPE,
  v2SaveStorageKeys,
} from "./deployment-scope";

const USER = "0x1111111111111111111111111111111111111111" as const;

void test("preserves the exact historical V1 exact-action storage key", () => {
  assert.equal(
    exactActionStorageKey(VEILPOT_V1_EXACT_ACTION_SCOPE, USER),
    `veilpot:exact-action:unresolved:v1:${String(
      VEILPOT_SEPOLIA_DEPLOYMENT.chainId,
    )}:${USER.toLowerCase()}`,
  );
});

void test("creates a distinct V2 exact-action namespace rooted in PoolV2", () => {
  const v1 = exactActionStorageKey(VEILPOT_V1_EXACT_ACTION_SCOPE, USER);

  const v2 = exactActionStorageKey(VEILPOT_V2_EXACT_ACTION_SCOPE, USER);

  assert.notEqual(v1, v2);

  assert.equal(
    v2,
    `veilpot:exact-action:unresolved:v2:${String(
      VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
    )}:${VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase()}:${USER.toLowerCase()}`,
  );
});

void test("scopes every M4 Save persistence key to V2", () => {
  const keys = v2SaveStorageKeys(USER);
  const chainId = String(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId);
  const pool = VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase();
  const token = VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase();
  const owner = USER.toLowerCase();

  assert.equal(keys.exactAction, `veilpot:exact-action:unresolved:v2:${chainId}:${pool}:${owner}`);

  assert.equal(
    keys.operatorApproval,
    `veilpot:operator-approval:unresolved:v2:${chainId}:${token}:${pool}:${owner}`,
  );

  assert.equal(keys.deposit, `veilpot:deposit:unresolved:v2:${chainId}:${pool}:${owner}`);

  assert.equal(
    keys.thresholdSettlement,
    `veilpot:threshold-settlement:unresolved:v2:${chainId}:${pool}:${owner}`,
  );
});

void test("allows active V2 destinations and rejects the historical V1 Pool", () => {
  assert.equal(
    exactActionDestinationAllowed(
      VEILPOT_V2_EXACT_ACTION_SCOPE,
      VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    ),
    true,
  );

  assert.equal(
    exactActionDestinationAllowed(
      VEILPOT_V2_EXACT_ACTION_SCOPE,
      VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    ),
    true,
  );

  assert.equal(
    exactActionDestinationAllowed(
      VEILPOT_V2_EXACT_ACTION_SCOPE,
      VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
    ),
    true,
  );

  assert.equal(
    exactActionDestinationAllowed(VEILPOT_V2_EXACT_ACTION_SCOPE, VEILPOT_SEPOLIA_DEPLOYMENT.pool),
    false,
  );
});

void test("rejects stale V1, wrong-wallet and wrong-chain attempts from V2 scope", () => {
  const review = createExactActionReview({
    key: "m4-v2-withdrawal",
    label: "M4 V2 withdrawal",
    consequence: "Test V2 deployment scoping.",
    sender: USER,
    to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    data: `0x${"12".repeat(40)}`,
    value: 0n,
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
    accountNonce: 1,
    preparedAt: 1_700_000_000,
  });

  const attempt = createExactActionAttempt(review, null);

  assert.equal(exactActionAttemptMatchesScope(attempt, VEILPOT_V2_EXACT_ACTION_SCOPE, USER), true);

  assert.equal(
    exactActionAttemptMatchesScope(
      {
        ...attempt,
        to: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
      },
      VEILPOT_V2_EXACT_ACTION_SCOPE,
      USER,
    ),
    false,
  );

  assert.equal(
    exactActionAttemptMatchesScope(
      attempt,
      VEILPOT_V2_EXACT_ACTION_SCOPE,
      "0x2222222222222222222222222222222222222222",
    ),
    false,
  );

  assert.equal(
    exactActionAttemptMatchesScope(
      {
        ...attempt,
        chainId: 1,
      },
      VEILPOT_V2_EXACT_ACTION_SCOPE,
      USER,
    ),
    false,
  );
});
