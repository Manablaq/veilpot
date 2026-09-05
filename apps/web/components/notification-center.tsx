"use client";

import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  Gift,
  LockKeyhole,
  RefreshCw,
  Settings,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { usePublicClient } from "wagmi";

import {
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_POOL_ABI,
  VEILPOT_SEPOLIA_DEPLOYMENT,
} from "@veilpot/protocol-sdk";

import type { WorkspaceView } from "@/components/workspace-panel";

interface NotificationCenterProps {
  readonly open: boolean;
  readonly authenticatedAddress: Address;
  readonly onClose: () => void;
  readonly onNavigate: (view: WorkspaceView) => void;
  readonly onUnreadCountChange: (count: number) => void;
}

type Filter = "All" | "Account" | "Plans" | "Draws";
type Category = Exclude<Filter, "All">;
type NotificationKind =
  | "participant"
  | "withdrawal"
  | "bond"
  | "plan-created"
  | "plan-funded"
  | "plan-executed"
  | "snapshot-ready"
  | "draw-started"
  | "draw-finalized";

interface LiveNotification {
  readonly id: string;
  readonly category: Category;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly detail: string;
  readonly blockNumber: bigint;
  readonly transactionHash: Hex;
  readonly view: WorkspaceView;
}

const RECENT_NOTIFICATION_BLOCKS = 5_000n;
const RPC_LOG_CHUNK_BLOCKS = 900n;
const RPC_RETRY_ATTEMPTS = 3;
const READ_STORAGE_PREFIX = "veilpot:notifications:read:v2:";
// Keep event logs strongly typed by processing each concrete getContractEvents result in-place.

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Live notifications could not be loaded.";
}

function storageKey(address: Address): string {
  return `${READ_STORAGE_PREFIX}${address.toLowerCase()}`;
}

function loadReadIds(address: Address): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(address));
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function persistReadIds(address: Address, ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(address), JSON.stringify([...ids]));
  } catch {
    // Read-state persistence is a UX convenience only. Protocol state remains authoritative.
  }
}

async function retryRpc<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown = new Error("RPC request failed.");

  for (let attempt = 0; attempt < RPC_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt + 1 < RPC_RETRY_ATTEMPTS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 180 * (attempt + 1));
        });
      }
    }
  }

  throw lastError;
}

function iconFor(kind: NotificationKind): LucideIcon {
  if (kind === "plan-created" || kind === "plan-funded" || kind === "plan-executed") {
    return CalendarClock;
  }
  if (kind === "snapshot-ready" || kind === "draw-started" || kind === "draw-finalized") {
    return Gift;
  }
  if (kind === "withdrawal" || kind === "bond") {
    return WalletCards;
  }
  return CheckCircle2;
}

function participantStateTitle(state: number): string {
  if (state === 2) return "Private deposit awaiting activation";
  if (state === 3) return "Private account activated";
  if (state === 4) return "Refund flow available";
  if (state === 6) return "Participant registration closed";
  return "Participant state changed";
}

export function NotificationCenter({
  open,
  authenticatedAddress,
  onClose,
  onNavigate,
  onUnreadCountChange,
}: NotificationCenterProps) {
  const publicClient = usePublicClient({ chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId });
  const refreshingRef = useRef(false);
  const [filter, setFilter] = useState<Filter>("All");
  const [read, setRead] = useState<Set<string>>(new Set());
  const [readHydrated, setReadHydrated] = useState(false);
  const [items, setItems] = useState<readonly LiveNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshotBlock, setSnapshotBlock] = useState<bigint | null>(null);

  useEffect(() => {
    setRead(loadReadIds(authenticatedAddress));
    setReadHydrated(true);
  }, [authenticatedAddress]);

  const refresh = useCallback(async () => {
    if (publicClient === undefined || refreshingRef.current) return;

    refreshingRef.current = true;
    setLoading(true);
    setNotice(null);

    try {
      const latest = await retryRpc(() => publicClient.getBlockNumber());
      const earliest =
        latest > RECENT_NOTIFICATION_BLOCKS ? latest - RECENT_NOTIFICATION_BLOCKS : 0n;
      const next: LiveNotification[] = [];

      const nextPlanNonce = await retryRpc(() =>
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
          abi: VEILPOT_AUTOPILOT_VAULT_ABI,
          functionName: "nextPlanNonce",
          args: [authenticatedAddress],
        }),
      );

      let discoveredPlanCount = 0n;
      const planIds = new Set<Hex>();

      if (nextPlanNonce > 0n) {
        const deploymentBlock = BigInt(VEILPOT_SEPOLIA_DEPLOYMENT.blocks.vault);
        let toBlock = latest;

        while (toBlock >= deploymentBlock && discoveredPlanCount < nextPlanNonce) {
          const earliestFullChunkEnd = deploymentBlock + RPC_LOG_CHUNK_BLOCKS - 1n;
          const fromBlock =
            toBlock >= earliestFullChunkEnd ? toBlock - RPC_LOG_CHUNK_BLOCKS + 1n : deploymentBlock;

          const logs = await retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
              abi: VEILPOT_AUTOPILOT_VAULT_ABI,
              eventName: "PlanCreated",
              args: { owner: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
          );

          discoveredPlanCount += BigInt(logs.length);

          for (const log of logs) {
            planIds.add(log.args.planId);

            if (log.blockNumber < earliest) continue;
            next.push({
              id: `${log.transactionHash}:plan-created`,
              category: "Plans",
              kind: "plan-created",
              title: "Autopilot plan created",
              detail: `Plan nonce ${log.args.planNonce.toString()} · ${String(log.args.executionCount)} committed window(s). No private amount is shown.`,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              view: "autopilot",
            });
          }

          if (fromBlock === deploymentBlock) break;
          toBlock = fromBlock - 1n;
        }

        if (discoveredPlanCount !== nextPlanNonce) {
          throw new Error(
            `Notification discovery found ${discoveredPlanCount.toString()} of ${nextPlanNonce.toString()} expected owner plans.`,
          );
        }
      }

      for (let fromBlock = earliest; fromBlock <= latest; fromBlock += RPC_LOG_CHUNK_BLOCKS) {
        const proposedToBlock = fromBlock + RPC_LOG_CHUNK_BLOCKS - 1n;
        const toBlock = proposedToBlock > latest ? latest : proposedToBlock;

        const [
          participantStates,
          withdrawals,
          bondWithdrawals,
          planFunded,
          planFundsWithdrawn,
          snapshotReady,
          drawStarted,
          drawFinalized,
        ] = await Promise.all([
          retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              eventName: "ParticipantStateChanged",
              args: { participant: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
          ),
          retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              eventName: "WithdrawalProcessed",
              args: { participant: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
          ),
          retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              eventName: "BondWithdrawn",
              args: { participant: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
          ),
          retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
              abi: VEILPOT_AUTOPILOT_VAULT_ABI,
              eventName: "PlanFunded",
              args: { owner: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
          ),
          retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
              abi: VEILPOT_AUTOPILOT_VAULT_ABI,
              eventName: "PlanFundsWithdrawn",
              args: { owner: authenticatedAddress },
              fromBlock,
              toBlock,
              strict: true,
            }),
          ),
          retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              eventName: "SnapshotReady",
              fromBlock,
              toBlock,
              strict: true,
            }),
          ),
          retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              eventName: "DrawStarted",
              fromBlock,
              toBlock,
              strict: true,
            }),
          ),
          retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              eventName: "DrawFinalized",
              fromBlock,
              toBlock,
              strict: true,
            }),
          ),
        ]);

        for (const log of participantStates) {
          const state = log.args.state;
          next.push({
            id: `${log.transactionHash}:participant:${String(state)}`,
            category: "Account",
            kind: "participant",
            title: participantStateTitle(state),
            detail: `Slot ${log.args.slot.toString()} · public lifecycle state ${String(state)}. Confidential principal remains hidden.`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            view: "home",
          });
        }

        for (const log of withdrawals) {
          next.push({
            id: `${log.transactionHash}:withdrawal`,
            category: "Account",
            kind: "withdrawal",
            title: "Confidential withdrawal processed",
            detail: `Withdrawal nonce ${log.args.withdrawalNonce.toString()} confirmed. The transferred amount is not included in notifications.`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            view: "activity",
          });
        }

        for (const log of bondWithdrawals) {
          next.push({
            id: `${log.transactionHash}:bond`,
            category: "Account",
            kind: "bond",
            title: "Registration bond returned",
            detail: "The public registration-bond withdrawal was confirmed on Sepolia.",
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            view: "activity",
          });
        }

        for (const log of planFunded) {
          next.push({
            id: `${log.transactionHash}:plan-funded`,
            category: "Plans",
            kind: "plan-funded",
            title: "Autopilot plan funded",
            detail: `Plan ${log.args.planId.slice(0, 10)}… received confidential funding. No amount is exposed here.`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            view: "autopilot",
          });
        }

        for (const log of planFundsWithdrawn) {
          next.push({
            id: `${log.transactionHash}:plan-funds-withdrawn`,
            category: "Plans",
            kind: "withdrawal",
            title: "Autopilot funds returned",
            detail: `Plan ${log.args.planId.slice(0, 10)}… returned remaining confidential funds to its immutable owner.`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            view: "autopilot",
          });
        }

        for (const planId of planIds) {
          const executed = await retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
              abi: VEILPOT_AUTOPILOT_VAULT_ABI,
              eventName: "PlanExecuted",
              args: { planId },
              fromBlock,
              toBlock,
              strict: true,
            }),
          );

          for (const log of executed) {
            next.push({
              id: `${log.transactionHash}:plan-executed:${log.args.index.toString()}`,
              category: "Plans",
              kind: "plan-executed",
              title: "Autopilot window executed",
              detail: `Committed window ${log.args.index.toString()} completed for plan ${planId.slice(0, 10)}…. Confidential movement remains private.`,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              view: "autopilot",
            });
          }
        }

        for (const log of snapshotReady) {
          next.push({
            id: `${log.transactionHash}:snapshot-ready`,
            category: "Draws",
            kind: "snapshot-ready",
            title: "VeilDraw snapshot ready",
            detail: `Snapshot ${log.args.snapshotId.toString()} finalized with ${log.args.participantCount.toString()} frozen participant slot(s). Weights remain encrypted.`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            view: "draws",
          });
        }

        for (const log of drawStarted) {
          next.push({
            id: `${log.transactionHash}:draw-started`,
            category: "Draws",
            kind: "draw-started",
            title: "VeilDraw started",
            detail: `Draw ${log.args.drawId.toString()} is bound to snapshot ${log.args.snapshotId.toString()}. Winner selection remains encrypted.`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            view: "draws",
          });
        }

        for (const log of drawFinalized) {
          next.push({
            id: `${log.transactionHash}:draw-finalized`,
            category: "Draws",
            kind: "draw-finalized",
            title: "VeilDraw finalized",
            detail: `Draw ${log.args.drawId.toString()} completed. No private winner identity or prize amount is exposed by this notification.`,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            view: "draws",
          });
        }
      }

      const unique = new Map<string, LiveNotification>();
      for (const item of next) unique.set(item.id, item);

      const ordered = [...unique.values()].sort((left, right) => {
        if (left.blockNumber > right.blockNumber) return -1;
        if (left.blockNumber < right.blockNumber) return 1;
        return left.id.localeCompare(right.id);
      });

      setItems(ordered);
      setSnapshotBlock(latest);
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      refreshingRef.current = false;
      setLoading(false);
    }
  }, [authenticatedAddress, publicClient]);

  useEffect(() => {
    void refresh();

    const onFocus = () => {
      void refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const notifications = useMemo(
    () => items.filter((item) => filter === "All" || item.category === filter),
    [filter, items],
  );

  const unreadCount = useMemo(
    () => items.reduce((count, item) => count + (read.has(item.id) ? 0 : 1), 0),
    [items, read],
  );

  useEffect(() => {
    onUnreadCountChange(readHydrated ? unreadCount : 0);
  }, [onUnreadCountChange, readHydrated, unreadCount]);

  const markRead = useCallback(
    (id: string) => {
      setRead((current) => {
        const next = new Set(current);
        next.add(id);
        persistReadIds(authenticatedAddress, next);
        return next;
      });
    },
    [authenticatedAddress],
  );

  const markAllRead = useCallback(() => {
    setRead((current) => {
      const next = new Set(current);
      for (const item of items) next.add(item.id);
      persistReadIds(authenticatedAddress, next);
      return next;
    });
  }, [authenticatedAddress, items]);

  if (!open) return null;

  return (
    <div
      className="side-panel-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-title"
    >
      <button
        className="side-panel-scrim"
        type="button"
        aria-label="Close notifications"
        onClick={onClose}
      />
      <aside className="side-panel notification-panel">
        <header className="side-panel-header">
          <div>
            <span className="eyebrow">LIVE INBOX</span>
            <h2 id="notification-title">Notifications</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close notifications"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="notification-privacy-note">
          <LockKeyhole size={16} />
          <p>
            <strong>Private by default.</strong> Live notifications are derived only from public
            Sepolia protocol events. Confidential balances, contribution amounts, withdrawal
            amounts, and private draw outcomes are never reconstructed here.
          </p>
        </div>

        <div className="notification-live-status">
          <div>
            <span>Source</span>
            <strong>Sepolia protocol events</strong>
          </div>
          <div>
            <span>Snapshot</span>
            <strong>
              {snapshotBlock === null ? "Loading…" : `Block ${snapshotBlock.toString()}`}
            </strong>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw className={loading ? "spin" : undefined} size={14} />
            Refresh
          </button>
        </div>

        <div className="notification-toolbar">
          {(["All", "Account", "Plans", "Draws"] as const).map((item) => (
            <button
              type="button"
              className={filter === item ? "active" : ""}
              key={item}
              onClick={() => {
                setFilter(item);
              }}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            className="settings-link"
            onClick={() => {
              onNavigate("settings");
              onClose();
            }}
          >
            <Settings size={14} /> Preferences
          </button>
        </div>

        {unreadCount > 0 ? (
          <button className="notification-mark-read" type="button" onClick={markAllRead}>
            Mark all {unreadCount.toString()} read
          </button>
        ) : null}

        <div className="notification-list">
          {notice !== null ? (
            <div className="notification-empty">
              <ShieldCheck size={20} />
              <strong>Live notification scan failed closed</strong>
              <span>{notice}</span>
            </div>
          ) : notifications.length === 0 && !loading ? (
            <div className="notification-empty">
              <BellRing size={20} />
              <strong>No recent live notifications</strong>
              <span>
                Confirmed public Veilpot account and draw events will appear here without exposing
                confidential values.
              </span>
            </div>
          ) : (
            notifications.map((notification) => {
              const Icon = iconFor(notification.kind);
              const unread = !read.has(notification.id);
              return (
                <button
                  className={unread ? "notification-item unread" : "notification-item"}
                  type="button"
                  key={notification.id}
                  onClick={() => {
                    markRead(notification.id);
                    onNavigate(notification.view);
                    onClose();
                  }}
                >
                  <span className="notification-icon">
                    <Icon size={17} />
                  </span>
                  <span>
                    <strong>{notification.title}</strong>
                    <p>{notification.detail}</p>
                    <time>Sepolia · block {notification.blockNumber.toString()}</time>
                  </span>
                  {unread ? <i className="unread-dot" /> : null}
                </button>
              );
            })
          )}
        </div>

        <footer className="side-panel-footer">
          <BellRing size={15} />
          <span>
            Notifications are public-event receipts only. For full transaction detail, use Activity
            or the linked block explorer.
          </span>
        </footer>
      </aside>
    </div>
  );
}
