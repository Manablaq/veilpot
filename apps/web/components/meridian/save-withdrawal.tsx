"use client";

import { ExternalLink, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseUnits, type Address, type Hex } from "viem";
import { useConnection, usePublicClient } from "wagmi";
import { useMetadata, useZamaSDK } from "@zama-fhe/react-sdk";

import {
  PARTICIPANT_STATE,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_POOL_V2_ABI,
  buildV2WithdrawalCall,
  encryptV2PoolAmount,
} from "@veilpot/protocol-sdk";

import styles from "@/app/meridian-app.module.css";
import type { ExactActionStatus } from "@/components/exact-action-control";
import {
  AddressText,
  InlineNotice,
  MeridianButton,
  ProtocolBadge,
  StatusBadge,
  Surface,
  TechnicalDisclosure,
} from "@/components/meridian";
import { type ExactActionAttempt, type ExactActionReview } from "@/lib/exact-action";
import { v2SaveStorageKeys } from "@/lib/deployment-scope";
import {
  MAX_WITHDRAWAL_REQUEST_BASE_UNITS,
  WITHDRAWAL_REVIEW_MAX_AGE_SECONDS,
  createWithdrawalReview,
  withdrawalReviewInvalidReason,
  type WithdrawalReview,
} from "@/lib/withdrawal-review";
import { v2ParticipantCanWithdraw, type V2ParticipantSnapshot } from "@/lib/v2-save";

interface ExactActionPrepareInput {
  readonly key: string;
  readonly label: string;
  readonly consequence: string;
  readonly to: Address;
  readonly data: Hex;
  readonly value?: bigint;
}

interface SaveExactActionBridge {
  readonly review: ExactActionReview | null;
  readonly attempt: ExactActionAttempt | null;
  readonly status: ExactActionStatus;
  readonly storageReady: boolean;
  readonly isWalletPending: boolean;
  readonly prepare: (input: ExactActionPrepareInput) => Promise<ExactActionReview | null>;
  readonly openWallet: () => Promise<Hex | null>;
  readonly reconcile: () => Promise<boolean>;
  readonly discardReview: () => void;
}

interface MeridianSaveWithdrawalProps {
  readonly authenticatedAddress: Address;
  readonly participant: V2ParticipantSnapshot;
  readonly exactAction: SaveExactActionBridge;
  readonly onRefresh: () => Promise<void>;
}

function compactAddress(address: Address): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "The V2 confidential withdrawal stopped safely.";
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameParticipantBinding(
  left: V2ParticipantSnapshot,
  right: V2ParticipantSnapshot,
): boolean {
  return (
    left.slotIndex === right.slotIndex &&
    left.state === right.state &&
    sameAddress(left.owner, right.owner) &&
    left.registrationVersion === right.registrationVersion &&
    left.reservationNonce === right.reservationNonce
  );
}

function exactReviewMatches(
  review: ExactActionReview | null,
  input: {
    readonly key: string;
    readonly to: Address;
    readonly data: Hex;
    readonly accountNonce: number;
  },
): boolean {
  return (
    review !== null &&
    review.key === input.key &&
    sameAddress(review.to, input.to) &&
    review.data.toLowerCase() === input.data.toLowerCase() &&
    review.accountNonce === input.accountNonce &&
    review.value === 0n
  );
}

function statusTone(status: ExactActionStatus): "protocol" | "private" | "warning" | "danger" {
  if (status.kind === "included") {
    return "protocol";
  }

  if (status.kind === "ready" || status.kind === "wallet") {
    return "private";
  }

  if (status.kind === "blocked") {
    return "warning";
  }

  return "danger";
}

function statusTitle(status: ExactActionStatus): string {
  switch (status.kind) {
    case "included":
      return "Exact V2 withdrawal included";
    case "ready":
      return "Exact withdrawal review ready";
    case "wallet":
      return "Wallet review open";
    case "blocked":
      return "Exact withdrawal blocked";
    case "reverted":
      return "Exact withdrawal reverted";
    case "error":
      return "Withdrawal stopped safely";
    case "idle":
      return "Withdrawal idle";
  }
}

export function MeridianSaveWithdrawal({
  authenticatedAddress,
  participant,
  exactAction,
  onRefresh,
}: MeridianSaveWithdrawalProps) {
  const connection = useConnection();

  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });

  const zama = useZamaSDK();

  const metadataQuery = useMetadata(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken);

  const storageKeys = useMemo(
    () => v2SaveStorageKeys(authenticatedAddress),
    [authenticatedAddress],
  );

  const [amount, setAmount] = useState("");
  const [withdrawalReview, setWithdrawalReview] = useState<WithdrawalReview | null>(null);
  const [withdrawalActionActive, setWithdrawalActionActive] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tokenDecimals = metadataQuery.data?.decimals;
  const tokenSymbol = metadataQuery.data?.symbol ?? "cUSDT";

  const parsedAmount = useMemo(() => {
    if (tokenDecimals === undefined || amount.trim().length === 0) {
      return null;
    }

    try {
      const value = parseUnits(amount.trim(), tokenDecimals);

      return value > 0n && value <= MAX_WITHDRAWAL_REQUEST_BASE_UNITS ? value : null;
    } catch {
      return null;
    }
  }, [amount, tokenDecimals]);

  const requireWallet = useCallback((): Address => {
    if (connection.status !== "connected") {
      throw new Error("Connect the wallet that owns the authenticated Veilpot session.");
    }

    if (!sameAddress(connection.address, authenticatedAddress)) {
      throw new Error("The connected wallet does not own the authenticated Veilpot session.");
    }

    if (connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId) {
      throw new Error("Switch the authenticated wallet to Ethereum Sepolia.");
    }

    if (publicClient === undefined) {
      throw new Error("The Ethereum Sepolia public client is unavailable.");
    }

    return connection.address;
  }, [authenticatedAddress, connection, publicClient]);

  const readParticipant = useCallback(async (): Promise<V2ParticipantSnapshot | null> => {
    if (publicClient === undefined) {
      throw new Error("The Ethereum Sepolia public client is unavailable.");
    }

    const state = await publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "participantState",
      args: [participant.slotIndex],
    });

    if (state === PARTICIPANT_STATE.FREE || state === PARTICIPANT_STATE.TOMBSTONED) {
      return null;
    }

    const row = await publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "participantMetadata",
      args: [participant.slotIndex],
    });

    if (row[0] !== state) {
      throw new Error("Participant state changed during the authoritative PoolV2 read.");
    }

    return {
      slotIndex: participant.slotIndex,
      state: row[0],
      owner: row[1],
      registrationVersion: row[2],
      reservationNonce: row[3],
      reservationExpiry: row[4],
      activationStartedAt: row[5],
      activationDeadline: row[6],
      refundAttemptNonce: row[7],
      bondHeld: row[8],
    };
  }, [participant.slotIndex, publicClient]);

  const readWithdrawalNonce = useCallback(
    async (holder: Address): Promise<bigint> => {
      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      return publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "nextWithdrawNonce",
        args: [holder],
      });
    },
    [publicClient],
  );

  useEffect(() => {
    if (!withdrawalActionActive) {
      return;
    }

    if (exactAction.status.kind === "included") {
      setWithdrawalReview(null);
      setWithdrawalActionActive(false);
      setAmount("");
      setError(null);
      setNotice(
        "The exact confidential withdrawal was included. Public participant metadata is refreshing; principal remains sealed.",
      );
      void onRefresh();
      return;
    }

    if (exactAction.status.kind === "reverted") {
      setWithdrawalReview(null);
      setWithdrawalActionActive(false);
      setError(
        "The exact reviewed withdrawal was mined with failure. No automatic retry was generated.",
      );
      return;
    }

    if (
      exactAction.status.kind === "error" &&
      exactAction.review === null &&
      exactAction.attempt === null
    ) {
      setWithdrawalReview(null);
      setWithdrawalActionActive(false);
    }
  }, [
    exactAction.attempt,
    exactAction.review,
    exactAction.status.kind,
    onRefresh,
    withdrawalActionActive,
  ]);

  const prepareWithdrawal = useCallback(async () => {
    setNotice(null);
    setError(null);
    setWithdrawalReview(null);
    setWithdrawalActionActive(false);

    if (!exactAction.storageReady) {
      setError("Veilpot is still checking for an unresolved exact wallet attempt.");
      return;
    }

    if (exactAction.attempt !== null || exactAction.review !== null) {
      setError(
        "Resolve or discard the current exact Save action before encrypting another withdrawal.",
      );
      return;
    }

    if (tokenDecimals !== 6 || parsedAmount === null) {
      setError("Enter a positive cUSDT withdrawal request using the exact 6-decimal token format.");
      return;
    }

    setPreparing(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [liveParticipant, withdrawalNonce, accountNonce] = await Promise.all([
        readParticipant(),
        readWithdrawalNonce(holder),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (
        !v2ParticipantCanWithdraw(liveParticipant) ||
        liveParticipant === null ||
        !sameAddress(liveParticipant.owner, holder)
      ) {
        throw new Error(
          "The authenticated wallet no longer owns an eligible ACTIVE PoolV2 registration.",
        );
      }

      if (!sameParticipantBinding(liveParticipant, participant)) {
        throw new Error(
          "The displayed ACTIVE registration changed. Refresh before encrypting a withdrawal.",
        );
      }

      setNotice(
        "Encrypting only the entered withdrawal request for the exact active PoolV2 contract and authenticated wallet.",
      );

      const encrypted = await encryptV2PoolAmount(zama, parsedAmount, holder);

      const [postParticipant, postWithdrawalNonce, postAccountNonce] = await Promise.all([
        readParticipant(),
        readWithdrawalNonce(holder),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (
        postParticipant === null ||
        !sameParticipantBinding(postParticipant, liveParticipant) ||
        postWithdrawalNonce !== withdrawalNonce ||
        postAccountNonce !== accountNonce
      ) {
        throw new Error(
          "Participant or nonce state changed while encrypting. The withdrawal ciphertext was discarded and cannot be reused.",
        );
      }

      const descriptor = buildV2WithdrawalCall({
        encrypted,
        caller: holder,
        registrationVersion: postParticipant.registrationVersion,
        reservationNonce: postParticipant.reservationNonce,
        withdrawalNonce,
      });

      const calldata = encodeFunctionData({
        abi: descriptor.abi,
        functionName: descriptor.functionName,
        args: descriptor.args,
      });

      await publicClient.simulateContract({
        ...descriptor,
        account: holder,
      });

      const reviewTime = Math.floor(Date.now() / 1000);

      const domainReview = createWithdrawalReview({
        holder,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: {
          slotIndex: postParticipant.slotIndex,
          state: postParticipant.state,
          owner: postParticipant.owner,
          registrationVersion: postParticipant.registrationVersion,
          reservationNonce: postParticipant.reservationNonce,
        },
        amountBaseUnits: parsedAmount,
        amountDisplay: amount.trim(),
        tokenSymbol,
        tokenDecimals,
        withdrawalNonce,
        accountNonce,
        encryptedValue: encrypted.encryptedValue,
        inputProof: encrypted.inputProof,
        calldata,
        preparedAt: reviewTime,
        simulatedAt: reviewTime,
      });

      const exactReview = await exactAction.prepare({
        key: storageKeys.withdrawal,
        label: "Submit confidential PoolV2 withdrawal",
        consequence:
          "Withdraw up to the exact encrypted requested amount, privately capped by encrypted principal. PoolV2 accounts only the confidential token's actual returned transfer and never decrypts principal.",
        to: descriptor.address,
        data: calldata,
        value: 0n,
      });

      if (
        !exactReviewMatches(exactReview, {
          key: storageKeys.withdrawal,
          to: descriptor.address,
          data: calldata,
          accountNonce,
        })
      ) {
        exactAction.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen confidential withdrawal. The ciphertext was discarded.",
        );
      }

      setWithdrawalReview(domainReview);
      setWithdrawalActionActive(true);

      setNotice(
        "The encrypted withdrawal passed the PoolV2 simulation and exact-action review. Inspect the clear request you entered, public participant binding, nonces and calldata before opening the wallet.",
      );
    } catch (caught: unknown) {
      exactAction.discardReview();
      setWithdrawalReview(null);
      setWithdrawalActionActive(false);
      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    amount,
    exactAction,
    parsedAmount,
    participant,
    publicClient,
    readParticipant,
    readWithdrawalNonce,
    requireWallet,
    storageKeys.withdrawal,
    tokenDecimals,
    tokenSymbol,
    zama,
  ]);

  const openWithdrawal = useCallback(async () => {
    const domainReview = withdrawalReview;

    if (domainReview === null) {
      setError("Encrypt and prepare a fresh confidential withdrawal review first.");
      return;
    }

    setError(null);
    setPreparing(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [liveParticipant, withdrawalNonce, accountNonce] = await Promise.all([
        readParticipant(),
        readWithdrawalNonce(holder),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      const reviewedEncrypted = {
        encryptedValue: domainReview.encryptedValue,
        inputProof: domainReview.inputProof,
        contractAddress: domainReview.pool,
        userAddress: domainReview.holder,
      } as const;

      const descriptor = buildV2WithdrawalCall({
        encrypted: reviewedEncrypted,
        caller: domainReview.holder,
        registrationVersion: domainReview.participant.registrationVersion,
        reservationNonce: domainReview.participant.reservationNonce,
        withdrawalNonce: domainReview.withdrawalNonce,
      });

      const currentCalldata = encodeFunctionData({
        abi: descriptor.abi,
        functionName: descriptor.functionName,
        args: descriptor.args,
      });

      const invalidReason = withdrawalReviewInvalidReason(domainReview, {
        holder,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: connection.chainId,
        participant: liveParticipant,
        amountBaseUnits: parsedAmount,
        withdrawalNonce,
        accountNonce,
        currentCalldata,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exactAction.discardReview();
        setWithdrawalReview(null);
        setWithdrawalActionActive(false);

        throw new Error(`${invalidReason} No replacement ciphertext or transaction was generated.`);
      }

      if (
        !exactReviewMatches(exactAction.review, {
          key: storageKeys.withdrawal,
          to: descriptor.address,
          data: currentCalldata,
          accountNonce,
        })
      ) {
        exactAction.discardReview();
        setWithdrawalReview(null);
        setWithdrawalActionActive(false);

        throw new Error(
          "The exact wallet review no longer matches the frozen confidential withdrawal.",
        );
      }

      await publicClient.simulateContract({
        ...descriptor,
        account: holder,
      });

      setWithdrawalReview(null);

      await exactAction.openWallet();
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    connection.chainId,
    exactAction,
    parsedAmount,
    publicClient,
    readParticipant,
    readWithdrawalNonce,
    requireWallet,
    storageKeys.withdrawal,
    withdrawalReview,
  ]);

  const discardWithdrawalReview = useCallback(() => {
    exactAction.discardReview();
    setWithdrawalReview(null);
    setWithdrawalActionActive(false);
    setError(null);
    setNotice("The confidential withdrawal review was discarded. No transaction was submitted.");
  }, [exactAction]);

  const reviewExpiresAt =
    withdrawalReview === null
      ? null
      : withdrawalReview.preparedAt + WITHDRAWAL_REVIEW_MAX_AGE_SECONDS;

  const ownsExactAction =
    withdrawalActionActive ||
    withdrawalReview !== null ||
    exactAction.review?.key === storageKeys.withdrawal ||
    exactAction.attempt?.key === storageKeys.withdrawal;

  return (
    <div className={styles.saveDepositFlow}>
      <Surface className={styles.saveDepositHeader} elevation="raised">
        <div>
          <span className={styles.workspaceEyebrow}>CONFIDENTIAL WITHDRAWAL · V2</span>

          <h2>Request privately. Revalidate before the wallet.</h2>

          <p>
            The request is encrypted for PoolV2 and this authenticated wallet. PoolV2 privately caps
            it at encrypted principal and accounts only the confidential token&apos;s actual
            transfer.
          </p>
        </div>

        <ProtocolBadge>PoolV2 · ACTIVE only</ProtocolBadge>
      </Surface>

      <div className={styles.saveDepositGrid}>
        <Surface className={styles.saveDepositStep}>
          <span className={styles.saveDepositStepIndex}>01</span>

          <LockKeyhole size={20} aria-hidden="true" />

          <h3>Enter your request</h3>

          <p>
            Enter only the amount you want to request. Veilpot does not reveal your principal or
            confidential wallet balance to calculate it.
          </p>

          <label className={styles.saveAmountField}>
            <span>Withdrawal request</span>

            <div>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                placeholder="25.000000"
                disabled={preparing || exactAction.attempt !== null || exactAction.review !== null}
                onChange={(event) => {
                  setAmount(event.target.value);

                  if (withdrawalReview !== null) {
                    exactAction.discardReview();
                    setWithdrawalReview(null);
                    setWithdrawalActionActive(false);
                  }
                }}
              />

              <strong>{tokenSymbol}</strong>
            </div>
          </label>

          <small className={styles.saveDepositHint}>
            Positive euint64-compatible request. The actual principal remains encrypted and may be
            lower than the entered request.
          </small>

          <MeridianButton
            variant="private"
            size="large"
            disabled={
              parsedAmount === null ||
              tokenDecimals !== 6 ||
              preparing ||
              !exactAction.storageReady ||
              exactAction.attempt !== null ||
              exactAction.review !== null
            }
            onClick={() => {
              void prepareWithdrawal();
            }}
          >
            {preparing ? (
              <LoaderCircle size={15} aria-hidden="true" />
            ) : (
              <LockKeyhole size={15} aria-hidden="true" />
            )}
            Encrypt + simulate withdrawal
          </MeridianButton>
        </Surface>

        <Surface className={styles.saveDepositStep}>
          <span className={styles.saveDepositStepIndex}>02</span>

          <ShieldCheck size={20} aria-hidden="true" />

          <h3>Freeze public identity</h3>

          <p>
            The encrypted request is valid only for this exact ACTIVE registration and the
            address-scoped PoolV2 withdrawal nonce.
          </p>

          <div className={styles.saveOperatorState}>
            <span>Participant state</span>
            <StatusBadge tone={v2ParticipantCanWithdraw(participant) ? "success" : "danger"}>
              {v2ParticipantCanWithdraw(participant) ? "ACTIVE" : "Not eligible"}
            </StatusBadge>
          </div>

          <div className={styles.savePrivacyFact}>
            <ShieldCheck size={14} aria-hidden="true" />
            Slot {participant.slotIndex.toString()} · registration{" "}
            {participant.registrationVersion.toString()} · reservation{" "}
            {participant.reservationNonce.toString()}
          </div>

          <div className={styles.saveDepositButtons}>
            <MeridianButton
              variant="tertiary"
              size="small"
              disabled={preparing}
              onClick={() => {
                void onRefresh();
              }}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Refresh public state
            </MeridianButton>
          </div>
        </Surface>

        <Surface className={styles.saveDepositStep}>
          <span className={styles.saveDepositStepIndex}>03</span>

          <ShieldCheck size={20} aria-hidden="true" />

          <h3>Preserve confidentiality</h3>

          <p>
            The contract privately computes the eligible request and subtracts only the token&apos;s
            actual returned transfer from principal.
          </p>

          <div className={styles.savePrivacyFact}>
            <LockKeyhole size={14} aria-hidden="true" />
            Principal reveal: never automatic.
          </div>

          <div className={styles.savePrivacyFact}>
            <LockKeyhole size={14} aria-hidden="true" />
            Balance reveal: not required.
          </div>

          <div className={styles.savePrivacyFact}>
            <LockKeyhole size={14} aria-hidden="true" />
            Zero-principal proof: separate B3-B3 action.
          </div>
        </Surface>
      </div>

      {notice !== null ? (
        <InlineNotice title="V2 withdrawal status" tone="protocol">
          {notice}
        </InlineNotice>
      ) : null}

      {error !== null ? (
        <InlineNotice title="Withdrawal stopped safely" tone="danger">
          {error}
        </InlineNotice>
      ) : null}

      {exactAction.attempt !== null ? (
        <Surface className={styles.saveFlowReview} elevation="raised">
          <InlineNotice title="Unresolved exact wallet attempt" tone="warning">
            Veilpot will not prepare another Save transaction until this exact nonce and calldata
            are reconciled.
          </InlineNotice>

          <dl>
            <div>
              <dt>Action</dt>
              <dd>{exactAction.attempt.label}</dd>
            </div>

            <div>
              <dt>Wallet nonce</dt>
              <dd>{exactAction.attempt.accountNonce}</dd>
            </div>

            <div>
              <dt>Destination</dt>
              <dd>{compactAddress(exactAction.attempt.to)}</dd>
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
      ) : exactAction.review !== null && withdrawalReview !== null ? (
        <Surface className={styles.saveFlowReview} elevation="raised">
          <header>
            <ShieldCheck size={19} aria-hidden="true" />

            <div>
              <span className={styles.workspaceEyebrow}>FROZEN V2 WITHDRAWAL REVIEW</span>

              <h2>{exactAction.review.label}</h2>
            </div>
          </header>

          <dl>
            <div>
              <dt>Sender</dt>
              <dd>
                <AddressText>{compactAddress(exactAction.review.sender)}</AddressText>
              </dd>
            </div>

            <div>
              <dt>Destination</dt>
              <dd>
                <AddressText>{compactAddress(exactAction.review.to)}</AddressText>
              </dd>
            </div>

            <div>
              <dt>Entered request</dt>
              <dd>
                {withdrawalReview.amountDisplay} {withdrawalReview.tokenSymbol}
              </dd>
            </div>

            <div>
              <dt>Participant slot</dt>
              <dd>{withdrawalReview.participant.slotIndex.toString()}</dd>
            </div>

            <div>
              <dt>Registration version</dt>
              <dd>{withdrawalReview.participant.registrationVersion.toString()}</dd>
            </div>

            <div>
              <dt>Reservation nonce</dt>
              <dd>{withdrawalReview.participant.reservationNonce.toString()}</dd>
            </div>

            <div>
              <dt>Withdrawal nonce</dt>
              <dd>{withdrawalReview.withdrawalNonce.toString()}</dd>
            </div>

            <div>
              <dt>Wallet nonce</dt>
              <dd>{withdrawalReview.accountNonce}</dd>
            </div>

            <div>
              <dt>Native value</dt>
              <dd>{exactAction.review.value.toString()} wei</dd>
            </div>

            <div>
              <dt>Review freshness</dt>
              <dd>
                {reviewExpiresAt === null ? "—" : `Expires after Unix ${String(reviewExpiresAt)}`}
              </dd>
            </div>
          </dl>

          <p>{exactAction.review.consequence}</p>

          <TechnicalDisclosure label="Show exact encrypted calldata">
            <code>{exactAction.review.data}</code>
          </TechnicalDisclosure>

          <div className={styles.saveDepositButtons}>
            <MeridianButton
              variant="primary"
              disabled={preparing || exactAction.isWalletPending}
              onClick={() => {
                void openWithdrawal();
              }}
            >
              Open exact wallet review
              <ExternalLink size={14} aria-hidden="true" />
            </MeridianButton>

            <MeridianButton
              variant="tertiary"
              disabled={exactAction.isWalletPending}
              onClick={discardWithdrawalReview}
            >
              Discard review
            </MeridianButton>
          </div>
        </Surface>
      ) : null}

      {ownsExactAction && exactAction.status.kind !== "idle" ? (
        <InlineNotice title={statusTitle(exactAction.status)} tone={statusTone(exactAction.status)}>
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

      <InlineNotice title="Withdrawal confidentiality boundary" tone="private">
        This control never decrypts principal, confidential wallet balance, pending amounts, refund
        residuals, winner state or prize entitlement. The clear amount shown above exists only
        because you typed it into this browser session.
      </InlineNotice>
    </div>
  );
}
