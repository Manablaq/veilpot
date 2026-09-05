export const VEILDRAW_V2_DRAW_STATE = Object.freeze({
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
} as const);

export const VEILDRAW_V2_RESOLUTION_PHASE = Object.freeze({
  NONE: 0,
  SHARD_SELECTION: 1,
  SLOT_RESOLUTION: 2,
  COMPLETE: 3,
} as const);

export const VEILDRAW_V2_SHARD_COUNT = 16n;
export const VEILDRAW_V2_PRIZE_COUNT = 3;

export type VeilDrawV2NextAction =
  | "prepare-bucket-evidence"
  | "settle-bucket-evidence"
  | "generate-candidate-batch"
  | "reduce-candidate-batch"
  | "settle-batch-evidence"
  | "start-winner-resolution"
  | "process-shard-selection"
  | "process-winner-shard"
  | "finalize-draw";

export interface VeilDrawV2Progress {
  readonly state: number;
  readonly participantCount: bigint;
  readonly batchId: bigint;
  readonly bucketAttemptNonce: bigint;
  readonly resolutionPhase: number;
  readonly shardSelectionCursor: bigint;
  readonly winnerShardCursor: bigint;
  readonly winnerCursor: bigint;
}

export function veilDrawV2StateName(state: number): string {
  switch (state) {
    case VEILDRAW_V2_DRAW_STATE.NO_DRAW:
      return "NO_DRAW";
    case VEILDRAW_V2_DRAW_STATE.BUCKET_DISCOVERY:
      return "BUCKET_DISCOVERY";
    case VEILDRAW_V2_DRAW_STATE.BUCKET_READY:
      return "BUCKET_READY";
    case VEILDRAW_V2_DRAW_STATE.AWAITING_CANDIDATE_BATCH:
      return "AWAITING_CANDIDATE_BATCH";
    case VEILDRAW_V2_DRAW_STATE.BATCH_REDUCTION_PENDING:
      return "BATCH_REDUCTION_PENDING";
    case VEILDRAW_V2_DRAW_STATE.BATCH_PROOF_PENDING:
      return "BATCH_PROOF_PENDING";
    case VEILDRAW_V2_DRAW_STATE.CANDIDATE_ACCEPTED:
      return "CANDIDATE_ACCEPTED";
    case VEILDRAW_V2_DRAW_STATE.WINNER_RESOLUTION:
      return "WINNER_RESOLUTION";
    case VEILDRAW_V2_DRAW_STATE.FINALIZED:
      return "FINALIZED";
    case VEILDRAW_V2_DRAW_STATE.NO_WEIGHT_TERMINAL:
      return "NO_WEIGHT_TERMINAL";
    case VEILDRAW_V2_DRAW_STATE.UNSUPPORTED_TOTAL:
      return "UNSUPPORTED_TOTAL";
    default:
      return `UNKNOWN_${String(state)}`;
  }
}

export function veilDrawV2ResolutionPhaseName(phase: number): string {
  switch (phase) {
    case VEILDRAW_V2_RESOLUTION_PHASE.NONE:
      return "NONE";
    case VEILDRAW_V2_RESOLUTION_PHASE.SHARD_SELECTION:
      return "SHARD_SELECTION";
    case VEILDRAW_V2_RESOLUTION_PHASE.SLOT_RESOLUTION:
      return "SLOT_RESOLUTION";
    case VEILDRAW_V2_RESOLUTION_PHASE.COMPLETE:
      return "COMPLETE";
    default:
      return `UNKNOWN_${String(phase)}`;
  }
}

export function veilDrawV2IsTerminal(state: number): boolean {
  return (
    state === VEILDRAW_V2_DRAW_STATE.FINALIZED ||
    state === VEILDRAW_V2_DRAW_STATE.NO_WEIGHT_TERMINAL ||
    state === VEILDRAW_V2_DRAW_STATE.UNSUPPORTED_TOTAL
  );
}

export function nextVeilDrawV2Action(progress: VeilDrawV2Progress): VeilDrawV2NextAction | null {
  switch (progress.state) {
    case VEILDRAW_V2_DRAW_STATE.BUCKET_DISCOVERY:
      return progress.bucketAttemptNonce === 0n
        ? "prepare-bucket-evidence"
        : "settle-bucket-evidence";

    case VEILDRAW_V2_DRAW_STATE.BUCKET_READY:
    case VEILDRAW_V2_DRAW_STATE.AWAITING_CANDIDATE_BATCH:
      return "generate-candidate-batch";

    case VEILDRAW_V2_DRAW_STATE.BATCH_REDUCTION_PENDING:
      return progress.batchId > 0n ? "reduce-candidate-batch" : null;

    case VEILDRAW_V2_DRAW_STATE.BATCH_PROOF_PENDING:
      return progress.batchId > 0n ? "settle-batch-evidence" : null;

    case VEILDRAW_V2_DRAW_STATE.CANDIDATE_ACCEPTED:
      return "start-winner-resolution";

    case VEILDRAW_V2_DRAW_STATE.WINNER_RESOLUTION:
      if (
        progress.resolutionPhase === VEILDRAW_V2_RESOLUTION_PHASE.SHARD_SELECTION &&
        progress.shardSelectionCursor < VEILDRAW_V2_SHARD_COUNT
      ) {
        return "process-shard-selection";
      }

      if (
        progress.resolutionPhase === VEILDRAW_V2_RESOLUTION_PHASE.SLOT_RESOLUTION &&
        progress.shardSelectionCursor === VEILDRAW_V2_SHARD_COUNT &&
        progress.winnerShardCursor < VEILDRAW_V2_SHARD_COUNT
      ) {
        return "process-winner-shard";
      }

      if (
        progress.resolutionPhase === VEILDRAW_V2_RESOLUTION_PHASE.COMPLETE &&
        progress.shardSelectionCursor === VEILDRAW_V2_SHARD_COUNT &&
        progress.winnerShardCursor === VEILDRAW_V2_SHARD_COUNT &&
        progress.winnerCursor === progress.participantCount
      ) {
        return "finalize-draw";
      }

      return null;

    default:
      return null;
  }
}

export function veilDrawV2ActionLabel(action: VeilDrawV2NextAction): string {
  switch (action) {
    case "prepare-bucket-evidence":
      return "Prepare bucket evidence";
    case "settle-bucket-evidence":
      return "Decrypt & settle public bucket evidence";
    case "generate-candidate-batch":
      return "Generate private candidate batch";
    case "reduce-candidate-batch":
      return "Reduce private candidate batch";
    case "settle-batch-evidence":
      return "Decrypt & settle public batch result";
    case "start-winner-resolution":
      return "Start private winner resolution";
    case "process-shard-selection":
      return "Process private shard selectors";
    case "process-winner-shard":
      return "Process next private winner shard";
    case "finalize-draw":
      return "Finalize private child draw";
  }
}
