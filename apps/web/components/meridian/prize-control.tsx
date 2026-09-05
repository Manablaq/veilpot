"use client";

import { CircleCheck, CircleDashed, Gift, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { useZamaSDK } from "@zama-fhe/react-sdk";
import { usePublicClient } from "wagmi";

import {
  VEILDRAW_ENGINE_V2_ABI,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_ADAPTER_V2_ABI,
  VEILPOT_POOL_V2_ABI,
  VEILPOT_RESERVE_ABI,
} from "@veilpot/protocol-sdk";

import { ExactActionReviewCard, useExactAction } from "@/components/exact-action-control";
import { VEILPOT_V2_EXACT_ACTION_SCOPE } from "@/lib/deployment-scope";
import { PRIZE_V2_STATE, YIELD_V2_STATE, roundReadyForYield } from "@/lib/prize-v2";
import { VEILDRAW_V2_DRAW_STATE } from "@/lib/veildraw-v2";

interface YieldSnapshot {
  readonly state: number;
  readonly statusPredicate: Hex;
  readonly proofContext: Hex;
  readonly sweepAttemptNonce: bigint;
  readonly snapshotId: bigint;
  readonly prizeIndex: number;
}

interface PrizeSnapshot {
  readonly state: number;
  readonly statusPredicate: Hex;
  readonly proofContext: Hex;
  readonly participantCount: bigint;
  readonly assignmentCursor: bigint;
  readonly statusAttemptNonce: bigint;
  readonly statusProofDeadline: bigint;
}

interface PrizeChildSnapshot {
  readonly drawId: bigint;
  readonly prizeIndex: number;
  readonly snapshotId: bigint;
  readonly drawState: number;
  readonly yield: YieldSnapshot | null;
  readonly prize: PrizeSnapshot | null;
}

interface PrizeRoundSnapshot {
  readonly snapshotId: bigint;
  readonly roundRecognized: boolean;
  readonly allChildrenFinalized: boolean;
  readonly children: readonly PrizeChildSnapshot[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The corrected V2.x yield/prize action stopped safely.";
}

function parsePublicBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n || value === "1" || value === "true") {
    return true;
  }

  if (value === false || value === 0 || value === 0n || value === "0" || value === "false") {
    return false;
  }

  throw new Error("The public proof result is not a canonical boolean.");
}

function parsePublicBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }

  throw new Error("The public proof context is not a canonical unsigned integer.");
}

function readClear(values: Readonly<Record<string, unknown>>, handle: Hex): unknown {
  const entry = Object.entries(values).find(([key]) => key.toLowerCase() === handle.toLowerCase());

  if (entry === undefined) {
    throw new Error("Public decryption did not return the exact requested handle.");
  }

  return entry[1];
}

function sameHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameYieldEvidence(left: YieldSnapshot, right: YieldSnapshot): boolean {
  return (
    left.state === right.state &&
    left.snapshotId === right.snapshotId &&
    left.prizeIndex === right.prizeIndex &&
    left.sweepAttemptNonce === right.sweepAttemptNonce &&
    sameHex(left.statusPredicate, right.statusPredicate) &&
    sameHex(left.proofContext, right.proofContext)
  );
}

function samePrizeEvidence(left: PrizeSnapshot, right: PrizeSnapshot): boolean {
  return (
    left.state === right.state &&
    left.participantCount === right.participantCount &&
    left.assignmentCursor === right.assignmentCursor &&
    left.statusAttemptNonce === right.statusAttemptNonce &&
    left.statusProofDeadline === right.statusProofDeadline &&
    sameHex(left.statusPredicate, right.statusPredicate) &&
    sameHex(left.proofContext, right.proofContext)
  );
}

function yieldStateName(state: number): string {
  switch (state) {
    case YIELD_V2_STATE.NONE:
      return "NONE";
    case YIELD_V2_STATE.RECOGNITION_PROOF_PENDING:
      return "RECOGNITION PROOF";
    case YIELD_V2_STATE.RECOGNIZED:
      return "RECOGNIZED";
    case YIELD_V2_STATE.SWEEP_PROOF_PENDING:
      return "SWEEP PROOF";
    case YIELD_V2_STATE.FUNDING_FINALIZED:
      return "FUNDING FINALIZED";
    default:
      return `UNKNOWN ${String(state)}`;
  }
}

function prizeStateName(state: number): string {
  switch (state) {
    case PRIZE_V2_STATE.UNPREPARED:
      return "UNPREPARED";
    case PRIZE_V2_STATE.STATUS_PROOF_PENDING:
      return "STATUS PROOF";
    case PRIZE_V2_STATE.ASSIGNING:
      return "ASSIGNING";
    case PRIZE_V2_STATE.CLAIMABLE:
      return "CLAIMABLE";
    case PRIZE_V2_STATE.CLAIMED:
      return "CLAIMED";
    case PRIZE_V2_STATE.NO_PRIZE:
      return "NO PRIZE";
    case PRIZE_V2_STATE.TRANSFER_PROOF_PENDING:
      return "TRANSFER PROOF";
    default:
      return `UNKNOWN ${String(state)}`;
  }
}

function currentSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function MeridianPrizeLifecycleControl({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });
  const zama = useZamaSDK();
  const exact = useExactAction(authenticatedAddress, VEILPOT_V2_EXACT_ACTION_SCOPE);

  const [round, setRound] = useState<PrizeRoundSnapshot | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publicEvidence, setPublicEvidence] = useState<string | null>(null);

  const readRound = useCallback(async (): Promise<PrizeRoundSnapshot | null> => {
    if (publicClient === undefined) {
      throw new Error("Ethereum Sepolia public client is unavailable.");
    }

    const nextDrawSnapshotId = await publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "nextDrawSnapshotId",
    });

    if (nextDrawSnapshotId <= 1n) {
      return null;
    }

    const snapshotId = nextDrawSnapshotId - 1n;

    const childIds = await Promise.all(
      [0n, 1n, 2n].map((prizeIndex) =>
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "snapshotPrizeDrawId",
          args: [snapshotId, prizeIndex],
        }),
      ),
    );

    const roundRecognized = await publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.adapter,
      abi: VEILPOT_ADAPTER_V2_ABI,
      functionName: "roundRecognized",
      args: [snapshotId],
    });

    if (roundRecognized) {
      const adapterDrawIds = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.adapter,
        abi: VEILPOT_ADAPTER_V2_ABI,
        functionName: "roundDrawIds",
        args: [snapshotId],
      });

      for (let index = 0; index < 3; index += 1) {
        if (adapterDrawIds[index] !== childIds[index]) {
          throw new Error(
            "Adapter round IDs no longer match the Pool snapshotPrizeDrawId binding.",
          );
        }
      }
    }

    const children: PrizeChildSnapshot[] = [];

    for (let prizeIndex = 0; prizeIndex < 3; prizeIndex += 1) {
      const drawId = childIds[prizeIndex];

      if (drawId === 0n) {
        continue;
      }

      const [metadata, enginePrizeIndex] = await Promise.all([
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
          abi: VEILDRAW_ENGINE_V2_ABI,
          functionName: "drawMetadataV2",
          args: [drawId],
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
          abi: VEILDRAW_ENGINE_V2_ABI,
          functionName: "drawPrizeIndex",
          args: [drawId],
        }),
      ]);

      if (metadata[1] !== snapshotId || enginePrizeIndex !== prizeIndex) {
        throw new Error("Engine draw metadata no longer matches the Pool snapshot/prize binding.");
      }

      let yieldSnapshot: YieldSnapshot | null = null;

      if (roundRecognized) {
        const [handles, roundMetadata] = await Promise.all([
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.adapter,
            abi: VEILPOT_ADAPTER_V2_ABI,
            functionName: "drawYieldHandles",
            args: [drawId],
          }),
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.adapter,
            abi: VEILPOT_ADAPTER_V2_ABI,
            functionName: "drawRoundMetadata",
            args: [drawId],
          }),
        ]);

        if (roundMetadata[0] !== snapshotId || roundMetadata[1] !== prizeIndex) {
          throw new Error(
            "Adapter child-yield metadata no longer matches its corrected V2.x round binding.",
          );
        }

        yieldSnapshot = {
          state: handles[0],
          statusPredicate: handles[4],
          proofContext: handles[5],
          sweepAttemptNonce: handles[6],
          snapshotId: roundMetadata[0],
          prizeIndex: roundMetadata[1],
        };
      }

      let prizeSnapshot: PrizeSnapshot | null = null;

      try {
        const handles = await publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
          abi: VEILPOT_RESERVE_ABI,
          functionName: "prizeHandles",
          args: [drawId],
        });

        prizeSnapshot = {
          state: handles[0],
          statusPredicate: handles[4],
          proofContext: handles[5],
          participantCount: handles[6],
          assignmentCursor: handles[7],
          statusAttemptNonce: handles[8],
          statusProofDeadline: handles[9],
        };
      } catch {
        prizeSnapshot = null;
      }

      children.push({
        drawId,
        prizeIndex,
        snapshotId,
        drawState: metadata[0],
        yield: yieldSnapshot,
        prize: prizeSnapshot,
      });
    }

    const allChildrenFinalized =
      children.length === 3 &&
      roundReadyForYield(
        snapshotId,
        children.map((child) => ({
          prizeIndex: child.prizeIndex,
          drawId: child.drawId,
          snapshotId: child.snapshotId,
          state: child.drawState,
        })),
      );

    return {
      snapshotId,
      roundRecognized,
      allChildrenFinalized,
      children,
    };
  }, [publicClient]);

  const refresh = useCallback(async () => {
    setLoadingKey("refresh");
    setNotice(null);

    try {
      setRound(await readRound());
    } catch (error: unknown) {
      setRound(null);
      setNotice("Live corrected V2.x yield/prize discovery stopped safely. " + errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [readRound]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (exact.status.kind === "included" || exact.status.kind === "reverted") {
      void refresh();
    }
  }, [exact.status, refresh]);

  const stageAdapterAction = useCallback(
    async (
      key: string,
      label: string,
      consequence: string,
      functionName: "settleRecognition" | "sweepYield" | "settleSweepCompletion",
      args: readonly unknown[],
    ) => {
      const data = encodeFunctionData({
        abi: VEILPOT_ADAPTER_V2_ABI,
        functionName,
        args: args as never,
      });

      await exact.prepare({
        key,
        label,
        consequence,
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.adapter,
        data,
        value: 0n,
      });
    },
    [exact],
  );

  const stageReserveAction = useCallback(
    async (
      key: string,
      label: string,
      consequence: string,
      functionName:
        | "preparePrize"
        | "settlePrizeStatus"
        | "refreshPrizeStatusEvidence"
        | "assignPrizeEntitlementChunk",
      args: readonly unknown[],
    ) => {
      const data = encodeFunctionData({
        abi: VEILPOT_RESERVE_ABI,
        functionName,
        args: args as never,
      });

      await exact.prepare({
        key,
        label,
        consequence,
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        data,
        value: 0n,
      });
    },
    [exact],
  );

  const recognizeRoundYield = useCallback(async () => {
    setNotice(null);

    try {
      const latest = await readRound();

      if (latest === null || !latest.allChildrenFinalized || latest.roundRecognized) {
        throw new Error(
          "Round yield can be recognized only once after all three exact child draws are FINALIZED.",
        );
      }

      const data = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "recognizeRoundYield",
        args: [latest.snapshotId],
      });

      await exact.prepare({
        key: `prize-v2:recognize-round-yield:${latest.snapshotId.toString()}`,
        label: "Recognize simulated three-prize round yield",
        consequence:
          "Ask Pool V2 to recognize one encrypted simulated Sepolia round yield only after all three exact child draws finalized. No TWAB, winner, target or yield amount is decrypted.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    }
  }, [exact, readRound]);

  const settleYieldEvidence = useCallback(
    async (child: PrizeChildSnapshot, phase: "recognition" | "sweep") => {
      const before = child.yield;

      if (before === null) {
        setNotice("No corrected V2.x child-yield evidence exists for this draw.");
        return;
      }

      if (phase === "recognition" && before.state !== YIELD_V2_STATE.RECOGNITION_PROOF_PENDING) {
        setNotice("Recognition evidence is not pending for this child draw.");
        return;
      }

      if (phase === "sweep" && before.state !== YIELD_V2_STATE.SWEEP_PROOF_PENDING) {
        setNotice("Sweep-completion evidence is not pending for this child draw.");
        return;
      }

      setLoadingKey(`yield-proof:${phase}:${child.drawId.toString()}`);
      setNotice(
        phase === "recognition"
          ? "Explicitly decrypting only the contract-authorized public child-yield zero predicate and exact proof context."
          : "Explicitly decrypting only the contract-authorized public sweep-completion predicate and exact proof context.",
      );

      try {
        const result = await zama.decryption.decryptPublicValues(
          [before.statusPredicate, before.proofContext],
          { timeout: 180_000 },
        );

        const clearStatus = parsePublicBoolean(
          readClear(result.clearValues, before.statusPredicate),
        );
        const clearContext = parsePublicBigInt(readClear(result.clearValues, before.proofContext));

        const latest = await readRound();
        const after = latest?.children.find((candidate) => candidate.drawId === child.drawId);

        if (
          after?.yield === null ||
          after?.yield === undefined ||
          !sameYieldEvidence(before, after.yield)
        ) {
          throw new Error(
            "Yield evidence changed while public decryption was in progress. The stale proof was discarded.",
          );
        }

        if (phase === "recognition") {
          await stageAdapterAction(
            `prize-v2:settle-yield-recognition:${child.drawId.toString()}`,
            "Settle child-yield recognition evidence",
            clearStatus
              ? "Verify this child recognized exactly zero simulated yield and finalize its funding state."
              : "Verify this child recognized nonzero simulated yield and unlock only its fixed-recipient reserve sweep.",
            "settleRecognition",
            [child.drawId, clearStatus, result.decryptionProof],
          );
        } else {
          await stageAdapterAction(
            `prize-v2:settle-yield-sweep:${child.drawId.toString()}:${before.sweepAttemptNonce.toString()}`,
            "Settle child-yield sweep completion",
            clearStatus
              ? "Verify the child simulated-yield residual reached exact zero and finalize reserve funding."
              : "Verify a residual still exists and return the child to the fixed-recipient sweep state.",
            "settleSweepCompletion",
            [child.drawId, before.sweepAttemptNonce, clearStatus, result.decryptionProof],
          );
        }

        setPublicEvidence(
          `${phase === "recognition" ? "Yield recognition" : "Yield sweep"} draw ${child.drawId.toString()}: publicStatus=${String(clearStatus)}, proofContext=${clearContext.toString()}. No confidential yield amount was revealed.`,
        );
      } catch (error: unknown) {
        setNotice(errorMessage(error));
      } finally {
        setLoadingKey(null);
      }
    },
    [readRound, stageAdapterAction, zama.decryption],
  );

  const sweepYield = useCallback(
    async (child: PrizeChildSnapshot) => {
      if (child.yield?.state !== YIELD_V2_STATE.RECOGNIZED) {
        setNotice("This child yield is not in RECOGNIZED state.");
        return;
      }

      await stageAdapterAction(
        `prize-v2:sweep-yield:${child.drawId.toString()}`,
        "Sweep child simulated yield to Prize Reserve",
        "Attempt the fixed-recipient transfer from Yield Adapter V2 to the immutable Prize Reserve. The confidential amount stays encrypted and accounting uses only the token-returned actual transfer.",
        "sweepYield",
        [child.drawId],
      );
    },
    [stageAdapterAction],
  );

  const preparePrize = useCallback(
    async (child: PrizeChildSnapshot) => {
      if (child.yield?.state !== YIELD_V2_STATE.FUNDING_FINALIZED) {
        setNotice(
          "Prize preparation is forbidden until this exact child yield reaches FUNDING_FINALIZED.",
        );
        return;
      }

      if (child.prize !== null && child.prize.state !== PRIZE_V2_STATE.UNPREPARED) {
        setNotice("This prize has already left UNPREPARED state.");
        return;
      }

      await stageReserveAction(
        `prize-v2:prepare:${child.drawId.toString()}`,
        "Prepare encrypted prize liability",
        "Freeze only realized child yield and explicit sponsor funding into this finalized draw's encrypted prize liability. Only the zero/nonzero status predicate becomes publicly decryptable.",
        "preparePrize",
        [child.drawId],
      );
    },
    [stageReserveAction],
  );

  const settlePrizeStatus = useCallback(
    async (child: PrizeChildSnapshot) => {
      const before = child.prize;

      if (before?.state !== PRIZE_V2_STATE.STATUS_PROOF_PENDING) {
        setNotice("Prize status evidence is not pending for this draw.");
        return;
      }

      if (currentSeconds() > before.statusProofDeadline) {
        setNotice(
          "This prize-status proof request expired. Refresh its evidence before decrypting.",
        );
        return;
      }

      setLoadingKey(`prize-status:${child.drawId.toString()}`);
      setNotice(
        "Explicitly decrypting only the Prize Reserve's authorized zero-prize predicate and exact proof context. Prize amount remains encrypted.",
      );

      try {
        const result = await zama.decryption.decryptPublicValues(
          [before.statusPredicate, before.proofContext],
          { timeout: 180_000 },
        );

        if (currentSeconds() > before.statusProofDeadline) {
          throw new Error(
            "The inclusive prize-status proof deadline expired during decryption. The proof was discarded; refresh evidence first.",
          );
        }

        const zeroPrize = parsePublicBoolean(readClear(result.clearValues, before.statusPredicate));
        const clearContext = parsePublicBigInt(readClear(result.clearValues, before.proofContext));

        const latest = await readRound();
        const after = latest?.children.find((candidate) => candidate.drawId === child.drawId);

        if (
          after?.prize === null ||
          after?.prize === undefined ||
          !samePrizeEvidence(before, after.prize)
        ) {
          throw new Error(
            "Prize-status evidence changed while decryption was in progress. The stale proof was discarded.",
          );
        }

        await stageReserveAction(
          `prize-v2:settle-status:${child.drawId.toString()}:${before.statusAttemptNonce.toString()}`,
          "Settle exact public prize-status evidence",
          zeroPrize
            ? "Verify this frozen prize is exactly zero and enter terminal NO_PRIZE."
            : "Verify this frozen prize is nonzero and begin fixed historical entitlement assignment without revealing the winner or amount.",
          "settlePrizeStatus",
          [child.drawId, before.statusAttemptNonce, zeroPrize, result.decryptionProof],
        );

        setPublicEvidence(
          `Prize status draw ${child.drawId.toString()}: zeroPrize=${String(zeroPrize)}, proofContext=${clearContext.toString()}. Prize amount remains encrypted.`,
        );
      } catch (error: unknown) {
        setNotice(errorMessage(error));
      } finally {
        setLoadingKey(null);
      }
    },
    [readRound, stageReserveAction, zama.decryption],
  );

  const refreshPrizeStatusEvidence = useCallback(
    async (child: PrizeChildSnapshot) => {
      const prize = child.prize;

      if (prize?.state !== PRIZE_V2_STATE.STATUS_PROOF_PENDING) {
        setNotice("There is no pending prize-status proof request to refresh.");
        return;
      }

      if (currentSeconds() <= prize.statusProofDeadline) {
        setNotice(
          "Prize-status evidence remains valid through its inclusive deadline and cannot be refreshed yet.",
        );
        return;
      }

      await stageReserveAction(
        `prize-v2:refresh-status:${child.drawId.toString()}:${prize.statusAttemptNonce.toString()}`,
        "Refresh expired prize-status evidence",
        "Replace only the expired public proof request with a fresh attempt nonce and deadline. Funding, encrypted prize value and entitlement state do not reopen.",
        "refreshPrizeStatusEvidence",
        [child.drawId],
      );
    },
    [stageReserveAction],
  );

  const assignNextEntitlementChunk = useCallback(
    async (child: PrizeChildSnapshot) => {
      const prize = child.prize;

      if (prize?.state !== PRIZE_V2_STATE.ASSIGNING) {
        setNotice("This prize is not in fixed entitlement assignment.");
        return;
      }

      if (prize.assignmentCursor >= prize.participantCount) {
        setNotice(
          "The visible assignment cursor has already reached the frozen participant count.",
        );
        return;
      }

      await stageReserveAction(
        `prize-v2:assign:${child.drawId.toString()}:${prize.assignmentCursor.toString()}`,
        "Assign next fixed historical entitlement chunk",
        "Process the next fixed historical snapshot chunk. Entitlements remain encrypted, no winner predicate is revealed and processing never early-stops on a winner.",
        "assignPrizeEntitlementChunk",
        [child.drawId, prize.assignmentCursor],
      );
    },
    [stageReserveAction],
  );

  const blocked = loadingKey !== null || exact.review !== null || exact.attempt !== null;

  return (
    <section className="workspace-stack">
      <article className="workspace-card block">
        <Gift size={21} aria-hidden="true" />

        <span className="eyebrow">YIELD + PRIZE · CORRECTED V2.x</span>

        <h2>Finish the three-prize round without revealing private amounts.</h2>

        <p>
          This surface uses Pool V2, VeilDraw Engine V2, Yield Adapter V2 and Prize Reserve from the
          active Sepolia deployment. Yield is simulated testnet yield. The confidential token is an
          official Zama testnet mock asset.
        </p>

        <div className="workspace-inline-actions">
          <button
            className="financial-secondary-button"
            type="button"
            disabled={blocked}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh V2.x lifecycle
          </button>

          {round !== null && round.allChildrenFinalized && !round.roundRecognized ? (
            <button
              className="financial-primary-button"
              type="button"
              disabled={blocked}
              onClick={() => {
                void recognizeRoundYield();
              }}
            >
              <Gift size={15} aria-hidden="true" />
              Prepare round-yield recognition
            </button>
          ) : null}
        </div>

        {round === null ? (
          <div className="financial-state-card">
            <CircleDashed size={18} aria-hidden="true" />

            <div>
              <strong>No allocated three-prize round discovered</strong>
              <p>Meridian does not fabricate yield, prize, winner or entitlement state.</p>
            </div>
          </div>
        ) : (
          <div className="financial-state-card">
            {round.allChildrenFinalized ? (
              <CircleCheck size={18} aria-hidden="true" />
            ) : (
              <CircleDashed size={18} aria-hidden="true" />
            )}

            <div>
              <strong>Snapshot {round.snapshotId.toString()}</strong>
              <p>
                Three-child finality: {round.allChildrenFinalized ? "complete" : "not complete"} ·
                Round yield: {round.roundRecognized ? "recognized" : "not recognized"}
              </p>
            </div>
          </div>
        )}
      </article>

      {round?.children.map((child) => {
        const yieldState = child.yield?.state;
        const prizeState = child.prize?.state;
        const proofDeadlineExpired =
          child.prize !== null &&
          child.prize.state === PRIZE_V2_STATE.STATUS_PROOF_PENDING &&
          currentSeconds() > child.prize.statusProofDeadline;

        return (
          <article className="workspace-card block" key={child.drawId.toString()}>
            <span className="eyebrow">
              PRIZE {child.prizeIndex + 1} · DRAW {child.drawId.toString()}
            </span>

            <div className="financial-state-card">
              {child.drawState === VEILDRAW_V2_DRAW_STATE.FINALIZED ? (
                <CircleCheck size={18} aria-hidden="true" />
              ) : (
                <CircleDashed size={18} aria-hidden="true" />
              )}

              <div>
                <strong>
                  VeilDraw{" "}
                  {child.drawState === VEILDRAW_V2_DRAW_STATE.FINALIZED
                    ? "FINALIZED"
                    : `state ${String(child.drawState)}`}
                </strong>
                <p>
                  Yield: {yieldState === undefined ? "not recognized" : yieldStateName(yieldState)}
                  {" · "}
                  Prize: {prizeState === undefined ? "not prepared" : prizeStateName(prizeState)}
                </p>
              </div>
            </div>

            <div className="workspace-inline-actions">
              {yieldState === YIELD_V2_STATE.RECOGNITION_PROOF_PENDING ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    void settleYieldEvidence(child, "recognition");
                  }}
                >
                  <LockKeyhole size={15} aria-hidden="true" />
                  Decrypt public yield-status evidence
                </button>
              ) : null}

              {yieldState === YIELD_V2_STATE.RECOGNIZED ? (
                <button
                  className="financial-primary-button"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    void sweepYield(child);
                  }}
                >
                  <Gift size={15} aria-hidden="true" />
                  Prepare fixed reserve sweep
                </button>
              ) : null}

              {yieldState === YIELD_V2_STATE.SWEEP_PROOF_PENDING ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    void settleYieldEvidence(child, "sweep");
                  }}
                >
                  <LockKeyhole size={15} aria-hidden="true" />
                  Decrypt public sweep-completion evidence
                </button>
              ) : null}

              {yieldState === YIELD_V2_STATE.FUNDING_FINALIZED &&
              (child.prize === null || child.prize.state === PRIZE_V2_STATE.UNPREPARED) ? (
                <button
                  className="financial-primary-button"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    void preparePrize(child);
                  }}
                >
                  <Gift size={15} aria-hidden="true" />
                  Prepare encrypted prize
                </button>
              ) : null}

              {prizeState === PRIZE_V2_STATE.STATUS_PROOF_PENDING && !proofDeadlineExpired ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    void settlePrizeStatus(child);
                  }}
                >
                  <LockKeyhole size={15} aria-hidden="true" />
                  Decrypt public prize-status evidence
                </button>
              ) : null}

              {prizeState === PRIZE_V2_STATE.STATUS_PROOF_PENDING && proofDeadlineExpired ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    void refreshPrizeStatusEvidence(child);
                  }}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  Refresh expired prize evidence
                </button>
              ) : null}

              {prizeState === PRIZE_V2_STATE.ASSIGNING ? (
                <button
                  className="financial-primary-button"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    void assignNextEntitlementChunk(child);
                  }}
                >
                  <Gift size={15} aria-hidden="true" />
                  Assign next fixed entitlement chunk
                </button>
              ) : null}
            </div>

            {prizeState === PRIZE_V2_STATE.CLAIMABLE ? (
              <div className="financial-state-card">
                <ShieldCheck size={18} aria-hidden="true" />

                <div>
                  <strong>Encrypted entitlement assignment complete</strong>
                  <p>
                    No entitlement is decrypted here. M6-B2B will add the separate owner opt-in
                    authorization, explicit private reveal, corrected V2.x EIP-712 signature and
                    separate claim submission.
                  </p>
                </div>
              </div>
            ) : null}

            {prizeState === PRIZE_V2_STATE.CLAIMED ? (
              <div className="financial-state-card">
                <CircleCheck size={18} aria-hidden="true" />

                <div>
                  <strong>Prize lifecycle terminal: CLAIMED</strong>
                  <p>
                    Terminal state is public. Confidential payout amount remains absent from this
                    surface.
                  </p>
                </div>
              </div>
            ) : null}

            {prizeState === PRIZE_V2_STATE.NO_PRIZE ? (
              <div className="financial-state-card">
                <CircleCheck size={18} aria-hidden="true" />

                <div>
                  <strong>Prize lifecycle terminal: NO_PRIZE</strong>
                  <p>
                    This terminal state came only from authenticated public zero-prize consequence
                    evidence.
                  </p>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}

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
            <strong>Yield / Prize notice</strong>
            <p>{notice}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
