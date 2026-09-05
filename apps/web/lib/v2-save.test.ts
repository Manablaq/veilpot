import assert from "node:assert/strict";
import test from "node:test";

import { PARTICIPANT_STATE, SUPPORTED_REGISTRATION_VERSION } from "@veilpot/protocol-sdk";

import {
  v2ParticipantCanDeposit,
  v2BondCreditAvailable,
  v2ParticipantCanAttemptRefund,
  v2ParticipantCanExpireActivation,
  v2ParticipantCanExpireReservation,
  v2ParticipantCanReserve,
  v2ParticipantCanSettleRefund,
  v2ParticipantCanSettleThreshold,
  v2ParticipantCanWithdraw,
  v2SaveLifecycle,
  type V2ParticipantSnapshot,
} from "./v2-save";

const OWNER = "0x1111111111111111111111111111111111111111" as const;

function participant(state: number): V2ParticipantSnapshot {
  return {
    slotIndex: 4n,
    state,
    owner: OWNER,
    registrationVersion: SUPPORTED_REGISTRATION_VERSION,
    reservationNonce: 7n,
    reservationExpiry: 200n,
    activationStartedAt: 120n,
    activationDeadline: 300n,
    refundAttemptNonce: 0n,
    bondHeld: true,
  };
}

void test("treats an absent participant as the only reservable state", () => {
  assert.equal(v2ParticipantCanReserve(null), true);
  assert.equal(v2ParticipantCanReserve(participant(PARTICIPANT_STATE.RESERVED)), false);

  assert.equal(v2SaveLifecycle(null).key, "unregistered");
});

void test("accepts RESERVED deposits through the inclusive reservation deadline only", () => {
  const reserved = participant(PARTICIPANT_STATE.RESERVED);

  assert.equal(v2ParticipantCanDeposit(reserved, 199n), true);

  assert.equal(v2ParticipantCanDeposit(reserved, 200n), true);

  assert.equal(v2ParticipantCanDeposit(reserved, 201n), false);

  assert.equal(
    v2ParticipantCanDeposit(
      {
        ...reserved,
        bondHeld: false,
      },
      150n,
    ),
    false,
  );
});

void test("matches the strict activation timeout boundary", () => {
  const pending = participant(PARTICIPANT_STATE.PENDING_ACTIVATION);

  assert.equal(v2ParticipantCanSettleThreshold(pending, 300n), true);

  assert.equal(v2ParticipantCanExpireActivation(pending, 300n), false);

  assert.equal(v2ParticipantCanSettleThreshold(pending, 301n), false);

  assert.equal(v2ParticipantCanExpireActivation(pending, 301n), true);
});

void test("allows withdrawal only from the exact ACTIVE supported registration", () => {
  const active = participant(PARTICIPANT_STATE.ACTIVE);

  assert.equal(v2ParticipantCanWithdraw(active), true);

  assert.equal(v2ParticipantCanWithdraw(participant(PARTICIPANT_STATE.RESERVED)), false);

  assert.equal(
    v2ParticipantCanWithdraw({
      ...active,
      registrationVersion: SUPPORTED_REGISTRATION_VERSION + 1n,
    }),
    false,
  );
});

void test("maps every consequential public participant lifecycle without inventing confidential values", () => {
  assert.equal(v2SaveLifecycle(participant(PARTICIPANT_STATE.RESERVED)).key, "reserved");

  assert.equal(
    v2SaveLifecycle(participant(PARTICIPANT_STATE.PENDING_ACTIVATION)).key,
    "pending-activation",
  );

  assert.equal(v2SaveLifecycle(participant(PARTICIPANT_STATE.ACTIVE)).key, "active");

  assert.equal(
    v2SaveLifecycle(participant(PARTICIPANT_STATE.PENDING_REFUND)).key,
    "pending-refund",
  );

  assert.equal(
    v2SaveLifecycle(participant(PARTICIPANT_STATE.REFUND_ATTEMPT_PENDING_PROOF)).key,
    "refund-proof-pending",
  );

  assert.equal(v2SaveLifecycle(participant(255)).key, "unknown");
});

void test("matches the strict reservation-expiry boundary", () => {
  const reserved = participant(PARTICIPANT_STATE.RESERVED);

  assert.equal(v2ParticipantCanExpireReservation(reserved, 200n), false);
  assert.equal(v2ParticipantCanExpireReservation(reserved, 201n), true);

  assert.equal(
    v2ParticipantCanExpireReservation(
      {
        ...reserved,
        bondHeld: false,
      },
      201n,
    ),
    false,
  );

  assert.equal(
    v2ParticipantCanExpireReservation(
      {
        ...reserved,
        registrationVersion: SUPPORTED_REGISTRATION_VERSION + 1n,
      },
      201n,
    ),
    false,
  );
});

void test("allows confidential refund attempts only from supported PENDING_REFUND registrations", () => {
  const pending = participant(PARTICIPANT_STATE.PENDING_REFUND);

  assert.equal(v2ParticipantCanAttemptRefund(pending), true);

  assert.equal(
    v2ParticipantCanAttemptRefund(participant(PARTICIPANT_STATE.REFUND_ATTEMPT_PENDING_PROOF)),
    false,
  );

  assert.equal(
    v2ParticipantCanAttemptRefund({
      ...pending,
      registrationVersion: SUPPORTED_REGISTRATION_VERSION + 1n,
    }),
    false,
  );
});

void test("allows refund-proof settlement only for a current positive attempt nonce", () => {
  const pendingProof = {
    ...participant(PARTICIPANT_STATE.REFUND_ATTEMPT_PENDING_PROOF),
    refundAttemptNonce: 9n,
  };

  assert.equal(v2ParticipantCanSettleRefund(pendingProof), true);

  assert.equal(
    v2ParticipantCanSettleRefund({
      ...pendingProof,
      refundAttemptNonce: 0n,
    }),
    false,
  );

  assert.equal(v2ParticipantCanSettleRefund(participant(PARTICIPANT_STATE.PENDING_REFUND)), false);
});

void test("treats the bond pull-credit independently from participant presence", () => {
  assert.equal(v2BondCreditAvailable(0n), false);
  assert.equal(v2BondCreditAvailable(1n), true);
  assert.equal(v2BondCreditAvailable(1_000_000_000_000_000n), true);
});
