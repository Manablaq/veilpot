"use client";

import { Activity, CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePublicClient } from "wagmi";

import { VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT, VEILPOT_POOL_V2_ABI } from "@veilpot/protocol-sdk";

import styles from "@/app/meridian-home.module.css";

interface ProtocolSnapshot {
  readonly activeParticipants: bigint;
  readonly activeEpochId: bigint;
  readonly activeEpochEnd: bigint;
  readonly latestSnapshotId: bigint;
  readonly latestDrawId: bigint;
}

type LiveState =
  | {
      readonly kind: "loading";
    }
  | {
      readonly kind: "ready";
      readonly snapshot: ProtocolSnapshot;
    }
  | {
      readonly kind: "unavailable";
    };

function epochBoundaryLabel(value: bigint): string {
  const milliseconds = Number(value) * 1000;

  if (!Number.isFinite(milliseconds)) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(milliseconds));
}

export function PublicProtocolBand() {
  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });

  const [live, setLive] = useState<LiveState>({
    kind: "loading",
  });

  const refresh = useCallback(async () => {
    if (publicClient === undefined) return;

    try {
      const [activeParticipants, activeEpochId, activeEpochEnd, latestSnapshotId, latestDrawId] =
        await Promise.all([
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "activeParticipantCount",
          }),
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
            functionName: "nextDrawId",
          }),
        ]);

      setLive({
        kind: "ready",
        snapshot: {
          activeParticipants,
          activeEpochId,
          activeEpochEnd,
          latestSnapshotId,
          latestDrawId,
        },
      });
    } catch {
      setLive({
        kind: "unavailable",
      });
    }
  }, [publicClient]);

  useEffect(() => {
    void refresh();

    const interval = window.setInterval(() => {
      void refresh();
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (live.kind === "unavailable") {
    return (
      <section
        className={`${styles.protocolBand} ${styles.protocolBandUnavailable}`}
        aria-live="polite"
      >
        <span className={styles.protocolBandNetwork}>
          <i aria-hidden="true" />
          Ethereum Sepolia
        </span>

        <span>
          <CircleAlert size={14} aria-hidden="true" />
          Live protocol state unavailable
        </span>

        <button
          type="button"
          onClick={() => {
            setLive({
              kind: "loading",
            });
            void refresh();
          }}
        >
          <RefreshCw size={13} aria-hidden="true" />
          Retry
        </button>
      </section>
    );
  }

  if (live.kind === "loading") {
    return (
      <section
        className={styles.protocolBand}
        aria-label="Loading live protocol state"
        aria-busy="true"
      >
        <span className={styles.protocolBandNetwork}>
          <i aria-hidden="true" />
          Ethereum Sepolia
        </span>

        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className={styles.protocolBandLoading} aria-hidden="true" />
        ))}
      </section>
    );
  }

  const { snapshot } = live;

  const rows = [
    ["Protocol status", "Live reads"],
    ["Active participants", snapshot.activeParticipants.toString()],
    ["Current epoch", `#${snapshot.activeEpochId.toString()}`],
    ["Epoch boundary", epochBoundaryLabel(snapshot.activeEpochEnd)],
    [
      "Latest snapshot",
      snapshot.latestSnapshotId === 0n ? "None yet" : `#${snapshot.latestSnapshotId.toString()}`,
    ],
    [
      "Latest draw",
      snapshot.latestDrawId === 0n ? "None yet" : `#${snapshot.latestDrawId.toString()}`,
    ],
  ] as const;

  return (
    <section
      className={styles.protocolBand}
      aria-label="Live Veilpot V2 protocol state"
      aria-live="polite"
    >
      <span className={styles.protocolBandNetwork}>
        <i aria-hidden="true" />
        Ethereum Sepolia
      </span>

      {rows.map(([label, value]) => (
        <span className={styles.protocolBandFact} key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </span>
      ))}

      <Activity className={styles.protocolBandPulse} size={14} aria-hidden="true" />
    </section>
  );
}
