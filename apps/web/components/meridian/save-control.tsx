"use client";

import {
  ArrowRight,
  CircleCheck,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatEther, type Address } from "viem";
import { usePublicClient } from "wagmi";

import {
  PARTICIPANT_STATE,
  REGISTRATION_BOND_WEI,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_POOL_V2_ABI,
  buildV2ReserveParticipantSlotCall,
} from "@veilpot/protocol-sdk";

import styles from "@/app/meridian-app.module.css";
import { useExactAction } from "@/components/exact-action-control";
import { MeridianSaveDepositActivation } from "@/components/meridian/save-deposit-activation";
import {
  AddressText,
  ExplorerLink,
  InlineNotice,
  MeridianButton,
  ProtocolBadge,
  StatusBadge,
  Surface,
  TechnicalDisclosure,
} from "@/components/meridian";
import { VEILPOT_V2_EXACT_ACTION_SCOPE } from "@/lib/deployment-scope";
import {
  V2_PARTICIPANT_SCAN_CHUNK_SIZE,
  v2ParticipantCanDeposit,
  v2ParticipantCanExpireActivation,
  v2ParticipantCanReserve,
  v2ParticipantCanSettleThreshold,
  v2ParticipantCanWithdraw,
  v2SaveLifecycle,
  type V2ParticipantSnapshot,
} from "@/lib/v2-save";

interface MeridianSaveControlProps {
  readonly authenticatedAddress: Address;
}

function compactAddress(address: Address): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function unixTimeLabel(timestamp: bigint): string {
  if (timestamp === 0n) return "—";

  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "The V2 participant state could not be loaded.";
}

function lifecycleTone(
  key: ReturnType<typeof v2SaveLifecycle>["key"],
): "neutral" | "success" | "warning" | "danger" | "information" {
  switch (key) {
    case "active":
      return "success";
    case "reserved":
    case "pending-activation":
      return "information";
    case "pending-refund":
    case "refund-proof-pending":
      return "warning";
    case "unknown":
      return "danger";
    default:
      return "neutral";
  }
}

export function MeridianSaveControl({ authenticatedAddress }: MeridianSaveControlProps) {
  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });

  const exactAction = useExactAction(authenticatedAddress, VEILPOT_V2_EXACT_ACTION_SCOPE);

  const [participant, setParticipant] = useState<V2ParticipantSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadParticipant = useCallback(async (): Promise<V2ParticipantSnapshot | null> => {
    if (publicClient === undefined) {
      throw new Error("The Ethereum Sepolia public client is unavailable.");
    }

    const maximum = await publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "MAX_PARTICIPANTS",
    });

    let found: V2ParticipantSnapshot | null = null;

    for (
      let start = 0;
      start < Number(maximum) && found === null;
      start += V2_PARTICIPANT_SCAN_CHUNK_SIZE
    ) {
      const end = Math.min(start + V2_PARTICIPANT_SCAN_CHUNK_SIZE, Number(maximum));

      const slots = Array.from({ length: end - start }, (_, index) => start + index);

      const states = await Promise.all(
        slots.map(async (slotIndex) => ({
          slotIndex,
          state: await publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "participantState",
            args: [BigInt(slotIndex)],
          }),
        })),
      );

      const occupied = states.filter(
        ({ state }) => state !== PARTICIPANT_STATE.FREE && state !== PARTICIPANT_STATE.TOMBSTONED,
      );

      const metadata = await Promise.all(
        occupied.map(async ({ slotIndex }) => ({
          slotIndex,
          row: await publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "participantMetadata",
            args: [BigInt(slotIndex)],
          }),
        })),
      );

      const match = metadata.find(
        ({ row }) => row[1].toLowerCase() === authenticatedAddress.toLowerCase(),
      );

      if (match !== undefined) {
        found = {
          slotIndex: BigInt(match.slotIndex),
          state: match.row[0],
          owner: match.row[1],
          registrationVersion: match.row[2],
          reservationNonce: match.row[3],
          reservationExpiry: match.row[4],
          activationStartedAt: match.row[5],
          activationDeadline: match.row[6],
          refundAttemptNonce: match.row[7],
          bondHeld: match.row[8],
        };
      }
    }

    return found;
  }, [authenticatedAddress, publicClient]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      setParticipant(await loadParticipant());
    } catch (error: unknown) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadParticipant]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (exactAction.status.kind === "included") {
      void refresh();
    }
  }, [exactAction.status.kind, refresh]);

  const lifecycle = useMemo(() => v2SaveLifecycle(participant), [participant]);

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

  const canReserve = v2ParticipantCanReserve(participant);
  const depositReady = v2ParticipantCanDeposit(participant, nowSeconds);
  const thresholdReady = v2ParticipantCanSettleThreshold(participant, nowSeconds);
  const activationExpired = v2ParticipantCanExpireActivation(participant, nowSeconds);
  const withdrawalReady = v2ParticipantCanWithdraw(participant);

  const prepareRegistration = useCallback(async () => {
    if (!canReserve) return;

    const call = buildV2ReserveParticipantSlotCall();

    const data = encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
    });

    await exactAction.prepare({
      key: "v2-save-reserve-participant-slot",
      label: "Reserve V2 participant slot",
      consequence:
        "Lock the exact public registration bond and create one bounded PoolV2 reservation for the authenticated wallet.",
      to: call.address,
      data,
      value: call.value,
    });
  }, [canReserve, exactAction]);

  return (
    <div className={styles.saveWorkspace}>
      <div className={styles.saveSummaryGrid}>
        <Surface className={styles.saveLifecycleCard} elevation="raised">
          <header className={styles.saveCardHeader}>
            <div>
              <span className={styles.workspaceEyebrow}>SAVE · V2</span>

              <h2>Private saving lifecycle</h2>
            </div>

            <StatusBadge tone={lifecycleTone(lifecycle.key)}>
              {loading ? "Loading" : lifecycle.label}
            </StatusBadge>
          </header>

          {loading ? (
            <div className={styles.saveLoadingState}>
              <LoaderCircle size={20} aria-hidden="true" />
              Reading authoritative PoolV2 lifecycle…
            </div>
          ) : loadError !== null ? (
            <InlineNotice title="Participant state unavailable" tone="danger">
              {loadError}
            </InlineNotice>
          ) : (
            <>
              <p className={styles.saveLifecycleDetail}>{lifecycle.detail}</p>

              <dl className={styles.savePublicMetadata}>
                <div>
                  <dt>Wallet</dt>
                  <dd>{compactAddress(authenticatedAddress)}</dd>
                </div>

                <div>
                  <dt>Pool</dt>
                  <dd>{compactAddress(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool)}</dd>
                </div>

                <div>
                  <dt>Slot</dt>
                  <dd>{participant === null ? "—" : participant.slotIndex.toString()}</dd>
                </div>

                <div>
                  <dt>Registration version</dt>
                  <dd>{participant === null ? "—" : participant.registrationVersion.toString()}</dd>
                </div>

                <div>
                  <dt>Reservation nonce</dt>
                  <dd>{participant === null ? "—" : participant.reservationNonce.toString()}</dd>
                </div>

                <div>
                  <dt>Bond held</dt>
                  <dd>{participant === null ? "—" : participant.bondHeld ? "Yes" : "No"}</dd>
                </div>
              </dl>

              <div className={styles.saveRefreshRow}>
                <MeridianButton
                  variant="tertiary"
                  size="small"
                  disabled={loading}
                  onClick={() => {
                    void refresh();
                  }}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Refresh lifecycle
                </MeridianButton>

                <ExplorerLink
                  href={`https://sepolia.etherscan.io/address/${VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool}`}
                >
                  PoolV2
                </ExplorerLink>
              </div>
            </>
          )}
        </Surface>

        <Surface className={styles.saveActionCard}>
          <span className={styles.workspaceEyebrow}>CURRENT NEXT STEP</span>

          {canReserve ? (
            <>
              <div className={styles.saveActionIcon}>
                <WalletCards size={21} aria-hidden="true" />
              </div>

              <h2>Reserve your private-saving slot.</h2>

              <p>Reservation is public lifecycle metadata. No confidential principal exists yet.</p>

              <div className={styles.saveBondRow}>
                <span>Exact registration bond</span>
                <strong>{formatEther(REGISTRATION_BOND_WEI)} ETH</strong>
              </div>

              <MeridianButton
                variant="primary"
                size="large"
                disabled={
                  loading ||
                  !exactAction.storageReady ||
                  exactAction.attempt !== null ||
                  exactAction.review !== null
                }
                onClick={() => {
                  void prepareRegistration();
                }}
              >
                Prepare exact registration
                <ArrowRight size={15} aria-hidden="true" />
              </MeridianButton>

              <small className={styles.saveActionFootnote}>
                Preparing performs a read-only simulation. It does not open the wallet or send a
                transaction.
              </small>
            </>
          ) : (
            <>
              <div className={styles.saveActionIcon}>
                <CircleCheck size={21} aria-hidden="true" />
              </div>

              <h2>{lifecycle.label}</h2>
              <p>{lifecycle.detail}</p>

              {depositReady ? (
                <InlineNotice title="Ready for confidential deposit" tone="private">
                  Exact PoolV2 authorization and V2-bound confidential deposit controls are
                  available below.
                </InlineNotice>
              ) : thresholdReady ? (
                <InlineNotice title="Threshold settlement pending" tone="protocol">
                  The amount remains confidential. Use the explicit public-threshold control below
                  to prepare the exact proof settlement.
                </InlineNotice>
              ) : activationExpired ? (
                <InlineNotice title="Activation recovery available" tone="warning">
                  The public activation deadline has expired. Recovery will use PoolV2 expiry and
                  refund functions without revealing the confidential pending amount.
                </InlineNotice>
              ) : withdrawalReady ? (
                <InlineNotice title="Active private saver" tone="private">
                  Principal remains sealed. M4-B3 will add V2-bound confidential withdrawal and
                  zero-principal deregistration.
                </InlineNotice>
              ) : null}
            </>
          )}
        </Surface>
      </div>

      {participant !== null && (depositReady || thresholdReady) ? (
        <MeridianSaveDepositActivation
          authenticatedAddress={authenticatedAddress}
          participant={participant}
          exactAction={exactAction}
          onRefresh={refresh}
        />
      ) : null}

      {participant !== null ? (
        <Surface className={styles.saveTimelineCard}>
          <header>
            <div>
              <Clock3 size={17} aria-hidden="true" />
              <span>Public lifecycle timing</span>
            </div>

            <ProtocolBadge>No private amount shown</ProtocolBadge>
          </header>

          <dl>
            <div>
              <dt>Reservation expiry</dt>
              <dd>{unixTimeLabel(participant.reservationExpiry)}</dd>
            </div>

            <div>
              <dt>Activation started</dt>
              <dd>{unixTimeLabel(participant.activationStartedAt)}</dd>
            </div>

            <div>
              <dt>Activation deadline</dt>
              <dd>{unixTimeLabel(participant.activationDeadline)}</dd>
            </div>

            <div>
              <dt>Refund attempt nonce</dt>
              <dd>{participant.refundAttemptNonce.toString()}</dd>
            </div>
          </dl>
        </Surface>
      ) : null}

      {canReserve && exactAction.attempt !== null ? (
        <Surface className={styles.saveExactAction} elevation="raised">
          <InlineNotice title="Exact wallet attempt requires reconciliation" tone="warning">
            Another registration request will remain blocked until this exact attempt is reconciled.
          </InlineNotice>

          <dl>
            <div>
              <dt>Action</dt>
              <dd>{exactAction.attempt.label}</dd>
            </div>
            <div>
              <dt>Nonce</dt>
              <dd>{exactAction.attempt.accountNonce}</dd>
            </div>
            <div>
              <dt>Hash</dt>
              <dd>{exactAction.attempt.hash ?? "No conclusive hash returned"}</dd>
            </div>
          </dl>

          <MeridianButton
            variant="secondary"
            disabled={exactAction.isWalletPending}
            onClick={() => {
              void exactAction.reconcile();
            }}
          >
            Reconcile exact attempt
          </MeridianButton>
        </Surface>
      ) : canReserve && exactAction.review !== null ? (
        <Surface className={styles.saveExactAction} elevation="raised">
          <header>
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <span className={styles.workspaceEyebrow}>EXACT WALLET REVIEW</span>
              <h2>Review before opening your wallet.</h2>
            </div>
          </header>

          <dl>
            <div>
              <dt>Destination</dt>
              <dd>
                <AddressText>{compactAddress(exactAction.review.to)}</AddressText>
              </dd>
            </div>

            <div>
              <dt>Wallet nonce</dt>
              <dd>{exactAction.review.accountNonce}</dd>
            </div>

            <div>
              <dt>Network</dt>
              <dd>Ethereum Sepolia · {exactAction.review.chainId}</dd>
            </div>

            <div>
              <dt>Native value</dt>
              <dd>{formatEther(exactAction.review.value)} ETH</dd>
            </div>
          </dl>

          <p>{exactAction.review.consequence}</p>

          <TechnicalDisclosure label="Show exact calldata">
            <code>{exactAction.review.data}</code>
          </TechnicalDisclosure>

          <div className={styles.saveExactActionButtons}>
            <MeridianButton
              variant="primary"
              disabled={exactAction.isWalletPending}
              onClick={() => {
                void exactAction.openWallet();
              }}
            >
              Open exact wallet review
              <ExternalLink size={14} aria-hidden="true" />
            </MeridianButton>

            <MeridianButton
              variant="tertiary"
              disabled={exactAction.isWalletPending}
              onClick={exactAction.discardReview}
            >
              Discard review
            </MeridianButton>
          </div>
        </Surface>
      ) : null}

      {canReserve && exactAction.status.kind !== "idle" ? (
        <InlineNotice
          title={
            exactAction.status.kind === "included"
              ? "Exact registration included"
              : exactAction.status.kind === "ready"
                ? "Exact review ready"
                : exactAction.status.kind === "wallet"
                  ? "Wallet review open"
                  : exactAction.status.kind === "blocked"
                    ? "Exact action blocked"
                    : exactAction.status.kind === "reverted"
                      ? "Exact transaction reverted"
                      : "Registration stopped safely"
          }
          tone={
            exactAction.status.kind === "included"
              ? "protocol"
              : exactAction.status.kind === "ready" || exactAction.status.kind === "wallet"
                ? "private"
                : exactAction.status.kind === "blocked"
                  ? "warning"
                  : "danger"
          }
        >
          <div className={styles.saveStatusCopy}>
            <span>{exactAction.status.message}</span>

            {"hash" in exactAction.status && exactAction.status.hash !== undefined ? (
              <a
                href={`https://sepolia.etherscan.io/tx/${exactAction.status.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View exact transaction
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </InlineNotice>
      ) : null}

      <InlineNotice title="Privacy boundary" tone="private">
        This screen reads only public lifecycle metadata. It never decrypts principal, pending
        deposit amounts, balances, winner state or prize entitlement.
      </InlineNotice>
    </div>
  );
}
