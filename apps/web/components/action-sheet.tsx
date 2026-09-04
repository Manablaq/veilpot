"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseUnits } from "viem";
import {
  useConfidentialIsOperator,
  useConfidentialSetOperator,
  useMetadata,
  useZamaSDK,
} from "@zama-fhe/react-sdk";
import {
  PARTICIPANT_STATE,
  REGISTRATION_BOND_WEI,
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_POOL_ABI,
  VEILPOT_SEPOLIA_DEPLOYMENT,
  autopilotPlanStateName,
  buildAutopilotFundingCall,
  buildAutopilotPlanIdCall,
  buildAutopilotPlanMetadataCall,
  buildAutopilotSchedule,
  buildCreateAutopilotPlanCall,
  buildDepositCall,
  buildReserveParticipantSlotCall,
  buildWithdrawalCall,
  encryptAutopilotFundingAmount,
  encryptAutopilotPlanAmounts,
  encryptPoolAmount,
  participantStateName,
  type Address,
  type Hex,
} from "@veilpot/protocol-sdk";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";

import {
  buildRecurringAutopilotWindows,
  findAutopilotScheduleRecord,
  loadAutopilotScheduleRecords,
  reconcileAutopilotPlanMetadata,
  saveAutopilotScheduleRecord,
  validateAutopilotDiscoveryEvents,
  type AutopilotPlanCreatedEventSnapshot,
  type AutopilotPlanMetadataSnapshot,
  type PersistedAutopilotScheduleRecord,
} from "@/lib/autopilot";
import {
  OPERATOR_APPROVAL_REVIEW_MAX_AGE_SECONDS,
  createOperatorApprovalReview,
  createOperatorApprovalSubmissionRecord,
  operatorApprovalReviewInvalidReason,
  operatorApprovalTransactionInvalidReason,
  parseOperatorApprovalSubmissionRecord,
  serializeOperatorApprovalSubmissionRecord,
  subscribeToSetOperatorSubmitted,
  transactionReceiptStatus,
  type OperatorApprovalReview,
  type OperatorApprovalSubmissionRecord,
} from "@/lib/operator-approval";

export type PreviewAction = "plan" | "deposit" | "withdraw" | null;

interface ActionSheetProps {
  readonly action: PreviewAction;
  readonly authenticatedAddress: Address;
  readonly onClose: () => void;
}

interface ParticipantSnapshot {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly reservationExpiry: bigint;
  readonly activationStartedAt: bigint;
  readonly activationDeadline: bigint;
  readonly refundAttemptNonce: bigint;
  readonly bondHeld: boolean;
}

type TransactionPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "wallet"; readonly label: string }
  | {
      readonly kind: "submitted";
      readonly label: string;
      readonly hash: Hex;
      readonly message: string;
    }
  | {
      readonly kind: "reverted";
      readonly label: string;
      readonly hash: Hex;
      readonly message: string;
    }
  | {
      readonly kind: "included";
      readonly label: string;
      readonly hash: Hex;
      readonly warning?: string;
    }
  | { readonly kind: "error"; readonly message: string };

interface PlanDraft {
  readonly name: string;
  readonly amount: string;
  readonly cadence: "weekly" | "monthly";
  readonly day: string;
  readonly time: string;
  readonly windowHours: string;
  readonly executionCount: string;
  readonly lifetimeCap: string;
}

interface CreatedAutopilotPlan {
  readonly planId: Hex;
  readonly scheduleRoot: Hex;
  readonly executionCount: number;
  readonly state: string;
  readonly transactionHash: Hex;
  readonly nextWindow: {
    readonly notBefore: bigint;
    readonly notAfter: bigint;
  };
}

interface DiscoveredAutopilotPlan {
  readonly event: AutopilotPlanCreatedEventSnapshot;
  readonly metadata: AutopilotPlanMetadataSnapshot;
  readonly state: string;
  readonly schedule: PersistedAutopilotScheduleRecord | null;
}

interface IncludedAutopilotFunding {
  readonly planId: Hex;
  readonly transactionHash: Hex;
}

const INITIAL_PLAN: PlanDraft = {
  name: "",
  amount: "",
  cadence: "weekly",
  day: "Friday",
  time: "08:00",
  windowHours: "2",
  executionCount: "12",
  lifetimeCap: "",
};

const stages = ["Prepare", "Review", "Approve", "Settle"] as const;

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const MONTH_DAYS = Array.from({ length: 28 }, (_, index) => String(index + 1));

const AUTOPILOT_EVENT_SCAN_CHUNK_BLOCKS = 1_000n;
const AUTOPILOT_PLAN_STATE_REVOKED = 3;
const AUTOPILOT_PLAN_STATE_COMPLETED = 4;

function compactAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "The action could not be completed. Nothing was submitted again automatically.";
}

function participantStatus(participant: ParticipantSnapshot | null): string {
  if (participant === null) return "Not registered";
  return participantStateName(participant.state);
}

function unixTimeLabel(timestamp: bigint): string {
  if (timestamp === 0n) return "—";
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function autopilotPlanCanReceiveFunding(state: number): boolean {
  return state !== AUTOPILOT_PLAN_STATE_REVOKED && state !== AUTOPILOT_PLAN_STATE_COMPLETED;
}

export function ActionSheet({ action, authenticatedAddress, onClose }: ActionSheetProps) {
  const connection = useConnection();
  const publicClient = usePublicClient({ chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId });
  const writeMutation = useWriteContract();
  const zama = useZamaSDK();

  const metadataQuery = useMetadata(VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken);
  const operatorQuery = useConfidentialIsOperator(
    {
      address: VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
      holder: connection.address,
      spender: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
    },
    { enabled: action === "deposit" && connection.address !== undefined },
  );
  const operatorMutation = useConfidentialSetOperator(VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken);

  const [participant, setParticipant] = useState<ParticipantSnapshot | null>(null);
  const [participantLoading, setParticipantLoading] = useState(false);
  const [participantError, setParticipantError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [transaction, setTransaction] = useState<TransactionPhase>({ kind: "idle" });
  const [operatorReview, setOperatorReview] = useState<OperatorApprovalReview | null>(null);
  const [operatorReviewNotice, setOperatorReviewNotice] = useState<string | null>(null);
  const [operatorSubmission, setOperatorSubmission] =
    useState<OperatorApprovalSubmissionRecord | null>(null);
  const [operatorSubmissionLoadedKey, setOperatorSubmissionLoadedKey] = useState<string | null>(
    null,
  );
  const [plan, setPlan] = useState<PlanDraft>(INITIAL_PLAN);
  const [planReview, setPlanReview] = useState(false);
  const [createdPlan, setCreatedPlan] = useState<CreatedAutopilotPlan | null>(null);
  const [planPersistenceWarning, setPlanPersistenceWarning] = useState<string | null>(null);
  const [autopilotMode, setAutopilotMode] = useState<"create" | "fund">("create");
  const [discoveredPlans, setDiscoveredPlans] = useState<readonly DiscoveredAutopilotPlan[]>([]);
  const [autopilotDiscoveryLoading, setAutopilotDiscoveryLoading] = useState(false);
  const [autopilotDiscoveryError, setAutopilotDiscoveryError] = useState<string | null>(null);
  const [autopilotScheduleWarning, setAutopilotScheduleWarning] = useState<string | null>(null);
  const [autopilotSnapshotBlock, setAutopilotSnapshotBlock] = useState<bigint | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<Hex | null>(null);
  const [fundingAmount, setFundingAmount] = useState("");
  const [fundingReview, setFundingReview] = useState(false);
  const [fundingIncluded, setFundingIncluded] = useState<IncludedAutopilotFunding | null>(null);
  const [fundingWarning, setFundingWarning] = useState<string | null>(null);
  const [localAction, setLocalAction] = useState<Exclude<PreviewAction, null>>("plan");

  const address = connection.address;
  const tokenSymbol = metadataQuery.data?.symbol ?? "confidential token";
  const tokenDecimals = metadataQuery.data?.decimals;
  const operatorSubmissionStorageKey = `veilpot:operator-approval:unresolved:v1:${String(
    VEILPOT_SEPOLIA_DEPLOYMENT.chainId,
  )}:${VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase()}:${VEILPOT_SEPOLIA_DEPLOYMENT.pool.toLowerCase()}:${authenticatedAddress.toLowerCase()}`;

  const preserveOperatorSubmission = useCallback(
    (record: OperatorApprovalSubmissionRecord) => {
      setOperatorSubmission(record);
      try {
        window.localStorage.setItem(
          operatorSubmissionStorageKey,
          serializeOperatorApprovalSubmissionRecord(record),
        );
      } catch {
        // In-memory blocking remains active if browser storage is unavailable.
      }
    },
    [operatorSubmissionStorageKey],
  );

  const clearOperatorSubmission = useCallback(() => {
    setOperatorSubmission(null);
    try {
      window.localStorage.removeItem(operatorSubmissionStorageKey);
    } catch {
      // In-memory state has already been cleared after conclusive reconciliation.
    }
  }, [operatorSubmissionStorageKey]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(operatorSubmissionStorageKey);
      if (stored === null) {
        setOperatorSubmission(null);
      } else {
        const parsed = parseOperatorApprovalSubmissionRecord(stored);
        const matchesCurrentContext =
          parsed !== null &&
          parsed.holder.toLowerCase() === authenticatedAddress.toLowerCase() &&
          parsed.token.toLowerCase() ===
            VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase() &&
          parsed.operator.toLowerCase() === VEILPOT_SEPOLIA_DEPLOYMENT.pool.toLowerCase();

        if (matchesCurrentContext) {
          setOperatorSubmission(parsed);
        } else {
          window.localStorage.removeItem(operatorSubmissionStorageKey);
          setOperatorSubmission(null);
        }
      }
    } catch {
      setOperatorSubmission(null);
    } finally {
      setOperatorSubmissionLoadedKey(operatorSubmissionStorageKey);
    }
  }, [authenticatedAddress, operatorSubmissionStorageKey]);

  const operatorSubmissionStorageReady =
    operatorSubmissionLoadedKey === operatorSubmissionStorageKey;

  useEffect(() => {
    setOperatorReview(null);
    setOperatorReviewNotice(null);

    if (action !== null) {
      setLocalAction(action);
      setAmount("");
      setTransaction({ kind: "idle" });
      setParticipantError(null);
      setPlanReview(false);
      setCreatedPlan(null);
      setPlanPersistenceWarning(null);
      setAutopilotMode("create");
      setDiscoveredPlans([]);
      setAutopilotDiscoveryLoading(false);
      setAutopilotDiscoveryError(null);
      setAutopilotScheduleWarning(null);
      setAutopilotSnapshotBlock(null);
      setSelectedPlanId(null);
      setFundingAmount("");
      setFundingReview(false);
      setFundingIncluded(null);
      setFundingWarning(null);
    }
  }, [action]);

  useEffect(() => {
    setOperatorReview(null);
    setOperatorReviewNotice(null);
    setDiscoveredPlans([]);
    setAutopilotDiscoveryError(null);
    setAutopilotScheduleWarning(null);
    setAutopilotSnapshotBlock(null);
    setSelectedPlanId(null);
    setFundingAmount("");
    setFundingReview(false);
    setFundingIncluded(null);
    setFundingWarning(null);
    setCreatedPlan(null);
    setPlanPersistenceWarning(null);
  }, [address, authenticatedAddress, connection.chainId]);

  const loadParticipant = useCallback(
    async (holder: Address): Promise<ParticipantSnapshot | null> => {
      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const maximum = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "MAX_PARTICIPANTS",
      });

      const chunkSize = 16;
      let found: ParticipantSnapshot | null = null;

      for (let start = 0; start < Number(maximum) && found === null; start += chunkSize) {
        const end = Math.min(start + chunkSize, Number(maximum));
        const slots = Array.from({ length: end - start }, (_, index) => start + index);

        const states = await Promise.all(
          slots.map(async (slotIndex) => ({
            slotIndex,
            state: await publicClient.readContract({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              functionName: "participantState",
              args: [BigInt(slotIndex)],
            }),
          })),
        );

        const occupiedSlots = states.filter(
          ({ state }) => state !== PARTICIPANT_STATE.FREE && state !== PARTICIPANT_STATE.TOMBSTONED,
        );

        const rows = await Promise.all(
          occupiedSlots.map(async ({ slotIndex }) => {
            const row = await publicClient.readContract({
              address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_ABI,
              functionName: "participantMetadata",
              args: [BigInt(slotIndex)],
            });
            return { slotIndex, row };
          }),
        );

        const match = rows.find(({ row }) => row[1].toLowerCase() === holder.toLowerCase());

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
    },
    [publicClient],
  );

  const refreshParticipant = useCallback(async () => {
    if (address === undefined) {
      setParticipant(null);
      return;
    }

    setParticipantLoading(true);
    setParticipantError(null);

    try {
      setParticipant(await loadParticipant(address));
    } catch (error: unknown) {
      setParticipantError(errorMessage(error));
    } finally {
      setParticipantLoading(false);
    }
  }, [address, loadParticipant]);

  useEffect(() => {
    if (action !== null) {
      void refreshParticipant();
    }
  }, [action, refreshParticipant]);

  const parsedAmount = useMemo(() => {
    if (tokenDecimals === undefined || amount.trim().length === 0) return null;
    try {
      const value = parseUnits(amount.trim(), tokenDecimals);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [amount, tokenDecimals]);

  const parsedFundingAmount = useMemo(() => {
    if (tokenDecimals === undefined || fundingAmount.trim().length === 0) return null;

    try {
      const value = parseUnits(fundingAmount.trim(), tokenDecimals);
      const maxUint64 = (1n << 64n) - 1n;

      return value > 0n && value <= maxUint64 ? value : null;
    } catch {
      return null;
    }
  }, [fundingAmount, tokenDecimals]);

  const selectedAutopilotPlan = useMemo(
    () =>
      selectedPlanId === null
        ? null
        : (discoveredPlans.find(
            (candidate) => candidate.event.planId.toLowerCase() === selectedPlanId.toLowerCase(),
          ) ?? null),
    [discoveredPlans, selectedPlanId],
  );

  const canUseWallet =
    address !== undefined &&
    connection.chainId === VEILPOT_SEPOLIA_DEPLOYMENT.chainId &&
    publicClient !== undefined;

  const reserveParticipant = useCallback(async () => {
    if (!canUseWallet) return;

    setTransaction({ kind: "wallet", label: "Approve the registration reservation" });

    try {
      const hash = await writeMutation.mutateAsync(buildReserveParticipantSlotCall());
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== "success") {
        throw new Error("The registration reservation transaction reverted.");
      }

      setTransaction({
        kind: "included",
        label: "Registration slot reserved",
        hash,
      });

      try {
        await refreshParticipant();
      } catch (error: unknown) {
        setTransaction({
          kind: "included",
          label:
            "Registration slot reserved - participant refresh needs review. Do not resubmit it automatically. " +
            errorMessage(error),
          hash,
        });
      }
    } catch (error: unknown) {
      setTransaction({ kind: "error", message: errorMessage(error) });
    }
  }, [canUseWallet, publicClient, refreshParticipant, writeMutation]);

  const reviewPoolOperator = useCallback(async () => {
    setOperatorReview(null);
    setOperatorReviewNotice(null);
    setTransaction({ kind: "idle" });

    if (!operatorSubmissionStorageReady) {
      setTransaction({
        kind: "error",
        message:
          "Veilpot is still checking for a previously submitted Pool approval. No new review was prepared.",
      });
      return;
    }

    if (operatorSubmission !== null) {
      setTransaction({
        kind: "submitted",
        label: "A previous Pool operator transaction still requires exact verification",
        hash: operatorSubmission.hash,
        message:
          "Veilpot preserved the expected transaction identity. Verify this exact hash before preparing any later approval.",
      });
      return;
    }

    if (connection.status !== "connected") {
      setTransaction({
        kind: "error",
        message: "Connect the wallet that owns the authenticated Veilpot session before review.",
      });
      return;
    }

    const connectedAddress = connection.address;
    if (connectedAddress.toLowerCase() !== authenticatedAddress.toLowerCase()) {
      setTransaction({
        kind: "error",
        message: "The connected wallet does not own the authenticated Veilpot session.",
      });
      return;
    }

    if (connection.chainId !== VEILPOT_SEPOLIA_DEPLOYMENT.chainId || publicClient === undefined) {
      setTransaction({
        kind: "error",
        message: "Switch the authenticated wallet to Ethereum Sepolia before review.",
      });
      return;
    }

    setParticipantLoading(true);
    setParticipantError(null);

    try {
      const [liveParticipant, operatorResult] = await Promise.all([
        loadParticipant(connectedAddress),
        operatorQuery.refetch({ throwOnError: true }),
      ]);

      setParticipant(liveParticipant);

      if (
        liveParticipant?.state !== PARTICIPANT_STATE.RESERVED ||
        liveParticipant.owner.toLowerCase() !== connectedAddress.toLowerCase()
      ) {
        throw new Error(
          "A live RESERVED participant registration owned by the authenticated wallet is required.",
        );
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (BigInt(nowSeconds) >= liveParticipant.reservationExpiry) {
        throw new Error("The RESERVED participant registration has expired.");
      }

      if (operatorResult.data === true) {
        setOperatorReviewNotice(
          "The Pool is already an active operator. No new approval was prepared or requested.",
        );
        return;
      }

      if (operatorResult.data !== false) {
        throw new Error("The live Pool operator status could not be verified.");
      }

      setOperatorReview(
        createOperatorApprovalReview({
          holder: connectedAddress,
          token: VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
          operator: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          chainId: connection.chainId,
          participant: liveParticipant,
          nowSeconds,
        }),
      );
    } catch (error: unknown) {
      setParticipantError(errorMessage(error));
      setTransaction({ kind: "error", message: errorMessage(error) });
    } finally {
      setParticipantLoading(false);
    }
  }, [
    authenticatedAddress,
    connection,
    loadParticipant,
    operatorQuery,
    operatorSubmission,
    operatorSubmissionStorageReady,
    publicClient,
  ]);

  const openPoolOperatorWalletReview = useCallback(async () => {
    const review = operatorReview;

    if (!operatorSubmissionStorageReady) {
      setOperatorReview(null);
      setTransaction({
        kind: "error",
        message:
          "Veilpot has not finished checking preserved Pool approval state. No wallet request was opened.",
      });
      return;
    }

    if (operatorSubmission !== null) {
      setOperatorReview(null);
      setTransaction({
        kind: "submitted",
        label: "A previous Pool operator transaction still requires exact verification",
        hash: operatorSubmission.hash,
        message:
          "Verify the preserved transaction before any later approval. No wallet request was opened.",
      });
      return;
    }

    if (review === null) {
      setTransaction({
        kind: "error",
        message: "Prepare and inspect a fresh Pool operator review before opening the wallet.",
      });
      return;
    }

    if (connection.status !== "connected") {
      setOperatorReview(null);
      setTransaction({
        kind: "error",
        message: "The wallet connection changed. Prepare a new review.",
      });
      return;
    }

    const connectedAddress = connection.address;
    if (
      connectedAddress.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_SEPOLIA_DEPLOYMENT.chainId ||
      publicClient === undefined
    ) {
      setOperatorReview(null);
      setTransaction({
        kind: "error",
        message: "The authenticated wallet context changed. Prepare a new review.",
      });
      return;
    }

    const submission: { record: OperatorApprovalSubmissionRecord | null } = {
      record: null,
    };
    let unsubscribeSubmitted: (() => void) | null = null;

    setParticipantLoading(true);
    setParticipantError(null);

    try {
      const [liveParticipant, operatorResult] = await Promise.all([
        loadParticipant(connectedAddress),
        operatorQuery.refetch({ throwOnError: true }),
      ]);

      setParticipant(liveParticipant);

      if (operatorResult.data === true) {
        setOperatorReview(null);
        setOperatorReviewNotice(
          "The Pool became an active operator before wallet review. No transaction was requested.",
        );
        setTransaction({ kind: "idle" });
        return;
      }

      if (operatorResult.data !== false) {
        throw new Error("The live Pool operator status could not be verified.");
      }

      if (
        liveParticipant?.state !== PARTICIPANT_STATE.RESERVED ||
        liveParticipant.owner.toLowerCase() !== connectedAddress.toLowerCase()
      ) {
        setOperatorReview(null);
        throw new Error("The participant is no longer the reviewed RESERVED registration.");
      }

      const invalidReason = operatorApprovalReviewInvalidReason(review, {
        holder: connectedAddress,
        token: VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
        operator: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        chainId: connection.chainId,
        participant: liveParticipant,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        setOperatorReview(null);
        throw new Error(`${invalidReason} No replacement approval was generated.`);
      }

      unsubscribeSubmitted = subscribeToSetOperatorSubmitted((event) => {
        if (
          event.tokenAddress !== undefined &&
          event.tokenAddress.toLowerCase() !== review.token.toLowerCase()
        ) {
          return;
        }

        const record = createOperatorApprovalSubmissionRecord(review, event.txHash);
        submission.record = record;
        preserveOperatorSubmission(record);
        setTransaction({
          kind: "submitted",
          label: "Pool operator transaction submitted; awaiting a conclusive receipt",
          hash: record.hash,
          message:
            "The exact reviewed transaction identity is preserved. Do not submit another approval unless this record is reconciled.",
        });
      });

      setTransaction({
        kind: "wallet",
        label: "Review the frozen Pool operator approval in your wallet",
      });

      const result = await operatorMutation.mutateAsync({
        operator: review.operator,
        until: review.until,
      });

      if (
        submission.record !== null &&
        submission.record.hash.toLowerCase() !== result.txHash.toLowerCase()
      ) {
        throw new Error("The SDK returned a different hash from its submitted-transaction event.");
      }

      if (submission.record === null) {
        submission.record = createOperatorApprovalSubmissionRecord(review, result.txHash);
        preserveOperatorSubmission(submission.record);
      }

      const record = submission.record;
      let receiptStatus = transactionReceiptStatus(result.receipt);

      if (receiptStatus === "unknown") {
        const receipt = await publicClient.getTransactionReceipt({ hash: record.hash });
        receiptStatus = transactionReceiptStatus(receipt);
      }

      setOperatorReview(null);

      if (receiptStatus === "reverted") {
        clearOperatorSubmission();
        setTransaction({
          kind: "reverted",
          label: "Pool operator transaction reverted",
          hash: record.hash,
          message:
            "The exact transaction was mined with failure. A future approval still requires a new explicit review; Veilpot did not retry.",
        });
        return;
      }

      if (receiptStatus !== "success") {
        throw new Error("A successful transaction receipt could not be verified.");
      }

      const minedTransaction = await publicClient.getTransaction({ hash: record.hash });
      const transactionInvalidReason = operatorApprovalTransactionInvalidReason(record, {
        from: minedTransaction.from,
        to: minedTransaction.to,
        input: minedTransaction.input,
      });

      if (transactionInvalidReason !== null) {
        setTransaction({
          kind: "submitted",
          label: "The submitted Pool operator transaction failed exact identity verification",
          hash: record.hash,
          message: `${transactionInvalidReason} The transaction remains blocked from retry until manually resolved.`,
        });
        return;
      }

      setTransaction({
        kind: "included",
        label: "Exact reviewed Pool operator transaction included successfully",
        hash: record.hash,
      });

      try {
        const reconciled = await operatorQuery.refetch({ throwOnError: true });

        if (reconciled.data === true) {
          clearOperatorSubmission();
          setOperatorReviewNotice(
            "The exact reviewed transaction and live active Pool operator state were reconciled.",
          );
          return;
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        if (nowSeconds >= record.until) {
          clearOperatorSubmission();
          setOperatorReviewNotice(
            "The exact reviewed transaction was confirmed and has already expired. A later approval requires a completely new review.",
          );
          setTransaction({
            kind: "included",
            label: "Exact reviewed Pool operator transaction included; approval window has expired",
            hash: record.hash,
          });
          return;
        }

        setTransaction({
          kind: "included",
          label: "Exact reviewed Pool operator transaction included successfully",
          hash: record.hash,
          warning:
            "The approval is not live even though the exact expected transaction mined before its expiry. Keep this exact record blocked and do not resubmit automatically.",
        });
      } catch (error: unknown) {
        setTransaction({
          kind: "included",
          label: "Exact reviewed Pool operator transaction included successfully",
          hash: record.hash,
          warning:
            "Operator-state reconciliation failed after exact transaction inclusion. The preserved record remains blocked from retry. " +
            errorMessage(error),
        });
      }
    } catch (error: unknown) {
      if (submission.record !== null) {
        setOperatorReview(null);
        setTransaction({
          kind: "submitted",
          label: "Pool operator transaction may have been submitted or mined",
          hash: submission.record.hash,
          message:
            "Receipt or exact-state reconciliation failed after the transaction hash became available. Verify the preserved transaction before any retry. " +
            errorMessage(error),
        });
      } else {
        setTransaction({ kind: "error", message: errorMessage(error) });
      }
    } finally {
      unsubscribeSubmitted?.();
      setParticipantLoading(false);
    }
  }, [
    authenticatedAddress,
    clearOperatorSubmission,
    connection,
    loadParticipant,
    operatorMutation,
    operatorQuery,
    operatorReview,
    operatorSubmission,
    operatorSubmissionStorageReady,
    preserveOperatorSubmission,
    publicClient,
  ]);

  const verifyOperatorTransaction = useCallback(async () => {
    const record = operatorSubmission;
    if (!operatorSubmissionStorageReady || record === null) return;

    if (connection.status !== "connected") {
      setTransaction({
        kind: "submitted",
        label: "The preserved Pool operator transaction is still blocked",
        hash: record.hash,
        message:
          "Reconnect the authenticated wallet on Ethereum Sepolia to verify this exact transaction. No wallet request was opened.",
      });
      return;
    }

    const connectedAddress = connection.address;
    if (
      connectedAddress.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connectedAddress.toLowerCase() !== record.holder.toLowerCase() ||
      connection.chainId !== record.chainId ||
      record.token.toLowerCase() !== VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase() ||
      record.operator.toLowerCase() !== VEILPOT_SEPOLIA_DEPLOYMENT.pool.toLowerCase() ||
      publicClient === undefined
    ) {
      setTransaction({
        kind: "submitted",
        label: "The preserved Pool operator transaction is still blocked",
        hash: record.hash,
        message:
          "The authenticated wallet or deployment context does not match the preserved transaction. No wallet request was opened.",
      });
      return;
    }

    try {
      const [receipt, minedTransaction] = await Promise.all([
        publicClient.getTransactionReceipt({ hash: record.hash }),
        publicClient.getTransaction({ hash: record.hash }),
      ]);
      const receiptStatus = transactionReceiptStatus(receipt);

      const transactionInvalidReason = operatorApprovalTransactionInvalidReason(record, {
        from: minedTransaction.from,
        to: minedTransaction.to,
        input: minedTransaction.input,
      });

      if (transactionInvalidReason !== null) {
        setTransaction({
          kind: "submitted",
          label: "The preserved transaction failed exact identity verification",
          hash: record.hash,
          message: `${transactionInvalidReason} Keep this record blocked and do not submit another approval.`,
        });
        return;
      }

      if (receiptStatus === "reverted") {
        clearOperatorSubmission();
        setTransaction({
          kind: "reverted",
          label: "The exact Pool operator transaction was verified as reverted",
          hash: record.hash,
          message:
            "The mined receipt reported failure. A future approval still requires a new explicit review.",
        });
        return;
      }

      if (receiptStatus !== "success") {
        throw new Error("The receipt did not report a recognized success or reverted status.");
      }

      const operatorResult = await operatorQuery.refetch({ throwOnError: true });
      if (operatorResult.data === true) {
        clearOperatorSubmission();
        setOperatorReview(null);
        setOperatorReviewNotice(
          "The exact hash, transaction identity, successful receipt, and active Pool operator state were reconciled.",
        );
        setTransaction({
          kind: "included",
          label: "Exact Pool operator transaction fully reconciled",
          hash: record.hash,
        });
        return;
      }

      if (Math.floor(Date.now() / 1000) >= record.until) {
        clearOperatorSubmission();
        setOperatorReview(null);
        setOperatorReviewNotice(
          "The exact transaction was verified as successfully mined, and its reviewed approval window has expired. A future approval requires a new review.",
        );
        setTransaction({
          kind: "included",
          label: "Exact Pool operator transaction verified; approval window expired",
          hash: record.hash,
        });
        return;
      }

      setTransaction({
        kind: "included",
        label: "Exact Pool operator transaction has a successful matching receipt",
        hash: record.hash,
        warning:
          "The operator state is still not active before the reviewed expiry. Keep this record blocked and do not submit another approval automatically.",
      });
    } catch (error: unknown) {
      setTransaction({
        kind: "submitted",
        label: "The Pool operator transaction still requires exact verification",
        hash: record.hash,
        message:
          "No conclusive exact reconciliation was obtained. The transaction may have been submitted or mined; do not retry. " +
          errorMessage(error),
      });
    }
  }, [
    authenticatedAddress,
    clearOperatorSubmission,
    connection,
    operatorQuery,
    operatorSubmission,
    operatorSubmissionStorageReady,
    publicClient,
  ]);

  useEffect(() => {
    if (operatorReview === null) return;

    if (operatorSubmission !== null) {
      setOperatorReview(null);
      setOperatorReviewNotice(
        "A preserved Pool operator transaction must be reconciled before any new review.",
      );
      return;
    }

    if (localAction !== "deposit") {
      setOperatorReview(null);
      setOperatorReviewNotice("The Pool approval review was closed. Prepare a new review.");
      return;
    }

    if (operatorQuery.data === true) {
      setOperatorReview(null);
      setOperatorReviewNotice(
        "The Pool is now an active operator. The prepared approval was invalidated.",
      );
      return;
    }

    const invalidReason = operatorApprovalReviewInvalidReason(operatorReview, {
      holder: address,
      token: VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken,
      operator: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
      chainId: connection.chainId,
      participant,
      nowSeconds: Math.floor(Date.now() / 1000),
    });

    if (invalidReason !== null) {
      setOperatorReview(null);
      setOperatorReviewNotice(`${invalidReason} Prepare a new review.`);
    }
  }, [
    address,
    connection.chainId,
    localAction,
    operatorQuery.data,
    operatorReview,
    operatorSubmission,
    participant,
  ]);

  useEffect(() => {
    if (operatorReview === null) return;

    const staleAt = (operatorReview.preparedAt + OPERATOR_APPROVAL_REVIEW_MAX_AGE_SECONDS) * 1000;
    const delay = Math.max(0, staleAt - Date.now());

    const timeout = window.setTimeout(() => {
      setOperatorReview(null);
      setOperatorReviewNotice(
        "The Pool approval review became stale. No replacement expiry was generated; prepare a new review.",
      );
    }, delay);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [operatorReview]);

  const submitRegistrationDeposit = useCallback(async () => {
    if (
      !canUseWallet ||
      participant?.state !== PARTICIPANT_STATE.RESERVED ||
      parsedAmount === null
    ) {
      return;
    }

    setTransaction({ kind: "wallet", label: "Encrypting your amount locally" });

    try {
      const encrypted = await encryptPoolAmount(zama, parsedAmount, address);
      const depositNonce = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "nextDepositNonce",
        args: [address],
      });

      const descriptor = buildDepositCall({
        encrypted,
        depositor: address,
        reservationNonce: participant.reservationNonce,
        depositNonce,
      });

      setTransaction({
        kind: "wallet",
        label: "Review and approve the confidential deposit",
      });

      const hash = await writeMutation.mutateAsync(descriptor);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== "success") {
        throw new Error("The confidential deposit transaction reverted.");
      }

      setTransaction({
        kind: "included",
        label: "Deposit included — confidential activation settlement is still pending",
        hash,
      });
      try {
        await refreshParticipant();
      } catch (error: unknown) {
        setTransaction({
          kind: "included",
          label:
            "Deposit included - confidential activation settlement is still pending. Participant refresh needs review. Do not resubmit it automatically. " +
            errorMessage(error),
          hash,
        });
      }
    } catch (error: unknown) {
      setTransaction({ kind: "error", message: errorMessage(error) });
    }
  }, [
    address,
    canUseWallet,
    parsedAmount,
    participant,
    publicClient,
    refreshParticipant,
    writeMutation,
    zama,
  ]);

  const submitWithdrawal = useCallback(async () => {
    if (!canUseWallet || participant?.state !== PARTICIPANT_STATE.ACTIVE || parsedAmount === null) {
      return;
    }

    setTransaction({ kind: "wallet", label: "Encrypting your withdrawal request locally" });

    try {
      const encrypted = await encryptPoolAmount(zama, parsedAmount, address);
      const withdrawalNonce = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "nextWithdrawNonce",
        args: [address],
      });

      const descriptor = buildWithdrawalCall({
        encrypted,
        caller: address,
        registrationVersion: participant.registrationVersion,
        reservationNonce: participant.reservationNonce,
        withdrawalNonce,
      });

      setTransaction({
        kind: "wallet",
        label: "Review and approve the confidential withdrawal",
      });

      const hash = await writeMutation.mutateAsync(descriptor);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== "success") {
        throw new Error("The confidential withdrawal transaction reverted.");
      }

      setTransaction({
        kind: "included",
        label: "Withdrawal included — confidential state updates are being finalized",
        hash,
      });
      await refreshParticipant();
    } catch (error: unknown) {
      setTransaction({ kind: "error", message: errorMessage(error) });
    }
  }, [
    address,
    canUseWallet,
    parsedAmount,
    participant,
    publicClient,
    refreshParticipant,
    writeMutation,
    zama,
  ]);

  const reviewPlan = useCallback(() => {
    const count = Number(plan.executionCount);
    const windowHours = Number(plan.windowHours);

    if (
      plan.name.trim().length < 2 ||
      plan.amount.trim().length === 0 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 1024 ||
      !Number.isFinite(windowHours) ||
      windowHours <= 0 ||
      windowHours > 24
    ) {
      setTransaction({
        kind: "error",
        message:
          "Complete the pot name, contribution amount, execution count (1–1024), and a valid execution window before review.",
      });
      return;
    }

    if (tokenDecimals !== undefined) {
      try {
        if (parseUnits(plan.amount, tokenDecimals) <= 0n) {
          throw new Error("Contribution amount must be greater than zero.");
        }
        if (
          plan.lifetimeCap.trim().length > 0 &&
          parseUnits(plan.lifetimeCap, tokenDecimals) <= 0n
        ) {
          throw new Error("Lifetime cap must be greater than zero.");
        }
      } catch (error: unknown) {
        setTransaction({ kind: "error", message: errorMessage(error) });
        return;
      }
    }

    setTransaction({ kind: "idle" });
    setPlanReview(true);
  }, [plan, tokenDecimals]);

  const createAutopilotPlan = useCallback(async () => {
    if (!planReview) return;

    if (!canUseWallet) {
      setTransaction({
        kind: "error",
        message: "Connect the authenticated wallet on Ethereum Sepolia before creating a plan.",
      });
      return;
    }

    if (participant?.state !== PARTICIPANT_STATE.ACTIVE) {
      setTransaction({
        kind: "error",
        message: "Autopilot requires the connected wallet to have an ACTIVE Veilpot participant.",
      });
      return;
    }

    if (tokenDecimals === undefined) {
      setTransaction({
        kind: "error",
        message: "Confidential-token metadata is not available yet. Nothing was submitted.",
      });
      return;
    }

    if (plan.lifetimeCap.trim().length === 0) {
      setTransaction({
        kind: "error",
        message: "Set an explicit lifetime authorization cap before wallet approval.",
      });
      return;
    }

    let periodAmount: bigint;
    let lifetimeCap: bigint;

    try {
      periodAmount = parseUnits(plan.amount.trim(), tokenDecimals);
      lifetimeCap = parseUnits(plan.lifetimeCap.trim(), tokenDecimals);

      const maxUint64 = (1n << 64n) - 1n;

      if (
        periodAmount <= 0n ||
        lifetimeCap <= 0n ||
        periodAmount > maxUint64 ||
        lifetimeCap > maxUint64
      ) {
        throw new RangeError("Autopilot encrypted amounts must be positive uint64 values.");
      }
    } catch (error: unknown) {
      setTransaction({ kind: "error", message: errorMessage(error) });
      return;
    }

    setCreatedPlan(null);
    setPlanPersistenceWarning(null);

    try {
      setTransaction({
        kind: "wallet",
        label: "Preparing the exact Autopilot policy from live Sepolia state",
      });

      const planNonce = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
        abi: VEILPOT_AUTOPILOT_VAULT_ABI,
        functionName: "nextPlanNonce",
        args: [address],
      });

      const planId = await publicClient.readContract(
        buildAutopilotPlanIdCall(
          address,
          participant.registrationVersion,
          participant.reservationNonce,
          planNonce,
        ),
      );

      const windows = buildRecurringAutopilotWindows({
        cadence: plan.cadence,
        day: plan.day,
        time: plan.time,
        windowHours: Number(plan.windowHours),
        executionCount: Number(plan.executionCount),
      });

      const schedule = buildAutopilotSchedule(planId, windows);

      setTransaction({
        kind: "wallet",
        label: "Encrypting period amount and lifetime cap with one shared proof",
      });

      const encrypted = await encryptAutopilotPlanAmounts(zama, periodAmount, lifetimeCap, address);

      const descriptor = buildCreateAutopilotPlanCall({
        encrypted,
        owner: address,
        slotIndex: participant.slotIndex,
        registrationVersion: participant.registrationVersion,
        reservationNonce: participant.reservationNonce,
        planNonce,
        scheduleRoot: schedule.root,
        executionCount: schedule.executionCount,
      });

      setTransaction({
        kind: "wallet",
        label: "Review and approve the exact Autopilot plan creation",
      });

      const hash = await writeMutation.mutateAsync(descriptor);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== "success") {
        throw new Error("The Autopilot plan-creation transaction reverted.");
      }

      setTransaction({
        kind: "included",
        label: "Autopilot plan creation included — reconciling live Vault state",
        hash,
      });

      const warnings: string[] = [];
      let state = "Included; live reconciliation pending";

      try {
        const metadata = await publicClient.readContract(buildAutopilotPlanMetadataCall(planId));

        if (
          metadata[1].toLowerCase() !== address.toLowerCase() ||
          metadata[6].toLowerCase() !== schedule.root.toLowerCase() ||
          metadata[7] !== schedule.executionCount
        ) {
          throw new Error("Live plan metadata does not match the prepared Autopilot policy.");
        }

        state = autopilotPlanStateName(metadata[0]);
      } catch (error: unknown) {
        warnings.push(
          `The plan transaction was mined, but live state reconciliation needs review. Do not resubmit it automatically. ${errorMessage(error)}`,
        );
      }

      try {
        saveAutopilotScheduleRecord(window.localStorage, {
          version: 1,
          chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId,
          vault: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
          owner: address,
          planId,
          scheduleRoot: schedule.root,
          executionCount: schedule.executionCount,
          creationTxHash: hash,
          windows: schedule.windows.map((window) => ({
            index: window.index.toString(),
            notBefore: window.notBefore.toString(),
            notAfter: window.notAfter.toString(),
            proof: window.proof,
          })),
        });
      } catch (error: unknown) {
        warnings.push(
          `The plan was mined, but this browser could not persist its public schedule proofs. Do not recreate the plan. ${errorMessage(error)}`,
        );
      }

      setPlanPersistenceWarning(warnings.length > 0 ? warnings.join(" ") : null);
      setCreatedPlan({
        planId,
        scheduleRoot: schedule.root,
        executionCount: schedule.executionCount,
        state,
        transactionHash: hash,
        nextWindow: {
          notBefore: schedule.windows[0].notBefore,
          notAfter: schedule.windows[0].notAfter,
        },
      });

      setTransaction({
        kind: "included",
        label: "Autopilot plan created — funding has not been sent",
        hash,
      });

      try {
        await refreshParticipant();
      } catch (error: unknown) {
        setPlanPersistenceWarning((current) => {
          const warning = `The plan transaction was mined, but participant-state refresh needs review. Do not resubmit it automatically. ${errorMessage(error)}`;

          return current ? `${current} ${warning}` : warning;
        });
      }
    } catch (error: unknown) {
      setTransaction({ kind: "error", message: errorMessage(error) });
    }
  }, [
    address,
    canUseWallet,
    participant,
    plan,
    planReview,
    publicClient,
    refreshParticipant,
    tokenDecimals,
    writeMutation,
    zama,
  ]);

  const refreshAutopilotPlans = useCallback(async () => {
    if (
      address === undefined ||
      publicClient === undefined ||
      connection.chainId !== VEILPOT_SEPOLIA_DEPLOYMENT.chainId
    ) {
      setAutopilotDiscoveryError(
        "Connect the authenticated wallet on Ethereum Sepolia before discovering Autopilot plans.",
      );
      return;
    }

    setAutopilotDiscoveryLoading(true);
    setAutopilotDiscoveryError(null);
    setAutopilotScheduleWarning(null);
    setAutopilotSnapshotBlock(null);
    setDiscoveredPlans([]);
    setSelectedPlanId(null);
    setFundingAmount("");
    setFundingReview(false);
    setFundingIncluded(null);
    setFundingWarning(null);

    try {
      const snapshot = await publicClient.getBlock({ blockTag: "latest" });
      const snapshotBlock = snapshot.number;
      const snapshotHash = snapshot.hash;
      const deploymentBlock = BigInt(VEILPOT_SEPOLIA_DEPLOYMENT.blocks.vault);

      if (snapshotBlock < deploymentBlock) {
        throw new Error("The Sepolia RPC snapshot predates the frozen Autopilot Vault deployment.");
      }

      const nextPlanNonce = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
        abi: VEILPOT_AUTOPILOT_VAULT_ABI,
        functionName: "nextPlanNonce",
        args: [address],
        blockNumber: snapshotBlock,
      });

      const events: AutopilotPlanCreatedEventSnapshot[] = [];
      let fromBlock = deploymentBlock;

      while (fromBlock <= snapshotBlock) {
        const proposedEnd = fromBlock + AUTOPILOT_EVENT_SCAN_CHUNK_BLOCKS - 1n;
        const toBlock = proposedEnd > snapshotBlock ? snapshotBlock : proposedEnd;

        const logs = await publicClient.getContractEvents({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
          abi: VEILPOT_AUTOPILOT_VAULT_ABI,
          eventName: "PlanCreated",
          args: { owner: address },
          fromBlock,
          toBlock,
          strict: true,
        });

        for (const log of logs) {
          events.push({
            planId: log.args.planId,
            owner: log.args.owner,
            planNonce: log.args.planNonce,
            slotIndex: log.args.slotIndex,
            registrationVersion: log.args.registrationVersion,
            reservationNonce: log.args.reservationNonce,
            executionCount: log.args.executionCount,
            scheduleRoot: log.args.scheduleRoot,
          });
        }

        fromBlock = toBlock + 1n;
      }

      const orderedEvents = validateAutopilotDiscoveryEvents(events, address, nextPlanNonce);

      let scheduleRecords: readonly PersistedAutopilotScheduleRecord[] = [];
      let localScheduleWarning: string | null = null;

      try {
        scheduleRecords = loadAutopilotScheduleRecords(window.localStorage, {
          chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId,
          vault: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
          owner: address,
        });
      } catch (error: unknown) {
        localScheduleWarning =
          "Live on-chain plan discovery succeeded, but this browser has malformed or unreadable public schedule storage. Funding does not require those local proofs. " +
          errorMessage(error);
      }

      const plans: DiscoveredAutopilotPlan[] = [];

      for (const event of orderedEvents) {
        const row = await publicClient.readContract({
          ...buildAutopilotPlanMetadataCall(event.planId),
          blockNumber: snapshotBlock,
        });

        const metadata: AutopilotPlanMetadataSnapshot = {
          state: row[0],
          owner: row[1],
          slotIndex: row[2],
          registrationVersion: row[3],
          reservationNonce: row[4],
          planNonce: row[5],
          scheduleRoot: row[6],
          executionCount: row[7],
          nextExecutionIndex: row[8],
          lastWindowNotAfter: row[9],
        };

        reconcileAutopilotPlanMetadata(event, metadata);

        let schedule: PersistedAutopilotScheduleRecord | null = null;

        try {
          schedule = findAutopilotScheduleRecord(scheduleRecords, {
            chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId,
            vault: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
            owner: address,
            planId: event.planId,
            scheduleRoot: event.scheduleRoot,
            executionCount: event.executionCount,
          });
        } catch (error: unknown) {
          localScheduleWarning ??=
            "A local public schedule record could not be trusted, so Veilpot ignored it. The verified on-chain plan remains discoverable and fundable. " +
            errorMessage(error);
        }

        plans.push({
          event,
          metadata,
          state: autopilotPlanStateName(metadata.state),
          schedule,
        });
      }

      const confirmation = await publicClient.getBlock({ blockNumber: snapshotBlock });

      if (confirmation.hash !== snapshotHash) {
        throw new Error(
          "The Sepolia discovery snapshot changed during the scan. Refresh discovery before selecting a plan.",
        );
      }

      setDiscoveredPlans(plans);
      setAutopilotSnapshotBlock(snapshotBlock);
      setAutopilotScheduleWarning(localScheduleWarning);
    } catch (error: unknown) {
      setDiscoveredPlans([]);
      setAutopilotSnapshotBlock(null);
      setAutopilotDiscoveryError(errorMessage(error));
    } finally {
      setAutopilotDiscoveryLoading(false);
    }
  }, [address, connection.chainId, publicClient]);

  const reviewAutopilotFunding = useCallback(() => {
    if (address === undefined || connection.chainId !== VEILPOT_SEPOLIA_DEPLOYMENT.chainId) {
      setTransaction({
        kind: "error",
        message: "Connect the authenticated wallet on Ethereum Sepolia before reviewing funding.",
      });
      return;
    }

    if (selectedAutopilotPlan === null) {
      setTransaction({
        kind: "error",
        message: "Select one live Autopilot plan owned by the connected wallet.",
      });
      return;
    }

    if (selectedAutopilotPlan.event.owner.toLowerCase() !== address.toLowerCase()) {
      setTransaction({
        kind: "error",
        message: "The selected Autopilot plan does not belong to the connected wallet.",
      });
      return;
    }

    if (!autopilotPlanCanReceiveFunding(selectedAutopilotPlan.metadata.state)) {
      setTransaction({
        kind: "error",
        message: "REVOKED and COMPLETED Autopilot plans cannot receive funding.",
      });
      return;
    }

    if (parsedFundingAmount === null) {
      setTransaction({
        kind: "error",
        message: "Enter a positive confidential funding amount that fits uint64.",
      });
      return;
    }

    setFundingIncluded(null);
    setFundingWarning(null);
    setFundingReview(true);
    setTransaction({ kind: "idle" });
  }, [address, connection.chainId, parsedFundingAmount, selectedAutopilotPlan]);

  const fundAutopilotPlan = useCallback(async () => {
    if (
      !fundingReview ||
      address === undefined ||
      publicClient === undefined ||
      connection.chainId !== VEILPOT_SEPOLIA_DEPLOYMENT.chainId ||
      selectedAutopilotPlan === null ||
      parsedFundingAmount === null
    ) {
      setTransaction({
        kind: "error",
        message: "Review the exact selected plan and funding amount before wallet approval.",
      });
      return;
    }

    if (selectedAutopilotPlan.event.owner.toLowerCase() !== address.toLowerCase()) {
      setTransaction({
        kind: "error",
        message: "The selected Autopilot plan no longer belongs to the connected wallet context.",
      });
      return;
    }

    setFundingIncluded(null);
    setFundingWarning(null);

    let submittedHash: Hex | null = null;

    try {
      const row = await publicClient.readContract(
        buildAutopilotPlanMetadataCall(selectedAutopilotPlan.event.planId),
      );

      const latestMetadata: AutopilotPlanMetadataSnapshot = {
        state: row[0],
        owner: row[1],
        slotIndex: row[2],
        registrationVersion: row[3],
        reservationNonce: row[4],
        planNonce: row[5],
        scheduleRoot: row[6],
        executionCount: row[7],
        nextExecutionIndex: row[8],
        lastWindowNotAfter: row[9],
      };

      reconcileAutopilotPlanMetadata(selectedAutopilotPlan.event, latestMetadata);

      if (!autopilotPlanCanReceiveFunding(latestMetadata.state)) {
        throw new Error(
          "The selected Autopilot plan is now REVOKED or COMPLETED. Funding was not submitted.",
        );
      }

      setTransaction({
        kind: "wallet",
        label: "Encrypting the reviewed Autopilot funding amount locally",
      });

      const encrypted = await encryptAutopilotFundingAmount(zama, parsedFundingAmount, address);

      const descriptor = buildAutopilotFundingCall({
        encrypted,
        owner: address,
        planId: selectedAutopilotPlan.event.planId,
      });

      setTransaction({
        kind: "wallet",
        label: "Review and approve the exact confidential Autopilot funding call",
      });

      const hash = await writeMutation.mutateAsync(descriptor);
      submittedHash = hash;

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== "success") {
        throw new Error("The Autopilot funding transaction was mined but reverted.");
      }

      setFundingIncluded({
        planId: selectedAutopilotPlan.event.planId,
        transactionHash: hash,
      });

      setFundingReview(false);
      setFundingAmount("");

      setTransaction({
        kind: "included",
        label:
          "Autopilot funding transaction included — the confidential transferred amount remains private",
        hash,
      });

      try {
        const reconciledRow = await publicClient.readContract(
          buildAutopilotPlanMetadataCall(selectedAutopilotPlan.event.planId),
        );

        const reconciledMetadata: AutopilotPlanMetadataSnapshot = {
          state: reconciledRow[0],
          owner: reconciledRow[1],
          slotIndex: reconciledRow[2],
          registrationVersion: reconciledRow[3],
          reservationNonce: reconciledRow[4],
          planNonce: reconciledRow[5],
          scheduleRoot: reconciledRow[6],
          executionCount: reconciledRow[7],
          nextExecutionIndex: reconciledRow[8],
          lastWindowNotAfter: reconciledRow[9],
        };

        reconcileAutopilotPlanMetadata(selectedAutopilotPlan.event, reconciledMetadata);

        setDiscoveredPlans((current) =>
          current.map((candidate) =>
            candidate.event.planId.toLowerCase() ===
            selectedAutopilotPlan.event.planId.toLowerCase()
              ? {
                  ...candidate,
                  metadata: reconciledMetadata,
                  state: autopilotPlanStateName(reconciledMetadata.state),
                }
              : candidate,
          ),
        );
      } catch (error: unknown) {
        setFundingWarning(
          "The funding transaction was mined, but later live-state reconciliation needs review. Do not retry automatically. " +
            errorMessage(error),
        );
      }
    } catch (error: unknown) {
      if (submittedHash !== null) {
        setTransaction({
          kind: "error",
          message:
            "A funding transaction was submitted with hash " +
            submittedHash +
            ". Receipt confirmation or execution did not complete successfully. Verify that exact hash before any manual retry. Nothing was resubmitted automatically. " +
            errorMessage(error),
        });
      } else {
        setTransaction({ kind: "error", message: errorMessage(error) });
      }
    }
  }, [
    address,
    connection.chainId,
    fundingReview,
    parsedFundingAmount,
    publicClient,
    selectedAutopilotPlan,
    writeMutation,
    zama,
  ]);

  if (action === null) return null;

  const isDeposit = localAction === "deposit";
  const isWithdraw = localAction === "withdraw";
  const isPlan = localAction === "plan";

  const participantName = participantStatus(participant);
  const wrongNetwork =
    connection.status === "connected" && connection.chainId !== VEILPOT_SEPOLIA_DEPLOYMENT.chainId;

  const sheetTitle = isPlan
    ? autopilotMode === "fund"
      ? "Discover the exact plan before you fund it."
      : "Build the plan before you approve it."
    : isDeposit
      ? "Fund your first private savings position."
      : "Request a private withdrawal.";

  const Icon = isPlan ? CalendarClock : isDeposit ? Landmark : WalletCards;

  return (
    <div
      className="action-sheet-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-sheet-title"
    >
      <button
        className="action-sheet-scrim"
        type="button"
        aria-label="Close financial action"
        onClick={onClose}
      />

      <section className="action-sheet human-action-sheet financial-sheet">
        <header className="action-sheet-head">
          <span className="action-sheet-icon">
            <Icon size={20} />
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="Close financial action"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="action-sheet-copy">
          <span className="eyebrow">
            {isPlan ? "NEW SAVING POT" : isDeposit ? "PRIVATE DEPOSIT" : "PRIVATE WITHDRAWAL"}
          </span>
          <h2 id="action-sheet-title">{sheetTitle}</h2>
          <p>
            {isPlan
              ? "Enter the values now. Veilpot keeps preparation separate from wallet approval, encryption, and on-chain settlement."
              : "Veilpot reads your live Sepolia participant state first and only exposes protocol actions valid for that state."}
          </p>
        </div>

        <div className="human-flow-track" aria-label="Action stages">
          {stages.map((stage, index) => (
            <div
              className={
                index === 0 || (transaction.kind === "wallet" && index <= 2)
                  ? "human-flow-stage active"
                  : transaction.kind === "included"
                    ? "human-flow-stage active"
                    : "human-flow-stage"
              }
              key={stage}
            >
              <span>{String(index + 1)}</span>
              <strong>{stage}</strong>
              {index < stages.length - 1 ? <i /> : null}
            </div>
          ))}
        </div>

        {!isPlan ? (
          <div className="financial-live-status">
            <div>
              <span>Wallet</span>
              <strong>{address === undefined ? "Not connected" : compactAddress(address)}</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>{wrongNetwork ? "Switch to Sepolia" : "Ethereum Sepolia"}</strong>
            </div>
            <div>
              <span>Participant</span>
              <strong>
                {participantLoading ? "Checking…" : (participantError ?? participantName)}
              </strong>
            </div>
          </div>
        ) : null}

        {isPlan ? (
          <div className="financial-form">
            <div className="financial-form-grid">
              <button
                className={
                  autopilotMode === "create"
                    ? "financial-primary-button"
                    : "financial-secondary-button"
                }
                type="button"
                aria-pressed={autopilotMode === "create"}
                onClick={() => {
                  setAutopilotMode("create");
                  setPlanReview(false);
                  setFundingReview(false);
                  setTransaction({ kind: "idle" });
                }}
              >
                Create plan
              </button>

              <button
                className={
                  autopilotMode === "fund"
                    ? "financial-primary-button"
                    : "financial-secondary-button"
                }
                type="button"
                aria-pressed={autopilotMode === "fund"}
                onClick={() => {
                  setAutopilotMode("fund");
                  setPlanReview(false);
                  setFundingReview(false);
                  setTransaction({ kind: "idle" });
                }}
              >
                Fund existing
              </button>
            </div>

            {autopilotMode === "create" ? (
              !planReview ? (
                <>
                  <label>
                    <span>Pot name</span>
                    <input
                      type="text"
                      value={plan.name}
                      placeholder="Emergency fund"
                      maxLength={48}
                      onChange={(event) => {
                        setPlan((current) => ({ ...current, name: event.target.value }));
                      }}
                    />
                  </label>

                  <div className="financial-form-grid">
                    <label>
                      <span>Contribution amount</span>
                      <div className="financial-input-unit">
                        <input
                          inputMode="decimal"
                          value={plan.amount}
                          placeholder="25.00"
                          onChange={(event) => {
                            setPlan((current) => ({ ...current, amount: event.target.value }));
                          }}
                        />
                        <small>{metadataQuery.data?.symbol ?? "token"}</small>
                      </div>
                    </label>
                    <label>
                      <span>Cadence</span>
                      <select
                        value={plan.cadence}
                        onChange={(event) => {
                          const cadence = event.target.value === "monthly" ? "monthly" : "weekly";
                          setPlan((current) => ({
                            ...current,
                            cadence,
                            day: cadence === "weekly" ? "Friday" : "1",
                          }));
                        }}
                      >
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                  </div>

                  <div className="financial-form-grid">
                    <label>
                      <span>{plan.cadence === "weekly" ? "Day" : "Calendar day (1–28)"}</span>
                      <select
                        value={plan.day}
                        onChange={(event) => {
                          setPlan((current) => ({
                            ...current,
                            day: event.target.value,
                          }));
                        }}
                      >
                        {plan.cadence === "weekly"
                          ? WEEKDAYS.map((day) => (
                              <option value={day} key={day}>
                                {day}
                              </option>
                            ))
                          : MONTH_DAYS.map((day) => (
                              <option value={day} key={day}>
                                {day}
                              </option>
                            ))}
                      </select>
                      <small className="financial-field-help">
                        {plan.cadence === "weekly"
                          ? "Choose the exact weekday for each contribution window."
                          : "Days 1–28 keep the recurring schedule valid in every month."}
                      </small>
                    </label>
                    <label>
                      <span>Start time (UTC)</span>
                      <input
                        type="time"
                        value={plan.time}
                        onChange={(event) => {
                          setPlan((current) => ({ ...current, time: event.target.value }));
                        }}
                      />
                    </label>
                  </div>

                  <div className="financial-form-grid">
                    <label>
                      <span>Execution window (hours)</span>
                      <input
                        type="number"
                        min="1"
                        max="24"
                        step="1"
                        value={plan.windowHours}
                        onChange={(event) => {
                          setPlan((current) => ({
                            ...current,
                            windowHours: event.target.value,
                          }));
                        }}
                      />
                    </label>
                    <label>
                      <span>Number of contributions</span>
                      <input
                        type="number"
                        min="1"
                        max="1024"
                        step="1"
                        value={plan.executionCount}
                        onChange={(event) => {
                          setPlan((current) => ({
                            ...current,
                            executionCount: event.target.value,
                          }));
                        }}
                      />
                    </label>
                  </div>

                  <label>
                    <span>Lifetime authorization cap</span>
                    <div className="financial-input-unit">
                      <input
                        inputMode="decimal"
                        value={plan.lifetimeCap}
                        placeholder="Optional until final review"
                        onChange={(event) => {
                          setPlan((current) => ({
                            ...current,
                            lifetimeCap: event.target.value,
                          }));
                        }}
                      />
                      <small>{metadataQuery.data?.symbol ?? "token"}</small>
                    </div>
                  </label>

                  <button className="financial-primary-button" type="button" onClick={reviewPlan}>
                    Review plan <ArrowRight size={16} />
                  </button>
                </>
              ) : (
                <div className="financial-plan-review">
                  <button
                    className="financial-back-button"
                    type="button"
                    onClick={() => {
                      setPlanReview(false);
                    }}
                  >
                    <ArrowLeft size={15} /> Edit values
                  </button>
                  <div className="action-review-table">
                    <div>
                      <span>Pot</span>
                      <strong>{plan.name}</strong>
                    </div>
                    <div>
                      <span>Contribution</span>
                      <strong>
                        {plan.amount} {metadataQuery.data?.symbol ?? "token"}
                      </strong>
                    </div>
                    <div>
                      <span>Schedule</span>
                      <strong>
                        {plan.cadence} · {plan.day} · {plan.time} UTC
                      </strong>
                    </div>
                    <div>
                      <span>Execution window</span>
                      <strong>{plan.windowHours} hour(s)</strong>
                    </div>
                    <div>
                      <span>Contributions</span>
                      <strong>{plan.executionCount}</strong>
                    </div>
                    <div>
                      <span>Lifetime cap</span>
                      <strong>
                        {plan.lifetimeCap.trim().length > 0
                          ? `${plan.lifetimeCap} ${metadataQuery.data?.symbol ?? "token"}`
                          : "Set during final Autopilot authorization"}
                      </strong>
                    </div>
                  </div>
                  <div className="action-safety-note">
                    <ShieldCheck size={17} />
                    <p>
                      <strong>Exact policy preparation.</strong> Veilpot will read the live owner
                      plan nonce, derive the frozen plan ID, build the deterministic SDK Merkle
                      schedule, encrypt period amount and lifetime cap under one shared proof, and
                      only then ask your wallet to approve the exact creation call. Schedule times
                      are committed in UTC.
                    </p>
                  </div>

                  <div className="financial-live-status">
                    <div>
                      <span>Participant</span>
                      <strong>
                        {participantLoading ? "Checking…" : (participantError ?? participantName)}
                      </strong>
                    </div>
                    <div>
                      <span>Network</span>
                      <strong>{wrongNetwork ? "Switch to Sepolia" : "Ethereum Sepolia"}</strong>
                    </div>
                    <div>
                      <span>Lifetime cap</span>
                      <strong>
                        {plan.lifetimeCap.trim().length > 0
                          ? `${plan.lifetimeCap} ${metadataQuery.data?.symbol ?? "token"}`
                          : "Required before approval"}
                      </strong>
                    </div>
                  </div>

                  <button
                    className="financial-primary-button"
                    type="button"
                    disabled={
                      !canUseWallet ||
                      participant?.state !== PARTICIPANT_STATE.ACTIVE ||
                      plan.lifetimeCap.trim().length === 0 ||
                      writeMutation.isPending ||
                      transaction.kind === "wallet"
                    }
                    onClick={() => {
                      void createAutopilotPlan();
                    }}
                  >
                    Create Autopilot plan <LockKeyhole size={15} />
                  </button>

                  {createdPlan !== null ? (
                    <div className="financial-state-card">
                      <CircleCheck size={20} />
                      <div>
                        <strong>Autopilot plan created</strong>
                        <p>
                          Plan {createdPlan.planId.slice(0, 10)}…{createdPlan.planId.slice(-8)} ·{" "}
                          {createdPlan.state}
                        </p>
                        <span>
                          Schedule root {createdPlan.scheduleRoot.slice(0, 10)}…
                          {createdPlan.scheduleRoot.slice(-8)}
                        </span>
                        <span>
                          {createdPlan.executionCount} committed windows · first window{" "}
                          {unixTimeLabel(createdPlan.nextWindow.notBefore)} –{" "}
                          {unixTimeLabel(createdPlan.nextWindow.notAfter)}
                        </span>
                        <p>
                          Funding was not sent automatically. Use Fund existing to discover this
                          live plan again and review a separate confidential wallet action.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {planPersistenceWarning !== null ? (
                    <div className="financial-state-card warning">
                      <ShieldCheck size={20} />
                      <div>
                        <strong>Plan was mined; do not recreate it automatically</strong>
                        <p>{planPersistenceWarning}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            ) : (
              <div className="financial-plan-review">
                <div className="action-safety-note">
                  <ShieldCheck size={17} />
                  <p>
                    <strong>Canonical live discovery.</strong> Veilpot pins one Sepolia block, scans
                    owner-indexed PlanCreated events from the frozen Vault deployment in bounded
                    ranges, checks completeness against the owner plan nonce, and reconciles every
                    result against live public plan metadata. No private amount is decrypted.
                  </p>
                </div>

                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={
                    !canUseWallet ||
                    autopilotDiscoveryLoading ||
                    writeMutation.isPending ||
                    transaction.kind === "wallet"
                  }
                  onClick={() => {
                    void refreshAutopilotPlans();
                  }}
                >
                  {autopilotDiscoveryLoading ? (
                    <>
                      <LoaderCircle size={15} /> Discovering live plans…
                    </>
                  ) : (
                    <>
                      <RefreshCw size={15} /> Discover my live plans
                    </>
                  )}
                </button>

                {autopilotSnapshotBlock !== null ? (
                  <div className="financial-live-status">
                    <div>
                      <span>Discovery snapshot</span>
                      <strong>Block {autopilotSnapshotBlock.toString()}</strong>
                    </div>
                    <div>
                      <span>Owner plans</span>
                      <strong>{discoveredPlans.length}</strong>
                    </div>
                    <div>
                      <span>Private values</span>
                      <strong>Not decrypted</strong>
                    </div>
                  </div>
                ) : null}

                {autopilotDiscoveryError !== null ? (
                  <div className="financial-state-card warning">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Plan discovery failed closed</strong>
                      <p>{autopilotDiscoveryError}</p>
                    </div>
                  </div>
                ) : null}

                {autopilotScheduleWarning !== null ? (
                  <div className="financial-state-card warning">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Local public proofs are unavailable or untrusted</strong>
                      <p>{autopilotScheduleWarning}</p>
                    </div>
                  </div>
                ) : null}

                {autopilotSnapshotBlock !== null && discoveredPlans.length === 0 ? (
                  <div className="financial-state-card">
                    <CircleDashed size={20} />
                    <div>
                      <strong>No owner Autopilot plans at this snapshot</strong>
                      <p>
                        No PlanCreated history matched the connected wallet through the pinned
                        block. Nothing is inferred or fabricated.
                      </p>
                    </div>
                  </div>
                ) : null}

                {discoveredPlans.map((candidate) => {
                  const selected =
                    selectedPlanId !== null &&
                    selectedPlanId.toLowerCase() === candidate.event.planId.toLowerCase();

                  const fundable = autopilotPlanCanReceiveFunding(candidate.metadata.state);

                  return (
                    <div className="financial-state-card" key={candidate.event.planId}>
                      {selected ? <CircleCheck size={20} /> : <CircleDashed size={20} />}
                      <div>
                        <strong>
                          Plan {candidate.event.planId.slice(0, 10)}…
                          {candidate.event.planId.slice(-8)}
                        </strong>
                        <p>
                          {candidate.state} · owner nonce {candidate.event.planNonce.toString()} ·
                          next window index {candidate.metadata.nextExecutionIndex}/
                          {candidate.metadata.executionCount}
                        </p>
                        <span>
                          Schedule root {candidate.event.scheduleRoot.slice(0, 10)}…
                          {candidate.event.scheduleRoot.slice(-8)}
                        </span>
                        <span>
                          {candidate.schedule === null
                            ? "Public schedule proofs are not stored in this browser"
                            : "Public schedule proofs matched this live plan exactly"}
                        </span>

                        {fundable ? (
                          <button
                            className="financial-secondary-button"
                            type="button"
                            onClick={() => {
                              setSelectedPlanId(candidate.event.planId);
                              setFundingAmount("");
                              setFundingReview(false);
                              setFundingIncluded(null);
                              setFundingWarning(null);
                              setTransaction({ kind: "idle" });
                            }}
                          >
                            {selected ? "Selected for funding" : "Select this plan"}
                          </button>
                        ) : (
                          <span className="financial-field-help">
                            REVOKED and COMPLETED plans cannot receive new funding.
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {selectedAutopilotPlan !== null ? (
                  <>
                    <label>
                      <span>Confidential funding amount</span>
                      <div className="financial-input-unit">
                        <input
                          inputMode="decimal"
                          value={fundingAmount}
                          placeholder="25.00"
                          onChange={(event) => {
                            setFundingAmount(event.target.value);
                            setFundingReview(false);
                            setFundingIncluded(null);
                            setFundingWarning(null);
                          }}
                        />
                        <small>{tokenSymbol}</small>
                      </div>
                      <small className="financial-field-help">
                        This value is entered for the selected plan and encrypted only after the
                        exact funding review below. Discovery never decrypts private plan values.
                      </small>
                    </label>

                    <button
                      className="financial-primary-button"
                      type="button"
                      disabled={
                        parsedFundingAmount === null ||
                        !canUseWallet ||
                        writeMutation.isPending ||
                        transaction.kind === "wallet"
                      }
                      onClick={reviewAutopilotFunding}
                    >
                      Review exact funding <ArrowRight size={16} />
                    </button>

                    {fundingReview ? (
                      <>
                        <div className="action-review-table">
                          <div>
                            <span>Owner</span>
                            <strong>{compactAddress(selectedAutopilotPlan.event.owner)}</strong>
                          </div>
                          <div>
                            <span>Plan state</span>
                            <strong>{selectedAutopilotPlan.state}</strong>
                          </div>
                          <div>
                            <span>Amount entered</span>
                            <strong>
                              {fundingAmount} {tokenSymbol}
                            </strong>
                          </div>
                          <div>
                            <span>Confidential token</span>
                            <strong>
                              {compactAddress(VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken)}
                            </strong>
                          </div>
                          <div>
                            <span>Vault destination</span>
                            <strong>{compactAddress(VEILPOT_SEPOLIA_DEPLOYMENT.vault)}</strong>
                          </div>
                          <div>
                            <span>Selected plan</span>
                            <strong>
                              {selectedAutopilotPlan.event.planId.slice(0, 10)}…
                              {selectedAutopilotPlan.event.planId.slice(-8)}
                            </strong>
                          </div>
                          <div>
                            <span>Funding path</span>
                            <strong>confidentialTransferAndCall</strong>
                          </div>
                        </div>

                        <div className="action-safety-note">
                          <LockKeyhole size={17} />
                          <p>
                            Before encryption and signing, Veilpot re-reads this exact plan from
                            live Vault state and rejects REVOKED or COMPLETED plans. The frozen SDK
                            then encrypts the entered amount for the confidential token and builds
                            the exact transfer-and-call to the Vault with this plan ID as callback
                            data.
                          </p>
                        </div>

                        <button
                          className="financial-primary-button"
                          type="button"
                          disabled={
                            parsedFundingAmount === null ||
                            !canUseWallet ||
                            writeMutation.isPending ||
                            transaction.kind === "wallet"
                          }
                          onClick={() => {
                            void fundAutopilotPlan();
                          }}
                        >
                          Encrypt & approve funding <LockKeyhole size={15} />
                        </button>
                      </>
                    ) : null}
                  </>
                ) : null}

                {fundingIncluded !== null ? (
                  <div className="financial-state-card">
                    <CircleCheck size={20} />
                    <div>
                      <strong>Autopilot funding transaction included</strong>
                      <p>
                        Plan {fundingIncluded.planId.slice(0, 10)}…
                        {fundingIncluded.planId.slice(-8)}
                      </p>
                      <span>
                        Transaction {fundingIncluded.transactionHash.slice(0, 10)}…
                        {fundingIncluded.transactionHash.slice(-8)}
                      </span>
                      <p>
                        The transaction was mined successfully. The confidential transferred amount
                        is not publicly revealed or inferred by this interface.
                      </p>
                    </div>
                  </div>
                ) : null}

                {fundingWarning !== null ? (
                  <div className="financial-state-card warning">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Funding was mined; do not resubmit automatically</strong>
                      <p>{fundingWarning}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {isDeposit ? (
          <div className="financial-form">
            {participant === null && !participantLoading ? (
              <div className="financial-step-card">
                <span className="financial-step-icon">
                  <CircleDashed size={18} />
                </span>
                <div>
                  <strong>1. Reserve your private savings slot</strong>
                  <p>
                    This is the protocol registration step. It requires the exact refundable
                    registration bond from the frozen SDK.
                  </p>
                  <button
                    className="financial-primary-button"
                    type="button"
                    disabled={!canUseWallet || writeMutation.isPending}
                    onClick={() => {
                      void reserveParticipant();
                    }}
                  >
                    Reserve slot · {formatEther(REGISTRATION_BOND_WEI)} ETH
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            ) : null}

            {participant?.state === PARTICIPANT_STATE.RESERVED ? (
              <>
                <div className="financial-step-card complete">
                  <span className="financial-step-icon">
                    <CircleCheck size={18} />
                  </span>
                  <div>
                    <strong>Registration slot reserved</strong>
                    <p>
                      Slot {participant.slotIndex.toString()} · reservation expires{" "}
                      {unixTimeLabel(participant.reservationExpiry)}
                    </p>
                  </div>
                </div>

                <div className="financial-step-card">
                  <span className="financial-step-icon">
                    {operatorSubmission === null && operatorQuery.data === true ? (
                      <CircleCheck size={18} />
                    ) : (
                      <CircleDashed size={18} />
                    )}
                  </span>
                  <div>
                    <strong>2. Allow the Pool to pull this confidential deposit</strong>
                    <p>
                      The permission is explicit and short-lived. Veilpot prepares one exact
                      30-minute approval for inspection before any wallet request.
                    </p>

                    {!operatorSubmissionStorageReady ? (
                      <p className="financial-field-help">
                        Checking for any previously submitted Pool approval…
                      </p>
                    ) : operatorSubmission !== null ? (
                      <div className="financial-state-card warning operator-verification-card">
                        <ShieldCheck size={18} />
                        <div>
                          <strong>
                            Exact transaction must be verified before any later approval
                          </strong>
                          <p>{operatorSubmission.hash}</p>
                          <button
                            className="financial-secondary-button"
                            type="button"
                            disabled={participantLoading || operatorMutation.isPending}
                            onClick={() => {
                              void verifyOperatorTransaction();
                            }}
                          >
                            <RefreshCw size={15} /> Verify exact transaction
                          </button>
                        </div>
                      </div>
                    ) : operatorQuery.data === true ? (
                      <span className="financial-inline-success">Pool operator is ready</span>
                    ) : operatorReview === null ? (
                      <button
                        className="financial-secondary-button"
                        type="button"
                        disabled={
                          operatorMutation.isPending ||
                          participantLoading ||
                          transaction.kind === "wallet" ||
                          transaction.kind === "submitted"
                        }
                        onClick={() => {
                          void reviewPoolOperator();
                        }}
                      >
                        Review Pool approval <ArrowRight size={16} />
                      </button>
                    ) : (
                      <div className="financial-plan-review operator-approval-review">
                        <div
                          className="action-review-table"
                          aria-label="Exact Pool approval review"
                        >
                          <div>
                            <span>Holder</span>
                            <strong>{operatorReview.holder}</strong>
                          </div>
                          <div>
                            <span>Confidential token · testnet mock</span>
                            <strong>{operatorReview.token}</strong>
                          </div>
                          <div>
                            <span>Operator / Pool</span>
                            <strong>{operatorReview.operator}</strong>
                          </div>
                          <div>
                            <span>Participant slot</span>
                            <strong>{operatorReview.participant.slotIndex.toString()}</strong>
                          </div>
                          <div>
                            <span>Registration version</span>
                            <strong>
                              {operatorReview.participant.registrationVersion.toString()}
                            </strong>
                          </div>
                          <div>
                            <span>Reservation nonce</span>
                            <strong>
                              {operatorReview.participant.reservationNonce.toString()}
                            </strong>
                          </div>
                          <div>
                            <span>Function</span>
                            <strong>{operatorReview.functionSignature}</strong>
                          </div>
                          <div>
                            <span>Expected selector</span>
                            <strong>{operatorReview.selector}</strong>
                          </div>
                          <div>
                            <span>Exact frozen until · Unix</span>
                            <strong>{operatorReview.until}</strong>
                          </div>
                          <div>
                            <span>Exact frozen until · UTC</span>
                            <strong>{operatorReview.untilUtc}</strong>
                          </div>
                          <div>
                            <span>Duration</span>
                            <strong>{operatorReview.durationSeconds / 60} minutes</strong>
                          </div>
                          <div>
                            <span>Network</span>
                            <strong>{operatorReview.network}</strong>
                          </div>
                          <div>
                            <span>chainId</span>
                            <strong>{operatorReview.chainId}</strong>
                          </div>
                          <div>
                            <span>Exact expected calldata</span>
                            <strong>{operatorReview.calldata}</strong>
                          </div>
                        </div>

                        <p className="financial-field-help">
                          This review is usable for five minutes. Opening the wallet re-reads the
                          RESERVED registration and operator state. It never replaces the displayed
                          expiry or calldata.
                        </p>

                        <button
                          className="financial-primary-button"
                          type="button"
                          disabled={
                            operatorMutation.isPending ||
                            participantLoading ||
                            transaction.kind === "wallet" ||
                            transaction.kind === "submitted"
                          }
                          onClick={() => {
                            void openPoolOperatorWalletReview();
                          }}
                        >
                          Open wallet review <LockKeyhole size={15} />
                        </button>
                      </div>
                    )}

                    {operatorReviewNotice !== null ? (
                      <p className="financial-field-help">{operatorReviewNotice}</p>
                    ) : null}
                  </div>
                </div>

                <label>
                  <span>3. Private deposit amount</span>
                  <div className="financial-input-unit">
                    <input
                      inputMode="decimal"
                      value={amount}
                      placeholder="25.00"
                      onChange={(event) => {
                        setAmount(event.target.value);
                      }}
                    />
                    <small>{tokenSymbol}</small>
                  </div>
                  <small className="financial-field-help">
                    The exact amount is encrypted for the Pool and your connected wallet. Veilpot
                    does not reveal it in this interface.
                  </small>
                </label>

                <button
                  className="financial-primary-button"
                  type="button"
                  disabled={
                    parsedAmount === null ||
                    operatorQuery.data !== true ||
                    writeMutation.isPending ||
                    transaction.kind === "wallet"
                  }
                  onClick={() => {
                    void submitRegistrationDeposit();
                  }}
                >
                  Encrypt & review deposit <LockKeyhole size={15} />
                </button>
              </>
            ) : null}

            {participant?.state === PARTICIPANT_STATE.PENDING_ACTIVATION ? (
              <div className="financial-state-card pending">
                <LoaderCircle size={20} />
                <div>
                  <strong>Deposit included; activation proof settlement is pending</strong>
                  <p>
                    Transaction inclusion is not confidential settlement. The protocol must settle
                    the public threshold proof before this registration becomes ACTIVE. Veilpot will
                    not submit a second deposit while this state is unresolved.
                  </p>
                  <span>Activation deadline · {unixTimeLabel(participant.activationDeadline)}</span>
                </div>
              </div>
            ) : null}

            {participant?.state === PARTICIPANT_STATE.ACTIVE ? (
              <div className="financial-state-card">
                <CircleCheck size={20} />
                <div>
                  <strong>Your direct registration deposit is complete</strong>
                  <p>
                    The frozen Pool only accepts the direct-user deposit while the participant is
                    RESERVED. Additional scheduled contributions enter the Pool through bounded
                    Autopilot, not through a fake top-up call.
                  </p>
                  <button
                    className="financial-secondary-button"
                    type="button"
                    onClick={() => {
                      setLocalAction("plan");
                      setTransaction({ kind: "idle" });
                    }}
                  >
                    Set up Autopilot savings <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            ) : null}

            {participant !== null &&
            participant.state !== PARTICIPANT_STATE.RESERVED &&
            participant.state !== PARTICIPANT_STATE.PENDING_ACTIVATION &&
            participant.state !== PARTICIPANT_STATE.ACTIVE ? (
              <div className="financial-state-card warning">
                <ShieldCheck size={20} />
                <div>
                  <strong>Registration recovery is required</strong>
                  <p>
                    Current participant state: {participantName}. Veilpot will not guess a
                    money-moving recovery path. Refund/proof recovery is wired in the dedicated
                    recovery gate.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {isWithdraw ? (
          <div className="financial-form">
            {participant?.state === PARTICIPANT_STATE.ACTIVE ? (
              <>
                <div className="financial-step-card complete">
                  <span className="financial-step-icon">
                    <CircleCheck size={18} />
                  </span>
                  <div>
                    <strong>Active private participant verified</strong>
                    <p>
                      Slot {participant.slotIndex.toString()} · registration version{" "}
                      {participant.registrationVersion.toString()}
                    </p>
                  </div>
                </div>

                <label>
                  <span>Requested withdrawal amount</span>
                  <div className="financial-input-unit">
                    <input
                      inputMode="decimal"
                      value={amount}
                      placeholder="10.00"
                      onChange={(event) => {
                        setAmount(event.target.value);
                      }}
                    />
                    <small>{tokenSymbol}</small>
                  </div>
                  <small className="financial-field-help">
                    The Pool caps the encrypted request at your encrypted principal. The exact
                    principal is not automatically decrypted.
                  </small>
                </label>

                <button
                  className="financial-primary-button"
                  type="button"
                  disabled={
                    parsedAmount === null ||
                    writeMutation.isPending ||
                    transaction.kind === "wallet"
                  }
                  onClick={() => {
                    void submitWithdrawal();
                  }}
                >
                  Encrypt & review withdrawal <WalletCards size={15} />
                </button>
              </>
            ) : (
              <div className="financial-state-card warning">
                <ShieldCheck size={20} />
                <div>
                  <strong>Withdrawal is not available in this participant state</strong>
                  <p>
                    {participantLoading
                      ? "Checking the live Pool state…"
                      : participant === null
                        ? "This wallet does not currently have a live Veilpot participant registration."
                        : `Current state: ${participantName}. The frozen Pool only accepts withdrawal from ACTIVE participants.`}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {transaction.kind !== "idle" ? (
          <div
            className={
              transaction.kind === "error" ||
              transaction.kind === "submitted" ||
              transaction.kind === "reverted"
                ? "financial-transaction-status error"
                : transaction.kind === "included"
                  ? "financial-transaction-status success"
                  : "financial-transaction-status"
            }
          >
            {transaction.kind === "wallet" ? (
              <LoaderCircle className="financial-spin" size={18} />
            ) : transaction.kind === "included" ? (
              <CircleCheck size={18} />
            ) : (
              <ShieldCheck size={18} />
            )}

            <div>
              <strong>
                {transaction.kind === "wallet"
                  ? transaction.label
                  : transaction.kind === "included"
                    ? transaction.label
                    : transaction.kind === "submitted" || transaction.kind === "reverted"
                      ? transaction.label
                      : "Action stopped safely"}
              </strong>
              {transaction.kind === "included" ? (
                <>
                  {transaction.warning !== undefined ? <p>{transaction.warning}</p> : null}
                  <a
                    href={`https://sepolia.etherscan.io/tx/${transaction.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View included transaction <ExternalLink size={13} />
                  </a>
                </>
              ) : transaction.kind === "submitted" || transaction.kind === "reverted" ? (
                <>
                  <p>{transaction.message}</p>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${transaction.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Verify exact transaction hash <ExternalLink size={13} />
                  </a>
                </>
              ) : transaction.kind === "error" ? (
                <p>{transaction.message}</p>
              ) : (
                <p>
                  Confirm only if the wallet details match the frozen review Veilpot showed you.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {!isPlan && participantError !== null ? (
          <button
            className="financial-secondary-button"
            type="button"
            onClick={() => {
              void refreshParticipant();
            }}
          >
            <RefreshCw size={15} /> Retry live participant check
          </button>
        ) : null}

        <div className="action-safety-note">
          <ShieldCheck size={17} />
          <p>
            <strong>You remain in control.</strong>{" "}
            {isPlan
              ? "Plan values stay local in this F6-A gate. No Autopilot broadcast occurs yet."
              : "Every transaction is initiated only by an explicit button press. Veilpot never decrypts private balances automatically."}
          </p>
        </div>

        <footer className="action-sheet-footer human">
          <span>
            <LockKeyhole size={14} /> Private values are hidden by default
          </span>
          <button type="button" onClick={onClose}>
            Done <ArrowRight size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}
