import type { Address } from "viem";

import { PARTICIPANT_STATE, SUPPORTED_REGISTRATION_VERSION } from "@veilpot/protocol-sdk";

export interface V2ParticipantSnapshot {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly reservationExpiry: bigint;
  readonly activationStartedAt: bigint;
  readonly activationDeadline: bigint;
  readonly refundAttemptNonce: bigint;
  readonly bondHeld: boolean;
}

export type V2SaveLifecycleKey =
  | "unregistered"
  | "reserved"
  | "pending-activation"
  | "active"
  | "pending-refund"
  | "refund-proof-pending"
  | "unknown";

export interface V2SaveLifecycleView {
  readonly key: V2SaveLifecycleKey;
  readonly label: string;
  readonly detail: string;
}

export const V2_PARTICIPANT_SCAN_CHUNK_SIZE = 16;

export function v2SaveLifecycle(participant: V2ParticipantSnapshot | null): V2SaveLifecycleView {
  if (participant === null) {
    return {
      key: "unregistered",
      label: "Not registered",
      detail: "No live V2 participant registration was found for this wallet.",
    };
  }

  switch (participant.state) {
    case PARTICIPANT_STATE.RESERVED:
      return {
        key: "reserved",
        label: "Reserved",
        detail:
          "A V2 participant slot is reserved. Confidential deposit preparation is the next lifecycle step.",
      };

    case PARTICIPANT_STATE.PENDING_ACTIVATION:
      return {
        key: "pending-activation",
        label: "Pending activation",
        detail:
          "A confidential deposit exists and only its public threshold predicate may be settled.",
      };

    case PARTICIPANT_STATE.ACTIVE:
      return {
        key: "active",
        label: "Active",
        detail:
          "This wallet has an active V2 participant registration. Principal remains confidential.",
      };

    case PARTICIPANT_STATE.PENDING_REFUND:
      return {
        key: "pending-refund",
        label: "Refund pending",
        detail: "The registration is in the repairable confidential refund path.",
      };

    case PARTICIPANT_STATE.REFUND_ATTEMPT_PENDING_PROOF:
      return {
        key: "refund-proof-pending",
        label: "Refund proof pending",
        detail:
          "A refund transfer attempt exists and its public completion predicate must be settled.",
      };

    default:
      return {
        key: "unknown",
        label: "Unknown lifecycle state",
        detail:
          "Veilpot stopped lifecycle interpretation because the public state is not recognized.",
      };
  }
}

export function v2ParticipantCanReserve(participant: V2ParticipantSnapshot | null): boolean {
  return participant === null;
}

export function v2ParticipantCanDeposit(
  participant: V2ParticipantSnapshot | null,
  nowSeconds: bigint,
): boolean {
  return (
    participant !== null &&
    participant.state === PARTICIPANT_STATE.RESERVED &&
    participant.registrationVersion === SUPPORTED_REGISTRATION_VERSION &&
    participant.bondHeld &&
    nowSeconds <= participant.reservationExpiry
  );
}

export function v2ParticipantCanSettleThreshold(
  participant: V2ParticipantSnapshot | null,
  nowSeconds: bigint,
): boolean {
  return (
    participant !== null &&
    participant.state === PARTICIPANT_STATE.PENDING_ACTIVATION &&
    participant.registrationVersion === SUPPORTED_REGISTRATION_VERSION &&
    nowSeconds <= participant.activationDeadline
  );
}

export function v2ParticipantCanExpireActivation(
  participant: V2ParticipantSnapshot | null,
  nowSeconds: bigint,
): boolean {
  return (
    participant !== null &&
    participant.state === PARTICIPANT_STATE.PENDING_ACTIVATION &&
    participant.activationDeadline !== 0n &&
    nowSeconds > participant.activationDeadline
  );
}

export function v2ParticipantCanWithdraw(participant: V2ParticipantSnapshot | null): boolean {
  return (
    participant !== null &&
    participant.state === PARTICIPANT_STATE.ACTIVE &&
    participant.registrationVersion === SUPPORTED_REGISTRATION_VERSION
  );
}

export function v2ParticipantCanExpireReservation(
  participant: V2ParticipantSnapshot | null,
  nowSeconds: bigint,
): boolean {
  return (
    participant !== null &&
    participant.state === PARTICIPANT_STATE.RESERVED &&
    participant.registrationVersion === SUPPORTED_REGISTRATION_VERSION &&
    participant.bondHeld &&
    participant.reservationExpiry !== 0n &&
    nowSeconds > participant.reservationExpiry
  );
}

export function v2ParticipantCanAttemptRefund(participant: V2ParticipantSnapshot | null): boolean {
  return (
    participant !== null &&
    participant.state === PARTICIPANT_STATE.PENDING_REFUND &&
    participant.registrationVersion === SUPPORTED_REGISTRATION_VERSION
  );
}

export function v2ParticipantCanSettleRefund(participant: V2ParticipantSnapshot | null): boolean {
  return (
    participant !== null &&
    participant.state === PARTICIPANT_STATE.REFUND_ATTEMPT_PENDING_PROOF &&
    participant.registrationVersion === SUPPORTED_REGISTRATION_VERSION &&
    participant.refundAttemptNonce > 0n
  );
}

export function v2BondCreditAvailable(pendingBondRefund: bigint): boolean {
  return pendingBondRefund > 0n;
}
