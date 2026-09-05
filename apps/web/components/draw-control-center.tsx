"use client";

import {
  CircleCheck,
  CircleDashed,
  Gift,
  LockKeyhole,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { useZamaSDK } from "@zama-fhe/react-sdk";
import { usePublicClient } from "wagmi";

import { VEILPOT_POOL_ABI, VEILPOT_SEPOLIA_DEPLOYMENT } from "@veilpot/protocol-sdk";

import { ExactActionReviewCard, useExactAction } from "@/components/exact-action-control";

const DRAW_STATE = {
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

const DRAW_STATE_NAME: Readonly<Record<number, string>> = {
  0: "NO_DRAW",
  1: "BUCKET_DISCOVERY",
  2: "BUCKET_READY",
  3: "AWAITING_CANDIDATE_BATCH",
  4: "BATCH_REDUCTION_PENDING",
  5: "BATCH_PROOF_PENDING",
  6: "CANDIDATE_ACCEPTED",
  7: "WINNER_RESOLUTION",
  8: "FINALIZED",
  9: "NO_WEIGHT_TERMINAL",
  10: "UNSUPPORTED_TOTAL",
};

interface DrawSnapshot {
  readonly activeEpochId: bigint;
  readonly activeEpochEnd: bigint;
  readonly nextSnapshotId: bigint;
  readonly currentSnapshotId: bigint;
  readonly snapshotInProgress: boolean;
  readonly snapshotReady: boolean;
  readonly snapshotParticipantCount: bigint;
  readonly snapshotCursor: bigint;
  readonly nextDrawId: bigint;
  readonly nextDrawSnapshotId: bigint;
  readonly nextDrawSnapshotReady: boolean;
  readonly latestDraw: {
    readonly drawId: bigint;
    readonly state: number;
    readonly snapshotId: bigint;
    readonly snapshotEpoch: bigint;
    readonly participantCount: bigint;
    readonly batchId: bigint;
    readonly bucketExponent: number;
    readonly bucketEvidencePrepared: boolean;
    readonly winnerCursor: bigint;
  } | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The VeilDraw action stopped safely.";
}

function parsePublicBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n || value === "1" || value === "true") {
    return true;
  }
  if (value === false || value === 0 || value === 0n || value === "0" || value === "false") {
    return false;
  }
  throw new Error("The public decryption result is not a canonical boolean.");
}

function parsePublicBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error("The public decryption result is not a canonical unsigned integer.");
}

function timeLabel(value: bigint): string {
  return new Date(Number(value) * 1000).toLocaleString();
}

function readClear(clearValues: Readonly<Record<string, unknown>>, handle: Hex): unknown {
  const entry = Object.entries(clearValues).find(
    ([key]) => key.toLowerCase() === handle.toLowerCase(),
  );
  if (entry === undefined) {
    throw new Error("Public decryption did not return the exact requested handle.");
  }
  return entry[1];
}

export function DrawControlCenter({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  const publicClient = usePublicClient({ chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId });
  const zama = useZamaSDK();
  const exact = useExactAction(authenticatedAddress);

  const [snapshot, setSnapshot] = useState<DrawSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publicEvidence, setPublicEvidence] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (publicClient === undefined) return;

    setLoading(true);
    setNotice(null);

    try {
      const [
        activeEpochId,
        activeEpochEnd,
        nextSnapshotId,
        currentSnapshotId,
        snapshotInProgress,
        snapshotReady,
        snapshotParticipantCount,
        snapshotCursor,
        nextDrawId,
        nextDrawSnapshotId,
      ] = await Promise.all([
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "activeEpochId",
        }),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "activeEpochEnd",
        }),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "nextSnapshotId",
        }),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "currentSnapshotId",
        }),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "snapshotInProgress",
        }),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "snapshotReady",
        }),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "snapshotParticipantCount",
        }),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "snapshotCursor",
        }),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "nextDrawId",
        }),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "nextDrawSnapshotId",
        }),
      ]);

      let nextDrawSnapshotReady = false;
      if (nextDrawSnapshotId > 0n && nextDrawSnapshotId <= nextSnapshotId) {
        try {
          const row = await publicClient.readContract({
            address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_ABI,
            functionName: "snapshotMetadata",
            args: [nextDrawSnapshotId],
          });
          nextDrawSnapshotReady = row[4];
        } catch {
          nextDrawSnapshotReady = false;
        }
      }

      let latestDraw: DrawSnapshot["latestDraw"] = null;
      if (nextDrawId > 0n) {
        const row = await publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "drawMetadata",
          args: [nextDrawId],
        });

        let bucketEvidencePrepared = false;
        if (row[0] === DRAW_STATE.BUCKET_DISCOVERY) {
          const evidenceHandles = await publicClient.readContract({
            address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_ABI,
            functionName: "drawBucketEvidenceHandles",
            args: [nextDrawId],
          });
          bucketEvidencePrepared = evidenceHandles.some((handle) => !/^0x0{64}$/i.test(handle));
        }

        latestDraw = {
          drawId: nextDrawId,
          state: row[0],
          snapshotId: row[1],
          snapshotEpoch: row[2],
          participantCount: row[3],
          batchId: row[4],
          bucketExponent: row[5],
          bucketEvidencePrepared,
          winnerCursor: row[6],
        };
      }

      setSnapshot({
        activeEpochId,
        activeEpochEnd,
        nextSnapshotId,
        currentSnapshotId,
        snapshotInProgress,
        snapshotReady,
        snapshotParticipantCount,
        snapshotCursor,
        nextDrawId,
        nextDrawSnapshotId,
        nextDrawSnapshotReady,
        latestDraw,
      });
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [publicClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (exact.status.kind === "included" || exact.status.kind === "reverted") {
      void refresh();
    }
  }, [exact.status, refresh]);

  const stagePoolAction = useCallback(
    async (
      key: string,
      label: string,
      consequence: string,
      functionName:
        | "startSnapshot"
        | "processSnapshotChunk"
        | "finalizeSnapshot"
        | "startDraw"
        | "prepareDrawBucketEvidence"
        | "submitDrawBucketEvidence"
        | "generateDrawCandidateBatch"
        | "reduceDrawCandidateBatch"
        | "submitDrawBatchEvidence"
        | "startWinnerResolution"
        | "processDrawWinnerChunk"
        | "finalizeDraw",
      args: readonly unknown[],
    ) => {
      const data = encodeFunctionData({
        abi: VEILPOT_POOL_ABI,
        functionName,
        args: args as never,
      });
      await exact.prepare({
        key,
        label,
        consequence,
        to: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });
    },
    [exact],
  );

  const stageLifecycle = useCallback(
    async (action: string) => {
      if (snapshot === null) return;
      const draw = snapshot.latestDraw;

      if (action === "start-snapshot") {
        await stagePoolAction(
          `draw:start-snapshot:${snapshot.activeEpochId.toString()}`,
          "Start immutable TWAB snapshot",
          "Freeze the just-ended epoch boundary and begin bounded participant snapshot processing.",
          "startSnapshot",
          [],
        );
      } else if (action === "process-snapshot") {
        await stagePoolAction(
          `draw:process-snapshot:${snapshot.currentSnapshotId.toString()}:${snapshot.snapshotCursor.toString()}`,
          "Process next snapshot chunk",
          "Process the next fixed participant chunk into encrypted snapshot weights without revealing them.",
          "processSnapshotChunk",
          [],
        );
      } else if (action === "finalize-snapshot") {
        await stagePoolAction(
          `draw:finalize-snapshot:${snapshot.currentSnapshotId.toString()}`,
          "Finalize immutable snapshot",
          "Mark the fully processed encrypted TWAB snapshot ready for exactly one draw.",
          "finalizeSnapshot",
          [],
        );
      } else if (action === "start-draw") {
        await stagePoolAction(
          `draw:start:${snapshot.nextDrawSnapshotId.toString()}`,
          "Start next finalized-snapshot draw",
          "Bind the next monotonically consumable finalized snapshot to a new VeilDraw.",
          "startDraw",
          [],
        );
      } else if (draw !== null && action === "prepare-bucket") {
        await stagePoolAction(
          `draw:prepare-bucket:${draw.drawId.toString()}:${draw.snapshotId.toString()}`,
          "Prepare public bucket evidence",
          "Compute only the encrypted bucket exponent, zero predicate, supported-domain predicate, and proof context; no winner data is revealed.",
          "prepareDrawBucketEvidence",
          [draw.drawId, draw.snapshotId],
        );
      } else if (
        draw !== null &&
        (action === "generate-batch" || action === "generate-next-batch")
      ) {
        await stagePoolAction(
          `draw:generate-batch:${draw.drawId.toString()}:${draw.batchId.toString()}`,
          "Generate fixed encrypted candidate batch",
          "Generate exactly eight protocol-random encrypted candidates. No caller-controlled randomness or candidate value is supplied.",
          "generateDrawCandidateBatch",
          [draw.drawId, draw.snapshotId],
        );
      } else if (draw !== null && action === "reduce-batch") {
        await stagePoolAction(
          `draw:reduce-batch:${draw.drawId.toString()}:${draw.batchId.toString()}`,
          "Reduce encrypted candidate batch",
          "Run the fixed order-preserving encrypted reduction and publish only the batch-success predicate for later proof.",
          "reduceDrawCandidateBatch",
          [draw.drawId, draw.snapshotId, draw.batchId],
        );
      } else if (draw !== null && action === "start-winner") {
        await stagePoolAction(
          `draw:start-winner:${draw.drawId.toString()}`,
          "Start encrypted winner resolution",
          "Begin fixed-order winner scanning without revealing the target, winner predicate, prefix, or winner count.",
          "startWinnerResolution",
          [draw.drawId, draw.snapshotId],
        );
      } else if (draw !== null && action === "process-winner") {
        await stagePoolAction(
          `draw:process-winner:${draw.drawId.toString()}:${draw.winnerCursor.toString()}`,
          "Process next encrypted winner chunk",
          "Process the next fixed eight-slot winner chunk without public winner disclosure.",
          "processDrawWinnerChunk",
          [draw.drawId, draw.snapshotId],
        );
      } else if (draw !== null && action === "finalize-draw") {
        await stagePoolAction(
          `draw:finalize:${draw.drawId.toString()}`,
          "Finalize VeilDraw",
          "Finalize only after every frozen snapshot slot has been processed. Winner predicates remain encrypted.",
          "finalizeDraw",
          [draw.drawId, draw.snapshotId],
        );
      }
    },
    [snapshot, stagePoolAction],
  );

  const decryptBucketEvidence = useCallback(async () => {
    const draw = snapshot?.latestDraw;
    if (
      draw === null ||
      draw === undefined ||
      publicClient === undefined ||
      draw.state !== DRAW_STATE.BUCKET_DISCOVERY
    ) {
      setNotice("Bucket evidence can only be decrypted for a BUCKET_DISCOVERY draw.");
      return;
    }

    setLoading(true);
    setNotice(
      "Decrypting only the publicly authorized bucket exponent, zero predicate, supported-domain predicate, and proof context.",
    );

    try {
      const handles = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "drawBucketEvidenceHandles",
        args: [draw.drawId],
      });

      const requested: Hex[] = [handles[0], handles[1], handles[2], handles[3]];
      const result = await zama.decryption.decryptPublicValues(requested, {
        timeout: 180_000,
      });

      const exponentValue = parsePublicBigInt(readClear(result.clearValues, handles[0]));
      const zero = parsePublicBoolean(readClear(result.clearValues, handles[1]));
      const supported = parsePublicBoolean(readClear(result.clearValues, handles[2]));
      const context = parsePublicBigInt(readClear(result.clearValues, handles[3]));

      if (exponentValue > 255n) {
        throw new Error("Bucket exponent does not fit uint8.");
      }

      const proof = result.decryptionProof;
      const data = encodeFunctionData({
        abi: VEILPOT_POOL_ABI,
        functionName: "submitDrawBucketEvidence",
        args: [draw.drawId, draw.snapshotId, Number(exponentValue), zero, supported, proof],
      });

      await exact.prepare({
        key: `draw:settle-bucket:${draw.drawId.toString()}:${draw.snapshotId.toString()}`,
        label: "Settle exact public bucket evidence",
        consequence:
          "Verify the KMS proof and move the draw to BUCKET_READY, NO_WEIGHT_TERMINAL, or UNSUPPORTED_TOTAL according to the exact public evidence.",
        to: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });

      setPublicEvidence(
        `Bucket evidence: exponent=${exponentValue.toString()}, totalIsZero=${String(
          zero,
        )}, totalIsSupported=${String(supported)}, proofContext=${context.toString()}.`,
      );
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [exact, publicClient, snapshot, zama.decryption]);

  const decryptBatchEvidence = useCallback(async () => {
    const draw = snapshot?.latestDraw;
    if (
      draw === null ||
      draw === undefined ||
      publicClient === undefined ||
      draw.state !== DRAW_STATE.BATCH_PROOF_PENDING
    ) {
      setNotice("Batch evidence is only available in BATCH_PROOF_PENDING.");
      return;
    }

    setLoading(true);
    setNotice(
      "Decrypting only public batch success and its proof context. The encrypted candidate target is deliberately excluded.",
    );

    try {
      const handles = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "drawBatchHandles",
        args: [draw.drawId],
      });

      const successHandle = handles[1];
      const contextHandle = handles[2];
      const result = await zama.decryption.decryptPublicValues([successHandle, contextHandle], {
        timeout: 180_000,
      });

      const success = parsePublicBoolean(readClear(result.clearValues, successHandle));
      const context = parsePublicBigInt(readClear(result.clearValues, contextHandle));

      const proof = result.decryptionProof;
      const data = encodeFunctionData({
        abi: VEILPOT_POOL_ABI,
        functionName: "submitDrawBatchEvidence",
        args: [draw.drawId, draw.snapshotId, draw.batchId, success, proof],
      });

      await exact.prepare({
        key: `draw:settle-batch:${draw.drawId.toString()}:${draw.batchId.toString()}`,
        label: "Settle exact public candidate-batch evidence",
        consequence: success
          ? "Accept the first valid encrypted candidate target for winner resolution."
          : "Prove the fixed candidate batch contained no valid target and permit a fresh fixed batch.",
        to: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });

      setPublicEvidence(
        `Batch evidence: success=${String(success)}, proofContext=${context.toString()}. Candidate target remains encrypted.`,
      );
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [exact, publicClient, snapshot, zama.decryption]);

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const draw = snapshot?.latestDraw ?? null;

  return (
    <section className="workspace-stack">
      <article className="workspace-card block">
        <Gift size={20} />
        <span className="eyebrow">LIVE VEILDRAW</span>
        <h2>Permissionless lifecycle, protected winner selection.</h2>
        <p>
          Snapshot and draw progress are public. Weights, candidates, accepted target, winner
          predicates, running prefix, and winner count stay encrypted. Public decryption controls
          are explicit and limited to proof evidence the contracts intentionally publish.
        </p>

        <div className="financial-live-status">
          <div>
            <span>Epoch</span>
            <strong>{snapshot?.activeEpochId.toString() ?? "—"}</strong>
          </div>
          <div>
            <span>Epoch boundary</span>
            <strong>{snapshot === null ? "—" : timeLabel(snapshot.activeEpochEnd)}</strong>
          </div>
          <div>
            <span>Snapshot</span>
            <strong>{snapshot?.currentSnapshotId.toString() ?? "—"}</strong>
          </div>
          <div>
            <span>Snapshot cursor</span>
            <strong>
              {snapshot === null
                ? "—"
                : `${snapshot.snapshotCursor.toString()}/${snapshot.snapshotParticipantCount.toString()}`}
            </strong>
          </div>
          <div>
            <span>Snapshot state</span>
            <strong>
              {snapshot?.snapshotInProgress
                ? "IN PROGRESS"
                : snapshot?.snapshotReady
                  ? "READY"
                  : "IDLE"}
            </strong>
          </div>
          <div>
            <span>Next draw snapshot</span>
            <strong>{snapshot?.nextDrawSnapshotId.toString() ?? "—"}</strong>
          </div>
          <div>
            <span>Latest draw</span>
            <strong>{draw?.drawId.toString() ?? "None"}</strong>
          </div>
          <div>
            <span>Draw state</span>
            <strong>
              {draw === null ? "—" : (DRAW_STATE_NAME[draw.state] ?? `#${String(draw.state)}`)}
            </strong>
          </div>
        </div>

        <button
          className="financial-secondary-button"
          type="button"
          disabled={loading}
          onClick={() => {
            void refresh();
          }}
        >
          <RefreshCw size={15} /> Refresh live draw state
        </button>
      </article>

      <article className="workspace-card block draw-explainer-card">
        <span className="eyebrow">HOW VEILDRAW WORKS</span>
        <h2>Your savings create encrypted time-weighted chances.</h2>
        <p>
          VeilDraw never publishes your savings balance to calculate eligibility. During each epoch,
          the Pool accumulates an encrypted time-weighted balance (TWAB), freezes an immutable
          snapshot after the boundary, and resolves the winner through encrypted, fixed-order
          protocol steps.
        </p>

        <div className="draw-explainer-grid" aria-label="VeilDraw lifecycle">
          <div className="draw-explainer-step">
            <span>1</span>
            <strong>Save through the epoch</strong>
            <p>
              Your confidential principal contributes to encrypted TWAB for the time it remains
              saved.
            </p>
          </div>
          <div className="draw-explainer-step">
            <span>2</span>
            <strong>Freeze the snapshot</strong>
            <p>
              After the epoch boundary, participant eligibility and encrypted weights are sealed in
              bounded chunks.
            </p>
          </div>
          <div className="draw-explainer-step">
            <span>3</span>
            <strong>Start the draw</strong>
            <p>
              Exactly one finalized snapshot is bound to a new draw. A caller cannot choose the
              winner.
            </p>
          </div>
          <div className="draw-explainer-step">
            <span>4</span>
            <strong>Prove the sampling domain</strong>
            <p>
              Only narrow public proof evidence is explicitly decrypted; savings weights and targets
              stay encrypted.
            </p>
          </div>
          <div className="draw-explainer-step">
            <span>5</span>
            <strong>Resolve the winner privately</strong>
            <p>
              Fixed encrypted candidate batches and eight-slot winner chunks resolve the target
              without public winner disclosure.
            </p>
          </div>
          <div className="draw-explainer-step">
            <span>6</span>
            <strong>Finalize and hand off prize state</strong>
            <p>
              The finalized encrypted winner state is consumed by the isolated PrizeReserve flow
              without turning the draw into a public balance leak.
            </p>
          </div>
        </div>

        <div className="draw-explainer-now">
          <ShieldCheck size={18} />
          <div>
            <strong>
              {snapshot === null
                ? "Reading the current epoch boundary…"
                : nowSeconds < snapshot.activeEpochEnd
                  ? `Current epoch closes ${timeLabel(snapshot.activeEpochEnd)}`
                  : "The epoch boundary has passed; snapshot controls can now follow live state."}
            </strong>
            <p>
              Controls stay disabled until their exact on-chain prerequisite is true. No
              confidential weight, candidate, winner predicate, or prize amount is automatically
              decrypted.
            </p>
          </div>
        </div>
      </article>

      <article className="workspace-card block">
        <span className="eyebrow">SNAPSHOT LIFECYCLE</span>
        <h2>Close the epoch into an immutable encrypted TWAB snapshot.</h2>
        <div className="workspace-inline-actions">
          <button
            className="financial-secondary-button"
            type="button"
            disabled={
              snapshot === null ||
              snapshot.snapshotInProgress ||
              nowSeconds < snapshot.activeEpochEnd ||
              exact.attempt !== null
            }
            onClick={() => {
              void stageLifecycle("start-snapshot");
            }}
          >
            <Play size={15} /> Prepare start snapshot
          </button>

          <button
            className="financial-secondary-button"
            type="button"
            disabled={
              snapshot === null ||
              !snapshot.snapshotInProgress ||
              snapshot.snapshotCursor >= snapshot.snapshotParticipantCount ||
              exact.attempt !== null
            }
            onClick={() => {
              void stageLifecycle("process-snapshot");
            }}
          >
            Process next snapshot chunk
          </button>

          <button
            className="financial-secondary-button"
            type="button"
            disabled={
              snapshot === null ||
              !snapshot.snapshotInProgress ||
              snapshot.snapshotCursor !== snapshot.snapshotParticipantCount ||
              exact.attempt !== null
            }
            onClick={() => {
              void stageLifecycle("finalize-snapshot");
            }}
          >
            <CircleCheck size={15} /> Prepare finalize snapshot
          </button>

          <button
            className={
              snapshot?.nextDrawSnapshotReady
                ? "financial-primary-button"
                : "financial-secondary-button"
            }
            type="button"
            disabled={
              snapshot === null || !snapshot.nextDrawSnapshotReady || exact.attempt !== null
            }
            onClick={() => {
              void stageLifecycle("start-draw");
            }}
          >
            <Gift size={15} /> Prepare next draw
          </button>
        </div>

        {snapshot !== null && !snapshot.nextDrawSnapshotReady ? (
          <p className="financial-field-help">
            The next draw remains unavailable until snapshot{" "}
            {snapshot.nextDrawSnapshotId.toString()} is finalized. The current epoch boundary is{" "}
            {timeLabel(snapshot.activeEpochEnd)}.
          </p>
        ) : null}
      </article>

      {draw !== null ? (
        <article className="workspace-card block">
          <span className="eyebrow">DRAW #{draw.drawId.toString()}</span>
          <h2>{DRAW_STATE_NAME[draw.state] ?? `State ${String(draw.state)}`}</h2>
          <p>
            Snapshot {draw.snapshotId.toString()} · epoch {draw.snapshotEpoch.toString()} ·{" "}
            {draw.participantCount.toString()} frozen participant slot(s)
          </p>

          <div className="financial-live-status">
            <div>
              <span>Batch</span>
              <strong>{draw.batchId.toString()}</strong>
            </div>
            <div>
              <span>Bucket exponent</span>
              <strong>{draw.bucketExponent}</strong>
            </div>
            <div>
              <span>Winner cursor</span>
              <strong>
                {draw.winnerCursor.toString()}/{draw.participantCount.toString()}
              </strong>
            </div>
            <div>
              <span>Winner disclosure</span>
              <strong>Protected</strong>
            </div>
          </div>

          <div className="workspace-inline-actions">
            {draw.state === DRAW_STATE.BUCKET_DISCOVERY && !draw.bucketEvidencePrepared ? (
              <button
                className="financial-secondary-button"
                type="button"
                disabled={exact.attempt !== null}
                onClick={() => {
                  void stageLifecycle("prepare-bucket");
                }}
              >
                Prepare bucket evidence
              </button>
            ) : null}

            {draw.state === DRAW_STATE.BUCKET_DISCOVERY && draw.bucketEvidencePrepared ? (
              <button
                className="financial-secondary-button"
                type="button"
                disabled={loading || exact.attempt !== null || exact.review !== null}
                onClick={() => {
                  void decryptBucketEvidence();
                }}
              >
                <LockKeyhole size={15} /> Decrypt public bucket evidence explicitly
              </button>
            ) : null}

            {draw.state === DRAW_STATE.BUCKET_READY ||
            draw.state === DRAW_STATE.AWAITING_CANDIDATE_BATCH ? (
              <button
                className="financial-secondary-button"
                type="button"
                onClick={() => {
                  void stageLifecycle("generate-batch");
                }}
              >
                Generate fixed encrypted candidate batch
              </button>
            ) : null}

            {draw.state === DRAW_STATE.BATCH_REDUCTION_PENDING ? (
              <button
                className="financial-secondary-button"
                type="button"
                onClick={() => {
                  void stageLifecycle("reduce-batch");
                }}
              >
                Reduce encrypted candidate batch
              </button>
            ) : null}

            {draw.state === DRAW_STATE.BATCH_PROOF_PENDING ? (
              <button
                className="financial-secondary-button"
                type="button"
                disabled={loading || exact.attempt !== null || exact.review !== null}
                onClick={() => {
                  void decryptBatchEvidence();
                }}
              >
                <LockKeyhole size={15} /> Decrypt public batch-success evidence explicitly
              </button>
            ) : null}

            {draw.state === DRAW_STATE.CANDIDATE_ACCEPTED ? (
              <button
                className="financial-secondary-button"
                type="button"
                onClick={() => {
                  void stageLifecycle("start-winner");
                }}
              >
                Start encrypted winner resolution
              </button>
            ) : null}

            {draw.state === DRAW_STATE.WINNER_RESOLUTION &&
            draw.winnerCursor < draw.participantCount ? (
              <button
                className="financial-secondary-button"
                type="button"
                onClick={() => {
                  void stageLifecycle("process-winner");
                }}
              >
                Process next winner chunk
              </button>
            ) : null}

            {draw.state === DRAW_STATE.WINNER_RESOLUTION &&
            draw.winnerCursor === draw.participantCount ? (
              <button
                className="financial-primary-button"
                type="button"
                onClick={() => {
                  void stageLifecycle("finalize-draw");
                }}
              >
                <CircleCheck size={15} /> Prepare draw finalization
              </button>
            ) : null}
          </div>

          {draw.state === DRAW_STATE.FINALIZED ? (
            <div className="financial-state-card">
              <CircleCheck size={18} />
              <div>
                <strong>Draw finalized</strong>
                <p>
                  Winner predicates remain encrypted. Prize preparation and historical entitlement
                  assignment are handled by the isolated PrizeReserve.
                </p>
              </div>
            </div>
          ) : null}

          {draw.state === DRAW_STATE.NO_WEIGHT_TERMINAL ||
          draw.state === DRAW_STATE.UNSUPPORTED_TOTAL ? (
            <div className="financial-state-card warning">
              <CircleDashed size={18} />
              <div>
                <strong>Terminal draw state</strong>
                <p>{DRAW_STATE_NAME[draw.state]}</p>
              </div>
            </div>
          ) : null}
        </article>
      ) : null}

      <ExactActionReviewCard controller={exact} />

      {publicEvidence !== null ? (
        <div className="financial-state-card">
          <ShieldCheck size={18} />
          <div>
            <strong>Explicitly decrypted public evidence</strong>
            <p>{publicEvidence}</p>
          </div>
        </div>
      ) : null}

      {notice !== null ? (
        <div className="financial-state-card warning">
          <ShieldCheck size={18} />
          <div>
            <strong>VeilDraw notice</strong>
            <p>{notice}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
