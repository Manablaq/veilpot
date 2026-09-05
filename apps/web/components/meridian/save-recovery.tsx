"use client";

import {
  Clock3,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatEther, type Address, type Hex } from "viem";
import { useConnection, usePublicClient } from "wagmi";
import { useZamaSDK } from "@zama-fhe/react-sdk";

import {
  PARTICIPANT_STATE,
  SUPPORTED_REGISTRATION_VERSION,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_POOL_V2_ABI,
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
  REFUND_SETTLEMENT_REVIEW_MAX_AGE_SECONDS,
  createRefundSettlementReview,
  refundSettlementReviewInvalidReason,
  type RefundParticipantBinding,
  type RefundSettlementReview,
} from "@/lib/recovery-review";
import { parsePublicBoolean } from "@/lib/threshold-settlement";
import {
  v2BondCreditAvailable,
  v2ParticipantCanAttemptRefund,
  v2ParticipantCanExpireActivation,
  v2ParticipantCanExpireReservation,
  v2ParticipantCanSettleRefund,
  type V2ParticipantSnapshot,
} from "@/lib/v2-save";

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

interface MeridianSaveRecoveryProps {
  readonly authenticatedAddress: Address;

  readonly participant: V2ParticipantSnapshot | null;

  readonly exactAction: SaveExactActionBridge;
}

type SimpleRecoveryKind =
  | "reservation-expiry"
  | "activation-expiry"
  | "refund-attempt"
  | "bond-withdrawal";

interface SimpleRecoveryAction {
  readonly key: string;
  readonly label: string;
  readonly consequence: string;
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
}

function compactAddress(address: Address): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "The V2.x recovery action stopped safely.";
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
    left.reservationNonce === right.reservationNonce &&
    left.reservationExpiry === right.reservationExpiry &&
    left.activationStartedAt === right.activationStartedAt &&
    left.activationDeadline === right.activationDeadline &&
    left.refundAttemptNonce === right.refundAttemptNonce &&
    left.bondHeld === right.bondHeld
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

function toRefundBinding(participant: V2ParticipantSnapshot): RefundParticipantBinding {
  return {
    slotIndex: participant.slotIndex,
    state: participant.state,
    owner: participant.owner,
    registrationVersion: participant.registrationVersion,
    reservationNonce: participant.reservationNonce,
    refundAttemptNonce: participant.refundAttemptNonce,
  };
}

export function MeridianSaveRecovery({
  authenticatedAddress,
  participant,
  exactAction,
}: MeridianSaveRecoveryProps) {
  const connection = useConnection();

  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });

  const zama = useZamaSDK();

  const storageKeys = useMemo(
    () => v2SaveStorageKeys(authenticatedAddress),
    [authenticatedAddress],
  );

  const recoveryKeys = useMemo(
    () =>
      new Set<string>([
        storageKeys.reservationExpiry,
        storageKeys.activationExpiry,
        storageKeys.refundAttempt,
        storageKeys.refundSettlement,
        storageKeys.bondWithdrawal,
      ]),
    [
      storageKeys.activationExpiry,
      storageKeys.bondWithdrawal,
      storageKeys.refundAttempt,
      storageKeys.refundSettlement,
      storageKeys.reservationExpiry,
    ],
  );

  const [bondCredit, setBondCredit] = useState(0n);

  const [blockTimestamp, setBlockTimestamp] = useState<bigint | null>(null);

  const [loadingPublic, setLoadingPublic] = useState(true);

  const [busy, setBusy] = useState(false);

  const [decrypting, setDecrypting] = useState(false);

  const [settlementReview, setSettlementReview] = useState<RefundSettlementReview | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

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

  const readBondCredit = useCallback(async (): Promise<bigint> => {
    if (publicClient === undefined) {
      throw new Error("The Ethereum Sepolia public client is unavailable.");
    }

    return publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "pendingBondRefund",
      args: [authenticatedAddress],
    });
  }, [authenticatedAddress, publicClient]);

  const readLatestTimestamp = useCallback(async (): Promise<bigint> => {
    if (publicClient === undefined) {
      throw new Error("The Ethereum Sepolia public client is unavailable.");
    }

    const block = await publicClient.getBlock({
      blockTag: "latest",
    });

    return block.timestamp;
  }, [publicClient]);

  const readLiveParticipant = useCallback(async (): Promise<V2ParticipantSnapshot | null> => {
    if (participant === null) {
      return null;
    }

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
      throw new Error("Participant state changed during the authoritative PoolV2.x read.");
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
  }, [participant, publicClient]);

  const requireBoundParticipant = useCallback(
    async (holder: Address): Promise<V2ParticipantSnapshot> => {
      if (participant === null) {
        throw new Error("No live PoolV2.x participant is available for this recovery action.");
      }

      const live = await readLiveParticipant();

      if (live === null) {
        throw new Error(
          "The displayed participant no longer exists. Refresh before preparing recovery.",
        );
      }

      if (!sameAddress(live.owner, holder)) {
        throw new Error("The live recovery participant belongs to a different wallet.");
      }

      if (live.registrationVersion !== SUPPORTED_REGISTRATION_VERSION) {
        throw new Error("The live recovery registration version is unsupported.");
      }

      if (!sameParticipantBinding(live, participant)) {
        throw new Error(
          "The public participant binding changed. Refresh before preparing recovery.",
        );
      }

      return live;
    },
    [participant, readLiveParticipant],
  );

  const readRefundCompleteHandle = useCallback(
    async (slotIndex: bigint): Promise<Hex> => {
      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const handle = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "refundCompleteHandle",
        args: [slotIndex],
      });

      if (!/^0x[0-9a-fA-F]{64}$/.test(handle)) {
        throw new Error("The refund-complete handle is malformed.");
      }

      return handle;
    },
    [publicClient],
  );

  const refreshPublicState = useCallback(async () => {
    setLoadingPublic(true);

    try {
      const [credit, timestamp] = await Promise.all([readBondCredit(), readLatestTimestamp()]);

      setBondCredit(credit);

      setBlockTimestamp(timestamp);
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setLoadingPublic(false);
    }
  }, [readBondCredit, readLatestTimestamp]);

  useEffect(() => {
    void refreshPublicState();
  }, [participant, refreshPublicState]);

  useEffect(() => {
    if (exactAction.review?.key !== storageKeys.refundSettlement) {
      setSettlementReview(null);
    }
  }, [exactAction.review?.key, storageKeys.refundSettlement]);

  const buildSimpleAction = useCallback(
    async (kind: SimpleRecoveryKind, holder: Address): Promise<SimpleRecoveryAction> => {
      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      if (kind === "bond-withdrawal") {
        const credit = await readBondCredit();

        if (!v2BondCreditAvailable(credit)) {
          throw new Error("No public registration-bond credit is currently withdrawable.");
        }

        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "withdrawBond",
        });

        return {
          key: storageKeys.bondWithdrawal,
          label: "Withdraw public registration-bond credit",
          consequence:
            "Withdraw the exact public pull-credit recorded for the authenticated wallet. This action does not read or reveal any confidential token amount.",
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data,
          value: 0n,
        };
      }

      const live = await requireBoundParticipant(holder);

      const timestamp = await readLatestTimestamp();

      if (kind === "reservation-expiry") {
        if (!v2ParticipantCanExpireReservation(live, timestamp)) {
          throw new Error("The reservation is not strictly past its public expiry boundary.");
        }

        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "expireReservation",
          args: [live.slotIndex],
        });

        return {
          key: storageKeys.reservationExpiry,
          label: "Expire unused V2.x reservation",
          consequence:
            "Release the expired registration bond into public pull-credit accounting and clear the unused participant slot. No confidential principal exists in this state.",
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data,
          value: 0n,
        };
      }

      if (kind === "activation-expiry") {
        if (!v2ParticipantCanExpireActivation(live, timestamp)) {
          throw new Error("The activation proof is not strictly past its public deadline.");
        }

        const data = encodeFunctionData({
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "expirePendingActivation",
          args: [live.slotIndex],
        });

        return {
          key: storageKeys.activationExpiry,
          label: "Expire pending activation",
          consequence:
            "Move the expired pending activation into the confidential refund lifecycle and credit its public registration bond for pull withdrawal. The pending confidential amount is not decrypted.",
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data,
          value: 0n,
        };
      }

      if (!v2ParticipantCanAttemptRefund(live)) {
        throw new Error("The participant is not in the supported PENDING_REFUND lifecycle state.");
      }

      const data = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "refundAttempt",
        args: [live.slotIndex],
      });

      return {
        key: storageKeys.refundAttempt,
        label: "Attempt confidential refund",
        consequence:
          "Ask PoolV2.x to transfer the encrypted refund obligation to its fixed registered owner. The requested amount and any residual remain confidential.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      };
    },
    [
      publicClient,
      readBondCredit,
      readLatestTimestamp,
      requireBoundParticipant,
      storageKeys.activationExpiry,
      storageKeys.bondWithdrawal,
      storageKeys.refundAttempt,
      storageKeys.reservationExpiry,
    ],
  );

  const prepareSimple = useCallback(
    async (kind: SimpleRecoveryKind) => {
      setError(null);
      setNotice(null);
      setSettlementReview(null);

      if (!exactAction.storageReady) {
        setError("Veilpot is still checking for an unresolved exact wallet attempt.");

        return;
      }

      if (exactAction.review !== null || exactAction.attempt !== null) {
        setError("Resolve or discard the current exact Save action before preparing recovery.");

        return;
      }

      setBusy(true);

      try {
        const holder = requireWallet();

        const action = await buildSimpleAction(kind, holder);

        const review = await exactAction.prepare(action);

        if (
          review?.key !== action.key ||
          !sameAddress(review.to, action.to) ||
          review.data.toLowerCase() !== action.data.toLowerCase() ||
          review.value !== 0n
        ) {
          exactAction.discardReview();

          throw new Error("The exact-action review diverged from the frozen recovery action.");
        }

        setNotice(
          "Recovery simulated successfully. Opening the wallet is a separate explicit step.",
        );
      } catch (caught: unknown) {
        exactAction.discardReview();

        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [buildSimpleAction, exactAction, requireWallet],
  );

  const openSimple = useCallback(
    async (kind: SimpleRecoveryKind) => {
      const review = exactAction.review;

      if (review === null) {
        setError("Prepare a fresh exact recovery review first.");

        return;
      }

      setBusy(true);
      setError(null);

      try {
        const holder = requireWallet();

        if (publicClient === undefined) {
          throw new Error("The Ethereum Sepolia public client is unavailable.");
        }

        const action = await buildSimpleAction(kind, holder);

        const accountNonce = await publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        });

        if (
          !exactReviewMatches(review, {
            key: action.key,
            to: action.to,
            data: action.data,
            accountNonce,
          })
        ) {
          exactAction.discardReview();

          throw new Error(
            "The exact recovery review no longer matches current public state, calldata or wallet nonce.",
          );
        }

        await publicClient.call({
          account: holder,
          to: action.to,
          data: action.data,
          value: 0n,
        });

        await exactAction.openWallet();
      } catch (caught: unknown) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [buildSimpleAction, exactAction, publicClient, requireWallet],
  );

  const prepareRefundSettlement = useCallback(async () => {
    setError(null);
    setNotice(null);
    setSettlementReview(null);

    if (!exactAction.storageReady) {
      setError("Veilpot is still checking for an unresolved exact wallet attempt.");

      return;
    }

    if (exactAction.review !== null || exactAction.attempt !== null) {
      setError(
        "Resolve or discard the current exact Save action before decrypting refund completion.",
      );

      return;
    }

    setDecrypting(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const before = await requireBoundParticipant(holder);

      if (!v2ParticipantCanSettleRefund(before)) {
        throw new Error("The participant is not waiting for a current refund-completion proof.");
      }

      const beforeHandle = await readRefundCompleteHandle(before.slotIndex);

      setNotice(
        "Decrypting only the explicitly public refund-complete boolean. No confidential refund amount or residual is requested.",
      );

      const decrypted = await zama.decryption.decryptPublicValues([beforeHandle], {
        timeout: 180_000,
      });

      const clearEntry = Object.entries(decrypted.clearValues).find(
        ([handle]) => handle.toLowerCase() === beforeHandle.toLowerCase(),
      );

      if (clearEntry === undefined) {
        throw new Error(
          "The public refund response did not contain the exact current completion handle.",
        );
      }

      const clearComplete = parsePublicBoolean(clearEntry[1]);

      const proof = decrypted.decryptionProof;

      if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(proof)) {
        throw new Error("The public refund-completion decryption proof is empty or malformed.");
      }

      const [after, afterHandle, accountNonce] = await Promise.all([
        readLiveParticipant(),
        readRefundCompleteHandle(before.slotIndex),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (
        after === null ||
        !sameAddress(after.owner, holder) ||
        !sameParticipantBinding(before, after)
      ) {
        throw new Error(
          "The refund participant changed during public decryption. The proof was discarded.",
        );
      }

      if (afterHandle.toLowerCase() !== beforeHandle.toLowerCase()) {
        throw new Error(
          "The refund-complete handle changed during public decryption. The proof was discarded.",
        );
      }

      const proofHex = proof;

      const data = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleRefundCompletion",
        args: [
          after.slotIndex,
          after.registrationVersion,
          after.reservationNonce,
          after.refundAttemptNonce,
          clearComplete,
          proofHex,
        ],
      });

      await publicClient.call({
        account: holder,
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });

      const preparedAt = Math.floor(Date.now() / 1000);

      const domainReview = createRefundSettlementReview({
        holder,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: toRefundBinding(after),
        refundCompleteHandle: afterHandle,
        clearComplete,
        decryptionProof: proofHex,
        calldata: data,
        accountNonce,
        preparedAt,
        simulatedAt: preparedAt,
      });

      const review = await exactAction.prepare({
        key: storageKeys.refundSettlement,
        label: clearComplete
          ? "Settle complete confidential refund"
          : "Settle partial confidential refund",
        consequence: clearComplete
          ? "Submit the exact authenticated TRUE refund-completion proof and clear the finished participant registration."
          : "Submit the exact authenticated FALSE refund-completion proof and return the registration to PENDING_REFUND for another confidential retry.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });

      if (
        !exactReviewMatches(review, {
          key: storageKeys.refundSettlement,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data,
          accountNonce,
        })
      ) {
        exactAction.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen refund-completion settlement.",
        );
      }

      setSettlementReview(domainReview);

      setNotice(
        clearComplete
          ? "The public completion consequence is TRUE. The exact participant-clear settlement is ready for explicit wallet review."
          : "The public completion consequence is FALSE. The exact settlement returns the participant to PENDING_REFUND for another confidential retry.",
      );
    } catch (caught: unknown) {
      exactAction.discardReview();

      setSettlementReview(null);

      setError(errorMessage(caught));
    } finally {
      setDecrypting(false);
    }
  }, [
    exactAction,
    publicClient,
    readLiveParticipant,
    readRefundCompleteHandle,
    requireBoundParticipant,
    requireWallet,
    storageKeys.refundSettlement,
    zama,
  ]);

  const openRefundSettlement = useCallback(async () => {
    const domainReview = settlementReview;

    const review = exactAction.review;

    if (domainReview === null || review === null) {
      setError("Prepare a fresh refund-completion proof review first.");

      return;
    }

    setBusy(true);
    setError(null);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [live, liveHandle, accountNonce] = await Promise.all([
        readLiveParticipant(),
        readRefundCompleteHandle(domainReview.participant.slotIndex),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      const data = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleRefundCompletion",
        args: [
          domainReview.participant.slotIndex,
          domainReview.participant.registrationVersion,
          domainReview.participant.reservationNonce,
          domainReview.participant.refundAttemptNonce,
          domainReview.clearComplete,
          domainReview.decryptionProof,
        ],
      });

      const invalidReason = refundSettlementReviewInvalidReason(domainReview, {
        holder,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: connection.chainId,
        participant: live === null ? null : toRefundBinding(live),
        refundCompleteHandle: liveHandle,
        currentCalldata: data,
        accountNonce,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exactAction.discardReview();

        setSettlementReview(null);

        throw new Error(
          `${invalidReason} The stale refund proof was discarded; no replacement transaction was generated.`,
        );
      }

      if (
        !exactReviewMatches(review, {
          key: storageKeys.refundSettlement,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data,
          accountNonce,
        })
      ) {
        exactAction.discardReview();

        setSettlementReview(null);

        throw new Error("The exact wallet review no longer matches the frozen refund settlement.");
      }

      await publicClient.call({
        account: holder,
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });

      setSettlementReview(null);

      await exactAction.openWallet();
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [
    connection.chainId,
    exactAction,
    publicClient,
    readLiveParticipant,
    readRefundCompleteHandle,
    requireWallet,
    settlementReview,
    storageKeys.refundSettlement,
  ]);

  const openReviewedAction = useCallback(async () => {
    const review = exactAction.review;

    if (review === null) {
      setError("Prepare a fresh exact recovery review first.");

      return;
    }

    if (review.key === storageKeys.refundSettlement) {
      await openRefundSettlement();

      return;
    }

    if (review.key === storageKeys.reservationExpiry) {
      await openSimple("reservation-expiry");

      return;
    }

    if (review.key === storageKeys.activationExpiry) {
      await openSimple("activation-expiry");

      return;
    }

    if (review.key === storageKeys.refundAttempt) {
      await openSimple("refund-attempt");

      return;
    }

    if (review.key === storageKeys.bondWithdrawal) {
      await openSimple("bond-withdrawal");

      return;
    }

    setError("The current exact review does not belong to the V2.x recovery surface.");
  }, [
    exactAction.review,
    openRefundSettlement,
    openSimple,
    storageKeys.activationExpiry,
    storageKeys.bondWithdrawal,
    storageKeys.refundAttempt,
    storageKeys.refundSettlement,
    storageKeys.reservationExpiry,
  ]);

  const ownsReview = exactAction.review !== null && recoveryKeys.has(exactAction.review.key);

  const ownsAttempt = exactAction.attempt !== null && recoveryKeys.has(exactAction.attempt.key);

  const reservationExpired =
    blockTimestamp !== null && v2ParticipantCanExpireReservation(participant, blockTimestamp);

  const activationExpired =
    blockTimestamp !== null && v2ParticipantCanExpireActivation(participant, blockTimestamp);

  const refundReady = v2ParticipantCanAttemptRefund(participant);

  const refundProofReady = v2ParticipantCanSettleRefund(participant);

  const bondReady = v2BondCreditAvailable(bondCredit);

  const commonDisabled =
    busy ||
    decrypting ||
    loadingPublic ||
    !exactAction.storageReady ||
    exactAction.review !== null ||
    exactAction.attempt !== null;

  if (loadingPublic && !refundReady && !refundProofReady && !ownsReview && !ownsAttempt) {
    return null;
  }

  if (
    !reservationExpired &&
    !activationExpired &&
    !refundReady &&
    !refundProofReady &&
    !bondReady &&
    !ownsReview &&
    !ownsAttempt
  ) {
    return null;
  }

  const reviewExpiresAt =
    settlementReview === null
      ? null
      : settlementReview.preparedAt + REFUND_SETTLEMENT_REVIEW_MAX_AGE_SECONDS;

  return (
    <div className={styles.saveDepositFlow}>
      <Surface className={styles.saveDepositHeader} elevation="raised">
        <div>
          <span className={styles.workspaceEyebrow}>RECOVERY · V2.x</span>

          <h2>Recovery without disclosure.</h2>

          <p>
            Expiry, confidential refund retries and public bond pull-credit are surfaced without
            revealing the encrypted refund obligation.
          </p>
        </div>

        <ProtocolBadge>Fail-closed recovery</ProtocolBadge>
      </Surface>

      <div className={styles.saveDepositGrid}>
        {reservationExpired ? (
          <Surface className={styles.saveDepositStep}>
            <Clock3 size={20} aria-hidden="true" />

            <h3>Expire unused reservation</h3>

            <p>
              The public reservation deadline is strictly past. Releasing it clears the unused slot
              and credits the registration bond for pull withdrawal.
            </p>

            <MeridianButton
              variant="secondary"
              size="large"
              disabled={commonDisabled}
              onClick={() => {
                void prepareSimple("reservation-expiry");
              }}
            >
              <RefreshCw size={15} aria-hidden="true" />
              Prepare reservation expiry
            </MeridianButton>
          </Surface>
        ) : null}

        {activationExpired ? (
          <Surface className={styles.saveDepositStep}>
            <Clock3 size={20} aria-hidden="true" />

            <h3>Recover expired activation</h3>

            <p>
              The public proof deadline is strictly past. Recovery moves the sealed pending
              obligation into the confidential refund lifecycle and credits the registration bond.
            </p>

            <MeridianButton
              variant="secondary"
              size="large"
              disabled={commonDisabled}
              onClick={() => {
                void prepareSimple("activation-expiry");
              }}
            >
              <RefreshCw size={15} aria-hidden="true" />
              Prepare activation expiry
            </MeridianButton>
          </Surface>
        ) : null}

        {refundReady ? (
          <Surface className={styles.saveDepositStep}>
            <ShieldCheck size={20} aria-hidden="true" />

            <h3>Attempt confidential refund</h3>

            <p>
              PoolV2.x sends the encrypted refund obligation only to its fixed registered owner and
              records only the actual confidential transfer result.
            </p>

            <div className={styles.savePrivacyFact}>
              <ShieldCheck size={14} aria-hidden="true" />
              Refund amount reveal: none
            </div>

            <MeridianButton
              variant="private"
              size="large"
              disabled={commonDisabled}
              onClick={() => {
                void prepareSimple("refund-attempt");
              }}
            >
              <ShieldCheck size={15} aria-hidden="true" />
              Prepare confidential refund
            </MeridianButton>
          </Surface>
        ) : null}

        {refundProofReady ? (
          <Surface className={styles.saveDepositStep}>
            <KeyRound size={20} aria-hidden="true" />

            <h3>Check refund completion</h3>

            <p>
              Explicitly decrypt only the public completion predicate for the current refund-attempt
              nonce.
            </p>

            <div className={styles.savePrivacyFact}>
              <ShieldCheck size={14} aria-hidden="true" />
              Confidential residual reveal: none
            </div>

            <MeridianButton
              variant="private"
              size="large"
              disabled={commonDisabled}
              onClick={() => {
                void prepareRefundSettlement();
              }}
            >
              {decrypting ? (
                <LoaderCircle size={15} aria-hidden="true" />
              ) : (
                <KeyRound size={15} aria-hidden="true" />
              )}
              Decrypt public completion boolean
            </MeridianButton>
          </Surface>
        ) : null}

        {bondReady ? (
          <Surface className={styles.saveDepositStep}>
            <WalletCards size={20} aria-hidden="true" />

            <h3>Withdraw bond credit</h3>

            <p>
              Registration-bond recovery is public pull accounting and survives participant
              clearance.
            </p>

            <div className={styles.saveBondRow}>
              <span>Public bond credit</span>

              <strong>{formatEther(bondCredit)} ETH</strong>
            </div>

            <MeridianButton
              variant="secondary"
              size="large"
              disabled={commonDisabled}
              onClick={() => {
                void prepareSimple("bond-withdrawal");
              }}
            >
              <WalletCards size={15} aria-hidden="true" />
              Prepare bond withdrawal
            </MeridianButton>
          </Surface>
        ) : null}
      </div>

      {notice !== null ? (
        <InlineNotice title="Recovery status" tone="protocol">
          {notice}
        </InlineNotice>
      ) : null}

      {error !== null ? (
        <InlineNotice title="Recovery stopped safely" tone="danger">
          {error}
        </InlineNotice>
      ) : null}

      {ownsAttempt ? (
        <Surface className={styles.saveFlowReview} elevation="raised">
          <InlineNotice title="Unresolved exact recovery attempt" tone="warning">
            No second recovery action will be prepared until this exact nonce and calldata are
            conclusively reconciled.
          </InlineNotice>

          <dl>
            <div>
              <dt>Action</dt>
              <dd>{exactAction.attempt.label}</dd>
            </div>

            <div>
              <dt>Destination</dt>
              <dd>{compactAddress(exactAction.attempt.to)}</dd>
            </div>

            <div>
              <dt>Wallet nonce</dt>
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
            Reconcile exact recovery attempt
          </MeridianButton>
        </Surface>
      ) : ownsReview ? (
        <Surface className={styles.saveFlowReview} elevation="raised">
          <header>
            <ShieldCheck size={19} aria-hidden="true" />

            <div>
              <span className={styles.workspaceEyebrow}>FROZEN RECOVERY REVIEW</span>

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
              <dt>Wallet nonce</dt>
              <dd>{exactAction.review.accountNonce}</dd>
            </div>

            <div>
              <dt>Native value</dt>
              <dd>{exactAction.review.value.toString()} wei</dd>
            </div>

            {settlementReview !== null ? (
              <>
                <div>
                  <dt>Public refund completion</dt>
                  <dd>{settlementReview.clearComplete ? "TRUE" : "FALSE"}</dd>
                </div>

                <div>
                  <dt>Refund attempt nonce</dt>
                  <dd>{settlementReview.participant.refundAttemptNonce.toString()}</dd>
                </div>

                <div>
                  <dt>Review expiry</dt>
                  <dd>{reviewExpiresAt === null ? "—" : `Unix ${String(reviewExpiresAt)}`}</dd>
                </div>
              </>
            ) : null}
          </dl>

          <p>{exactAction.review.consequence}</p>

          {settlementReview !== null ? (
            <TechnicalDisclosure label="Show public refund-complete handle">
              <code>{settlementReview.refundCompleteHandle}</code>
            </TechnicalDisclosure>
          ) : null}

          <TechnicalDisclosure label="Show exact recovery calldata">
            <code>{exactAction.review.data}</code>
          </TechnicalDisclosure>

          {exactAction.review.key === storageKeys.refundSettlement && settlementReview === null ? (
            <InlineNotice title="Fresh proof context required" tone="warning">
              The exact refund settlement is missing its ephemeral public-proof review context.
              Discard it and decrypt the current completion predicate again.
            </InlineNotice>
          ) : (
            <MeridianButton
              variant="primary"
              disabled={busy || exactAction.isWalletPending}
              onClick={() => {
                void openReviewedAction();
              }}
            >
              Open exact wallet review
              <ExternalLink size={14} aria-hidden="true" />
            </MeridianButton>
          )}

          <MeridianButton
            variant="tertiary"
            disabled={exactAction.isWalletPending}
            onClick={() => {
              exactAction.discardReview();
              setSettlementReview(null);
              setNotice("The recovery review was discarded. No transaction was submitted.");
            }}
          >
            Discard review
          </MeridianButton>
        </Surface>
      ) : null}

      <InlineNotice title="Recovery privacy boundary" tone="private">
        Recovery never decrypts principal, wallet confidential balance, the confidential refund
        obligation, or its residual. Only the contract-designated public refund-complete boolean may
        be explicitly decrypted.
      </InlineNotice>

      <StatusBadge tone="neutral">
        Corrected PoolV2.x · {compactAddress(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool)}
      </StatusBadge>
    </div>
  );
}
