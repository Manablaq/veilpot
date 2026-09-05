"use client";

import { toUserFacingError } from "@/lib/ui-error";

import { Activity, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { decodeEventLog, type Abi, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";

import {
  VEILDRAW_ENGINE_V2_ABI,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_ADAPTER_V2_ABI,
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_POOL_V2_ABI,
  VEILPOT_RESERVE_ABI,
} from "@veilpot/protocol-sdk";

interface ActivityItem {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: Hex;
}

interface ActivitySource {
  readonly key: string;
  readonly label: string;
  readonly address: Address;
  readonly abi: Abi;
  readonly deploymentBlock: bigint;
}

const ACTIVITY_PAGE_BLOCKS = 4_000n;
const RPC_LOG_CHUNK_BLOCKS = 700n;

const ACTIVITY_SOURCES: readonly ActivitySource[] = [
  {
    key: "pool-v2",
    label: "Pool V2",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    abi: VEILPOT_POOL_V2_ABI,
    deploymentBlock: BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.blocks.pool),
  },
  {
    key: "engine-v2",
    label: "VeilDraw Engine V2",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
    abi: VEILDRAW_ENGINE_V2_ABI,
    deploymentBlock: BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engineCreation.parentBlock),
  },
  {
    key: "autopilot-vault",
    label: "Autopilot Vault",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
    abi: VEILPOT_AUTOPILOT_VAULT_ABI,
    deploymentBlock: BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.blocks.vault),
  },
  {
    key: "yield-adapter-v2",
    label: "Yield Adapter V2",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.adapter,
    abi: VEILPOT_ADAPTER_V2_ABI,
    deploymentBlock: BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.blocks.adapter),
  },
  {
    key: "prize-reserve",
    label: "Prize Reserve",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
    abi: VEILPOT_RESERVE_ABI,
    deploymentBlock: BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.blocks.reserve),
  },
];

function errorMessage(error: unknown): string {
  return toUserFacingError(error, "Recent public activity could not be loaded.");
}

function containsAuthenticatedAddress(value: unknown, authenticatedAddress: Address): boolean {
  if (typeof value === "string") {
    return (
      /^0x[0-9a-fA-F]{40}$/.test(value) &&
      value.toLowerCase() === authenticatedAddress.toLowerCase()
    );
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsAuthenticatedAddress(entry, authenticatedAddress));
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value as Readonly<Record<string, unknown>>).some((entry) =>
      containsAuthenticatedAddress(entry, authenticatedAddress),
    );
  }

  return false;
}

function humanizeEventName(eventName: string): string {
  return eventName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function minimumDeploymentBlock(): bigint {
  return ACTIVITY_SOURCES.reduce(
    (minimum, source) => (source.deploymentBlock < minimum ? source.deploymentBlock : minimum),
    ACTIVITY_SOURCES[0].deploymentBlock,
  );
}

export function LiveActivityPanel({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });

  const [items, setItems] = useState<readonly ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshotBlock, setSnapshotBlock] = useState<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (publicClient === undefined) return;

    setLoading(true);
    setNotice(null);

    try {
      const finalized = await publicClient.getBlock({
        blockTag: "finalized",
      });

      const upperBlock = finalized.number;
      const deploymentFloor = minimumDeploymentBlock();

      if (upperBlock < deploymentFloor) {
        setItems([]);
        setSnapshotBlock(upperBlock);
        return;
      }

      const recentFloor =
        upperBlock + 1n > ACTIVITY_PAGE_BLOCKS ? upperBlock - ACTIVITY_PAGE_BLOCKS + 1n : 0n;

      const lowerBlock = recentFloor > deploymentFloor ? recentFloor : deploymentFloor;

      const next: ActivityItem[] = [];

      for (let fromBlock = lowerBlock; fromBlock <= upperBlock; fromBlock += RPC_LOG_CHUNK_BLOCKS) {
        const proposedToBlock = fromBlock + RPC_LOG_CHUNK_BLOCKS - 1n;

        const toBlock = proposedToBlock > upperBlock ? upperBlock : proposedToBlock;

        const chunks = await Promise.all(
          ACTIVITY_SOURCES.map(async (source) => {
            if (source.deploymentBlock > toBlock) {
              return {
                source,
                logs: [],
              } as const;
            }

            const sourceFromBlock =
              source.deploymentBlock > fromBlock ? source.deploymentBlock : fromBlock;

            const logs = await publicClient.getLogs({
              address: source.address,
              fromBlock: sourceFromBlock,
              toBlock,
            });

            return {
              source,
              logs,
            } as const;
          }),
        );

        for (const chunk of chunks) {
          for (const log of chunk.logs) {
            try {
              const decodedUnknown: unknown = decodeEventLog({
                abi: chunk.source.abi,
                data: log.data,
                topics: log.topics,
                strict: true,
              });

              if (
                typeof decodedUnknown !== "object" ||
                decodedUnknown === null ||
                !("eventName" in decodedUnknown) ||
                typeof decodedUnknown.eventName !== "string" ||
                !("args" in decodedUnknown)
              ) {
                continue;
              }

              const eventName = decodedUnknown.eventName;
              const decodedArgs = decodedUnknown.args;

              if (eventName === "PublicDecryptionVerified") {
                continue;
              }

              if (!containsAuthenticatedAddress(decodedArgs, authenticatedAddress)) {
                continue;
              }

              next.push({
                key: [chunk.source.key, log.transactionHash, String(log.logIndex)].join(":"),
                label: humanizeEventName(eventName),
                detail:
                  `${chunk.source.label} · finalized public account event; ` +
                  "confidential values are not projected.",
                blockNumber: log.blockNumber,
                logIndex: log.logIndex,
                transactionHash: log.transactionHash,
              });
            } catch {
              continue;
            }
          }
        }
      }

      next.sort((left, right) => {
        if (left.blockNumber > right.blockNumber) return -1;
        if (left.blockNumber < right.blockNumber) return 1;

        if (left.logIndex > right.logIndex) return -1;
        if (left.logIndex < right.logIndex) return 1;

        return left.key.localeCompare(right.key);
      });

      setItems(next);
      setSnapshotBlock(upperBlock);
    } catch (error: unknown) {
      setItems([]);
      setSnapshotBlock(null);
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
