"use client";

import { ExternalLink, KeyRound, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { useConnection, usePublicClient } from "wagmi";
import { useZamaSDK } from "@zama-fhe/react-sdk";

import {
  PARTICIPANT_STATE,
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
  DEREGISTRATION_REVIEW_MAX_AGE_SECONDS,
  createDeregistrationSettlementReview,
  deregistrationReviewInvalidReason,
  type DeregistrationSettlementReview,
} from "@/lib/deregistration-review";
import { parsePublicBoolean } from "@/lib/threshold-settlement";
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

interface MeridianSaveDeregistrationProps {
  readonly authenticatedAddress: Address;

  readonly participant: V2ParticipantSnapshot;

  readonly exactAction: SaveExactActionBridge;

  readonly onRefresh: () => Promise<void>;
}

type DeregistrationActionKind = "prepare" | "settle" | null;

function compactAddress(address: Address): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "The V2.x deregistration flow stopped safely.";
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
      return "Exact V2.x deregistration action included";

    case "ready":
      return "Exact deregistration review ready";

    case "wallet":
      return "Wallet review open";

    case "blocked":
      return "Exact deregistration action blocked";

    case "reverted":
      return "Exact deregistration action reverted";

    case "error":
      return "Deregistration stopped safely";

    case "idle":
      return "Deregistration idle";
  }
}

export function MeridianSaveDeregistration({
  authenticatedAddress,
  participant,
  exactAction,
  onRefresh,
}: MeridianSaveDeregistrationProps) {
  const connection = useConnection();

  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });

  const zama = useZamaSDK();

  const storageKeys = useMemo(
    () => v2SaveStorageKeys(authenticatedAddress),
    [authenticatedAddress],
  );

  const [actionKind, setActionKind] = useState<DeregistrationActionKind>(null);

  const [preparationBinding, setPreparationBinding] = useState<V2ParticipantSnapshot | null>(null);

  const [preparedParticipant, setPreparedParticipant] = useState<V2ParticipantSnapshot | null>(
    null,
  );

  const [preparedHandle, setPreparedHandle] = useState<Hex | null>(null);

  const [settlementReview, setSettlementReview] = useState<DeregistrationSettlementReview | null>(
    null,
  );

  const [preparing, setPreparing] = useState(false);

  const [decrypting, setDecrypting] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const clearPreparedPredicate = useCallback(() => {
    setPreparedParticipant(null);

    setPreparedHandle(null);
  }, []);

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
  }, [participant.slotIndex, publicClient]);

  const readZeroHandle = useCallback(async (): Promise<Hex> => {
    if (publicClient === undefined) {
      throw new Error("The Ethereum Sepolia public client is unavailable.");
    }

    const handle = await publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "deregistrationZeroHandle",
      args: [participant.slotIndex],
    });

    if (!/^0x[0-9a-fA-F]{64}$/.test(handle)) {
      throw new Error("The PoolV2.x deregistration-zero handle is malformed.");
    }

    return handle;
  }, [participant.slotIndex, publicClient]);

  useEffect(() => {
    if (actionKind === null) {
      return;
    }

    if (exactAction.status.kind === "included") {
      if (actionKind === "prepare") {
        const frozen = preparationBinding;

        setActionKind(null);

        setPreparationBinding(null);

        if (frozen === null) {
          clearPreparedPredicate();

          setError(
            "The preparation transaction was included without its frozen participant context. Prepare a fresh predicate before decrypting.",
          );

          return;
        }

        void (async () => {
          try {
            const [liveParticipant, zeroHandle] = await Promise.all([
              readParticipant(),
              readZeroHandle(),
            ]);

            if (
              liveParticipant === null ||
              !v2ParticipantCanWithdraw(liveParticipant) ||
              !sameAddress(liveParticipant.owner, authenticatedAddress) ||
              !sameParticipantBinding(liveParticipant, frozen)
            ) {
              throw new Error(
                "The ACTIVE registration changed after deregistration preparation. Prepare a fresh predicate.",
              );
            }

            setPreparedParticipant(liveParticipant);

            setPreparedHandle(zeroHandle);

            setError(null);

            setNotice(
              "The exact preparation transaction was included. The current deregistration-zero handle is armed for an explicit public boolean decryption.",
            );

            await onRefresh();
          } catch (caught: unknown) {
            clearPreparedPredicate();

            setError(errorMessage(caught));
          }
        })();

        return;
      }

      clearPreparedPredicate();

      setSettlementReview(null);

      setPreparationBinding(null);

      setActionKind(null);

      setError(null);

      setNotice(
        "The exact TRUE zero-principal settlement was included. Public lifecycle state is refreshing.",
      );

      void onRefresh();

      return;
    }

    if (exactAction.status.kind === "reverted") {
      if (actionKind === "settle") {
        setSettlementReview(null);
      }

      if (actionKind === "prepare") {
        setPreparationBinding(null);
      }

      setActionKind(null);

      setError(
        "The exact deregistration action was mined with failure. No automatic retry was generated.",
      );

      return;
    }

    if (
      exactAction.status.kind === "error" &&
      exactAction.review === null &&
      exactAction.attempt === null
    ) {
      setActionKind(null);

      setPreparationBinding(null);

      setSettlementReview(null);
    }
  }, [
    actionKind,
    authenticatedAddress,
    clearPreparedPredicate,
    exactAction.attempt,
    exactAction.review,
    exactAction.status.kind,
    onRefresh,
    preparationBinding,
    readParticipant,
    readZeroHandle,
  ]);

  const prepareZeroPredicate = useCallback(async () => {
    setNotice(null);
    setError(null);
    clearPreparedPredicate();
    setSettlementReview(null);
    setPreparationBinding(null);
    setActionKind(null);

    if (!exactAction.storageReady) {
      setError("Veilpot is still checking for an unresolved exact wallet attempt.");

      return;
    }

    if (exactAction.attempt !== null || exactAction.review !== null) {
      setError("Resolve or discard the current exact Save action before preparing deregistration.");

      return;
    }

    setPreparing(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const liveParticipant = await readParticipant();

      if (
        liveParticipant === null ||
        !v2ParticipantCanWithdraw(liveParticipant) ||
        !sameAddress(liveParticipant.owner, holder)
      ) {
        throw new Error(
          "The authenticated wallet no longer owns an eligible ACTIVE PoolV2.x registration.",
        );
      }

      if (!sameParticipantBinding(liveParticipant, participant)) {
        throw new Error(
          "The displayed ACTIVE registration changed. Refresh before preparing deregistration.",
        );
      }

      const calldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "prepareDeregistration",
        args: [liveParticipant.slotIndex],
      });

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "prepareDeregistration",
        args: [liveParticipant.slotIndex],
        account: holder,
      });

      const exactReview = await exactAction.prepare({
        key: storageKeys.deregistrationPreparation,
        label: "Prepare current zero-principal predicate",
        consequence:
          "Recompute the encrypted principal-equals-zero predicate for this exact ACTIVE PoolV2.x slot and make only that boolean consequence publicly decryptable.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data: calldata,
        value: 0n,
      });

      if (
        exactReview?.key !== storageKeys.deregistrationPreparation ||
        !sameAddress(exactReview.to, VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool) ||
        exactReview.data.toLowerCase() !== calldata.toLowerCase() ||
        exactReview.value !== 0n
      ) {
        exactAction.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen deregistration-preparation call.",
        );
      }

      setPreparationBinding(liveParticipant);

      setActionKind("prepare");

      setNotice(
        "Preparation simulated. Inspect the exact PoolV2.x call before opening the wallet. No principal is decrypted by this transaction.",
      );
    } catch (caught: unknown) {
      exactAction.discardReview();

      setPreparationBinding(null);

      setActionKind(null);

      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    clearPreparedPredicate,
    exactAction,
    participant,
    publicClient,
    readParticipant,
    requireWallet,
    storageKeys.deregistrationPreparation,
  ]);

  const openPreparation = useCallback(async () => {
    const frozen = preparationBinding;

    if (frozen === null || actionKind !== "prepare") {
      setError("Prepare a fresh zero-principal predicate review first.");

      return;
    }

    setError(null);
    setPreparing(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [liveParticipant, accountNonce] = await Promise.all([
        readParticipant(),

        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (
        liveParticipant === null ||
        !sameParticipantBinding(liveParticipant, frozen) ||
        !sameAddress(liveParticipant.owner, holder)
      ) {
        exactAction.discardReview();

        setPreparationBinding(null);

        setActionKind(null);

        throw new Error(
          "The ACTIVE registration changed before wallet opening. The preparation review was discarded.",
        );
      }

      const calldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "prepareDeregistration",
        args: [liveParticipant.slotIndex],
      });

      if (
        !exactReviewMatches(exactAction.review, {
          key: storageKeys.deregistrationPreparation,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data: calldata,
          accountNonce,
        })
      ) {
        exactAction.discardReview();

        setPreparationBinding(null);

        setActionKind(null);

        throw new Error(
          "The exact wallet review no longer matches the current deregistration-preparation action.",
        );
      }

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "prepareDeregistration",
        args: [liveParticipant.slotIndex],
        account: holder,
      });

      await exactAction.openWallet();
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    actionKind,
    exactAction,
    preparationBinding,
    publicClient,
    readParticipant,
    requireWallet,
    storageKeys.deregistrationPreparation,
  ]);

  const decryptZeroPredicate = useCallback(async () => {
    const frozenParticipant = preparedParticipant;

    const frozenHandle = preparedHandle;

    setNotice(null);
    setError(null);
    setSettlementReview(null);

    if (frozenParticipant === null || frozenHandle === null) {
      setError(
        "Prepare and confirm a fresh deregistration predicate before requesting its public boolean decryption.",
      );

      return;
    }

    if (exactAction.review !== null || exactAction.attempt !== null) {
      setError(
        "Resolve or discard the current exact Save action before decrypting the prepared zero predicate.",
      );

      return;
    }

    setDecrypting(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [preParticipant, preHandle] = await Promise.all([readParticipant(), readZeroHandle()]);

      if (
        preParticipant === null ||
        !sameParticipantBinding(preParticipant, frozenParticipant) ||
        !sameAddress(preParticipant.owner, holder)
      ) {
        clearPreparedPredicate();

        throw new Error(
          "The ACTIVE registration changed after preparation. Prepare a fresh predicate.",
        );
      }

      if (preHandle.toLowerCase() !== frozenHandle.toLowerCase()) {
        clearPreparedPredicate();

        throw new Error(
          "The deregistration-zero handle changed after preparation. A principal mutation may have occurred; prepare a fresh predicate.",
        );
      }

      setNotice(
        "Decrypting only the explicitly public principal-equals-zero boolean. Principal itself, wallet balance and all confidential amounts remain sealed.",
      );

      const decrypted = await zama.decryption.decryptPublicValues([frozenHandle], {
        timeout: 180_000,
      });

      const clearEntry = Object.entries(decrypted.clearValues).find(
        ([handle]) => handle.toLowerCase() === frozenHandle.toLowerCase(),
      );

      if (clearEntry === undefined) {
        throw new Error(
          "The public deregistration response did not contain the exact prepared handle.",
        );
      }

      const clearZero = parsePublicBoolean(clearEntry[1]);

      const proof = decrypted.decryptionProof;

      if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(proof)) {
        throw new Error("The public deregistration decryption proof is empty or malformed.");
      }

      const proofHex = proof;

      const [postParticipant, postHandle, accountNonce] = await Promise.all([
        readParticipant(),
        readZeroHandle(),

        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (
        postParticipant === null ||
        !sameParticipantBinding(postParticipant, frozenParticipant) ||
        !sameAddress(postParticipant.owner, holder)
      ) {
        clearPreparedPredicate();

        throw new Error(
          "The ACTIVE registration changed during public decryption. The proof was discarded.",
        );
      }

      if (postHandle.toLowerCase() !== frozenHandle.toLowerCase()) {
        clearPreparedPredicate();

        throw new Error(
          "The zero-principal handle changed during public decryption. The proof was discarded and cannot be reused.",
        );
      }

      if (!clearZero) {
        clearPreparedPredicate();

        setNotice(
          "The explicit public zero-principal consequence is FALSE. No deregistration settlement was prepared and no private amount was revealed.",
        );

        return;
      }

      const calldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleDeregistration",
        args: [postParticipant.slotIndex, true, proofHex],
      });

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleDeregistration",
        args: [postParticipant.slotIndex, true, proofHex],
        account: holder,
      });

      const preparedAt = Math.floor(Date.now() / 1000);

      const domainReview = createDeregistrationSettlementReview({
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
        zeroHandle: postHandle,
        clearZero: true,
        decryptionProof: proofHex,
        calldata,
        accountNonce,
        preparedAt,
        simulatedAt: preparedAt,
      });

      const exactReview = await exactAction.prepare({
        key: storageKeys.deregistrationSettlement,
        label: "Settle TRUE zero-principal deregistration",
        consequence:
          "Submit the exact publicly verified TRUE zero-principal proof for this ACTIVE PoolV2.x slot. Successful settlement tombstones the current registration without revealing principal.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data: calldata,
        value: 0n,
      });

      if (
        !exactReviewMatches(exactReview, {
          key: storageKeys.deregistrationSettlement,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data: calldata,
          accountNonce,
        })
      ) {
        exactAction.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen TRUE deregistration proof settlement.",
        );
      }

      clearPreparedPredicate();

      setSettlementReview(domainReview);

      setActionKind("settle");

      setNotice(
        "The TRUE public zero-principal consequence passed simulation. Recheck the handle, participant identity, wallet nonce and exact calldata before opening the wallet.",
      );
    } catch (caught: unknown) {
      exactAction.discardReview();

      setSettlementReview(null);

      setActionKind(null);

      setError(errorMessage(caught));
    } finally {
      setDecrypting(false);
    }
  }, [
    clearPreparedPredicate,
    exactAction,
    preparedHandle,
    preparedParticipant,
    publicClient,
    readParticipant,
    readZeroHandle,
    requireWallet,
    storageKeys.deregistrationSettlement,
    zama,
  ]);

  const openSettlement = useCallback(async () => {
    const domainReview = settlementReview;

    if (domainReview === null || actionKind !== "settle") {
      setError("Prepare a fresh TRUE zero-principal settlement review first.");

      return;
    }

    setError(null);
    setPreparing(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [liveParticipant, liveHandle, accountNonce] = await Promise.all([
        readParticipant(),
        readZeroHandle(),

        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      const calldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleDeregistration",
        args: [domainReview.participant.slotIndex, true, domainReview.decryptionProof],
      });

      const invalidReason = deregistrationReviewInvalidReason(domainReview, {
        holder,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: connection.chainId,
        participant: liveParticipant,
        zeroHandle: liveHandle,
        currentCalldata: calldata,
        accountNonce,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exactAction.discardReview();

        setSettlementReview(null);

        setActionKind(null);

        throw new Error(
          `${invalidReason} The stale public proof was discarded; no replacement transaction was generated.`,
        );
      }

      if (
        !exactReviewMatches(exactAction.review, {
          key: storageKeys.deregistrationSettlement,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data: calldata,
          accountNonce,
        })
      ) {
        exactAction.discardReview();

        setSettlementReview(null);

        setActionKind(null);

        throw new Error(
          "The exact wallet review no longer matches the frozen deregistration settlement.",
        );
      }

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleDeregistration",
        args: [domainReview.participant.slotIndex, true, domainReview.decryptionProof],
        account: holder,
      });

      setSettlementReview(null);

      await exactAction.openWallet();
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    actionKind,
    connection.chainId,
    exactAction,
    publicClient,
    readParticipant,
    readZeroHandle,
    requireWallet,
    settlementReview,
    storageKeys.deregistrationSettlement,
  ]);

  const discardExactReview = useCallback(() => {
    exactAction.discardReview();

    setActionKind(null);

    setPreparationBinding(null);

    setSettlementReview(null);

    setError(null);

    setNotice("The deregistration review was discarded. No transaction was submitted.");
  }, [exactAction]);

  const ownsPreparation =
    exactAction.review?.key === storageKeys.deregistrationPreparation ||
    exactAction.attempt?.key === storageKeys.deregistrationPreparation;

  const ownsSettlement =
    exactAction.review?.key === storageKeys.deregistrationSettlement ||
    exactAction.attempt?.key === storageKeys.deregistrationSettlement;

  const ownsExactAction = ownsPreparation || ownsSettlement;

  const reviewExpiresAt =
    settlementReview === null
      ? null
      : settlementReview.preparedAt + DEREGISTRATION_REVIEW_MAX_AGE_SECONDS;

  return (
    <div className={styles.saveDepositFlow}>
      <Surface className={styles.saveDepositHeader} elevation="raised">
        <div>
          <span className={styles.workspaceEyebrow}>ZERO-PRINCIPAL EXIT · V2.x</span>

          <h2>Prove zero without revealing principal.</h2>

          <p>
            Deregistration uses one intentionally public boolean: whether the current encrypted
            principal equals zero. The principal amount itself never becomes public.
          </p>
        </div>

        <ProtocolBadge>Corrected PoolV2.x</ProtocolBadge>
      </Surface>

      <div className={styles.saveDepositGrid}>
        <Surface className={styles.saveDepositStep}>
          <span className={styles.saveDepositStepIndex}>01</span>

          <RefreshCw size={20} aria-hidden="true" />

          <h3>Prepare the current predicate</h3>

          <p>
            PoolV2.x recomputes principal equals zero from the current encrypted principal and makes
            only that boolean publicly decryptable.
          </p>

          <div className={styles.savePrivacyFact}>
            <ShieldCheck size={14} aria-hidden="true" />
            Slot {participant.slotIndex.toString()} · registration{" "}
            {participant.registrationVersion.toString()} · reservation{" "}
            {participant.reservationNonce.toString()}
          </div>

          <MeridianButton
            variant="secondary"
            size="large"
            disabled={
              preparing ||
              decrypting ||
              !exactAction.storageReady ||
              exactAction.review !== null ||
              exactAction.attempt !== null
            }
            onClick={() => {
              void prepareZeroPredicate();
            }}
          >
            {preparing ? (
              <LoaderCircle size={15} aria-hidden="true" />
            ) : (
              <RefreshCw size={15} aria-hidden="true" />
            )}
            Prepare fresh zero predicate
          </MeridianButton>
        </Surface>

        <Surface className={styles.saveDepositStep}>
          <span className={styles.saveDepositStepIndex}>02</span>

          <KeyRound size={20} aria-hidden="true" />

          <h3>Explicitly decrypt one boolean</h3>

          <p>
            This step asks the Zama public-decryption path only for the prepared deregistration-zero
            handle.
          </p>

          <div className={styles.savePrivacyFact}>
            <ShieldCheck size={14} aria-hidden="true" />
            Principal reveal: none
          </div>

          <div className={styles.savePrivacyFact}>
            <ShieldCheck size={14} aria-hidden="true" />
            Wallet confidential balance reveal: none
          </div>

          <StatusBadge tone={preparedHandle === null ? "neutral" : "success"}>
            {preparedHandle === null
              ? "Fresh preparation required"
              : "Fresh public predicate armed"}
          </StatusBadge>

          <MeridianButton
            variant="private"
            size="large"
            disabled={
              decrypting ||
              preparing ||
              preparedHandle === null ||
              preparedParticipant === null ||
              exactAction.review !== null ||
              exactAction.attempt !== null
            }
            onClick={() => {
              void decryptZeroPredicate();
            }}
          >
            {decrypting ? (
              <LoaderCircle size={15} aria-hidden="true" />
            ) : (
              <KeyRound size={15} aria-hidden="true" />
            )}
            Decrypt public zero consequence
          </MeridianButton>
        </Surface>

        <Surface className={styles.saveDepositStep}>
          <span className={styles.saveDepositStepIndex}>03</span>

          <ShieldCheck size={20} aria-hidden="true" />

          <h3>Settle only TRUE</h3>

          <p>
            A FALSE public result creates no settlement transaction. A TRUE result is frozen to its
            exact handle, proof, participant, calldata and wallet nonce.
          </p>

          <div className={styles.savePrivacyFact}>
            <ShieldCheck size={14} aria-hidden="true" />
            Any later principal credit refreshes the contract handle and invalidates the stale TRUE
            proof.
          </div>
        </Surface>
      </div>

      {notice !== null ? (
        <InlineNotice title="Deregistration status" tone="protocol">
          {notice}
        </InlineNotice>
      ) : null}

      {error !== null ? (
        <InlineNotice title="Deregistration stopped safely" tone="danger">
          {error}
        </InlineNotice>
      ) : null}

      {exactAction.attempt !== null && ownsExactAction ? (
        <Surface className={styles.saveFlowReview} elevation="raised">
          <InlineNotice title="Unresolved exact deregistration attempt" tone="warning">
            Veilpot will not prepare another Save action until this exact nonce and calldata are
            reconciled.
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
      ) : exactAction.review !== null && actionKind === "prepare" ? (
        <Surface className={styles.saveFlowReview} elevation="raised">
          <header>
            <RefreshCw size={19} aria-hidden="true" />

            <div>
              <span className={styles.workspaceEyebrow}>FROZEN PREPARATION REVIEW</span>

              <h2>Recompute the current public consequence.</h2>
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
              <dt>Participant slot</dt>
              <dd>{participant.slotIndex.toString()}</dd>
            </div>

            <div>
              <dt>Wallet nonce</dt>
              <dd>{exactAction.review.accountNonce}</dd>
            </div>

            <div>
              <dt>Native value</dt>
              <dd>{exactAction.review.value.toString()} wei</dd>
            </div>
          </dl>

          <p>{exactAction.review.consequence}</p>

          <TechnicalDisclosure label="Show exact preparation calldata">
            <code>{exactAction.review.data}</code>
          </TechnicalDisclosure>

          <div className={styles.saveDepositButtons}>
            <MeridianButton
              variant="primary"
              disabled={preparing || exactAction.isWalletPending}
              onClick={() => {
                void openPreparation();
              }}
            >
              Open exact wallet review
              <ExternalLink size={14} aria-hidden="true" />
            </MeridianButton>

            <MeridianButton
              variant="tertiary"
              disabled={exactAction.isWalletPending}
              onClick={discardExactReview}
            >
              Discard review
            </MeridianButton>
          </div>
        </Surface>
      ) : exactAction.review !== null && settlementReview !== null && actionKind === "settle" ? (
        <Surface className={styles.saveFlowReview} elevation="raised">
          <header>
            <ShieldCheck size={19} aria-hidden="true" />

            <div>
              <span className={styles.workspaceEyebrow}>FROZEN TRUE ZERO-PROOF REVIEW</span>

              <h2>Settle the exact current proof.</h2>
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
              <dt>Participant slot</dt>
              <dd>{settlementReview.participant.slotIndex.toString()}</dd>
            </div>

            <div>
              <dt>Registration version</dt>
              <dd>{settlementReview.participant.registrationVersion.toString()}</dd>
            </div>

            <div>
              <dt>Reservation nonce</dt>
              <dd>{settlementReview.participant.reservationNonce.toString()}</dd>
            </div>

            <div>
              <dt>Public consequence</dt>
              <dd>TRUE · principal equals zero</dd>
            </div>

            <div>
              <dt>Wallet nonce</dt>
              <dd>{settlementReview.accountNonce}</dd>
            </div>

            <div>
              <dt>Review expiry</dt>
              <dd>{reviewExpiresAt === null ? "—" : `Unix ${String(reviewExpiresAt)}`}</dd>
            </div>
          </dl>

          <TechnicalDisclosure label="Show public zero handle">
            <code>{settlementReview.zeroHandle}</code>
          </TechnicalDisclosure>

          <TechnicalDisclosure label="Show exact settlement calldata">
            <code>{exactAction.review.data}</code>
          </TechnicalDisclosure>

          <div className={styles.saveDepositButtons}>
            <MeridianButton
              variant="primary"
              disabled={preparing || exactAction.isWalletPending}
              onClick={() => {
                void openSettlement();
              }}
            >
              Open exact settlement wallet review
              <ExternalLink size={14} aria-hidden="true" />
            </MeridianButton>

            <MeridianButton
              variant="tertiary"
              disabled={exactAction.isWalletPending}
              onClick={discardExactReview}
            >
              Discard proof review
            </MeridianButton>
          </div>
        </Surface>
      ) : exactAction.review !== null && ownsExactAction ? (
        <Surface className={styles.saveFlowReview} elevation="raised">
          <InlineNotice title="Ephemeral proof context unavailable" tone="warning">
            An exact deregistration review was restored without its in-memory public-proof context.
            Discard it and prepare a fresh predicate rather than reusing stale proof material.
          </InlineNotice>

          <MeridianButton
            variant="tertiary"
            disabled={exactAction.isWalletPending}
            onClick={discardExactReview}
          >
            Discard and prepare fresh
          </MeridianButton>
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

      <InlineNotice title="Deregistration privacy boundary" tone="private">
        Only the intentionally public principal-equals-zero boolean may be decrypted here.
        Principal, pending amounts, refund residuals, wallet confidential balance, VeilDraw winner
        state and prize entitlement remain encrypted.
      </InlineNotice>
    </div>
  );
}
