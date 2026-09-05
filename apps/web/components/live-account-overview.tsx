"use client";

import { toUserFacingError } from "@/lib/ui-error";

import { RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, formatEther, type Address } from "viem";
import { useConnection, usePublicClient } from "wagmi";

import {
  PARTICIPANT_STATE,
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_POOL_V2_ABI,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  participantStateName,
} from "@veilpot/protocol-sdk";

import { ExactActionReviewCard, useExactAction } from "@/components/exact-action-control";
import { VEILPOT_V2_EXACT_ACTION_SCOPE } from "@/lib/deployment-scope";

interface ParticipantPublicSnapshot {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly bondHeld: boolean;
}

interface LiveAccountState {
  readonly participant: ParticipantPublicSnapshot | null;
  readonly activeParticipantCount: bigint;
  readonly pendingBondRefund: bigint;
  readonly nextWithdrawNonce: bigint;
  readonly ownerPlanCount: bigint;
  readonly activeEpochId: bigint;
  readonly activeEpochEnd: bigint;
  readonly nextSnapshotId: bigint;
  readonly nextDrawId: bigint;
}

function errorMessage(error: unknown): string {
  return toUserFacingError(error, "Live Sepolia state could not be loaded.");
}

function timeLabel(value: bigint): string {
  return value === 0n ? "—" : new Date(Number(value) * 1000).toLocaleString();
}

export function LiveAccountOverview({
  authenticatedAddress,
  compact = false,
}: {
  readonly authenticatedAddress: Address;
  readonly compact?: boolean;
}) {
  const connection = useConnection();
  const publicClient = usePublicClient({ chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId });
  const exact = useExactAction(authenticatedAddress, VEILPOT_V2_EXACT_ACTION_SCOPE);

  const [state, setState] = useState<LiveAccountState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadParticipant = useCallback(async (): Promise<ParticipantPublicSnapshot | null> => {
    if (publicClient === undefined) return null;

    const reservations = await publicClient.getContractEvents({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      eventName: "ParticipantReserved",
      args: { participant: authenticatedAddress },
      fromBlock: BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.blocks.pool),
      toBlock: "latest",
    });

    const latestReservation = reservations
      .slice()
      .sort((left, right) => {
        const leftBlock = left.blockNumber;
        const rightBlock = right.blockNumber;

        if (leftBlock < rightBlock) return -1;
        if (leftBlock > rightBlock) return 1;

        return left.logIndex - right.logIndex;
      })
      .at(-1);

    const slotIndex = latestReservation?.args.slot;

    if (slotIndex === undefined || slotIndex >= 128n) {
      return null;
    }

    const state = await publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "participantState",
      args: [slotIndex],
    });

    if (state === PARTICIPANT_STATE.FREE || state === PARTICIPANT_STATE.TOMBSTONED) {
      return null;
    }

    const row = await publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "participantMetadata",
      args: [slotIndex],
    });

    if (
      row[0] === PARTICIPANT_STATE.FREE ||
      row[0] === PARTICIPANT_STATE.TOMBSTONED ||
      row[1].toLowerCase() !== authenticatedAddress.toLowerCase()
    ) {
      return null;
    }

    return {
      slotIndex,
      state: row[0],
      owner: row[1],
      registrationVersion: row[2],
      reservationNonce: row[3],
      bondHeld: row[8],
    };
  }, [authenticatedAddress, publicClient]);

  const refresh = useCallback(async () => {
    if (publicClient === undefined) return;

    setLoading(true);
    setError(null);

    try {
      const [
        participant,
        activeParticipantCount,
        pendingBondRefund,
        nextWithdrawNonce,
        ownerPlanCount,
        activeEpochId,
        activeEpochEnd,
        nextSnapshotId,
        nextDrawId,
      ] = await Promise.all([
        loadParticipant(),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "activeParticipantCount",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "pendingBondRefund",
          args: [authenticatedAddress],
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "nextWithdrawNonce",
          args: [authenticatedAddress],
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
          abi: VEILPOT_AUTOPILOT_VAULT_ABI,
          functionName: "nextPlanNonce",
          args: [authenticatedAddress],
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

      setState({
        participant,
        activeParticipantCount,
        pendingBondRefund,
        nextWithdrawNonce,
        ownerPlanCount,
        activeEpochId,
        activeEpochEnd,
        nextSnapshotId,
        nextDrawId,
      });
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [authenticatedAddress, loadParticipant, publicClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (exact.status.kind === "included" || exact.status.kind === "reverted") {
      void refresh();
    }
  }, [exact.status, refresh]);

  const prepareBondWithdrawal = useCallback(async () => {
    if (state === null || state.pendingBondRefund === 0n) return;

    const data = encodeFunctionData({
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "withdrawBond",
      args: [],
    });

    await exact.prepare({
      key: "registration-bond-withdrawal",
      label: "Withdraw registration bond refund",
      consequence: `Return exactly ${formatEther(state.pendingBondRefund)} ETH of public pull-refund credit to the authenticated wallet.`,
      to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      data,
      value: 0n,
    });
  }, [exact, state]);

  return (
    <section
      className={compact ? "workspace-card block live-account-card" : "workspace-card block"}
    >
      <div className="workspace-card-main">
        <span className="eyebrow">LIVE SEPOLIA ACCOUNT STATE</span>
        <h2>Protocol state, not presentation data.</h2>
        <p>
          Only public lifecycle metadata is loaded here. Confidential principal, Vault funds,
          contribution amounts, and prize entitlements are never decrypted automatically.
        </p>

        {error !== null ? (
          <div className="financial-state-card warning">
            <ShieldCheck size={18} />
            <div>
              <strong>Live read failed closed</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        <div className="financial-live-status">
          <div>
            <span>Participant</span>
            <strong>
              {loading
                ? "Checking…"
                : state?.participant === null || state === null
                  ? "Not registered"
                  : participantStateName(state.participant.state)}
            </strong>
          </div>
          <div>
            <span>Slot</span>
            <strong>{state?.participant?.slotIndex.toString() ?? "—"}</strong>
          </div>
          <div>
            <span>Active participants</span>
            <strong>{state?.activeParticipantCount.toString() ?? "—"}</strong>
          </div>
          <div>
            <span>Owner Autopilot plans</span>
            <strong>{state?.ownerPlanCount.toString() ?? "—"}</strong>
          </div>
          <div>
            <span>Withdrawal nonce</span>
            <strong>{state?.nextWithdrawNonce.toString() ?? "—"}</strong>
          </div>
          <div>
            <span>Bond refund</span>
            <strong>{state === null ? "—" : `${formatEther(state.pendingBondRefund)} ETH`}</strong>
          </div>
          <div>
            <span>Active draw epoch</span>
            <strong>{state?.activeEpochId.toString() ?? "—"}</strong>
          </div>
          <div>
            <span>Epoch boundary</span>
            <strong>{state === null ? "—" : timeLabel(state.activeEpochEnd)}</strong>
          </div>
          <div>
            <span>Finalized/started snapshots</span>
            <strong>{state?.nextSnapshotId.toString() ?? "—"}</strong>
          </div>
          <div>
            <span>Draws started</span>
            <strong>{state?.nextDrawId.toString() ?? "—"}</strong>
          </div>
        </div>

        <div className="workspace-inline-actions">
          <button
            className="financial-secondary-button"
            type="button"
            disabled={loading}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw size={15} /> Refresh live state
          </button>

          {state !== null && state.pendingBondRefund > 0n ? (
            <button
              className="financial-secondary-button"
              type="button"
              disabled={
                connection.status !== "connected" ||
                connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
                exact.attempt !== null
              }
              onClick={() => {
                void prepareBondWithdrawal();
              }}
            >
              <WalletCards size={15} /> Prepare bond refund withdrawal
            </button>
          ) : null}
        </div>

        <ExactActionReviewCard controller={exact} />
      </div>
    </section>
  );
}
