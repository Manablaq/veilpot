"use client";

import {
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, parseUnits, type Address, type Hex } from "viem";
import { useConnection, usePublicClient } from "wagmi";
import { useConfidentialIsOperator, useMetadata, useZamaSDK } from "@zama-fhe/react-sdk";

import {
  PARTICIPANT_STATE,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_POOL_V2_ABI,
  buildV2DepositCall,
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
import {
  DEPOSIT_REVIEW_MAX_AGE_SECONDS,
  MAX_REGISTRATION_DEPOSIT_BASE_UNITS,
  MIN_REGISTRATION_DEPOSIT_BASE_UNITS,
  createDepositReview,
  depositReviewInvalidReason,
  type DepositReview,
} from "@/lib/deposit-review";
import { type ExactActionAttempt, type ExactActionReview } from "@/lib/exact-action";
import { v2SaveStorageKeys } from "@/lib/deployment-scope";
import {
  OPERATOR_APPROVAL_REVIEW_MAX_AGE_SECONDS,
  createOperatorApprovalReview,
  operatorApprovalReviewInvalidReason,
  type OperatorApprovalReview,
} from "@/lib/operator-approval";
import {
  THRESHOLD_REVIEW_MAX_AGE_SECONDS,
  createThresholdSettlementReview,
  parsePublicBoolean,
  thresholdReviewInvalidReason,
  type ThresholdSettlementReview,
} from "@/lib/threshold-settlement";
import type { V2ParticipantSnapshot } from "@/lib/v2-save";

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

interface MeridianSaveDepositActivationProps {
  readonly authenticatedAddress: Address;
  readonly participant: V2ParticipantSnapshot;
  readonly exactAction: SaveExactActionBridge;
  readonly onRefresh: () => Promise<void>;
}

type ReviewKind = "operator" | "deposit" | "threshold" | null;

function compactAddress(address: Address): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "The V2 Save action stopped safely.";
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

export function MeridianSaveDepositActivation({
  authenticatedAddress,
  participant,
  exactAction,
  onRefresh,
}: MeridianSaveDepositActivationProps) {
  const connection = useConnection();

  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });

  const zama = useZamaSDK();

  const metadataQuery = useMetadata(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken);

  const operatorQuery = useConfidentialIsOperator(
    {
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
      holder: connection.address,
      spender: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    },
    {
      enabled: connection.address !== undefined,
    },
  );

  const storageKeys = useMemo(
    () => v2SaveStorageKeys(authenticatedAddress),
    [authenticatedAddress],
  );

  const [amount, setAmount] = useState("");

  const [reviewKind, setReviewKind] = useState<ReviewKind>(null);

  const [operatorReview, setOperatorReview] = useState<OperatorApprovalReview | null>(null);

  const [depositReview, setDepositReview] = useState<DepositReview | null>(null);

  const [thresholdReview, setThresholdReview] = useState<ThresholdSettlementReview | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [preparing, setPreparing] = useState(false);

  const [decrypting, setDecrypting] = useState(false);

  const tokenDecimals = metadataQuery.data?.decimals;

  const tokenSymbol = metadataQuery.data?.symbol ?? "cUSDT";

  const parsedAmount = useMemo(() => {
    if (tokenDecimals === undefined || amount.trim().length === 0) {
      return null;
    }

    try {
      const value = parseUnits(amount.trim(), tokenDecimals);

      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [amount, tokenDecimals]);

  const clearDomainReviews = useCallback(() => {
    setReviewKind(null);
    setOperatorReview(null);
    setDepositReview(null);
    setThresholdReview(null);
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
      throw new Error("Participant state changed during the authoritative read.");
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

  const refreshOperator = useCallback(async () => {
    setError(null);

    try {
      requireWallet();

      const result = await operatorQuery.refetch({
        throwOnError: true,
      });

      if (result.data !== true && result.data !== false) {
        throw new Error("The live PoolV2 operator state could not be verified.");
      }

      setNotice(
        result.data
          ? "PoolV2 is currently authorized as an ERC-7984 operator for this wallet."
          : "PoolV2 is not currently authorized. An exact 30-minute operator approval is required before confidential deposit.",
      );
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    }
  }, [operatorQuery, requireWallet]);

  useEffect(() => {
    if (
      exactAction.review === null &&
      exactAction.attempt === null &&
      (exactAction.status.kind === "error" ||
        exactAction.status.kind === "included" ||
        exactAction.status.kind === "reverted")
    ) {
      clearDomainReviews();
    }
  }, [clearDomainReviews, exactAction.attempt, exactAction.review, exactAction.status.kind]);

  useEffect(() => {
    if (exactAction.status.kind === "included") {
      void operatorQuery.refetch();
      void onRefresh();
    }
  }, [exactAction.status.kind, onRefresh, operatorQuery]);

  const prepareOperatorApproval = useCallback(async () => {
    setNotice(null);
    setError(null);
    clearDomainReviews();

    if (!exactAction.storageReady) {
      setError("Veilpot is still checking for an unresolved exact wallet attempt.");
      return;
    }

    if (exactAction.attempt !== null || exactAction.review !== null) {
      setError("Resolve or discard the current exact Save action before preparing another one.");
      return;
    }

    setPreparing(true);

    try {
      const holder = requireWallet();

      const liveParticipant = await readParticipant();

      if (
        liveParticipant?.state !== PARTICIPANT_STATE.RESERVED ||
        !sameAddress(liveParticipant.owner, holder) ||
        !liveParticipant.bondHeld
      ) {
        throw new Error(
          "A live RESERVED PoolV2 participant owned by this wallet with its bond held is required.",
        );
      }

      const nowSeconds = Math.floor(Date.now() / 1000);

      if (BigInt(nowSeconds) >= liveParticipant.reservationExpiry) {
        throw new Error(
          "The participant reservation is too close to or beyond expiry. Do not create a new operator approval.",
        );
      }

      const operatorResult = await operatorQuery.refetch({
        throwOnError: true,
      });

      if (operatorResult.data === true) {
        setNotice("PoolV2 is already an active operator. No approval transaction was prepared.");
        return;
      }

      if (operatorResult.data !== false) {
        throw new Error("The current PoolV2 operator status could not be proven.");
      }

      const domainReview = createOperatorApprovalReview({
        holder,
        token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
        operator: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: liveParticipant,
        nowSeconds,
      });

      const exactReview = await exactAction.prepare({
        key: storageKeys.operatorApproval,
        label: "Authorize PoolV2 for confidential deposit",
        consequence:
          "Authorize only the active PoolV2 contract as ERC-7984 operator for the exact reviewed 30-minute expiry.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
        data: domainReview.calldata,
        value: 0n,
      });

      if (exactReview === null) {
        throw new Error("The exact PoolV2 operator approval did not pass simulation.");
      }

      if (
        !sameAddress(exactReview.to, domainReview.token) ||
        exactReview.data.toLowerCase() !== domainReview.calldata.toLowerCase()
      ) {
        exactAction.discardReview();
        throw new Error(
          "The exact-action review diverged from the frozen operator-approval calldata.",
        );
      }

      setOperatorReview(domainReview);
      setReviewKind("operator");
      setNotice(
        "Exact PoolV2 operator authorization simulated. Inspect the contract and expiry before opening the wallet.",
      );
    } catch (caught: unknown) {
      exactAction.discardReview();
      clearDomainReviews();
      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    clearDomainReviews,
    exactAction,
    operatorQuery,
    readParticipant,
    requireWallet,
    storageKeys.operatorApproval,
  ]);

  const openOperatorApproval = useCallback(async () => {
    const domainReview = operatorReview;

    if (domainReview === null || reviewKind !== "operator") {
      setError("Prepare a fresh PoolV2 operator review first.");
      return;
    }

    setError(null);
    setPreparing(true);

    try {
      const holder = requireWallet();

      const [liveParticipant, operatorResult] = await Promise.all([
        readParticipant(),
        operatorQuery.refetch({
          throwOnError: true,
        }),
      ]);

      if (operatorResult.data === true) {
        exactAction.discardReview();
        clearDomainReviews();
        setNotice(
          "PoolV2 became an active operator before wallet opening. No approval transaction was requested.",
        );
        return;
      }

      if (operatorResult.data !== false) {
        throw new Error(
          "The PoolV2 operator state could not be verified immediately before wallet opening.",
        );
      }

      const invalidReason = operatorApprovalReviewInvalidReason(domainReview, {
        holder,
        token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
        operator: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: liveParticipant,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exactAction.discardReview();
        clearDomainReviews();

        throw new Error(`${invalidReason} No replacement authorization was generated.`);
      }

      if (
        exactAction.review?.key !== storageKeys.operatorApproval ||
        !sameAddress(exactAction.review.to, domainReview.token) ||
        exactAction.review.data.toLowerCase() !== domainReview.calldata.toLowerCase()
      ) {
        exactAction.discardReview();
        clearDomainReviews();

        throw new Error(
          "The exact wallet review no longer matches the frozen PoolV2 authorization.",
        );
      }

      clearDomainReviews();

      await exactAction.openWallet();
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    clearDomainReviews,
    exactAction,
    operatorQuery,
    operatorReview,
    readParticipant,
    requireWallet,
    reviewKind,
    storageKeys.operatorApproval,
  ]);

  const prepareDeposit = useCallback(async () => {
    setNotice(null);
    setError(null);
    clearDomainReviews();

    if (!exactAction.storageReady) {
      setError("Veilpot is still checking for an unresolved exact wallet attempt.");
      return;
    }

    if (exactAction.attempt !== null || exactAction.review !== null) {
      setError(
        "Resolve or discard the current exact Save action before encrypting another amount.",
      );
      return;
    }

    if (tokenDecimals !== 6 || parsedAmount === null) {
      setError("Enter a valid cUSDT amount using the exact 6-decimal token format.");
      return;
    }

    if (
      parsedAmount < MIN_REGISTRATION_DEPOSIT_BASE_UNITS ||
      parsedAmount > MAX_REGISTRATION_DEPOSIT_BASE_UNITS
    ) {
      setError("Registration deposit must be between 1.000000 and 1,000,000.000000 cUSDT.");
      return;
    }

    setPreparing(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [liveParticipant, operatorResult, depositNonce, accountNonce, pendingBondRefund] =
        await Promise.all([
          readParticipant(),
          operatorQuery.refetch({
            throwOnError: true,
          }),
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "nextDepositNonce",
            args: [holder],
          }),
          publicClient.getTransactionCount({
            address: holder,
            blockTag: "pending",
          }),
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "pendingBondRefund",
            args: [holder],
          }),
        ]);

      if (
        liveParticipant?.state !== PARTICIPANT_STATE.RESERVED ||
        !sameAddress(liveParticipant.owner, holder) ||
        !liveParticipant.bondHeld
      ) {
        throw new Error(
          "A live RESERVED PoolV2 participant owned by this wallet with its bond held is required.",
        );
      }

      if (BigInt(Math.floor(Date.now() / 1000)) >= liveParticipant.reservationExpiry) {
        throw new Error(
          "The participant reservation is too close to or beyond expiry. No encryption was performed.",
        );
      }

      if (operatorResult.data !== true) {
        throw new Error("PoolV2 operator authorization is not currently active.");
      }

      if (pendingBondRefund !== 0n) {
        throw new Error(
          "A pending registration-bond refund must be resolved before confidential deposit.",
        );
      }

      setNotice(
        "Encrypting only the entered amount for the exact active PoolV2 contract and authenticated wallet.",
      );

      const encrypted = await encryptV2PoolAmount(zama, parsedAmount, holder);

      const [
        postParticipant,
        postOperatorResult,
        postDepositNonce,
        postAccountNonce,
        postPendingBondRefund,
      ] = await Promise.all([
        readParticipant(),
        operatorQuery.refetch({
          throwOnError: true,
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "nextDepositNonce",
          args: [holder],
        }),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "pendingBondRefund",
          args: [holder],
        }),
      ]);

      if (
        postParticipant === null ||
        !sameParticipantBinding(postParticipant, liveParticipant) ||
        postOperatorResult.data !== true ||
        postDepositNonce !== depositNonce ||
        postAccountNonce !== accountNonce ||
        postPendingBondRefund !== 0n
      ) {
        throw new Error(
          "Public state changed while encrypting. The ciphertext was discarded and cannot be reused.",
        );
      }

      const descriptor = buildV2DepositCall({
        encrypted,
        depositor: holder,
        reservationNonce: postParticipant.reservationNonce,
        depositNonce,
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

      const preparedAt = Math.floor(Date.now() / 1000);

      const domainReview = createDepositReview({
        holder,
        token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: postParticipant,
        amountBaseUnits: parsedAmount,
        amountDisplay: amount.trim(),
        tokenSymbol,
        tokenDecimals,
        depositNonce,
        accountNonce,
        encryptedValue: encrypted.encryptedValue,
        inputProof: encrypted.inputProof,
        calldata,
        preparedAt,
        simulatedAt: Math.floor(Date.now() / 1000),
      });

      const exactReview = await exactAction.prepare({
        key: storageKeys.deposit,
        label: "Submit confidential PoolV2 deposit",
        consequence:
          "Transfer only the exact encrypted cUSDT amount into PoolV2 under the frozen participant registration and deposit nonce.",
        to: descriptor.address,
        data: calldata,
        value: 0n,
      });

      if (
        !exactReviewMatches(exactReview, {
          key: storageKeys.deposit,
          to: descriptor.address,
          data: calldata,
          accountNonce,
        })
      ) {
        exactAction.discardReview();

        throw new Error(
          "The exact-action review diverged from the encrypted deposit review. The ciphertext was discarded.",
        );
      }

      setDepositReview(domainReview);
      setReviewKind("deposit");

      setNotice(
        "Encrypted deposit simulated twice against the exact V2 state. Inspect the amount, participant binding, nonces and calldata before opening the wallet.",
      );
    } catch (caught: unknown) {
      exactAction.discardReview();
      clearDomainReviews();
      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    amount,
    clearDomainReviews,
    exactAction,
    operatorQuery,
    parsedAmount,
    publicClient,
    readParticipant,
    requireWallet,
    storageKeys.deposit,
    tokenDecimals,
    tokenSymbol,
    zama,
  ]);

  const openDeposit = useCallback(async () => {
    const domainReview = depositReview;

    if (domainReview === null || reviewKind !== "deposit") {
      setError("Encrypt and prepare a fresh confidential deposit review first.");
      return;
    }

    setError(null);
    setPreparing(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [liveParticipant, operatorResult, depositNonce, accountNonce] = await Promise.all([
        readParticipant(),
        operatorQuery.refetch({
          throwOnError: true,
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "nextDepositNonce",
          args: [holder],
        }),
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

      const descriptor = buildV2DepositCall({
        encrypted: reviewedEncrypted,
        depositor: domainReview.holder,
        reservationNonce: domainReview.participant.reservationNonce,
        depositNonce: domainReview.depositNonce,
      });

      const currentCalldata = encodeFunctionData({
        abi: descriptor.abi,
        functionName: descriptor.functionName,
        args: descriptor.args,
      });

      const invalidReason = depositReviewInvalidReason(domainReview, {
        holder,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: liveParticipant,
        amountBaseUnits: parsedAmount,
        depositNonce,
        accountNonce,
        operatorActive: operatorResult.data === true,
        currentCalldata,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exactAction.discardReview();
        clearDomainReviews();

        throw new Error(`${invalidReason} No replacement ciphertext or transaction was generated.`);
      }

      if (
        !exactReviewMatches(exactAction.review, {
          key: storageKeys.deposit,
          to: descriptor.address,
          data: currentCalldata,
          accountNonce,
        })
      ) {
        exactAction.discardReview();
        clearDomainReviews();

        throw new Error(
          "The exact wallet review no longer matches the frozen confidential deposit.",
        );
      }

      await publicClient.simulateContract({
        ...descriptor,
        account: holder,
      });

      clearDomainReviews();

      await exactAction.openWallet();
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    clearDomainReviews,
    depositReview,
    exactAction,
    operatorQuery,
    parsedAmount,
    publicClient,
    readParticipant,
    requireWallet,
    reviewKind,
    storageKeys.deposit,
  ]);

  const prepareThresholdSettlement = useCallback(async () => {
    setNotice(null);
    setError(null);
    clearDomainReviews();

    if (!exactAction.storageReady) {
      setError("Veilpot is still checking for an unresolved exact wallet attempt.");
      return;
    }

    if (exactAction.attempt !== null || exactAction.review !== null) {
      setError("Resolve or discard the current exact Save action first.");
      return;
    }

    setDecrypting(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const liveParticipant = await readParticipant();

      if (
        liveParticipant?.state !== PARTICIPANT_STATE.PENDING_ACTIVATION ||
        !sameAddress(liveParticipant.owner, holder)
      ) {
        throw new Error("The exact participant is no longer PENDING_ACTIVATION.");
      }

      if (BigInt(Math.floor(Date.now() / 1000)) > liveParticipant.activationDeadline) {
        throw new Error("The activation-proof deadline has expired.");
      }

      const thresholdHandle = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "thresholdHandle",
        args: [liveParticipant.slotIndex],
      });

      if (!/^0x[0-9a-fA-F]{64}$/.test(thresholdHandle)) {
        throw new Error("PoolV2 returned an invalid threshold handle.");
      }

      setNotice(
        "Decrypting only the intentionally public threshold consequence. The confidential deposited amount is not being decrypted.",
      );

      const decrypted = await zama.decryption.decryptPublicValues([thresholdHandle], {
        timeout: 180_000,
      });

      const clearEntry = Object.entries(decrypted.clearValues).find(
        ([handle]) => handle.toLowerCase() === thresholdHandle.toLowerCase(),
      );

      if (clearEntry === undefined) {
        throw new Error(
          "The public decryption result did not contain the exact PoolV2 threshold handle.",
        );
      }

      const clearSatisfied = parsePublicBoolean(clearEntry[1]);

      const proof = decrypted.decryptionProof;

      if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(proof)) {
        throw new Error("The public threshold decryption proof is empty or malformed.");
      }

      const [postParticipant, postHandle, accountNonce] = await Promise.all([
        readParticipant(),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "thresholdHandle",
          args: [liveParticipant.slotIndex],
        }),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      if (
        postParticipant?.state !== PARTICIPANT_STATE.PENDING_ACTIVATION ||
        postParticipant.slotIndex !== liveParticipant.slotIndex ||
        !sameAddress(postParticipant.owner, liveParticipant.owner) ||
        postParticipant.registrationVersion !== liveParticipant.registrationVersion ||
        postParticipant.reservationNonce !== liveParticipant.reservationNonce ||
        postParticipant.activationDeadline !== liveParticipant.activationDeadline ||
        postHandle.toLowerCase() !== thresholdHandle.toLowerCase()
      ) {
        throw new Error(
          "Pending-activation state changed during public decryption. The proof was discarded.",
        );
      }

      const calldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleThreshold",
        args: [
          postParticipant.slotIndex,
          postParticipant.registrationVersion,
          postParticipant.reservationNonce,
          clearSatisfied,
          proof,
        ],
      });

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleThreshold",
        args: [
          postParticipant.slotIndex,
          postParticipant.registrationVersion,
          postParticipant.reservationNonce,
          clearSatisfied,
          proof,
        ],
        account: holder,
      });

      const preparedAt = Math.floor(Date.now() / 1000);

      const domainReview = createThresholdSettlementReview({
        holder,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: {
          slotIndex: postParticipant.slotIndex,
          state: postParticipant.state,
          owner: postParticipant.owner,
          registrationVersion: postParticipant.registrationVersion,
          reservationNonce: postParticipant.reservationNonce,
          activationDeadline: postParticipant.activationDeadline,
        },
        thresholdHandle,
        clearSatisfied,
        decryptionProof: proof,
        calldata,
        accountNonce,
        preparedAt,
        simulatedAt: preparedAt,
      });

      const exactReview = await exactAction.prepare({
        key: storageKeys.thresholdSettlement,
        label: clearSatisfied
          ? "Settle TRUE activation threshold"
          : "Settle FALSE activation threshold",
        consequence: clearSatisfied
          ? "Authenticate the exact public TRUE threshold proof and move this registration to ACTIVE."
          : "Authenticate the exact public FALSE threshold proof and move this registration into its repairable refund path.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data: calldata,
        value: 0n,
      });

      if (
        !exactReviewMatches(exactReview, {
          key: storageKeys.thresholdSettlement,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data: calldata,
          accountNonce,
        })
      ) {
        exactAction.discardReview();

        throw new Error(
          "The exact-action review diverged from the authenticated public threshold proof.",
        );
      }

      setThresholdReview(domainReview);
      setReviewKind("threshold");

      setNotice(
        clearSatisfied
          ? "Public threshold consequence: TRUE. Exact ACTIVE-settlement calldata simulated successfully."
          : "Public threshold consequence: FALSE. Exact refund-path settlement calldata simulated successfully.",
      );
    } catch (caught: unknown) {
      exactAction.discardReview();
      clearDomainReviews();
      setError(errorMessage(caught));
    } finally {
      setDecrypting(false);
    }
  }, [
    clearDomainReviews,
    exactAction,
    publicClient,
    readParticipant,
    requireWallet,
    storageKeys.thresholdSettlement,
    zama.decryption,
  ]);

  const openThresholdSettlement = useCallback(async () => {
    const domainReview = thresholdReview;

    if (domainReview === null || reviewKind !== "threshold") {
      setError("Prepare a fresh authenticated threshold review first.");
      return;
    }

    setError(null);
    setPreparing(true);

    try {
      const holder = requireWallet();

      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [liveParticipant, thresholdHandle, accountNonce] = await Promise.all([
        readParticipant(),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "thresholdHandle",
          args: [domainReview.participant.slotIndex],
        }),
        publicClient.getTransactionCount({
          address: holder,
          blockTag: "pending",
        }),
      ]);

      const currentCalldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleThreshold",
        args: [
          domainReview.participant.slotIndex,
          domainReview.participant.registrationVersion,
          domainReview.participant.reservationNonce,
          domainReview.clearSatisfied,
          domainReview.decryptionProof,
        ],
      });

      const invalidReason = thresholdReviewInvalidReason(domainReview, {
        holder,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant:
          liveParticipant === null
            ? null
            : {
                slotIndex: liveParticipant.slotIndex,
                state: liveParticipant.state,
                owner: liveParticipant.owner,
                registrationVersion: liveParticipant.registrationVersion,
                reservationNonce: liveParticipant.reservationNonce,
                activationDeadline: liveParticipant.activationDeadline,
              },
        thresholdHandle,
        currentCalldata,
        accountNonce,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exactAction.discardReview();
        clearDomainReviews();

        throw new Error(`${invalidReason} No replacement proof or transaction was generated.`);
      }

      if (
        !exactReviewMatches(exactAction.review, {
          key: storageKeys.thresholdSettlement,
          to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          data: currentCalldata,
          accountNonce,
        })
      ) {
        exactAction.discardReview();
        clearDomainReviews();

        throw new Error(
          "The exact wallet review no longer matches the frozen threshold settlement.",
        );
      }

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleThreshold",
        args: [
          domainReview.participant.slotIndex,
          domainReview.participant.registrationVersion,
          domainReview.participant.reservationNonce,
          domainReview.clearSatisfied,
          domainReview.decryptionProof,
        ],
        account: holder,
      });

      clearDomainReviews();

      await exactAction.openWallet();
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setPreparing(false);
    }
  }, [
    clearDomainReviews,
    exactAction,
    publicClient,
    readParticipant,
    requireWallet,
    reviewKind,
    storageKeys.thresholdSettlement,
    thresholdReview,
  ]);

  const discardCurrentReview = useCallback(() => {
    exactAction.discardReview();
    clearDomainReviews();
    setNotice("The prepared review was discarded. No transaction was submitted.");
  }, [clearDomainReviews, exactAction]);

  const operatorActive = operatorQuery.data === true;

  const reserved = participant.state === PARTICIPANT_STATE.RESERVED;

  const pendingActivation = participant.state === PARTICIPANT_STATE.PENDING_ACTIVATION;

  const activeDomainReview =
    reviewKind === "operator"
      ? operatorReview
      : reviewKind === "deposit"
        ? depositReview
        : reviewKind === "threshold"
          ? thresholdReview
          : null;

  const reviewExpiresAt =
    reviewKind === "operator" && operatorReview !== null
      ? operatorReview.preparedAt + OPERATOR_APPROVAL_REVIEW_MAX_AGE_SECONDS
      : reviewKind === "deposit" && depositReview !== null
        ? depositReview.preparedAt + DEPOSIT_REVIEW_MAX_AGE_SECONDS
        : reviewKind === "threshold" && thresholdReview !== null
          ? thresholdReview.preparedAt + THRESHOLD_REVIEW_MAX_AGE_SECONDS
          : null;

  return (
    <div className={styles.saveDepositFlow}>
      <Surface className={styles.saveDepositHeader} elevation="raised">
        <div>
          <span className={styles.workspaceEyebrow}>CONFIDENTIAL SAVE · V2</span>

          <h2>
            {reserved ? "Authorize, encrypt, review." : "Settle only the public consequence."}
          </h2>

          <p>
            {reserved
              ? "The amount is encrypted for the exact active PoolV2 contract and wallet. No balance reveal is required."
              : "The deposited amount remains encrypted. Only the threshold predicate intentionally made public by PoolV2 can be decrypted."}
          </p>
        </div>

        <ProtocolBadge>PoolV2 · exact-action boundary</ProtocolBadge>
      </Surface>

      {reserved ? (
        <div className={styles.saveDepositGrid}>
          <Surface className={styles.saveDepositStep}>
            <span className={styles.saveDepositStepIndex}>01</span>

            <KeyRound size={20} aria-hidden="true" />

            <h3>Pool authorization</h3>

            <p>
              PoolV2 needs a temporary ERC-7984 operator permission before it can pull the encrypted
              registration deposit.
            </p>

            <div className={styles.saveOperatorState}>
              <span>Live status</span>

              <StatusBadge
                tone={
                  operatorActive ? "success" : operatorQuery.data === false ? "warning" : "neutral"
                }
              >
                {operatorActive
                  ? "Authorized"
                  : operatorQuery.data === false
                    ? "Not authorized"
                    : "Unverified"}
              </StatusBadge>
            </div>

            <div className={styles.saveDepositButtons}>
              <MeridianButton
                variant="tertiary"
                size="small"
                disabled={operatorQuery.isFetching}
                onClick={() => {
                  void refreshOperator();
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Verify operator
              </MeridianButton>

              {!operatorActive ? (
                <MeridianButton
                  variant="secondary"
                  disabled={
                    preparing || exactAction.attempt !== null || exactAction.review !== null
                  }
                  onClick={() => {
                    void prepareOperatorApproval();
                  }}
                >
                  Prepare exact authorization
                </MeridianButton>
              ) : null}
            </div>
          </Surface>

          <Surface className={styles.saveDepositStep}>
            <span className={styles.saveDepositStepIndex}>02</span>

            <LockKeyhole size={20} aria-hidden="true" />

            <h3>Encrypt deposit</h3>

            <p>
              Enter the amount you choose to save. Veilpot does not reveal or automatically decrypt
              your confidential token balance.
            </p>

            <label className={styles.saveAmountField}>
              <span>Deposit amount</span>

              <div>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  placeholder="1.000000"
                  onChange={(event) => {
                    setAmount(event.target.value);

                    if (depositReview !== null || reviewKind === "deposit") {
                      exactAction.discardReview();
                      clearDomainReviews();
                    }
                  }}
                />

                <strong>{tokenSymbol}</strong>
              </div>
            </label>

            <small className={styles.saveDepositHint}>
              Protocol envelope: {formatUnits(MIN_REGISTRATION_DEPOSIT_BASE_UNITS, 6)} to{" "}
              {formatUnits(MAX_REGISTRATION_DEPOSIT_BASE_UNITS, 6)} {tokenSymbol}.
            </small>

            <MeridianButton
              variant="private"
              size="large"
              disabled={
                !operatorActive ||
                parsedAmount === null ||
                preparing ||
                exactAction.attempt !== null ||
                exactAction.review !== null
              }
              onClick={() => {
                void prepareDeposit();
              }}
            >
              {preparing ? (
                <LoaderCircle size={15} aria-hidden="true" />
              ) : (
                <LockKeyhole size={15} aria-hidden="true" />
              )}
              Encrypt + simulate exact deposit
            </MeridianButton>
          </Surface>

          <Surface className={styles.saveDepositStep}>
            <span className={styles.saveDepositStepIndex}>03</span>

            <ShieldCheck size={20} aria-hidden="true" />

            <h3>Activation</h3>

            <p>
              After the encrypted deposit is included, PoolV2 exposes only its public
              minimum/maximum threshold predicate for proof settlement.
            </p>

            <div className={styles.savePrivacyFact}>
              <LockKeyhole size={14} aria-hidden="true" />
              Amount stays encrypted through activation.
            </div>
          </Surface>
        </div>
      ) : null}

      {pendingActivation ? (
        <Surface className={styles.saveThresholdCard} elevation="raised">
          <div className={styles.saveThresholdIcon}>
            <ShieldCheck size={22} aria-hidden="true" />
          </div>

          <div>
            <span className={styles.workspaceEyebrow}>EXPLICIT PUBLIC CONSEQUENCE</span>

            <h2>Settle the activation threshold.</h2>

            <p>
              This user-triggered action asks Zama to decrypt only the threshold handle that PoolV2
              deliberately marked publicly decryptable. It does not decrypt the deposited amount.
            </p>
          </div>

          <MeridianButton
            variant="primary"
            size="large"
            disabled={decrypting || exactAction.attempt !== null || exactAction.review !== null}
            onClick={() => {
              void prepareThresholdSettlement();
            }}
          >
            {decrypting ? (
              <LoaderCircle size={15} aria-hidden="true" />
            ) : (
              <ShieldCheck size={15} aria-hidden="true" />
            )}
            Explicitly decrypt public threshold
          </MeridianButton>
        </Surface>
      ) : null}

      {notice !== null ? (
        <InlineNotice title="V2 Save status" tone="protocol">
          {notice}
        </InlineNotice>
      ) : null}

      {error !== null ? (
        <InlineNotice title="Save action stopped safely" tone="danger">
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
      ) : exactAction.review !== null && activeDomainReview !== null ? (
        <Surface className={styles.saveFlowReview} elevation="raised">
          <header>
            <ShieldCheck size={19} aria-hidden="true" />

            <div>
              <span className={styles.workspaceEyebrow}>FROZEN V2 REVIEW</span>

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

            {reviewKind === "operator" && operatorReview !== null ? (
              <>
                <div>
                  <dt>Operator</dt>
                  <dd>{compactAddress(operatorReview.operator)}</dd>
                </div>

                <div>
                  <dt>Authorization expiry</dt>
                  <dd>{operatorReview.untilUtc}</dd>
                </div>
              </>
            ) : null}

            {reviewKind === "deposit" && depositReview !== null ? (
              <>
                <div>
                  <dt>Entered amount</dt>
                  <dd>
                    {depositReview.amountDisplay} {depositReview.tokenSymbol}
                  </dd>
                </div>

                <div>
                  <dt>Deposit nonce</dt>
                  <dd>{depositReview.depositNonce.toString()}</dd>
                </div>

                <div>
                  <dt>Participant slot</dt>
                  <dd>{depositReview.participant.slotIndex.toString()}</dd>
                </div>

                <div>
                  <dt>Reservation nonce</dt>
                  <dd>{depositReview.participant.reservationNonce.toString()}</dd>
                </div>
              </>
            ) : null}

            {reviewKind === "threshold" && thresholdReview !== null ? (
              <>
                <div>
                  <dt>Public consequence</dt>
                  <dd>{thresholdReview.clearSatisfied ? "TRUE" : "FALSE"}</dd>
                </div>

                <div>
                  <dt>Participant slot</dt>
                  <dd>{thresholdReview.participant.slotIndex.toString()}</dd>
                </div>
              </>
            ) : null}

            {reviewExpiresAt !== null ? (
              <div>
                <dt>Review freshness</dt>
                <dd>Expires after Unix {reviewExpiresAt}</dd>
              </div>
            ) : null}
          </dl>

          <p>{exactAction.review.consequence}</p>

          <TechnicalDisclosure label="Show exact calldata">
            <code>{exactAction.review.data}</code>
          </TechnicalDisclosure>

          <div className={styles.saveDepositButtons}>
            <MeridianButton
              variant="primary"
              disabled={preparing || exactAction.isWalletPending}
              onClick={() => {
                if (reviewKind === "operator") {
                  void openOperatorApproval();
                  return;
                }

                if (reviewKind === "deposit") {
                  void openDeposit();
                  return;
                }

                if (reviewKind === "threshold") {
                  void openThresholdSettlement();
                }
              }}
            >
              Open exact wallet review
              <ExternalLink size={14} aria-hidden="true" />
            </MeridianButton>

            <MeridianButton
              variant="tertiary"
              disabled={exactAction.isWalletPending}
              onClick={discardCurrentReview}
            >
              Discard review
            </MeridianButton>
          </div>
        </Surface>
      ) : null}

      {exactAction.status.kind !== "idle" ? (
        <InlineNotice
          title={
            exactAction.status.kind === "included"
              ? "Exact V2 Save transaction included"
              : exactAction.status.kind === "ready"
                ? "Exact review ready"
                : exactAction.status.kind === "wallet"
                  ? "Wallet review open"
                  : exactAction.status.kind === "blocked"
                    ? "Exact Save action blocked"
                    : exactAction.status.kind === "reverted"
                      ? "Exact transaction reverted"
                      : "V2 Save action stopped"
          }
          tone={statusTone(exactAction.status)}
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

      <InlineNotice title="Confidentiality boundary" tone="private">
        No confidential wallet balance, principal amount, pending deposit amount, winner state or
        prize value is automatically decrypted by this control.
      </InlineNotice>
    </div>
  );
}
