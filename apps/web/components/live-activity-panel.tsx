"use client";

import { Activity, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { usePublicClient } from "wagmi";

import {
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_POOL_ABI,
  VEILPOT_SEPOLIA_DEPLOYMENT,
} from "@veilpot/protocol-sdk";

interface ActivityItem {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly blockNumber: bigint;
  readonly transactionHash: Hex;
}

const RECENT_ACTIVITY_BLOCKS = 5_000n;
const RPC_LOG_CHUNK_BLOCKS = 900n;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Recent public activity could not be loaded.";
}

export function LiveActivityPanel({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  const publicClient = usePublicClient({ chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId });
  const [items, setItems] = useState<readonly ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshotBlock, setSnapshotBlock] = useState<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (publicClient === undefined) return;
    setLoading(true);
    setNotice(null);

    try {
      const latest = await publicClient.getBlockNumber();
      const earliest = latest > RECENT_ACTIVITY_BLOCKS ? latest - RECENT_ACTIVITY_BLOCKS : 0n;
      const next: ActivityItem[] = [];

      for (let fromBlock = earliest; fromBlock <= latest; fromBlock += RPC_LOG_CHUNK_BLOCKS) {
        const proposedToBlock = fromBlock + RPC_LOG_CHUNK_BLOCKS - 1n;
        const toBlock = proposedToBlock > latest ? latest : proposedToBlock;

        const [participantStates, withdrawals, bondWithdrawals, planCreated, planFunded] =
          await Promise.all([
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              eventName: "ParticipantStateChanged",
              args: { participant: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              eventName: "WithdrawalProcessed",
              args: { participant: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              eventName: "BondWithdrawn",
              args: { participant: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
              abi: VEILPOT_AUTOPILOT_VAULT_ABI,
              eventName: "PlanCreated",
              args: { owner: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
              abi: VEILPOT_AUTOPILOT_VAULT_ABI,
              eventName: "PlanFunded",
              args: { owner: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
          ]);

        for (const log of participantStates) {
          next.push({
            key: `${log.transactionHash}:participant`,
            label: "Participant state changed",
            detail: `Slot ${log.args.slot.toString()} · state ${String(log.args.state)}`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          });
        }

        for (const log of withdrawals) {
          next.push({
            key: `${log.transactionHash}:withdrawal`,
            label: "Confidential withdrawal processed",
            detail: `Withdrawal nonce ${log.args.withdrawalNonce.toString()} · amount remains confidential`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          });
        }

        for (const log of bondWithdrawals) {
          next.push({
            key: `${log.transactionHash}:bond`,
            label: "Registration bond withdrawn",
            detail: `${log.args.amount.toString()} wei`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          });
        }

        for (const log of planCreated) {
          next.push({
            key: `${log.transactionHash}:plan-created`,
            label: "Autopilot plan created",
            detail: `Owner plan nonce ${log.args.planNonce.toString()} · ${String(log.args.executionCount)} committed windows`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          });
        }

        for (const log of planFunded) {
          next.push({
            key: `${log.transactionHash}:plan-funded`,
            label: "Autopilot plan funded",
            detail: `Plan ${log.args.planId.slice(0, 10)}… · transferred amount remains confidential`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          });
        }
      }

      next.sort((left, right) => {
        if (left.blockNumber > right.blockNumber) return -1;
        if (left.blockNumber < right.blockNumber) return 1;
        return left.key.localeCompare(right.key);
      });

      setItems(next);
      setSnapshotBlock(latest);
    } catch (error: unknown) {
      setItems([]);
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [authenticatedAddress, publicClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <article className="workspace-card block">
      <Activity size={20} />
      <span className="eyebrow">LIVE PUBLIC ACCOUNT ACTIVITY</span>
      <h2>Recent Sepolia events, not a fixture timeline.</h2>
      <p>
        This view scans recent public protocol events for the authenticated wallet in provider-safe
        block chunks. Confidential transferred values are never inferred from event presence.
      </p>

      <button
        className="financial-secondary-button"
        type="button"
        disabled={loading}
        onClick={() => {
          void refresh();
        }}
      >
        <RefreshCw size={15} /> Refresh recent activity
      </button>

      {snapshotBlock !== null ? (
        <p className="financial-field-help">Snapshot through block {snapshotBlock.toString()}</p>
      ) : null}

      <div className="workspace-activity-list">
        {items.map((item) => (
          <div key={item.key}>
            <i className="activity-state-dot done" />
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <a
              href={`https://sepolia.etherscan.io/tx/${item.transactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              Block {item.blockNumber.toString()} <ExternalLink size={12} />
            </a>
          </div>
        ))}
      </div>

      {!loading && items.length === 0 && notice === null ? (
        <p>No matching public account events were found in the recent 5,000-block window.</p>
      ) : null}

      {notice !== null ? (
        <div className="financial-state-card warning">
          <ShieldCheck size={18} />
          <div>
            <strong>Activity scan failed closed</strong>
            <p>{notice}</p>
          </div>
        </div>
      ) : null}
    </article>
  );
}
