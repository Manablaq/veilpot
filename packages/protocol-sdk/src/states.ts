export const PARTICIPANT_STATE = {
  FREE: 0,
  RESERVED: 1,
  PENDING_ACTIVATION: 2,
  ACTIVE: 3,
  PENDING_REFUND: 4,
  REFUND_ATTEMPT_PENDING_PROOF: 5,
  TOMBSTONED: 6,
} as const;

export type ParticipantState = (typeof PARTICIPANT_STATE)[keyof typeof PARTICIPANT_STATE];

export const DRAW_STATE = {
  NO_DRAW: 0,
  BUCKET_DISCOVERY: 1,
  BUCKET_READY: 2,
  AWAITING_CANDIDATE_BATCH: 3,
  BATCH_REDUCTION_PENDING: 4,
  BATCH_PROOF_PENDING: 5,
  CANDIDATE_ACCEPTED: 6,
  WINNER_RESOLUTION: 7,
  FINALIZED: 8,
  NO_WEIGHT_TERMINAL: 9,
  UNSUPPORTED_TOTAL: 10,
} as const;

export type DrawState = (typeof DRAW_STATE)[keyof typeof DRAW_STATE];

export const YIELD_STATE = {
  NONE: 0,
  RECOGNITION_PROOF_PENDING: 1,
  RECOGNIZED: 2,
  SWEEP_PROOF_PENDING: 3,
  FUNDING_FINALIZED: 4,
} as const;

export type YieldState = (typeof YIELD_STATE)[keyof typeof YIELD_STATE];

export const PRIZE_STATE = {
  UNPREPARED: 0,
  STATUS_PROOF_PENDING: 1,
  ASSIGNING: 2,
  CLAIMABLE: 3,
  CLAIMED: 4,
  NO_PRIZE: 5,
  TRANSFER_PROOF_PENDING: 6,
} as const;

export type PrizeState = (typeof PRIZE_STATE)[keyof typeof PRIZE_STATE];

export const AUTOPILOT_PLAN_STATE = {
  NONE: 0,
  ACTIVE: 1,
  PAUSED: 2,
  REVOKED: 3,
  COMPLETED: 4,
} as const;

export type AutopilotPlanState = (typeof AUTOPILOT_PLAN_STATE)[keyof typeof AUTOPILOT_PLAN_STATE];

function stateName<T extends Record<string, number>>(
  states: T,
  value: number,
  label: string,
): keyof T {
  const match = Object.entries(states).find(([, ordinal]) => ordinal === value);

  if (match === undefined) {
    throw new RangeError(label + " ordinal is not recognized");
  }

  return match[0];
}

export function participantStateName(value: number): keyof typeof PARTICIPANT_STATE {
  return stateName(PARTICIPANT_STATE, value, "participant state");
}

export function drawStateName(value: number): keyof typeof DRAW_STATE {
  return stateName(DRAW_STATE, value, "draw state");
}

export function yieldStateName(value: number): keyof typeof YIELD_STATE {
  return stateName(YIELD_STATE, value, "yield state");
}

export function prizeStateName(value: number): keyof typeof PRIZE_STATE {
  return stateName(PRIZE_STATE, value, "prize state");
}

export function autopilotPlanStateName(value: number): keyof typeof AUTOPILOT_PLAN_STATE {
  return stateName(AUTOPILOT_PLAN_STATE, value, "Autopilot plan state");
}
