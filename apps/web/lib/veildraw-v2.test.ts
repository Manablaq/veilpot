import assert from "node:assert/strict";
import test from "node:test";

import {
  VEILDRAW_V2_DRAW_STATE,
  VEILDRAW_V2_RESOLUTION_PHASE,
  nextVeilDrawV2Action,
  veilDrawV2IsTerminal,
} from "./veildraw-v2";

const base = {
  participantCount: 17n,
  batchId: 0n,
  bucketAttemptNonce: 0n,
  resolutionPhase: VEILDRAW_V2_RESOLUTION_PHASE.NONE,
  shardSelectionCursor: 0n,
  winnerShardCursor: 0n,
  winnerCursor: 0n,
};

void test("bucket discovery distinguishes preparation from explicit proof settlement", () => {
  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.BUCKET_DISCOVERY,
    }),
    "prepare-bucket-evidence",
  );

  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.BUCKET_DISCOVERY,
      bucketAttemptNonce: 1n,
    }),
    "settle-bucket-evidence",
  );
});

void test("candidate progression never skips reduction or public success proof", () => {
  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.BUCKET_READY,
    }),
    "generate-candidate-batch",
  );

  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.BATCH_REDUCTION_PENDING,
      batchId: 2n,
    }),
    "reduce-candidate-batch",
  );

  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.BATCH_PROOF_PENDING,
      batchId: 2n,
    }),
    "settle-batch-evidence",
  );
});

void test("private resolution requires all sixteen shard selectors before slot resolution", () => {
  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.WINNER_RESOLUTION,
      resolutionPhase: VEILDRAW_V2_RESOLUTION_PHASE.SHARD_SELECTION,
      shardSelectionCursor: 12n,
    }),
    "process-shard-selection",
  );

  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.WINNER_RESOLUTION,
      resolutionPhase: VEILDRAW_V2_RESOLUTION_PHASE.SLOT_RESOLUTION,
      shardSelectionCursor: 12n,
    }),
    null,
  );
});

void test("private winner resolution processes every logical shard without winner-dependent early stop", () => {
  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.WINNER_RESOLUTION,
      resolutionPhase: VEILDRAW_V2_RESOLUTION_PHASE.SLOT_RESOLUTION,
      shardSelectionCursor: 16n,
      winnerShardCursor: 7n,
      winnerCursor: 17n,
    }),
    "process-winner-shard",
  );
});

void test("finalization requires complete fixed shard progression and the exact public participant cursor", () => {
  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.WINNER_RESOLUTION,
      resolutionPhase: VEILDRAW_V2_RESOLUTION_PHASE.COMPLETE,
      shardSelectionCursor: 16n,
      winnerShardCursor: 16n,
      winnerCursor: 16n,
    }),
    null,
  );

  assert.equal(
    nextVeilDrawV2Action({
      ...base,
      state: VEILDRAW_V2_DRAW_STATE.WINNER_RESOLUTION,
      resolutionPhase: VEILDRAW_V2_RESOLUTION_PHASE.COMPLETE,
      shardSelectionCursor: 16n,
      winnerShardCursor: 16n,
      winnerCursor: 17n,
    }),
    "finalize-draw",
  );
});

void test("finalized, zero-weight and unsupported child draws are terminal in the UI", () => {
  for (const state of [
    VEILDRAW_V2_DRAW_STATE.FINALIZED,
    VEILDRAW_V2_DRAW_STATE.NO_WEIGHT_TERMINAL,
    VEILDRAW_V2_DRAW_STATE.UNSUPPORTED_TOTAL,
  ]) {
    assert.equal(veilDrawV2IsTerminal(state), true);
    assert.equal(
      nextVeilDrawV2Action({
        ...base,
        state,
      }),
      null,
    );
  }
});
