"use client";

import { toUserFacingError } from "@/lib/ui-error";

import {
  CircleCheck,
  CircleDashed,
  Gift,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { useZamaSDK } from "@zama-fhe/react-sdk";
import { usePublicClient } from "wagmi";

import {
  VEILDRAW_ENGINE_V2_ABI,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_POOL_V2_ABI,
} from "@veilpot/protocol-sdk";

import { ExactActionReviewCard, useExactAction } from "@/components/exact-action-control";
import { VEILPOT_V2_EXACT_ACTION_SCOPE } from "@/lib/deployment-scope";
import {
  VEILDRAW_V2_DRAW_STATE,
  VEILDRAW_V2_PRIZE_COUNT,
  nextVeilDrawV2Action,
  veilDrawV2ActionLabel,
  veilDrawV2IsTerminal,
  veilDrawV2ResolutionPhaseName,
  veilDrawV2StateName,
  type VeilDrawV2NextAction,
} from "@/lib/veildraw-v2";

interface SnapshotMetadata {
  readonly snapshotId: bigint;
  readonly cutoff: bigint;
  readonly participantCount: bigint;
  readonly cursor: bigint;
  readonly inProgress: boolean;
  readonly ready: boolean;
}

interface ImportMetadata {
  readonly participantCount: bigint;
  readonly cursor: bigint;
  readonly initialized: boolean;
  readonly sealed: boolean;
}

interface ChildDraw {
  readonly prizeIndex: number;
  readonly drawId: bigint;
  readonly snapshotId: bigint;
  readonly state: number;
  readonly participantCount: bigint;
  readonly batchId: bigint;
  readonly bucketExponent: number;
  readonly bucketAttemptNonce: bigint;
  readonly resolutionPhase: number;
  readonly shardSelectionCursor: bigint;
  readonly winnerShardCursor: bigint;
  readonly winnerCursor: bigint;
}

interface VeilDrawSnapshot {
  readonly activeEpochId: bigint;
  readonly activeEpochEnd: bigint;
  readonly nextSnapshotId: bigint;
  readonly currentSnapshotId: bigint;
  readonly nextDrawSnapshotId: bigint;
  readonly snapshotInProgress: boolean;
  readonly snapshotReady: boolean;
  readonly snapshotParticipantCount: bigint;
  readonly snapshotCursor: bigint;
  readonly pendingSnapshot: SnapshotMetadata | null;
  readonly pendingImport: ImportMetadata | null;
  readonly latestRoundSnapshotId: bigint;
  readonly childDraws: readonly ChildDraw[];
}

function errorMessage(error: unknown): string {
  return toUserFacingError(error, "The VeilDraw action stopped safely.");
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

function readClear(clearValues: Readonly<Record<string, unknown>>, handle: Hex): unknown {
  const entry = Object.entries(clearValues).find(
    ([key]) => key.toLowerCase() === handle.toLowerCase(),
  );

  if (entry === undefined) {
    throw new Error("Public decryption did not return the exact requested handle.");
  }

  return entry[1];
}

function sameHandle(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameDrawBinding(left: ChildDraw, right: ChildDraw): boolean {
  return (
    left.drawId === right.drawId &&
    left.prizeIndex === right.prizeIndex &&
    left.snapshotId === right.snapshotId &&
    left.state === right.state &&
    left.participantCount === right.participantCount &&
    left.batchId === right.batchId &&
    left.bucketAttemptNonce === right.bucketAttemptNonce &&
    left.resolutionPhase === right.resolutionPhase &&
    left.shardSelectionCursor === right.shardSelectionCursor &&
    left.winnerShardCursor === right.winnerShardCursor &&
    left.winnerCursor === right.winnerCursor
  );
}

function timeLabel(value: bigint): string {
  return new Date(Number(value) * 1000).toLocaleString();
}

function drawActionDescription(action: VeilDrawV2NextAction): string {
  switch (action) {
    case "prepare-bucket-evidence":
      return "Compute only the contract-authorized public bucket evidence. Snapshot total stays encrypted.";
    case "settle-bucket-evidence":
      return "Explicitly decrypt the authorized bucket exponent, zero predicate, supported-domain predicate and proof context, then prepare their exact proof settlement.";
    case "generate-candidate-batch":
      return "Generate exactly eight fresh Zama protocol-random candidates. No seed, target or candidate is supplied by the caller.";
    case "reduce-candidate-batch":
      return "Reduce the private candidate batch to its first valid candidate while keeping the target encrypted.";
    case "settle-batch-evidence":
      return "Explicitly decrypt only public batch success plus its proof context. The candidate target remains encrypted.";
    case "start-winner-resolution":
      return "Begin private two-stage winner resolution. Selected shard, target and winner remain encrypted.";
    case "process-shard-selection":
      return "Process the next fixed four encrypted shard selectors without revealing the selected shard.";
    case "process-winner-shard":
      return "Process the next fixed eight-slot logical shard without revealing whether it contains the winner.";
    case "finalize-draw":
      return "Finalize only after all sixteen shard selectors and all sixteen winner shards have been processed.";
  }
}

export function DrawControlCenter({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });
  const zama = useZamaSDK();
  const exact = useExactAction(authenticatedAddress, VEILPOT_V2_EXACT_ACTION_SCOPE);

  const [snapshot, setSnapshot] = useState<VeilDrawSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publicEvidence, setPublicEvidence] = useState<string | null>(null);

  const readChildDraw = useCallback(
    async (
      drawId: bigint,
      expectedSnapshotId: bigint,
      expectedPrizeIndex: number,
    ): Promise<ChildDraw> => {
      if (publicClient === undefined) {
        throw new Error("Sepolia public client is unavailable.");
      }

      const [metadata, resolution, prizeIndex] = await Promise.all([
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
          abi: VEILDRAW_ENGINE_V2_ABI,
          functionName: "drawMetadataV2",
          args: [drawId],
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
          abi: VEILDRAW_ENGINE_V2_ABI,
          functionName: "drawResolutionMetadata",
          args: [drawId],
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
          abi: VEILDRAW_ENGINE_V2_ABI,
          functionName: "drawPrizeIndex",
          args: [drawId],
        }),
      ]);

      if (metadata[1] !== expectedSnapshotId || prizeIndex !== expectedPrizeIndex) {
        throw new Error("The child draw no longer matches the expected snapshot/prize binding.");
      }

      return {
        prizeIndex: expectedPrizeIndex,
        drawId,
        state: metadata[0],
        snapshotId: metadata[1],
        participantCount: metadata[2],
        batchId: metadata[3],
        bucketExponent: metadata[4],
        bucketAttemptNonce: metadata[5],
        resolutionPhase: resolution[0],
        shardSelectionCursor: resolution[1],
        winnerShardCursor: resolution[2],
        winnerCursor: resolution[3],
      };
    },
    [publicClient],
  );

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
        nextDrawSnapshotId,
        snapshotInProgress,
        snapshotReady,
        snapshotParticipantCount,
        snapshotCursor,
      ] = await Promise.all([
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "activeEpochId",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "activeEpochEnd",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "nextSnapshotId",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "currentSnapshotId",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "nextDrawSnapshotId",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "snapshotInProgress",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "snapshotReady",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "snapshotParticipantCount",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "snapshotCursor",
        }),
      ]);

      const pendingSnapshotId = nextDrawSnapshotId <= nextSnapshotId ? nextDrawSnapshotId : 0n;

      let pendingSnapshot: SnapshotMetadata | null = null;
      let pendingImport: ImportMetadata | null = null;

      if (pendingSnapshotId > 0n) {
        const row = await publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "snapshotMetadata",
          args: [pendingSnapshotId],
        });

        pendingSnapshot = {
          snapshotId: pendingSnapshotId,
          cutoff: row[0],
          participantCount: row[1],
          cursor: row[2],
          inProgress: row[3],
          ready: row[4],
        };

        if (row[4]) {
          try {
            const imported = await publicClient.readContract({
              address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_V2_ABI,
              functionName: "drawSnapshotImportMetadata",
              args: [pendingSnapshotId],
            });

            pendingImport = {
              participantCount: imported[0],
              cursor: imported[1],
              initialized: imported[2],
              sealed: imported[3],
            };
          } catch {
            pendingImport = {
              participantCount: row[1],
              cursor: 0n,
              initialized: false,
              sealed: false,
            };
          }
        }
      }

      const latestRoundSnapshotId = nextDrawSnapshotId > 1n ? nextDrawSnapshotId - 1n : 0n;

      const childDraws: ChildDraw[] = [];

      if (latestRoundSnapshotId > 0n) {
        const childIds = await Promise.all(
          [0n, 1n, 2n].map((prizeIndex) =>
            publicClient.readContract({
              address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_V2_ABI,
              functionName: "snapshotPrizeDrawId",
              args: [latestRoundSnapshotId, prizeIndex],
            }),
          ),
        );

        for (let prizeIndex = 0; prizeIndex < VEILDRAW_V2_PRIZE_COUNT; prizeIndex += 1) {
          const drawId = childIds[prizeIndex];

          if (drawId === 0n) continue;

          childDraws.push(await readChildDraw(drawId, latestRoundSnapshotId, prizeIndex));
        }
      }

      setSnapshot({
        activeEpochId,
        activeEpochEnd,
        nextSnapshotId,
        currentSnapshotId,
        nextDrawSnapshotId,
        snapshotInProgress,
        snapshotReady,
        snapshotParticipantCount,
        snapshotCursor,
        pendingSnapshot,
        pendingImport,
        latestRoundSnapshotId,
        childDraws,
      });
    } catch (error: unknown) {
      setNotice("Live VeilDraw discovery stopped safely. " + errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [publicClient, readChildDraw]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

  const stageExactPoolCall = useCallback(
    async (key: string, label: string, consequence: string, data: Hex) => {
      setNotice(null);

      await exact.prepare({
        key,
        label,
        consequence,
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });
    },
    [exact],
  );

  const stageSnapshotLifecycle = useCallback(
    async (
      action:
        | "start-snapshot"
        | "process-snapshot"
        | "finalize-snapshot"
        | "begin-import"
        | "process-import"
        | "finalize-import"
        | "start-round",
    ) => {
      if (snapshot === null) return;

      if (action === "start-snapshot") {
        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "startSnapshot",
        });

        await stageExactPoolCall(
          `veildraw-v2:start-snapshot:${snapshot.activeEpochId.toString()}`,
          "Start immutable VeilDraw snapshot",
          "Freeze the closing epoch at its configured cutoff. No confidential balance or TWAB value is decrypted.",
          data,
        );
        return;
      }

      if (action === "process-snapshot") {
        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "processSnapshotChunk",
        });

        await stageExactPoolCall(
          `veildraw-v2:process-snapshot:${snapshot.currentSnapshotId.toString()}:${snapshot.snapshotCursor.toString()}`,
          "Process next immutable snapshot chunk",
          "Materialize the next fixed participant snapshot chunk without revealing encrypted weights.",
          data,
        );
        return;
      }

      if (action === "finalize-snapshot") {
        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "finalizeSnapshot",
        });

        await stageExactPoolCall(
          `veildraw-v2:finalize-snapshot:${snapshot.currentSnapshotId.toString()}`,
          "Finalize immutable VeilDraw snapshot",
          "Mark the fully processed snapshot ready without decrypting its total or any saver weight.",
          data,
        );
        return;
      }

      const pending = snapshot.pendingSnapshot;

      if (pending === null) {
        setNotice("No finalized next draw snapshot is currently available.");
        return;
      }

      if (action === "begin-import") {
        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "beginDrawSnapshotImport",
          args: [pending.snapshotId],
        });

        await stageExactPoolCall(
          `veildraw-v2:begin-import:${pending.snapshotId.toString()}`,
          "Begin private Engine snapshot import",
          "Initialize the non-custodial Engine copy for the exact finalized Pool snapshot.",
          data,
        );
        return;
      }

      if (action === "process-import") {
        const cursor = snapshot.pendingImport?.cursor ?? 0n;

        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "processDrawSnapshotImportChunk",
          args: [pending.snapshotId],
        });

        await stageExactPoolCall(
          `veildraw-v2:process-import:${pending.snapshotId.toString()}:${cursor.toString()}`,
          "Import next private Engine shard",
          "Transfer only transaction-scoped ciphertext access for the next fixed eight-seat snapshot shard.",
          data,
        );
        return;
      }

      if (action === "finalize-import") {
        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "finalizeDrawSnapshotImport",
          args: [pending.snapshotId],
        });

        await stageExactPoolCall(
          `veildraw-v2:finalize-import:${pending.snapshotId.toString()}`,
          "Seal private Engine snapshot",
          "Seal the immutable Engine snapshot only after every real Pool slot has been copied.",
          data,
        );
        return;
      }

      const data = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "startDraw",
      });

      await stageExactPoolCall(
        `veildraw-v2:start-round:${pending.snapshotId.toString()}`,
        "Start three private VeilDraw prizes",
        "Atomically allocate exactly three independent child draws from one immutable sealed snapshot.",
        data,
      );
    },
    [snapshot, stageExactPoolCall],
  );

  const decryptBucketEvidence = useCallback(
    async (draw: ChildDraw) => {
      if (publicClient === undefined) return;

      setLoading(true);
      setNotice(
        "Decrypting only contract-authorized bucket evidence. Snapshot total, target, shard and winner remain encrypted.",
      );

      try {
        const before = await readChildDraw(draw.drawId, draw.snapshotId, draw.prizeIndex);

        if (
          before.state !== VEILDRAW_V2_DRAW_STATE.BUCKET_DISCOVERY ||
          before.bucketAttemptNonce === 0n
        ) {
          throw new Error("Bucket evidence is no longer pending for this exact child draw.");
        }

        const handles = await publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "drawBucketEvidenceHandles",
          args: [draw.drawId],
        });

        const result = await zama.decryption.decryptPublicValues(
          [handles[0], handles[1], handles[2], handles[3]],
          {
            timeout: 180_000,
          },
        );

        const clearExponent = parsePublicBigInt(readClear(result.clearValues, handles[0]));
        const clearZero = parsePublicBoolean(readClear(result.clearValues, handles[1]));
        const clearSupported = parsePublicBoolean(readClear(result.clearValues, handles[2]));
        const clearContext = parsePublicBigInt(readClear(result.clearValues, handles[3]));

        if (clearExponent > 255n) {
          throw new Error("Bucket exponent does not fit uint8.");
        }

        const expectedContext = await publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
          abi: VEILDRAW_ENGINE_V2_ABI,
          functionName: "drawProofContextValue",
          args: [1, draw.drawId, 0n, before.bucketAttemptNonce],
        });

        if (clearContext !== expectedContext) {
          throw new Error("Bucket proof context does not match the exact current child draw.");
        }

        const [after, handlesAfter] = await Promise.all([
          readChildDraw(draw.drawId, draw.snapshotId, draw.prizeIndex),
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "drawBucketEvidenceHandles",
            args: [draw.drawId],
          }),
        ]);

        if (!sameDrawBinding(before, after)) {
          throw new Error(
            "Child draw state moved during bucket decryption. The proof was discarded.",
          );
        }

        for (let index = 0; index < 4; index += 1) {
          if (!sameHandle(handles[index], handlesAfter[index])) {
            throw new Error(
              "Bucket evidence handle moved during decryption. The proof was discarded.",
            );
          }
        }

        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "submitDrawBucketEvidence",
          args: [
            draw.drawId,
            draw.snapshotId,
            Number(clearExponent),
            clearZero,
            clearSupported,
            result.decryptionProof,
          ],
        });

        await stageExactPoolCall(
          `veildraw-v2:settle-bucket:${draw.drawId.toString()}:${before.bucketAttemptNonce.toString()}`,
          `Settle Prize ${String(draw.prizeIndex + 1)} bucket evidence`,
          "Authenticate the exact public bucket evidence. No candidate, accepted target, selected shard or winner is disclosed.",
          data,
        );

        setPublicEvidence(
          `Prize ${String(draw.prizeIndex + 1)} bucket evidence: exponent=${clearExponent.toString()}, zero=${String(clearZero)}, supported=${String(clearSupported)}, proofContext=${clearContext.toString()}.`,
        );
      } catch (error: unknown) {
        setNotice(errorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [publicClient, readChildDraw, stageExactPoolCall, zama.decryption],
  );

  const decryptBatchEvidence = useCallback(
    async (draw: ChildDraw) => {
      if (publicClient === undefined) return;

      setLoading(true);
      setNotice(
        "Decrypting only public batch success and its exact proof context. Candidate values and accepted target remain encrypted.",
      );

      try {
        const before = await readChildDraw(draw.drawId, draw.snapshotId, draw.prizeIndex);

        if (before.state !== VEILDRAW_V2_DRAW_STATE.BATCH_PROOF_PENDING || before.batchId === 0n) {
          throw new Error("Batch evidence is no longer pending for this exact child draw.");
        }

        const handles = await publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "drawBatchHandles",
          args: [draw.drawId],
        });

        const successHandle = handles[1];
        const contextHandle = handles[2];

        const result = await zama.decryption.decryptPublicValues([successHandle, contextHandle], {
          timeout: 180_000,
        });

        const clearSuccess = parsePublicBoolean(readClear(result.clearValues, successHandle));
        const clearContext = parsePublicBigInt(readClear(result.clearValues, contextHandle));

        const expectedContext = await publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
          abi: VEILDRAW_ENGINE_V2_ABI,
          functionName: "drawProofContextValue",
          args: [2, draw.drawId, before.batchId, before.batchId],
        });

        if (clearContext !== expectedContext) {
          throw new Error("Batch proof context does not match the exact current child draw.");
        }

        const [after, handlesAfter] = await Promise.all([
          readChildDraw(draw.drawId, draw.snapshotId, draw.prizeIndex),
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "drawBatchHandles",
            args: [draw.drawId],
          }),
        ]);

        if (!sameDrawBinding(before, after)) {
          throw new Error(
            "Child draw state moved during batch decryption. The proof was discarded.",
          );
        }

        if (
          !sameHandle(successHandle, handlesAfter[1]) ||
          !sameHandle(contextHandle, handlesAfter[2])
        ) {
          throw new Error(
            "Batch evidence handle moved during decryption. The proof was discarded.",
          );
        }

        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "submitDrawBatchEvidence",
          args: [
            draw.drawId,
            draw.snapshotId,
            before.batchId,
            clearSuccess,
            result.decryptionProof,
          ],
        });

        await stageExactPoolCall(
          `veildraw-v2:settle-batch:${draw.drawId.toString()}:${before.batchId.toString()}`,
          `Settle Prize ${String(draw.prizeIndex + 1)} batch evidence`,
          clearSuccess
            ? "Authenticate that this fixed private batch contains a valid candidate and freeze its encrypted accepted target."
            : "Authenticate that this fixed private batch contains no valid candidate and permit a fresh fixed batch.",
          data,
        );

        setPublicEvidence(
          `Prize ${String(draw.prizeIndex + 1)} batch evidence: success=${String(clearSuccess)}, proofContext=${clearContext.toString()}. Candidate target remains encrypted.`,
        );
      } catch (error: unknown) {
        setNotice(errorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [publicClient, readChildDraw, stageExactPoolCall, zama.decryption],
  );

  const stageDrawProgress = useCallback(
    async (draw: ChildDraw) => {
      const action = nextVeilDrawV2Action(draw);

      if (action === null) {
        setNotice(
          `Prize ${String(draw.prizeIndex + 1)} has no valid next public progression action from its current state.`,
        );
        return;
      }

      if (action === "settle-bucket-evidence") {
        await decryptBucketEvidence(draw);
        return;
      }

      if (action === "settle-batch-evidence") {
        await decryptBatchEvidence(draw);
        return;
      }

      let data: Hex;

      switch (action) {
        case "prepare-bucket-evidence":
          data = encodeFunctionData({
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "prepareDrawBucketEvidence",
            args: [draw.drawId, draw.snapshotId],
          });
          break;

        case "generate-candidate-batch":
          data = encodeFunctionData({
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "generateDrawCandidateBatch",
            args: [draw.drawId, draw.snapshotId],
          });
          break;

        case "reduce-candidate-batch":
          data = encodeFunctionData({
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "reduceDrawCandidateBatch",
            args: [draw.drawId, draw.snapshotId, draw.batchId],
          });
          break;

        case "start-winner-resolution":
          data = encodeFunctionData({
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "startWinnerResolution",
            args: [draw.drawId, draw.snapshotId],
          });
          break;

        case "process-shard-selection":
          data = encodeFunctionData({
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "processDrawShardSelectionChunk",
            args: [draw.drawId, draw.snapshotId],
          });
          break;

        case "process-winner-shard":
          data = encodeFunctionData({
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "processDrawWinnerShard",
            args: [draw.drawId, draw.snapshotId],
          });
          break;

        case "finalize-draw":
          data = encodeFunctionData({
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "finalizeDraw",
            args: [draw.drawId, draw.snapshotId],
          });
          break;

        default:
          return;
      }

      await stageExactPoolCall(
        `veildraw-v2:${action}:${draw.drawId.toString()}:${draw.batchId.toString()}:${draw.shardSelectionCursor.toString()}:${draw.winnerShardCursor.toString()}`,
        `Prize ${String(draw.prizeIndex + 1)} · ${veilDrawV2ActionLabel(action)}`,
        drawActionDescription(action),
        data,
      );
    },
    [decryptBatchEvidence, decryptBucketEvidence, stageExactPoolCall],
  );

  const snapshotAction = useMemo(() => {
    if (snapshot === null) return null;

    if (snapshot.snapshotInProgress) {
      return snapshot.snapshotCursor < snapshot.snapshotParticipantCount
        ? ("process-snapshot" as const)
        : ("finalize-snapshot" as const);
    }

    if (nowSeconds >= snapshot.activeEpochEnd) {
      return "start-snapshot" as const;
    }

    return null;
  }, [nowSeconds, snapshot]);

  const importAction = useMemo(() => {
    if (!snapshot?.pendingSnapshot?.ready) {
      return null;
    }

    const imported = snapshot.pendingImport;

    if (!imported?.initialized) {
      return "begin-import" as const;
    }

    if (!imported.sealed && imported.cursor < imported.participantCount) {
      return "process-import" as const;
    }

    if (!imported.sealed && imported.cursor === imported.participantCount) {
      return "finalize-import" as const;
    }

    if (imported.sealed) {
      return "start-round" as const;
    }

    return null;
  }, [snapshot]);

  const allLatestChildrenFinalized =
    snapshot !== null &&
    snapshot.childDraws.length === VEILDRAW_V2_PRIZE_COUNT &&
    snapshot.childDraws.every((draw) => draw.state === VEILDRAW_V2_DRAW_STATE.FINALIZED);

  return (
    <section className="workspace-stack">
      <article className="workspace-card block">
        <Gift size={21} aria-hidden="true" />

        <span className="eyebrow">LIVE VEILDRAW · THREE PRIZES</span>

        <h2>One immutable savings round. Three independent private winners.</h2>

        <p>
          Live Sepolia state drives the Pool and private draw engine directly. Saver weights, random
          candidates, accepted targets, selected shards and winner predicates remain encrypted. Only
          the exact proof consequences explicitly authorized by the contracts can be publicly
          decrypted.
        </p>

        <div className="financial-live-status">
          <div>
            <span>Epoch</span>
            <strong>{snapshot?.activeEpochId.toString() ?? "—"}</strong>
          </div>

          <div>
            <span>Next cutoff</span>
            <strong>{snapshot === null ? "—" : timeLabel(snapshot.activeEpochEnd)}</strong>
          </div>

          <div>
            <span>Pool snapshot</span>
            <strong>{snapshot?.currentSnapshotId.toString() ?? "—"}</strong>
          </div>

          <div>
            <span>Latest draw round</span>
            <strong>{snapshot?.latestRoundSnapshotId.toString() ?? "—"}</strong>
          </div>
        </div>

        <button
          className="financial-secondary-button"
          type="button"
          disabled={loading || exact.isWalletPending}
          onClick={() => {
            void refresh();
          }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Refresh live draw state
        </button>
      </article>

      <article className="workspace-card block">
        <span className="eyebrow">SNAPSHOT PIPELINE</span>

        <h2>Permissionless epoch materialization.</h2>

        <div className="financial-live-status">
          <div>
            <span>Snapshot progress</span>
            <strong>
              {snapshot === null
                ? "—"
                : `${snapshot.snapshotCursor.toString()} / ${snapshot.snapshotParticipantCount.toString()}`}
            </strong>
          </div>

          <div>
            <span>Snapshot ready</span>
            <strong>{String(snapshot?.snapshotReady ?? false)}</strong>
          </div>

          <div>
            <span>Next draw snapshot</span>
            <strong>{snapshot?.nextDrawSnapshotId.toString() ?? "—"}</strong>
          </div>

          <div>
            <span>Engine import</span>
            <strong>
              {snapshot?.pendingImport === null || snapshot?.pendingImport === undefined
                ? "Not initialized"
                : snapshot.pendingImport.sealed
                  ? "SEALED"
                  : `${snapshot.pendingImport.cursor.toString()} / ${snapshot.pendingImport.participantCount.toString()}`}
            </strong>
          </div>
        </div>

        <div className="workspace-inline-actions">
          {snapshotAction !== null ? (
            <button
              className="financial-primary-button"
              type="button"
              disabled={loading || exact.attempt !== null || exact.isWalletPending}
              onClick={() => {
                void stageSnapshotLifecycle(snapshotAction);
              }}
            >
              <Sparkles size={15} aria-hidden="true" />

              {snapshotAction === "start-snapshot"
                ? "Prepare epoch snapshot"
                : snapshotAction === "process-snapshot"
                  ? "Prepare next snapshot chunk"
                  : "Prepare snapshot finalization"}
            </button>
          ) : null}

          {importAction !== null ? (
            <button
              className="financial-secondary-button"
              type="button"
              disabled={loading || exact.attempt !== null || exact.isWalletPending}
              onClick={() => {
                void stageSnapshotLifecycle(importAction);
              }}
            >
              <LockKeyhole size={15} aria-hidden="true" />

              {importAction === "begin-import"
                ? "Prepare Engine import"
                : importAction === "process-import"
                  ? "Prepare next private import shard"
                  : importAction === "finalize-import"
                    ? "Prepare Engine snapshot seal"
                    : "Prepare three-prize round"}
            </button>
          ) : null}
        </div>
      </article>

      <article className="workspace-card block">
        <span className="eyebrow">PRIVATE PRIZE TRACKS</span>

        <h2>Three child draws advance independently.</h2>

        {snapshot?.childDraws.length === 0 ? (
          <div className="financial-state-card">
            <CircleDashed size={18} aria-hidden="true" />

            <div>
              <strong>No child draw has been allocated yet</strong>
              <p>Veilpot does not fabricate draw state, winners or prize values.</p>
            </div>
          </div>
        ) : null}

        {snapshot?.childDraws.map((draw) => {
          const nextAction = nextVeilDrawV2Action(draw);
          const terminal = veilDrawV2IsTerminal(draw.state);

          return (
            <div className="financial-state-card" key={draw.drawId.toString()}>
              {draw.state === VEILDRAW_V2_DRAW_STATE.FINALIZED ? (
                <CircleCheck size={18} aria-hidden="true" />
              ) : (
                <CircleDashed size={18} aria-hidden="true" />
              )}

              <div>
                <strong>
                  Prize {String(draw.prizeIndex + 1)} · {veilDrawV2StateName(draw.state)}
                </strong>

                <p>
                  Draw #{draw.drawId.toString()} · Snapshot #{draw.snapshotId.toString()}
                </p>

                <span>
                  Resolution {veilDrawV2ResolutionPhaseName(draw.resolutionPhase)} · shard selectors{" "}
                  {draw.shardSelectionCursor.toString()}/16 · winner shards{" "}
                  {draw.winnerShardCursor.toString()}/16
                </span>

                {nextAction !== null ? (
                  <button
                    className="financial-secondary-button"
                    type="button"
                    disabled={loading || exact.attempt !== null || exact.isWalletPending}
                    onClick={() => {
                      void stageDrawProgress(draw);
                    }}
                  >
                    <ShieldCheck size={15} aria-hidden="true" />
                    {veilDrawV2ActionLabel(nextAction)}
                  </button>
                ) : terminal ? (
                  <span>
                    {draw.state === VEILDRAW_V2_DRAW_STATE.FINALIZED
                      ? "Private child draw finalized. Winner identity remains encrypted."
                      : draw.state === VEILDRAW_V2_DRAW_STATE.NO_WEIGHT_TERMINAL
                        ? "Terminal zero-weight child. No winner was fabricated."
                        : "Terminal unsupported total. No unsafe draw progression is offered."}
                  </span>
                ) : (
                  <span>No safe next action is inferred from the current public metadata.</span>
                )}
              </div>
            </div>
          );
        })}

        {allLatestChildrenFinalized ? (
          <div className="financial-state-card">
            <CircleCheck size={18} aria-hidden="true" />

            <div>
              <strong>All three child draws finalized privately</strong>
              <p>
                The round is ready for yield recognition, confidential prize funding, encrypted
                entitlement assignment and historical-owner claiming.
              </p>
            </div>
          </div>
        ) : null}
      </article>

      <ExactActionReviewCard controller={exact} />

      {publicEvidence !== null ? (
        <div className="financial-state-card">
          <ShieldCheck size={18} aria-hidden="true" />

          <div>
            <strong>Explicit public consequence evidence</strong>
            <p>{publicEvidence}</p>
          </div>
        </div>
      ) : null}

      {notice !== null ? (
        <div className="financial-state-card warning">
          <ShieldCheck size={18} aria-hidden="true" />

          <div>
            <strong>VeilDraw notice</strong>
            <p>{notice}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
