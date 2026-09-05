import {
  CLAIM_AUTHORIZATION_PRIMARY_TYPE,
  CLAIM_AUTHORIZATION_TYPES,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  type ClaimAuthorization,
} from "@veilpot/protocol-sdk";
import type { Address } from "viem";

import { VEILDRAW_V2_DRAW_STATE } from "./veildraw-v2";

export const PRIZE_V2_PRIZE_COUNT = 3 as const;

export const PRIZE_V2_STATE = Object.freeze({
  UNPREPARED: 0,
  STATUS_PROOF_PENDING: 1,
  ASSIGNING: 2,
  CLAIMABLE: 3,
  CLAIMED: 4,
  NO_PRIZE: 5,
  TRANSFER_PROOF_PENDING: 6,
} as const);

export const YIELD_V2_STATE = Object.freeze({
  NONE: 0,
  RECOGNITION_PROOF_PENDING: 1,
  RECOGNIZED: 2,
  SWEEP_PROOF_PENDING: 3,
  FUNDING_FINALIZED: 4,
} as const);

export type YieldV2NextAction = "settle-recognition" | "sweep-yield" | "settle-sweep";

export type PrizeV2NextAction =
  | "prepare-prize"
  | "settle-prize-status"
  | "refresh-prize-status-evidence"
  | "assign-entitlement-chunk"
  | "settle-claim-completion"
  | "refresh-claim-completion-evidence";

export interface PrizeV2ChildFinality {
  readonly prizeIndex: number;
  readonly drawId: bigint;
  readonly snapshotId: bigint;
  readonly state: number;
}

export interface PrizeV2LifecycleInput {
  readonly state: number;
  readonly yieldState: number;
  readonly participantCount: bigint;
  readonly assignmentCursor: bigint;
  readonly statusProofDeadline: bigint;
  readonly transferProofDeadline: bigint;
  readonly nowSeconds: bigint;
}

const UINT256_MAX = (1n << 256n) - 1n;

function assertUint256(value: bigint, label: string): void {
  if (value < 0n || value > UINT256_MAX) {
    throw new RangeError(`${label} must fit uint256`);
  }
}

function assertAddress(value: string, label: string): asserts value is Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} is not an Ethereum address`);
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function roundReadyForYield(
  snapshotId: bigint,
  childDraws: readonly PrizeV2ChildFinality[],
): boolean {
  if (snapshotId <= 0n || childDraws.length !== PRIZE_V2_PRIZE_COUNT) {
    return false;
  }

  const [first, second, third] = childDraws;

  if (first.prizeIndex !== 0 || second.prizeIndex !== 1 || third.prizeIndex !== 2) {
    return false;
  }

  if (
    first.snapshotId !== snapshotId ||
    second.snapshotId !== snapshotId ||
    third.snapshotId !== snapshotId
  ) {
    return false;
  }

  if (
    first.drawId <= 0n ||
    second.drawId !== first.drawId + 1n ||
    third.drawId !== second.drawId + 1n
  ) {
    return false;
  }

  return childDraws.every((draw) => draw.state === VEILDRAW_V2_DRAW_STATE.FINALIZED);
}

export function nextRoundYieldV2Action(
  roundRecognized: boolean,
  snapshotId: bigint,
  childDraws: readonly PrizeV2ChildFinality[],
): "recognize-round-yield" | null {
  if (roundRecognized) {
    return null;
  }

  return roundReadyForYield(snapshotId, childDraws) ? "recognize-round-yield" : null;
}

export function nextChildYieldV2Action(state: number): YieldV2NextAction | null {
  switch (state) {
    case YIELD_V2_STATE.RECOGNITION_PROOF_PENDING:
      return "settle-recognition";

    case YIELD_V2_STATE.RECOGNIZED:
      return "sweep-yield";

    case YIELD_V2_STATE.SWEEP_PROOF_PENDING:
      return "settle-sweep";

    case YIELD_V2_STATE.NONE:
    case YIELD_V2_STATE.FUNDING_FINALIZED:
    default:
      return null;
  }
}

export function nextPrizeV2Action(input: PrizeV2LifecycleInput): PrizeV2NextAction | null {
  assertUint256(input.participantCount, "participantCount");
  assertUint256(input.assignmentCursor, "assignmentCursor");
  assertUint256(input.statusProofDeadline, "statusProofDeadline");
  assertUint256(input.transferProofDeadline, "transferProofDeadline");
  assertUint256(input.nowSeconds, "nowSeconds");

  switch (input.state) {
    case PRIZE_V2_STATE.UNPREPARED:
      return input.yieldState === YIELD_V2_STATE.FUNDING_FINALIZED ? "prepare-prize" : null;

    case PRIZE_V2_STATE.STATUS_PROOF_PENDING:
      if (input.statusProofDeadline !== 0n && input.nowSeconds > input.statusProofDeadline) {
        return "refresh-prize-status-evidence";
      }

      return "settle-prize-status";

    case PRIZE_V2_STATE.ASSIGNING:
      return input.assignmentCursor < input.participantCount ? "assign-entitlement-chunk" : null;

    case PRIZE_V2_STATE.TRANSFER_PROOF_PENDING:
      if (input.transferProofDeadline !== 0n && input.nowSeconds > input.transferProofDeadline) {
        return "refresh-claim-completion-evidence";
      }

      return "settle-claim-completion";

    case PRIZE_V2_STATE.CLAIMABLE:
    case PRIZE_V2_STATE.CLAIMED:
    case PRIZE_V2_STATE.NO_PRIZE:
    default:
      return null;
  }
}

export interface V2xClaimAuthorizationInput {
  readonly drawId: bigint;
  readonly slotIndex: bigint;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly nonce: bigint;
  readonly expiry: bigint;
}

export const V2X_CLAIM_EIP712_DOMAIN = Object.freeze({
  name: "VeilpotPrizeReserve",
  version: "1",
  chainId: BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId),
  verifyingContract: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
} as const);

export function buildV2xClaimAuthorization(input: V2xClaimAuthorizationInput): ClaimAuthorization {
  assertAddress(input.owner, "claim owner");
  assertUint256(input.drawId, "drawId");
  assertUint256(input.slotIndex, "slotIndex");
  assertUint256(input.registrationVersion, "registrationVersion");
  assertUint256(input.reservationNonce, "reservationNonce");
  assertUint256(input.nonce, "nonce");
  assertUint256(input.expiry, "expiry");

  if (input.expiry === 0n) {
    throw new RangeError("claim expiry must be nonzero");
  }

  return {
    chainId: BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId),
    reserve: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
    pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    drawId: input.drawId,
    slotIndex: input.slotIndex,
    participant: input.owner,
    recipient: input.owner,
    registrationVersion: input.registrationVersion,
    reservationNonce: input.reservationNonce,
    nonce: input.nonce,
    expiry: input.expiry,
  };
}

export function assertV2xClaimAuthorization(authorization: ClaimAuthorization): void {
  assertAddress(authorization.reserve, "claim reserve");
  assertAddress(authorization.pool, "claim pool");
  assertAddress(authorization.participant, "claim participant");
  assertAddress(authorization.recipient, "claim recipient");

  assertUint256(authorization.chainId, "chainId");
  assertUint256(authorization.drawId, "drawId");
  assertUint256(authorization.slotIndex, "slotIndex");
  assertUint256(authorization.registrationVersion, "registrationVersion");
  assertUint256(authorization.reservationNonce, "reservationNonce");
  assertUint256(authorization.nonce, "nonce");
  assertUint256(authorization.expiry, "expiry");

  if (
    authorization.chainId !== BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId) ||
    !sameAddress(authorization.reserve, VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve) ||
    !sameAddress(authorization.pool, VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool)
  ) {
    throw new Error("claim authorization is not bound to the active corrected V2.x deployment");
  }

  if (!sameAddress(authorization.participant, authorization.recipient)) {
    throw new Error("claim participant and recipient must be the same historical owner");
  }

  if (authorization.expiry === 0n) {
    throw new Error("claim expiry must be nonzero");
  }
}

export function buildV2xClaimTypedData(input: V2xClaimAuthorizationInput) {
  const message = buildV2xClaimAuthorization(input);

  return {
    domain: V2X_CLAIM_EIP712_DOMAIN,
    types: CLAIM_AUTHORIZATION_TYPES,
    primaryType: CLAIM_AUTHORIZATION_PRIMARY_TYPE,
    message,
  } as const;
}
