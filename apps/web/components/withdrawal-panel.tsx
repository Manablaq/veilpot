"use client";

import { toUserFacingError } from "@/lib/ui-error";

import { CircleCheck, LockKeyhole, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatEther, parseUnits, type Address, type Hex } from "viem";
import { useMetadata, useZamaSDK } from "@zama-fhe/react-sdk";
import { useConnection, usePublicClient } from "wagmi";

import {
  PARTICIPANT_STATE,
  SUPPORTED_REGISTRATION_VERSION,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_POOL_V2_ABI,
  buildV2WithdrawalCall,
  encryptV2PoolAmount,
  participantStateName,
} from "@veilpot/protocol-sdk";

import { ExactActionReviewCard, useExactAction } from "@/components/exact-action-control";
import { VEILPOT_V2_EXACT_ACTION_SCOPE, v2SaveStorageKeys } from "@/lib/deployment-scope";
import {
  createDeregistrationSettlementReview,
  deregistrationReviewInvalidReason,
  type DeregistrationSettlementReview,
} from "@/lib/deregistration-review";
import {
  createRefundSettlementReview,
  refundSettlementReviewInvalidReason,
  type RefundParticipantBinding,
  type RefundSettlementReview,
} from "@/lib/recovery-review";
import { parsePublicBoolean } from "@/lib/threshold-settlement";
import {
  MAX_WITHDRAWAL_REQUEST_BASE_UNITS,
  createWithdrawalReview,
  withdrawalReviewInvalidReason,
  type WithdrawalReview,
} from "@/lib/withdrawal-review";
import {
  v2BondCreditAvailable,
  v2ParticipantCanAttemptRefund,
  v2ParticipantCanExpireActivation,
  v2ParticipantCanExpireReservation,
  v2ParticipantCanSettleRefund,
  v2ParticipantCanWithdraw,
  type V2ParticipantSnapshot,
} from "@/lib/v2-save";

type ReviewKind =
  | "withdrawal"
  | "reservation-expiry"
  | "activation-expiry"
  | "refund-attempt"
  | "refund-settlement"
  | "bond-withdrawal"
  | "deregistration-prepare"
  | "deregistration-settle";

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

function errorMessage(error: unknown): string {
  return toUserFacingError(
    error,
    "The recovery action stopped safely. Nothing was submitted automatically.",
  );
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
  review: ReturnType<typeof useExactAction>["review"],
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

export function WithdrawalPanel({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  const connection = useConnection();

  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });

  const metadataQuery = useMetadata(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken);

  const zama = useZamaSDK();

  const exact = useExactAction(authenticatedAddress, VEILPOT_V2_EXACT_ACTION_SCOPE);

  const storageKeys = useMemo(
    () => v2SaveStorageKeys(authenticatedAddress),
    [authenticatedAddress],
  );

  const [participant, setParticipant] = useState<V2ParticipantSnapshot | null>(null);

  const [bondCredit, setBondCredit] = useState(0n);

  const [latestTimestamp, setLatestTimestamp] = useState<bigint | null>(null);

  const [amount, setAmount] = useState("");

  const [loading, setLoading] = useState(false);

  const [busy, setBusy] = useState(false);

  const [decrypting, setDecrypting] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);

  const [encryptedReviewAmount, setEncryptedReviewAmount] = useState<string | null>(null);

  const [withdrawalReview, setWithdrawalReview] = useState<WithdrawalReview | null>(null);

  const [refundReview, setRefundReview] = useState<RefundSettlementReview | null>(null);

  const [deregistrationReview, setDeregistrationReview] =
    useState<DeregistrationSettlementReview | null>(null);

  const [preparedDeregistrationParticipant, setPreparedDeregistrationParticipant] =
    useState<V2ParticipantSnapshot | null>(null);

  const [preparedDeregistrationHandle, setPreparedDeregistrationHandle] = useState<Hex | null>(
    null,
  );

  const [deregistrationPreparationBinding, setDeregistrationPreparationBinding] =
    useState<V2ParticipantSnapshot | null>(null);

  const [currentReviewKind, setCurrentReviewKind] = useState<ReviewKind | null>(null);

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

  const clearDomainReviews = useCallback(() => {
    setWithdrawalReview(null);
    setRefundReview(null);
    setDeregistrationReview(null);
    setEncryptedReviewAmount(null);
  }, []);

  const clearPreparedDeregistration = useCallback(() => {
    setPreparedDeregistrationParticipant(null);
    setPreparedDeregistrationHandle(null);
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

  const loadParticipant = useCallback(async (): Promise<V2ParticipantSnapshot | null> => {
    if (publicClient === undefined) {
      throw new Error("The Ethereum Sepolia public client is unavailable.");
    }

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
      !sameAddress(row[1], authenticatedAddress)
    ) {
      return null;
    }

    return {
      slotIndex,
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
  }, [authenticatedAddress, publicClient]);

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
        throw new Error("The PoolV2.x refund-complete handle is malformed.");
      }

      return handle;
    },
    [publicClient],
  );

  const readDeregistrationZeroHandle = useCallback(
    async (slotIndex: bigint): Promise<Hex> => {
      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const handle = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "deregistrationZeroHandle",
        args: [slotIndex],
      });

      if (!/^0x[0-9a-fA-F]{64}$/.test(handle)) {
        throw new Error("The PoolV2.x deregistration-zero handle is malformed.");
      }

      return handle;
    },
    [publicClient],
  );

  const requireBoundParticipant = useCallback(
    async (holder: Address): Promise<V2ParticipantSnapshot> => {
      const live = await loadParticipant();

      if (live === null) {
        throw new Error("No live PoolV2.x participant is available for this action.");
      }

      if (!sameAddress(live.owner, holder)) {
        throw new Error("The live participant belongs to a different wallet.");
      }

      if (live.registrationVersion !== SUPPORTED_REGISTRATION_VERSION) {
        throw new Error("The live PoolV2.x registration version is unsupported.");
      }

      if (participant === null || !sameParticipantBinding(live, participant)) {
        throw new Error(
          "The public participant binding changed. Refresh before preparing another action.",
        );
      }

      return live;
    },
    [loadParticipant, participant],
  );

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const [liveParticipant, credit, timestamp] = await Promise.all([
        loadParticipant(),
        readBondCredit(),
        readLatestTimestamp(),
      ]);

      setParticipant(liveParticipant);

      setBondCredit(credit);

      setLatestTimestamp(timestamp);
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadParticipant, readBondCredit, readLatestTimestamp]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (currentReviewKind === null) {
      return;
    }

    if (exact.status.kind === "reverted") {
      clearDomainReviews();
      clearPreparedDeregistration();
      setDeregistrationPreparationBinding(null);
      setCurrentReviewKind(null);

      setNotice(
        "The exact reviewed V2.x transaction was mined with failure. No automatic retry was generated.",
      );

      void refresh();

      return;
    }

    if (exact.status.kind === "error" && exact.review === null && exact.attempt === null) {
      clearDomainReviews();

      if (currentReviewKind === "deregistration-prepare") {
        setDeregistrationPreparationBinding(null);
      }

      setCurrentReviewKind(null);

      return;
    }

    if (exact.status.kind !== "included") {
      return;
    }

    if (currentReviewKind === "deregistration-prepare") {
      const frozen = deregistrationPreparationBinding;

      clearDomainReviews();

      setDeregistrationPreparationBinding(null);

      setCurrentReviewKind(null);

      if (frozen === null) {
        clearPreparedDeregistration();

        setNotice(
          "The deregistration-preparation transaction was included without its frozen participant context. Prepare a fresh predicate.",
        );

        return;
      }

      void (async () => {
        try {
          const [live, zeroHandle] = await Promise.all([
            loadParticipant(),
            readDeregistrationZeroHandle(frozen.slotIndex),
          ]);

          if (
            live === null ||
            !v2ParticipantCanWithdraw(live) ||
            !sameParticipantBinding(live, frozen)
          ) {
            throw new Error(
              "The ACTIVE registration changed after deregistration preparation. Prepare a fresh predicate.",
            );
          }

          setPreparedDeregistrationParticipant(live);

          setPreparedDeregistrationHandle(zeroHandle);

          setNotice(
            "The exact preparation transaction is included. Only the current public zero-principal predicate is now eligible for explicit decryption.",
          );

          await refresh();
        } catch (error: unknown) {
          clearPreparedDeregistration();

          setNotice(errorMessage(error));
        }
      })();

      return;
    }

    clearDomainReviews();
    clearPreparedDeregistration();
    setDeregistrationPreparationBinding(null);
    setCurrentReviewKind(null);

    if (currentReviewKind === "withdrawal") {
      setAmount("");
    }

    setNotice(
      "The exact V2.x transaction is conclusively included. Public lifecycle state is refreshing.",
    );

    void refresh();
  }, [
    clearDomainReviews,
    clearPreparedDeregistration,
    currentReviewKind,
    deregistrationPreparationBinding,
    exact.attempt,
    exact.review,
    exact.status.kind,
    loadParticipant,
    readDeregistrationZeroHandle,
    refresh,
  ]);

  const prepareWithdrawal = useCallback(async () => {
    setNotice(null);
    clearDomainReviews();
    clearPreparedDeregistration();
    setDeregistrationPreparationBinding(null);
    setCurrentReviewKind(null);

    if (!exact.storageReady) {
      setNotice("Veilpot is still checking for an unresolved exact wallet attempt.");
      return;
    }

    if (exact.attempt !== null || exact.review !== null) {
      setNotice(
        "Resolve or discard the current exact Save action before encrypting another withdrawal.",
      );
      return;
    }

    if (tokenDecimals !== 6 || parsedAmount === null) {
      setNotice(
        "Enter a positive cUSDT withdrawal request using the exact 6-decimal token format.",
      );
      return;
    }

    setBusy(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [before, withdrawalNonce, accountNonce] = await Promise.all([
        requireBoundParticipant(holder),
        readWithdrawalNonce(holder),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (!v2ParticipantCanWithdraw(before)) {
        throw new Error(
          "The authenticated participant is not an eligible ACTIVE PoolV2.x registration.",
        );
      }

      setNotice(
        "Encrypting only the entered withdrawal request for the exact active PoolV2.x contract and authenticated wallet.",
      );

      const encrypted = await encryptV2PoolAmount(zama, parsedAmount, holder);

      const [after, withdrawalNonceAfter, accountNonceAfter] = await Promise.all([
        loadParticipant(),
        readWithdrawalNonce(holder),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (
        after === null ||
        !sameParticipantBinding(after, before) ||
        withdrawalNonceAfter !== withdrawalNonce ||
        accountNonceAfter !== accountNonce
      ) {
        throw new Error(
          "Participant or nonce state changed during encryption. The withdrawal ciphertext was discarded and cannot be reused.",
        );
      }

      const descriptor = buildV2WithdrawalCall({
        encrypted,
        caller: holder,
        registrationVersion: after.registrationVersion,
        reservationNonce: after.reservationNonce,
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
          slotIndex: after.slotIndex,
          state: after.state,
          owner: after.owner,
          registrationVersion: after.registrationVersion,
          reservationNonce: after.reservationNonce,
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

      const exactReview = await exact.prepare({
        key: storageKeys.withdrawal,
        label: "Submit confidential PoolV2.x withdrawal",
        consequence:
          "Withdraw up to the exact encrypted requested amount, privately capped by encrypted principal. PoolV2.x accounts only the confidential token's actual returned transfer and never decrypts principal.",
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
        exact.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen confidential withdrawal. The ciphertext was discarded.",
        );
      }

      setWithdrawalReview(domainReview);

      setEncryptedReviewAmount(amount.trim());

      setCurrentReviewKind("withdrawal");

      setNotice(
        "The encrypted withdrawal passed exact PoolV2.x simulation. Inspect the clear amount you entered, participant binding, nonces and calldata before opening the wallet.",
      );
    } catch (error: unknown) {
      exact.discardReview();
      clearDomainReviews();
      setCurrentReviewKind(null);

      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [
    amount,
    clearDomainReviews,
    clearPreparedDeregistration,
    exact,
    loadParticipant,
    parsedAmount,
    publicClient,
    readWithdrawalNonce,
    requireBoundParticipant,
    requireWallet,
    storageKeys.withdrawal,
    tokenDecimals,
    tokenSymbol,
    zama,
  ]);

  const openWithdrawal = useCallback(async () => {
    const domainReview = withdrawalReview;

    if (domainReview === null) {
      setNotice("Encrypt and prepare a fresh confidential withdrawal review first.");
      return;
    }

    setBusy(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [liveParticipant, withdrawalNonce, accountNonce] = await Promise.all([
        loadParticipant(),
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
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: liveParticipant,
        amountBaseUnits: parsedAmount,
        withdrawalNonce,
        accountNonce,
        currentCalldata,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exact.discardReview();
        clearDomainReviews();
        setCurrentReviewKind(null);

        throw new Error(`${invalidReason} No replacement ciphertext or transaction was generated.`);
      }

      if (
        !exactReviewMatches(exact.review, {
          key: storageKeys.withdrawal,
          to: descriptor.address,
          data: currentCalldata,
          accountNonce,
        })
      ) {
        exact.discardReview();
        clearDomainReviews();
        setCurrentReviewKind(null);

        throw new Error(
          "The exact wallet review no longer matches the frozen confidential withdrawal.",
        );
      }

      await publicClient.simulateContract({
        ...descriptor,
        account: holder,
      });

      setWithdrawalReview(null);
      setEncryptedReviewAmount(null);

      await exact.openWallet();
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [
    clearDomainReviews,
    exact,
    loadParticipant,
    parsedAmount,
    publicClient,
    readWithdrawalNonce,
    requireWallet,
    storageKeys.withdrawal,
    withdrawalReview,
  ]);

  const buildSimpleRecoveryAction = useCallback(
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
            "Move the expired pending activation into the confidential refund lifecycle and credit its public registration bond. The confidential pending amount is not decrypted.",
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

  const prepareSimpleRecovery = useCallback(
    async (kind: SimpleRecoveryKind) => {
      setNotice(null);
      clearDomainReviews();

      if (!exact.storageReady) {
        setNotice("Veilpot is still checking for an unresolved exact wallet attempt.");
        return;
      }

      if (exact.review !== null || exact.attempt !== null) {
        setNotice("Resolve or discard the current exact Save action before preparing recovery.");
        return;
      }

      setBusy(true);

      try {
        const holder = requireWallet();

        const action = await buildSimpleRecoveryAction(kind, holder);

        const review = await exact.prepare(action);

        if (
          review?.key !== action.key ||
          !sameAddress(review.to, action.to) ||
          review.data.toLowerCase() !== action.data.toLowerCase() ||
          review.value !== 0n
        ) {
          exact.discardReview();

          throw new Error("The exact-action review diverged from the frozen recovery action.");
        }

        setCurrentReviewKind(kind);

        setNotice(
          "Recovery simulated successfully. Opening the wallet remains a separate explicit step.",
        );
      } catch (error: unknown) {
        exact.discardReview();
        setCurrentReviewKind(null);

        setNotice(errorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [buildSimpleRecoveryAction, clearDomainReviews, exact, requireWallet],
  );

  const openSimpleRecovery = useCallback(
    async (kind: SimpleRecoveryKind) => {
      const review = exact.review;

      if (review === null) {
        setNotice("Prepare a fresh exact recovery review first.");
        return;
      }

      setBusy(true);

      try {
        const holder = requireWallet();

        if (publicClient === undefined) {
          throw new Error("The Ethereum Sepolia public client is unavailable.");
        }

        const action = await buildSimpleRecoveryAction(kind, holder);

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
          exact.discardReview();
          setCurrentReviewKind(null);

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

        await exact.openWallet();
      } catch (error: unknown) {
        setNotice(errorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [buildSimpleRecoveryAction, exact, publicClient, requireWallet],
  );

  const prepareRefundSettlement = useCallback(async () => {
    setNotice(null);
    clearDomainReviews();

    if (!exact.storageReady) {
      setNotice("Veilpot is still checking for an unresolved exact wallet attempt.");
      return;
    }

    if (exact.review !== null || exact.attempt !== null) {
      setNotice(
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
        "Decrypting only the intentionally public refund-complete boolean. No confidential refund amount or residual is requested.",
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
        loadParticipant(),
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

      const data = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleRefundCompletion",
        args: [
          after.slotIndex,
          after.registrationVersion,
          after.reservationNonce,
          after.refundAttemptNonce,
          clearComplete,
          proof,
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
        decryptionProof: proof,
        calldata: data,
        accountNonce,
        preparedAt,
        simulatedAt: preparedAt,
      });

      const review = await exact.prepare({
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
        exact.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen refund-completion settlement.",
        );
      }

      setRefundReview(domainReview);

      setCurrentReviewKind("refund-settlement");

      setNotice(
        clearComplete
          ? "Public refund-completion consequence: TRUE. Exact completion settlement is ready for separate wallet review."
          : "Public refund-completion consequence: FALSE. Exact retry-path settlement is ready for separate wallet review.",
      );
    } catch (error: unknown) {
      exact.discardReview();
      setRefundReview(null);
      setCurrentReviewKind(null);

      setNotice(errorMessage(error));
    } finally {
      setDecrypting(false);
    }
  }, [
    clearDomainReviews,
    exact,
    loadParticipant,
    publicClient,
    readRefundCompleteHandle,
    requireBoundParticipant,
    requireWallet,
    storageKeys.refundSettlement,
    zama.decryption,
  ]);

  const openRefundSettlement = useCallback(async () => {
    const domainReview = refundReview;

    const review = exact.review;

    if (domainReview === null || review === null) {
      setNotice("Prepare a fresh refund-completion proof review first.");
      return;
    }

    setBusy(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [live, liveHandle, accountNonce] = await Promise.all([
        loadParticipant(),
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
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: live === null ? null : toRefundBinding(live),
        refundCompleteHandle: liveHandle,
        currentCalldata: data,
        accountNonce,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exact.discardReview();
        setRefundReview(null);
        setCurrentReviewKind(null);

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
        exact.discardReview();
        setRefundReview(null);
        setCurrentReviewKind(null);

        throw new Error("The exact wallet review no longer matches the frozen refund settlement.");
      }

      await publicClient.call({
        account: holder,
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });

      setRefundReview(null);

      await exact.openWallet();
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [
    exact,
    loadParticipant,
    publicClient,
    readRefundCompleteHandle,
    refundReview,
    requireWallet,
    storageKeys.refundSettlement,
  ]);

  const prepareDeregistrationPredicate = useCallback(async () => {
    setNotice(null);
    clearDomainReviews();
    clearPreparedDeregistration();
    setDeregistrationPreparationBinding(null);
    setCurrentReviewKind(null);

    if (!exact.storageReady) {
      setNotice("Veilpot is still checking for an unresolved exact wallet attempt.");
      return;
    }

    if (exact.review !== null || exact.attempt !== null) {
      setNotice(
        "Resolve or discard the current exact Save action before preparing deregistration.",
      );
      return;
    }

    setBusy(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const live = await requireBoundParticipant(holder);

      if (!v2ParticipantCanWithdraw(live)) {
        throw new Error("Deregistration preparation requires an ACTIVE PoolV2.x participant.");
      }

      const calldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "prepareDeregistration",
        args: [live.slotIndex],
      });

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "prepareDeregistration",
        args: [live.slotIndex],
        account: holder,
      });

      const accountNonce = await publicClient.getTransactionCount({
        address: holder,
        blockTag: "pending",
      });

      const exactReview = await exact.prepare({
        key: storageKeys.deregistrationPreparation,
        label: "Prepare current zero-principal predicate",
        consequence:
          "Recompute the encrypted principal-equals-zero predicate for this exact ACTIVE PoolV2.x slot and make only that boolean consequence publicly decryptable.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data: calldata,
        value: 0n,
      });

      if (
        !exactReviewMatches(exactReview, {
          key: storageKeys.deregistrationPreparation,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data: calldata,
          accountNonce,
        })
      ) {
        exact.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen deregistration-preparation call.",
        );
      }

      setDeregistrationPreparationBinding(live);

      setCurrentReviewKind("deregistration-prepare");

      setNotice(
        "Preparation simulated. Inspect the exact PoolV2.x call before opening the wallet. No principal is decrypted by this transaction.",
      );
    } catch (error: unknown) {
      exact.discardReview();

      setDeregistrationPreparationBinding(null);

      setCurrentReviewKind(null);

      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [
    clearDomainReviews,
    clearPreparedDeregistration,
    exact,
    publicClient,
    requireBoundParticipant,
    requireWallet,
    storageKeys.deregistrationPreparation,
  ]);

  const openDeregistrationPreparation = useCallback(async () => {
    const frozen = deregistrationPreparationBinding;

    if (frozen === null) {
      setNotice("Prepare a fresh zero-principal predicate review first.");
      return;
    }

    setBusy(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [live, accountNonce] = await Promise.all([
        loadParticipant(),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (
        live === null ||
        !sameParticipantBinding(live, frozen) ||
        !sameAddress(live.owner, holder)
      ) {
        exact.discardReview();

        setDeregistrationPreparationBinding(null);

        setCurrentReviewKind(null);

        throw new Error(
          "The ACTIVE registration changed before wallet opening. The preparation review was discarded.",
        );
      }

      const calldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "prepareDeregistration",
        args: [live.slotIndex],
      });

      if (
        !exactReviewMatches(exact.review, {
          key: storageKeys.deregistrationPreparation,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data: calldata,
          accountNonce,
        })
      ) {
        exact.discardReview();

        setDeregistrationPreparationBinding(null);

        setCurrentReviewKind(null);

        throw new Error(
          "The exact wallet review no longer matches the current deregistration-preparation action.",
        );
      }

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "prepareDeregistration",
        args: [live.slotIndex],
        account: holder,
      });

      await exact.openWallet();
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [
    deregistrationPreparationBinding,
    exact,
    loadParticipant,
    publicClient,
    requireWallet,
    storageKeys.deregistrationPreparation,
  ]);

  const decryptDeregistrationPredicate = useCallback(async () => {
    const frozenParticipant = preparedDeregistrationParticipant;

    const frozenHandle = preparedDeregistrationHandle;

    setNotice(null);
    setDeregistrationReview(null);

    if (frozenParticipant === null || frozenHandle === null) {
      setNotice(
        "Prepare and confirm a fresh deregistration predicate before requesting its public boolean decryption.",
      );
      return;
    }

    if (exact.review !== null || exact.attempt !== null) {
      setNotice(
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

      const [before, beforeHandle] = await Promise.all([
        loadParticipant(),
        readDeregistrationZeroHandle(frozenParticipant.slotIndex),
      ]);

      if (
        before === null ||
        !sameParticipantBinding(before, frozenParticipant) ||
        !sameAddress(before.owner, holder)
      ) {
        clearPreparedDeregistration();

        throw new Error(
          "The ACTIVE registration changed after preparation. Prepare a fresh predicate.",
        );
      }

      if (beforeHandle.toLowerCase() !== frozenHandle.toLowerCase()) {
        clearPreparedDeregistration();

        throw new Error(
          "The deregistration-zero handle changed after preparation. Prepare a fresh predicate.",
        );
      }

      setNotice(
        "Decrypting only the intentionally public principal-equals-zero boolean. Principal itself and confidential balances remain sealed.",
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

      const [after, afterHandle, accountNonce] = await Promise.all([
        loadParticipant(),
        readDeregistrationZeroHandle(frozenParticipant.slotIndex),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (
        after === null ||
        !sameParticipantBinding(after, frozenParticipant) ||
        !sameAddress(after.owner, holder)
      ) {
        clearPreparedDeregistration();

        throw new Error(
          "The ACTIVE registration changed during public decryption. The proof was discarded.",
        );
      }

      if (afterHandle.toLowerCase() !== frozenHandle.toLowerCase()) {
        clearPreparedDeregistration();

        throw new Error(
          "The zero-principal handle changed during public decryption. The proof was discarded and cannot be reused.",
        );
      }

      if (!clearZero) {
        clearPreparedDeregistration();

        setNotice(
          "Zero-principal predicate: FALSE. No deregistration settlement was prepared and no private amount was revealed.",
        );

        return;
      }

      const calldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleDeregistration",
        args: [after.slotIndex, true, proof],
      });

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleDeregistration",
        args: [after.slotIndex, true, proof],
        account: holder,
      });

      const preparedAt = Math.floor(Date.now() / 1000);

      const domainReview = createDeregistrationSettlementReview({
        holder,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: {
          slotIndex: after.slotIndex,
          state: after.state,
          owner: after.owner,
          registrationVersion: after.registrationVersion,
          reservationNonce: after.reservationNonce,
        },
        zeroHandle: afterHandle,
        clearZero: true,
        decryptionProof: proof,
        calldata,
        accountNonce,
        preparedAt,
        simulatedAt: preparedAt,
      });

      const exactReview = await exact.prepare({
        key: storageKeys.deregistrationSettlement,
        label: "Settle TRUE zero-principal deregistration",
        consequence:
          "Submit the exact publicly verified TRUE zero-principal proof for this ACTIVE PoolV2.x slot. Successful settlement tombstones the registration without revealing principal.",
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
        exact.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen TRUE deregistration proof settlement.",
        );
      }

      clearPreparedDeregistration();

      setDeregistrationReview(domainReview);

      setCurrentReviewKind("deregistration-settle");

      setNotice(
        "Zero-principal predicate: TRUE. The exact proof, handle, participant binding, wallet nonce and calldata are frozen for separate wallet review.",
      );
    } catch (error: unknown) {
      exact.discardReview();
      setDeregistrationReview(null);
      setCurrentReviewKind(null);

      setNotice(errorMessage(error));
    } finally {
      setDecrypting(false);
    }
  }, [
    clearPreparedDeregistration,
    exact,
    loadParticipant,
    preparedDeregistrationHandle,
    preparedDeregistrationParticipant,
    publicClient,
    readDeregistrationZeroHandle,
    requireWallet,
    storageKeys.deregistrationSettlement,
    zama.decryption,
  ]);

  const openDeregistrationSettlement = useCallback(async () => {
    const domainReview = deregistrationReview;

    if (domainReview === null) {
      setNotice("Prepare a fresh TRUE zero-principal settlement review first.");
      return;
    }

    setBusy(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [live, liveHandle, accountNonce] = await Promise.all([
        loadParticipant(),
        readDeregistrationZeroHandle(domainReview.participant.slotIndex),
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
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: live,
        zeroHandle: liveHandle,
        currentCalldata: calldata,
        accountNonce,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exact.discardReview();
        setDeregistrationReview(null);
        setCurrentReviewKind(null);

        throw new Error(
          `${invalidReason} The stale public proof was discarded; no replacement transaction was generated.`,
        );
      }

      if (
        !exactReviewMatches(exact.review, {
          key: storageKeys.deregistrationSettlement,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data: calldata,
          accountNonce,
        })
      ) {
        exact.discardReview();
        setDeregistrationReview(null);
        setCurrentReviewKind(null);

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

      setDeregistrationReview(null);

      await exact.openWallet();
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [
    deregistrationReview,
    exact,
    loadParticipant,
    publicClient,
    readDeregistrationZeroHandle,
    requireWallet,
    storageKeys.deregistrationSettlement,
  ]);

  const openCurrentReview = useCallback(async () => {
    const review = exact.review;

    if (review === null) {
      setNotice("Prepare a fresh exact V2.x review first.");
      return;
    }

    if (review.key === storageKeys.withdrawal) {
      await openWithdrawal();
      return;
    }

    if (review.key === storageKeys.reservationExpiry) {
      await openSimpleRecovery("reservation-expiry");
      return;
    }

    if (review.key === storageKeys.activationExpiry) {
      await openSimpleRecovery("activation-expiry");
      return;
    }

    if (review.key === storageKeys.refundAttempt) {
      await openSimpleRecovery("refund-attempt");
      return;
    }

    if (review.key === storageKeys.refundSettlement) {
      await openRefundSettlement();
      return;
    }

    if (review.key === storageKeys.bondWithdrawal) {
      await openSimpleRecovery("bond-withdrawal");
      return;
    }

    if (review.key === storageKeys.deregistrationPreparation) {
      await openDeregistrationPreparation();
      return;
    }

    if (review.key === storageKeys.deregistrationSettlement) {
      await openDeregistrationSettlement();
      return;
    }

    setNotice("The current exact review no longer belongs to this recovery action.");
  }, [
    exact.review,
    openDeregistrationPreparation,
    openDeregistrationSettlement,
    openRefundSettlement,
    openSimpleRecovery,
    openWithdrawal,
    storageKeys.activationExpiry,
    storageKeys.bondWithdrawal,
    storageKeys.deregistrationPreparation,
    storageKeys.deregistrationSettlement,
    storageKeys.refundAttempt,
    storageKeys.refundSettlement,
    storageKeys.reservationExpiry,
    storageKeys.withdrawal,
  ]);

  const active = v2ParticipantCanWithdraw(participant);

  const reservationExpired =
    latestTimestamp !== null && v2ParticipantCanExpireReservation(participant, latestTimestamp);

  const activationExpired =
    latestTimestamp !== null && v2ParticipantCanExpireActivation(participant, latestTimestamp);

  const refundReady = v2ParticipantCanAttemptRefund(participant);

  const refundProofReady = v2ParticipantCanSettleRefund(participant);

  const bondReady = v2BondCreditAvailable(bondCredit);

  const actionDisabled =
    loading ||
    busy ||
    decrypting ||
    !exact.storageReady ||
    exact.review !== null ||
    exact.attempt !== null;

  return (
    <div className="financial-form">
      {active && participant !== null ? (
        <>
          <div className="financial-step-card complete">
            <span className="financial-step-icon">
              <CircleCheck size={18} />
            </span>

            <div>
              <strong>ACTIVE participant verified from Sepolia</strong>

              <p>
                Slot {participant.slotIndex.toString()} · registration version{" "}
                {participant.registrationVersion.toString()} · reservation nonce{" "}
                {participant.reservationNonce.toString()}
              </p>
            </div>
          </div>

          <label>
            <span>Requested withdrawal amount</span>

            <div className="financial-input-unit">
              <input
                inputMode="decimal"
                value={amount}
                placeholder="1.00"
                onChange={(event) => {
                  setAmount(event.target.value);

                  setEncryptedReviewAmount(null);

                  setWithdrawalReview(null);

                  if (exact.attempt === null) {
                    exact.discardReview();
                  }
                }}
              />

              <small>{tokenSymbol}</small>
            </div>

            <small className="financial-field-help">
              The amount is encrypted only after the explicit preparation click. PoolV2.x privately
              caps the request at encrypted principal; Veilpot never decrypts principal
              automatically.
            </small>
          </label>

          <button
            className="financial-primary-button"
            type="button"
            disabled={parsedAmount === null || tokenDecimals !== 6 || actionDisabled}
            onClick={() => {
              void prepareWithdrawal();
            }}
          >
            <LockKeyhole size={15} /> Encrypt & prepare exact withdrawal review
          </button>

          {encryptedReviewAmount !== null ? (
            <div className="financial-state-card">
              <ShieldCheck size={18} />

              <div>
                <strong>Encrypted withdrawal review prepared</strong>

                <p>
                  Entered amount: {encryptedReviewAmount} {tokenSymbol}. This clear amount exists
                  only in the current browser review and is never used to infer or reveal principal.
                </p>
              </div>
            </div>
          ) : null}

          <ExactActionReviewCard controller={exact} onOpenWallet={openCurrentReview} />

          <div className="action-safety-note">
            <ShieldCheck size={17} />

            <p>
              <strong>Optional full exit.</strong> After withdrawals, zero-principal deregistration
              remains a separate proof flow. Preparing it does not reveal principal, and public
              boolean decryption remains an explicit user action.
            </p>
          </div>

          <button
            className="financial-secondary-button"
            type="button"
            disabled={actionDisabled}
            onClick={() => {
              void prepareDeregistrationPredicate();
            }}
          >
            <WalletCards size={15} /> Prepare zero-principal predicate
          </button>

          <button
            className="financial-secondary-button"
            type="button"
            disabled={
              loading ||
              busy ||
              decrypting ||
              preparedDeregistrationHandle === null ||
              preparedDeregistrationParticipant === null ||
              exact.review !== null ||
              exact.attempt !== null
            }
            onClick={() => {
              void decryptDeregistrationPredicate();
            }}
          >
            <LockKeyhole size={15} /> Decrypt zero-principal boolean explicitly
          </button>
        </>
      ) : (
        <>
          <div className="financial-state-card warning">
            <ShieldCheck size={20} />

            <div>
              <strong>Private savings recovery</strong>

              <p>
                {loading
                  ? "Checking live account state…"
                  : participant === null
                    ? "No live participant registration is currently present."
                    : `Current recovery state: ${participantStateName(participant.state)}.`}
              </p>
            </div>
          </div>

          {reservationExpired ? (
            <button
              className="financial-secondary-button"
              type="button"
              disabled={actionDisabled}
              onClick={() => {
                void prepareSimpleRecovery("reservation-expiry");
              }}
            >
              <RefreshCw size={15} /> Prepare expired reservation release
            </button>
          ) : null}

          {activationExpired ? (
            <button
              className="financial-secondary-button"
              type="button"
              disabled={actionDisabled}
              onClick={() => {
                void prepareSimpleRecovery("activation-expiry");
              }}
            >
              <RefreshCw size={15} /> Prepare expired activation recovery
            </button>
          ) : null}

          {refundReady ? (
            <button
              className="financial-primary-button"
              type="button"
              disabled={actionDisabled}
              onClick={() => {
                void prepareSimpleRecovery("refund-attempt");
              }}
            >
              <ShieldCheck size={15} /> Prepare confidential refund attempt
            </button>
          ) : null}

          {refundProofReady ? (
            <>
              <div className="action-safety-note">
                <ShieldCheck size={17} />

                <p>
                  Only the public refund-complete predicate is decrypted. The confidential refund
                  obligation and residual amount remain sealed.
                </p>
              </div>

              <button
                className="financial-primary-button"
                type="button"
                disabled={actionDisabled}
                onClick={() => {
                  void prepareRefundSettlement();
                }}
              >
                <LockKeyhole size={15} /> Decrypt refund-completion boolean explicitly
              </button>
            </>
          ) : null}

          <ExactActionReviewCard controller={exact} onOpenWallet={openCurrentReview} />
        </>
      )}

      {bondReady ? (
        <div className="financial-state-card">
          <WalletCards size={18} />

          <div>
            <strong>Public registration-bond credit</strong>

            <p>{formatEther(bondCredit)} ETH is available through the PoolV2.x pull-credit path.</p>

            <button
              className="financial-secondary-button"
              type="button"
              disabled={actionDisabled}
              onClick={() => {
                void prepareSimpleRecovery("bond-withdrawal");
              }}
            >
              <WalletCards size={15} /> Prepare bond refund withdrawal
            </button>
          </div>
        </div>
      ) : null}

      {notice !== null ? <p className="financial-field-help">{notice}</p> : null}

      <button
        className="financial-secondary-button"
        type="button"
        disabled={loading || busy || decrypting}
        onClick={() => {
          void refresh();
        }}
      >
        <RefreshCw size={15} /> Refresh participant state
      </button>
    </div>
  );
}
