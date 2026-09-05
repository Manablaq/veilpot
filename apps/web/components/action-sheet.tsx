"use client";

import { toUserFacingError } from "@/lib/ui-error";

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
import { encodeFunctionData, formatEther, formatUnits, parseUnits } from "viem";
import {
  useConfidentialBalance,
  useConfidentialIsOperator,
  useConfidentialSetOperator,
  useMetadata,
  useZamaSDK,
} from "@zama-fhe/react-sdk";
import {
  PARTICIPANT_STATE,
  REGISTRATION_BOND_WEI,
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_POOL_V2_ABI,
  VEILPOT_SEPOLIA_DEPLOYMENT,
  autopilotPlanStateName,
  buildAutopilotFundingCall,
  buildAutopilotPlanIdCall,
  buildAutopilotPlanMetadataCall,
  buildAutopilotSchedule,
  buildCreateAutopilotPlanCall,
  buildV2DepositCall,
  buildV2ReserveParticipantSlotCall,
  encryptAutopilotFundingAmount,
  encryptAutopilotPlanAmounts,
  encryptV2PoolAmount,
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
  operatorApprovalReviewInvalidReason,
  operatorApprovalTransactionInvalidReason,
  parseOperatorApprovalSubmissionRecord,
  transactionReceiptStatus,
  type OperatorApprovalReview,
  type OperatorApprovalSubmissionRecord,
} from "@/lib/operator-approval";
import {
  DEPOSIT_REVIEW_MAX_AGE_SECONDS,
  MAX_REGISTRATION_DEPOSIT_BASE_UNITS,
  MIN_REGISTRATION_DEPOSIT_BASE_UNITS,
  createDepositReview,
  depositReviewInvalidReason,
  depositTransactionInvalidReason,
  parseDepositSubmissionRecord,
  serializeDepositSubmissionRecord,
  withDepositSubmissionHash,
  type DepositReview,
  type DepositSubmissionRecord,
} from "@/lib/deposit-review";
import { VEILPOT_V2_EXACT_ACTION_SCOPE, v2SaveStorageKeys } from "@/lib/deployment-scope";
import {
  ACTIVE_STATE,
  PENDING_REFUND_STATE,
  THRESHOLD_REVIEW_MAX_AGE_SECONDS,
  createThresholdSettlementReview,
  parsePublicBoolean,
  parseThresholdSubmissionRecord,
  serializeThresholdSubmissionRecord,
  thresholdReviewInvalidReason,
  thresholdSettlementTransactionInvalidReason,
  withThresholdSubmissionHash,
  type ThresholdSettlementReview,
  type ThresholdSubmissionRecord,
} from "@/lib/threshold-settlement";

import { useExactAction } from "@/components/exact-action-control";
import { WithdrawalPanel } from "@/components/withdrawal-panel";

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

function autopilotWalletWiringEnabled(): boolean {
  return false;
}

function compactAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function errorMessage(error: unknown): string {
  return toUserFacingError(
    error,
    "The action could not be completed. Nothing was submitted again automatically.",
  );
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
  const publicClient = usePublicClient({ chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId });
  const writeMutation = useWriteContract();
  const zama = useZamaSDK();
  const exactAction = useExactAction(authenticatedAddress, VEILPOT_V2_EXACT_ACTION_SCOPE);
  const v2SaveKeys = useMemo(() => v2SaveStorageKeys(authenticatedAddress), [authenticatedAddress]);

  const metadataQuery = useMetadata(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken);
  const operatorQuery = useConfidentialIsOperator(
    {
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
      holder: connection.address,
      spender: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    },
    { enabled: action === "deposit" && connection.address !== undefined },
  );
  const operatorMutation = useConfidentialSetOperator(
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
  );
  const readinessBalanceQuery = useConfidentialBalance(
    {
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
      account: connection.address,
    },
    {
      enabled: false,
      retry: false,
    },
  );

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
  const [depositReview, setDepositReview] = useState<DepositReview | null>(null);
  const [depositNotice, setDepositNotice] = useState<string | null>(null);
  const [depositPreparing, setDepositPreparing] = useState(false);
  const [depositSubmission, setDepositSubmission] = useState<DepositSubmissionRecord | null>(null);
  const [depositSubmissionLoadedKey, setDepositSubmissionLoadedKey] = useState<string | null>(null);
  const [readinessBalance, setReadinessBalance] = useState<bigint | null>(null);
  const [readinessBalanceError, setReadinessBalanceError] = useState<string | null>(null);
  const [thresholdReview, setThresholdReview] = useState<ThresholdSettlementReview | null>(null);
  const [thresholdNotice, setThresholdNotice] = useState<string | null>(null);
  const [thresholdDecrypting, setThresholdDecrypting] = useState(false);
  const [thresholdSubmission, setThresholdSubmission] = useState<ThresholdSubmissionRecord | null>(
    null,
  );
  const [thresholdSubmissionLoadedKey, setThresholdSubmissionLoadedKey] = useState<string | null>(
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
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  )}:${VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase()}:${VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase()}:${authenticatedAddress.toLowerCase()}`;
  const depositSubmissionStorageKey = `veilpot:deposit:unresolved:v1:${String(
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  )}:${VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase()}:${authenticatedAddress.toLowerCase()}`;
  const thresholdSubmissionStorageKey = `veilpot:threshold-settlement:unresolved:v1:${String(
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  )}:${VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase()}:${authenticatedAddress.toLowerCase()}`;

  const clearOperatorSubmission = useCallback(() => {
    setOperatorSubmission(null);
    try {
      window.localStorage.removeItem(operatorSubmissionStorageKey);
    } catch {
      // In-memory state has already been cleared after conclusive reconciliation.
    }
  }, [operatorSubmissionStorageKey]);

  const preserveDepositSubmission = useCallback(
    (record: DepositSubmissionRecord) => {
      setDepositSubmission(record);
      try {
        window.localStorage.setItem(
          depositSubmissionStorageKey,
          serializeDepositSubmissionRecord(record),
        );
      } catch {
        // In-memory blocking remains active if browser storage is unavailable.
      }
    },
    [depositSubmissionStorageKey],
  );

  const clearDepositSubmission = useCallback(() => {
    setDepositSubmission(null);
    try {
      window.localStorage.removeItem(depositSubmissionStorageKey);
    } catch {
      // In-memory state has already been cleared after conclusive reconciliation.
    }
  }, [depositSubmissionStorageKey]);

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
            VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase() &&
          parsed.operator.toLowerCase() === VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase();

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

  const preserveThresholdSubmission = useCallback(
    (record: ThresholdSubmissionRecord) => {
      setThresholdSubmission(record);
      try {
        window.localStorage.setItem(
          thresholdSubmissionStorageKey,
          serializeThresholdSubmissionRecord(record),
        );
      } catch {
        // In-memory blocking remains active if browser storage is unavailable.
      }
    },
    [thresholdSubmissionStorageKey],
  );

  const clearThresholdSubmission = useCallback(() => {
    setThresholdSubmission(null);
    try {
      window.localStorage.removeItem(thresholdSubmissionStorageKey);
    } catch {
      // In-memory state is already clear after conclusive reconciliation.
    }
  }, [thresholdSubmissionStorageKey]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(depositSubmissionStorageKey);
      if (stored === null) {
        setDepositSubmission(null);
      } else {
        const parsed = parseDepositSubmissionRecord(stored);
        const matchesCurrentContext =
          parsed !== null &&
          parsed.holder.toLowerCase() === authenticatedAddress.toLowerCase() &&
          parsed.pool.toLowerCase() === VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase() &&
          parsed.token.toLowerCase() ===
            VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase() &&
          parsed.chainId === VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId;

        if (matchesCurrentContext) {
          setDepositSubmission(parsed);
        } else {
          window.localStorage.removeItem(depositSubmissionStorageKey);
          setDepositSubmission(null);
        }
      }
    } catch {
      setDepositSubmission(null);
    } finally {
      setDepositSubmissionLoadedKey(depositSubmissionStorageKey);
    }
  }, [authenticatedAddress, depositSubmissionStorageKey]);

  const depositSubmissionStorageReady = depositSubmissionLoadedKey === depositSubmissionStorageKey;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(thresholdSubmissionStorageKey);
      if (stored === null) {
        setThresholdSubmission(null);
      } else {
        const parsed = parseThresholdSubmissionRecord(stored);
        const matchesCurrentContext =
          parsed !== null &&
          parsed.holder.toLowerCase() === authenticatedAddress.toLowerCase() &&
          parsed.pool.toLowerCase() === VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase() &&
          parsed.chainId === VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId;
        if (matchesCurrentContext) {
          setThresholdSubmission(parsed);
        } else {
          window.localStorage.removeItem(thresholdSubmissionStorageKey);
          setThresholdSubmission(null);
        }
      }
    } catch {
      setThresholdSubmission(null);
    } finally {
      setThresholdSubmissionLoadedKey(thresholdSubmissionStorageKey);
    }
  }, [authenticatedAddress, thresholdSubmissionStorageKey]);

  const thresholdSubmissionStorageReady =
    thresholdSubmissionLoadedKey === thresholdSubmissionStorageKey;

  useEffect(() => {
    setOperatorReview(null);
    setOperatorReviewNotice(null);
    setDepositReview(null);
    setDepositNotice(null);
    setDepositPreparing(false);
    setReadinessBalance(null);
    setReadinessBalanceError(null);
    setThresholdReview(null);
    setThresholdNotice(null);
    setThresholdDecrypting(false);

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
    setDepositReview(null);
    setDepositNotice(null);
    setDepositPreparing(false);
    setReadinessBalance(null);
    setReadinessBalanceError(null);
    setThresholdReview(null);
    setThresholdNotice(null);
    setThresholdDecrypting(false);
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

      const reservations = await publicClient.getContractEvents({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        eventName: "ParticipantReserved",
        args: { participant: holder },
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
        row[1].toLowerCase() !== holder.toLowerCase()
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
    connection.chainId === VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId &&
    publicClient !== undefined;

  const reserveParticipant = useCallback(async () => {
    if (!canUseWallet) {
      return;
    }

    if (!exactAction.storageReady) {
      setTransaction({
        kind: "error",
        message: "Veilpot is still checking for an unresolved exact V2.x wallet attempt.",
      });
      return;
    }

    if (exactAction.attempt !== null) {
      const preservedHash = exactAction.attempt.hash;

      setTransaction({
        kind: "wallet",
        label: "Reconciling the existing exact registration attempt",
      });

      const reconciled = await exactAction.reconcile();

      if (!reconciled) {
        setTransaction({
          kind: "error",
          message:
            "The earlier exact registration attempt is not conclusively reconciled. Do not retry or prepare another reservation yet.",
        });
        return;
      }

      const liveParticipant = await loadParticipant(address);
      setParticipant(liveParticipant);

      if (
        liveParticipant !== null &&
        liveParticipant.owner.toLowerCase() === address.toLowerCase() &&
        liveParticipant.state === PARTICIPANT_STATE.RESERVED
      ) {
        if (preservedHash !== null) {
          setTransaction({
            kind: "included",
            label: "Exact PoolV2 registration reservation reconciled",
            hash: preservedHash,
          });
        } else {
          setTransaction({ kind: "idle" });
        }

        return;
      }

      setTransaction({
        kind: "error",
        message:
          "The exact attempt reconciled, but the expected RESERVED participant is not visible in current PoolV2 state. Do not retry automatically.",
      });
      return;
    }

    const call = buildV2ReserveParticipantSlotCall();

    const data = encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
    });

    if (exactAction.review === null) {
      const liveParticipant = await loadParticipant(address);
      setParticipant(liveParticipant);

      if (liveParticipant !== null) {
        setTransaction({
          kind: "error",
          message:
            "This wallet already has a live PoolV2 participant. No new reservation review was prepared.",
        });
        return;
      }

      const review = await exactAction.prepare({
        key: "v2-save-reserve-participant-slot",
        label: "Reserve V2 participant slot",
        consequence:
          "Lock the exact public registration bond and create one bounded PoolV2 reservation for the authenticated wallet.",
        to: call.address,
        data,
        value: call.value,
      });

      if (review === null) {
        setTransaction({
          kind: "error",
          message:
            "The exact PoolV2 registration simulation did not produce a valid review. Nothing was submitted.",
        });
        return;
      }

      setTransaction({
        kind: "wallet",
        label: "Exact registration review ready — press Reserve slot again to open the wallet",
      });

      return;
    }

    if (
      exactAction.review.key !== "v2-save-reserve-participant-slot" ||
      exactAction.review.to.toLowerCase() !== call.address.toLowerCase() ||
      exactAction.review.data.toLowerCase() !== data.toLowerCase() ||
      exactAction.review.value !== call.value
    ) {
      exactAction.discardReview();

      setTransaction({
        kind: "error",
        message:
          "The prepared registration review no longer matches the exact PoolV2 reservation call. It was discarded.",
      });

      return;
    }

    setTransaction({
      kind: "wallet",
      label: "Opening the exact PoolV2 registration wallet review",
    });

    const hash = await exactAction.openWallet();

    if (hash === null) {
      setTransaction({
        kind: "error",
        message:
          "No conclusive transaction hash was returned. Veilpot will not retry automatically. If an unresolved attempt was preserved, press the reservation button only to reconcile it.",
      });
      return;
    }

    const receipt = await publicClient.getTransactionReceipt({
      hash,
    });

    if (receipt.status !== "success") {
      setTransaction({
        kind: "reverted",
        label: "Exact PoolV2 registration reservation reverted",
        hash,
        message:
          "The reviewed reservation was mined with failure. No automatic retry was generated.",
      });
      return;
    }

    const liveParticipant = await loadParticipant(address);
    setParticipant(liveParticipant);

    if (
      liveParticipant !== null &&
      liveParticipant.owner.toLowerCase() === address.toLowerCase() &&
      liveParticipant.state === PARTICIPANT_STATE.RESERVED
    ) {
      setTransaction({
        kind: "included",
        label: "Exact PoolV2 registration slot reserved",
        hash,
      });

      return;
    }

    setTransaction({
      kind: "submitted",
      label: "Registration transaction mined but lifecycle reconciliation needs review",
      hash,
      message:
        "The exact transaction receipt succeeded, but the expected RESERVED participant was not observed in the current PoolV2 read. Do not submit another reservation automatically.",
    });
  }, [address, canUseWallet, exactAction, loadParticipant, publicClient]);

  const reviewPoolOperator = useCallback(async () => {
    setOperatorReview(null);
    setOperatorReviewNotice(null);
    setTransaction({ kind: "idle" });

    if (!exactAction.storageReady) {
      setTransaction({
        kind: "error",
        message:
          "Veilpot is still checking for an unresolved exact V2.x wallet attempt. No operator review was prepared.",
      });
      return;
    }

    if (exactAction.attempt !== null) {
      setTransaction({
        kind: "wallet",
        label: "Reconciling the existing exact Save wallet attempt",
      });

      const reconciled = await exactAction.reconcile();

      if (!reconciled) {
        setTransaction({
          kind: "error",
          message:
            "The previous exact Save wallet attempt is not conclusively resolved. No PoolV2 operator approval was prepared and no retry was generated.",
        });
        return;
      }

      setTransaction({
        kind: "idle",
      });

      setOperatorReviewNotice(
        "The previous exact Save wallet attempt was reconciled. Review the current PoolV2 operator state before preparing another action.",
      );

      return;
    }

    if (exactAction.review !== null) {
      setTransaction({
        kind: "error",
        message:
          "Another exact Save review is already prepared. Complete or discard that review before preparing PoolV2 authorization.",
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

    if (
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId ||
      publicClient === undefined
    ) {
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
        operatorQuery.refetch({
          throwOnError: true,
        }),
      ]);

      setParticipant(liveParticipant);

      if (
        liveParticipant?.state !== PARTICIPANT_STATE.RESERVED ||
        liveParticipant.owner.toLowerCase() !== connectedAddress.toLowerCase() ||
        !liveParticipant.bondHeld
      ) {
        throw new Error(
          "A live RESERVED PoolV2 participant owned by this wallet with its registration bond held is required.",
        );
      }

      const nowSeconds = Math.floor(Date.now() / 1000);

      if (BigInt(nowSeconds) >= liveParticipant.reservationExpiry) {
        throw new Error("The PoolV2 reservation has expired. No operator approval was prepared.");
      }

      if (operatorResult.data === true) {
        setOperatorReviewNotice(
          "PoolV2 is already an active ERC-7984 operator. No approval transaction was prepared.",
        );
        return;
      }

      if (operatorResult.data !== false) {
        throw new Error("The live PoolV2 operator state could not be verified.");
      }

      const domainReview = createOperatorApprovalReview({
        holder: connectedAddress,
        token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
        operator: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: liveParticipant,
        nowSeconds,
      });

      const exactReview = await exactAction.prepare({
        key: v2SaveKeys.operatorApproval,
        label: "Authorize PoolV2 for confidential deposit",
        consequence:
          "Authorize only the active PoolV2 contract as ERC-7984 operator for the exact reviewed 30-minute expiry.",
        to: domainReview.token,
        data: domainReview.calldata,
        value: 0n,
      });

      if (exactReview === null) {
        throw new Error(
          "The exact PoolV2 operator authorization did not pass read-only simulation.",
        );
      }

      if (
        exactReview.key !== v2SaveKeys.operatorApproval ||
        exactReview.to.toLowerCase() !== domainReview.token.toLowerCase() ||
        exactReview.data.toLowerCase() !== domainReview.calldata.toLowerCase() ||
        exactReview.value !== 0n
      ) {
        exactAction.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen PoolV2 operator authorization.",
        );
      }

      setOperatorReview(domainReview);

      setOperatorReviewNotice(
        "Exact PoolV2 operator authorization simulated successfully. Inspect the frozen 30-minute expiry and calldata before opening the wallet.",
      );
    } catch (error: unknown) {
      exactAction.discardReview();
      setOperatorReview(null);
      setParticipantError(errorMessage(error));
      setTransaction({
        kind: "error",
        message: errorMessage(error),
      });
    } finally {
      setParticipantLoading(false);
    }
  }, [
    authenticatedAddress,
    connection,
    exactAction,
    loadParticipant,
    operatorQuery,
    publicClient,
    v2SaveKeys.operatorApproval,
  ]);

  const openPoolOperatorWalletReview = useCallback(async () => {
    const review = operatorReview;

    if (review === null) {
      setTransaction({
        kind: "error",
        message: "Prepare and inspect a fresh PoolV2 operator review before opening the wallet.",
      });
      return;
    }

    if (connection.status !== "connected") {
      exactAction.discardReview();
      setOperatorReview(null);

      setTransaction({
        kind: "error",
        message: "The wallet connection changed. Prepare a new PoolV2 operator review.",
      });

      return;
    }

    const connectedAddress = connection.address;

    if (
      connectedAddress.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId ||
      publicClient === undefined
    ) {
      exactAction.discardReview();
      setOperatorReview(null);

      setTransaction({
        kind: "error",
        message: "The authenticated wallet context changed. Prepare a new PoolV2 operator review.",
      });

      return;
    }

    setParticipantLoading(true);
    setParticipantError(null);

    try {
      const [liveParticipant, operatorResult] = await Promise.all([
        loadParticipant(connectedAddress),
        operatorQuery.refetch({
          throwOnError: true,
        }),
      ]);

      setParticipant(liveParticipant);

      if (operatorResult.data === true) {
        exactAction.discardReview();
        setOperatorReview(null);

        setOperatorReviewNotice(
          "PoolV2 became an active operator before wallet opening. No approval transaction was requested.",
        );

        setTransaction({
          kind: "idle",
        });

        return;
      }

      if (operatorResult.data !== false) {
        throw new Error(
          "The live PoolV2 operator state could not be verified immediately before wallet opening.",
        );
      }

      const invalidReason = operatorApprovalReviewInvalidReason(review, {
        holder: connectedAddress,
        token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
        operator: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participant: liveParticipant,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (invalidReason !== null) {
        exactAction.discardReview();
        setOperatorReview(null);

        throw new Error(`${invalidReason} No replacement authorization was generated.`);
      }

      if (
        exactAction.review?.key !== v2SaveKeys.operatorApproval ||
        exactAction.review.to.toLowerCase() !== review.token.toLowerCase() ||
        exactAction.review.data.toLowerCase() !== review.calldata.toLowerCase() ||
        exactAction.review.value !== 0n
      ) {
        exactAction.discardReview();
        setOperatorReview(null);

        throw new Error(
          "The exact wallet review no longer matches the frozen PoolV2 operator authorization.",
        );
      }

      setTransaction({
        kind: "wallet",
        label: "Review the exact frozen PoolV2 operator authorization in your wallet",
      });

      setOperatorReview(null);

      const hash = await exactAction.openWallet();

      if (hash === null) {
        setTransaction({
          kind: "error",
          message:
            "No conclusive operator-authorization transaction hash was returned. Veilpot did not retry. Any unresolved exact attempt remains blocked until reconciliation.",
        });

        return;
      }

      const receipt = await publicClient.getTransactionReceipt({
        hash,
      });

      if (receipt.status !== "success") {
        setTransaction({
          kind: "reverted",
          label: "Exact PoolV2 operator authorization reverted",
          hash,
          message:
            "The exact reviewed authorization was mined with failure. Veilpot did not retry it.",
        });

        return;
      }

      const reconciledOperator = await operatorQuery.refetch({
        throwOnError: true,
      });

      if (reconciledOperator.data === true) {
        setOperatorReviewNotice(
          "The exact reviewed transaction and live active PoolV2 operator state were reconciled.",
        );

        setTransaction({
          kind: "included",
          label: "Exact PoolV2 operator authorization included successfully",
          hash,
        });

        return;
      }

      setTransaction({
        kind: "submitted",
        label: "Operator authorization mined but live operator state needs review",
        hash,
        message:
          "The exact transaction receipt succeeded, but the current operator query did not prove PoolV2 active. Veilpot will not retry automatically.",
      });
    } catch (error: unknown) {
      setParticipantError(errorMessage(error));

      setTransaction({
        kind: "error",
        message: errorMessage(error),
      });
    } finally {
      setParticipantLoading(false);
    }
  }, [
    authenticatedAddress,
    connection,
    exactAction,
    loadParticipant,
    operatorQuery,
    operatorReview,
    publicClient,
    v2SaveKeys.operatorApproval,
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
      record.token.toLowerCase() !==
        VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase() ||
      record.operator.toLowerCase() !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase() ||
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
      token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
      operator: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
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

  const revealReadinessBalance = useCallback(async () => {
    setReadinessBalance(null);
    setReadinessBalanceError(null);

    if (
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId
    ) {
      setReadinessBalanceError(
        "Connect the authenticated wallet on Ethereum Sepolia before decrypting this balance.",
      );
      return;
    }

    try {
      const result = await readinessBalanceQuery.refetch();
      if (result.error !== null) throw result.error;
      if (result.data === undefined) {
        throw new Error("The confidential balance decryption returned no value.");
      }
      setReadinessBalance(result.data);
    } catch (error: unknown) {
      setReadinessBalanceError(errorMessage(error));
    }
  }, [authenticatedAddress, connection, readinessBalanceQuery]);

  const reconcileMinedDeposit = useCallback(
    async (record: DepositSubmissionRecord, hash: Hex) => {
      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [receipt, minedTransaction] = await Promise.all([
        publicClient.getTransactionReceipt({ hash }),
        publicClient.getTransaction({ hash }),
      ]);

      if (receipt.status === "reverted") {
        clearDepositSubmission();
        setDepositReview(null);
        setTransaction({
          kind: "reverted",
          label: "Confidential deposit transaction reverted",
          hash,
          message:
            "The exact reviewed transaction was mined with failure. A future deposit requires a new encryption and review; Veilpot did not retry.",
        });
        return;
      }

      const identityReason = depositTransactionInvalidReason(record, {
        from: minedTransaction.from,
        to: minedTransaction.to,
        input: minedTransaction.input,
        nonce: minedTransaction.nonce,
        value: minedTransaction.value,
      });

      if (identityReason !== null) {
        setTransaction({
          kind: "submitted",
          label: "Mined deposit failed exact transaction-identity verification",
          hash,
          message: `${identityReason} Keep this record blocked and do not submit another deposit.`,
        });
        return;
      }

      clearDepositSubmission();
      setDepositReview(null);

      try {
        const liveParticipant = await loadParticipant(record.holder);
        setParticipant(liveParticipant);

        const exactBinding =
          liveParticipant !== null &&
          liveParticipant.slotIndex === record.participantSlotIndex &&
          liveParticipant.reservationNonce === record.reservationNonce;

        if (
          exactBinding &&
          (liveParticipant.state === PARTICIPANT_STATE.PENDING_ACTIVATION ||
            liveParticipant.state === PARTICIPANT_STATE.ACTIVE)
        ) {
          setDepositNotice(
            liveParticipant.state === PARTICIPANT_STATE.PENDING_ACTIVATION
              ? "The exact deposit is mined and reconciled. Confidential threshold settlement is the next separate step."
              : "The exact deposit is mined and the participant is already ACTIVE.",
          );
          setTransaction({
            kind: "included",
            label:
              liveParticipant.state === PARTICIPANT_STATE.PENDING_ACTIVATION
                ? "Exact confidential deposit included — activation settlement pending"
                : "Exact confidential deposit fully reconciled",
            hash,
          });
          return;
        }

        const currentState =
          liveParticipant === null
            ? "no current live participant registration"
            : participantStateName(liveParticipant.state);
        setDepositNotice(
          `The exact deposit is mined and its raw transaction identity is reconciled. The live lifecycle has since advanced to ${currentState}. Continue from current state; the old encrypted deposit review cannot be reused.`,
        );
        setTransaction({
          kind: "included",
          label: "Exact confidential deposit included and conclusively reconciled",
          hash,
          warning:
            "The participant lifecycle advanced after this exact deposit. The old deposit attempt is closed; refresh and continue from live state rather than retrying it.",
        });
      } catch (stateError: unknown) {
        setDepositNotice(
          "The exact deposit is mined and its raw transaction identity is reconciled. Current participant state could not be refreshed, but the old deposit attempt is conclusively closed and must not be retried.",
        );
        setTransaction({
          kind: "included",
          label: "Exact confidential deposit included and conclusively reconciled",
          hash,
          warning:
            "Live participant refresh failed after conclusive transaction inclusion. " +
            errorMessage(stateError),
        });
      }
    },
    [clearDepositSubmission, loadParticipant, publicClient],
  );

  const prepareRegistrationDepositReview = useCallback(async () => {
    setDepositReview(null);
    setDepositNotice(null);
    setTransaction({ kind: "idle" });

    if (!exactAction.storageReady) {
      setTransaction({
        kind: "error",
        message:
          "Veilpot is still checking for an unresolved exact V2.x wallet attempt. No encryption was performed.",
      });
      return;
    }

    if (exactAction.attempt !== null) {
      setTransaction({
        kind: "error",
        message:
          "An earlier exact Save wallet attempt remains unresolved. Reconcile it before encrypting another confidential deposit.",
      });
      return;
    }

    if (exactAction.review !== null) {
      setTransaction({
        kind: "error",
        message:
          "Another exact Save review is already prepared. Complete or discard it before encrypting a new deposit.",
      });
      return;
    }

    if (!depositSubmissionStorageReady) {
      setTransaction({
        kind: "error",
        message:
          "Veilpot is still checking legacy deposit-attempt state. No encryption was performed.",
      });
      return;
    }

    if (depositSubmission !== null) {
      setDepositNotice(
        "A preserved historical confidential-deposit attempt must be conclusively reconciled before the V2.x exact-action deposit path can prepare another ciphertext.",
      );
      return;
    }

    if (connection.status !== "connected") {
      setTransaction({
        kind: "error",
        message:
          "Connect the wallet that owns the authenticated Veilpot session before encryption.",
      });
      return;
    }

    const connectedAddress = connection.address;

    if (
      connectedAddress.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId ||
      publicClient === undefined
    ) {
      setTransaction({
        kind: "error",
        message: "Use the authenticated wallet on Ethereum Sepolia before encryption.",
      });
      return;
    }

    if (tokenDecimals !== 6 || parsedAmount === null) {
      setTransaction({
        kind: "error",
        message: "Enter a valid cUSDT amount using its exact 6-decimal token units.",
      });
      return;
    }

    if (
      parsedAmount < MIN_REGISTRATION_DEPOSIT_BASE_UNITS ||
      parsedAmount > MAX_REGISTRATION_DEPOSIT_BASE_UNITS
    ) {
      setTransaction({
        kind: "error",
        message: "Registration deposit must be between 1.000000 and 1,000,000.000000 cUSDT.",
      });
      return;
    }

    setParticipantLoading(true);
    setParticipantError(null);
    setDepositPreparing(true);

    try {
      const [liveParticipant, operatorResult, depositNonce, accountNonce, pendingBondRefund] =
        await Promise.all([
          loadParticipant(connectedAddress),
          operatorQuery.refetch({
            throwOnError: true,
          }),
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "nextDepositNonce",
            args: [connectedAddress],
          }),
          publicClient.getTransactionCount({
            address: connectedAddress,
            blockTag: "pending",
          }),
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "pendingBondRefund",
            args: [connectedAddress],
          }),
        ]);

      setParticipant(liveParticipant);

      if (
        liveParticipant?.state !== PARTICIPANT_STATE.RESERVED ||
        liveParticipant.owner.toLowerCase() !== connectedAddress.toLowerCase() ||
        !liveParticipant.bondHeld
      ) {
        throw new Error(
          "A live RESERVED PoolV2 participant owned by this wallet with its registration bond held is required.",
        );
      }

      if (BigInt(Math.floor(Date.now() / 1000)) >= liveParticipant.reservationExpiry) {
        throw new Error(
          "The PoolV2 reservation is expired or too late for a new confidential deposit.",
        );
      }

      if (operatorResult.data !== true) {
        throw new Error(
          "PoolV2 operator authorization is not currently active. Prepare a fresh exact authorization first.",
        );
      }

      if (pendingBondRefund !== 0n) {
        throw new Error(
          "A pending registration-bond refund must be resolved before confidential deposit.",
        );
      }

      setDepositNotice(
        "Encrypting only the entered amount for the exact active PoolV2 contract and authenticated wallet.",
      );

      const encrypted = await encryptV2PoolAmount(zama, parsedAmount, connectedAddress);

      const [
        postParticipant,
        postOperatorResult,
        postDepositNonce,
        postAccountNonce,
        postPendingBondRefund,
      ] = await Promise.all([
        loadParticipant(connectedAddress),
        operatorQuery.refetch({
          throwOnError: true,
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "nextDepositNonce",
          args: [connectedAddress],
        }),
        publicClient.getTransactionCount({
          address: connectedAddress,
          blockTag: "pending",
        }),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "pendingBondRefund",
          args: [connectedAddress],
        }),
      ]);

      setParticipant(postParticipant);

      if (postParticipant === null) {
        throw new Error(
          "The exact RESERVED PoolV2 participant disappeared while encrypting. The ciphertext was discarded.",
        );
      }

      const participantBindingUnchanged =
        postParticipant.slotIndex === liveParticipant.slotIndex &&
        postParticipant.state === liveParticipant.state &&
        postParticipant.owner.toLowerCase() === liveParticipant.owner.toLowerCase() &&
        postParticipant.registrationVersion === liveParticipant.registrationVersion &&
        postParticipant.reservationNonce === liveParticipant.reservationNonce &&
        postParticipant.reservationExpiry === liveParticipant.reservationExpiry &&
        postParticipant.bondHeld === liveParticipant.bondHeld;

      if (
        !participantBindingUnchanged ||
        postOperatorResult.data !== true ||
        postDepositNonce !== depositNonce ||
        postAccountNonce !== accountNonce ||
        postPendingBondRefund !== 0n
      ) {
        throw new Error(
          "Public V2.x state changed while encrypting. The ciphertext was discarded and cannot be reused.",
        );
      }

      const descriptor = buildV2DepositCall({
        encrypted,
        depositor: connectedAddress,
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
        account: connectedAddress,
      });

      const preparedAt = Math.floor(Date.now() / 1000);

      const domainReview = createDepositReview({
        holder: connectedAddress,
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
        key: v2SaveKeys.deposit,
        label: "Submit confidential PoolV2 deposit",
        consequence:
          "Transfer only the exact encrypted cUSDT amount into PoolV2 under the frozen participant registration and deposit nonce.",
        to: descriptor.address,
        data: calldata,
        value: 0n,
      });

      if (
        exactReview?.key !== v2SaveKeys.deposit ||
        exactReview.to.toLowerCase() !== descriptor.address.toLowerCase() ||
        exactReview.data.toLowerCase() !== calldata.toLowerCase() ||
        exactReview.accountNonce !== accountNonce ||
        exactReview.value !== 0n
      ) {
        exactAction.discardReview();

        throw new Error(
          "The exact-action review diverged from the frozen encrypted deposit. The ciphertext was discarded.",
        );
      }

      setDepositReview(domainReview);

      setDepositNotice(
        "Encrypted deposit simulated against the exact corrected V2.x state and frozen into an exact-action review. Wallet submission remains disabled until Gate 2B2-C2.",
      );
    } catch (error: unknown) {
      exactAction.discardReview();
      setDepositReview(null);
      setDepositNotice(null);

      setTransaction({
        kind: "error",
        message: errorMessage(error),
      });
    } finally {
      setParticipantLoading(false);
      setDepositPreparing(false);
    }
  }, [
    amount,
    authenticatedAddress,
    connection,
    depositSubmission,
    depositSubmissionStorageReady,
    exactAction,
    loadParticipant,
    operatorQuery,
    parsedAmount,
    publicClient,
    tokenDecimals,
    tokenSymbol,
    v2SaveKeys.deposit,
    zama,
  ]);

  const openRegistrationDepositWalletReview = useCallback(async () => {
    const review = depositReview;

    if (review === null) {
      setTransaction({
        kind: "error",
        message: "Encrypt, simulate, and inspect a fresh confidential PoolV2 deposit review first.",
      });
      return;
    }

    if (!exactAction.storageReady) {
      setDepositReview(null);

      setTransaction({
        kind: "error",
        message:
          "Veilpot is still checking for an unresolved exact Save wallet attempt. No wallet request was opened.",
      });

      return;
    }

    if (exactAction.attempt !== null) {
      setDepositReview(null);

      setTransaction({
        kind: "error",
        message:
          "An earlier exact Save wallet attempt remains unresolved. Reconcile it before any new wallet request.",
      });

      return;
    }

    if (connection.status !== "connected") {
      exactAction.discardReview();
      setDepositReview(null);

      setTransaction({
        kind: "error",
        message: "The wallet connection changed. Prepare a fresh encrypted PoolV2 deposit review.",
      });

      return;
    }

    const connectedAddress = connection.address;

    if (
      connectedAddress.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId ||
      publicClient === undefined
    ) {
      exactAction.discardReview();
      setDepositReview(null);

      setTransaction({
        kind: "error",
        message:
          "The authenticated wallet or Sepolia context changed. The encrypted review was discarded.",
      });

      return;
    }

    setParticipantLoading(true);
    setParticipantError(null);

    try {
      const [liveParticipant, operatorResult, depositNonce, accountNonce, pendingBondRefund] =
        await Promise.all([
          loadParticipant(connectedAddress),
          operatorQuery.refetch({
            throwOnError: true,
          }),
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "nextDepositNonce",
            args: [connectedAddress],
          }),
          publicClient.getTransactionCount({
            address: connectedAddress,
            blockTag: "pending",
          }),
          publicClient.readContract({
            address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
            abi: VEILPOT_POOL_V2_ABI,
            functionName: "pendingBondRefund",
            args: [connectedAddress],
          }),
        ]);

      setParticipant(liveParticipant);

      if (pendingBondRefund !== 0n) {
        exactAction.discardReview();
        setDepositReview(null);

        throw new Error(
          "A registration-bond refund became pending after deposit preparation. The encrypted review was discarded.",
        );
      }

      const reviewedEncrypted = {
        encryptedValue: review.encryptedValue,
        inputProof: review.inputProof,
        contractAddress: review.pool,
        userAddress: review.holder,
      } as const;

      const descriptor = buildV2DepositCall({
        encrypted: reviewedEncrypted,
        depositor: review.holder,
        reservationNonce: review.participant.reservationNonce,
        depositNonce: review.depositNonce,
      });

      const currentCalldata = encodeFunctionData({
        abi: descriptor.abi,
        functionName: descriptor.functionName,
        args: descriptor.args,
      });

      const invalidReason = depositReviewInvalidReason(review, {
        holder: connectedAddress,
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
        setDepositReview(null);

        throw new Error(`${invalidReason} No replacement ciphertext or transaction was generated.`);
      }

      if (
        exactAction.review?.key !== v2SaveKeys.deposit ||
        exactAction.review.to.toLowerCase() !== descriptor.address.toLowerCase() ||
        exactAction.review.data.toLowerCase() !== currentCalldata.toLowerCase() ||
        exactAction.review.accountNonce !== accountNonce ||
        exactAction.review.value !== 0n
      ) {
        exactAction.discardReview();
        setDepositReview(null);

        throw new Error(
          "The exact wallet review no longer matches the frozen confidential PoolV2 deposit.",
        );
      }

      await publicClient.simulateContract({
        ...descriptor,
        account: connectedAddress,
      });

      setDepositReview(null);

      setDepositNotice(
        "Live PoolV2 state, operator permission, participant binding, application nonce, wallet nonce and exact calldata were rechecked. Opening the wallet is now the only remaining action.",
      );

      setTransaction({
        kind: "wallet",
        label: "Review the exact frozen confidential PoolV2 deposit in your wallet",
      });

      const hash = await exactAction.openWallet();

      if (hash === null) {
        setTransaction({
          kind: "idle",
        });

        setDepositNotice(
          "No conclusive new deposit hash was returned. Veilpot did not retry. If the shared exact-action controller preserved an unresolved attempt, reconcile it before doing anything else.",
        );

        return;
      }

      const receipt = await publicClient.getTransactionReceipt({
        hash,
      });

      if (receipt.status !== "success") {
        setTransaction({
          kind: "reverted",
          label: "Exact confidential PoolV2 deposit reverted",
          hash,
          message: "The exact reviewed deposit was mined with failure. Veilpot did not retry it.",
        });

        return;
      }

      const [reconciledParticipant, reconciledDepositNonce] = await Promise.all([
        loadParticipant(connectedAddress),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "nextDepositNonce",
          args: [connectedAddress],
        }),
      ]);

      setParticipant(reconciledParticipant);

      const lifecycleAdvanced =
        reconciledParticipant !== null &&
        reconciledParticipant.owner.toLowerCase() === connectedAddress.toLowerCase() &&
        reconciledParticipant.slotIndex === review.participant.slotIndex &&
        reconciledParticipant.registrationVersion === review.participant.registrationVersion &&
        reconciledParticipant.reservationNonce === review.participant.reservationNonce &&
        (reconciledParticipant.state === PARTICIPANT_STATE.PENDING_ACTIVATION ||
          reconciledParticipant.state === PARTICIPANT_STATE.ACTIVE);

      const depositNonceAdvanced = reconciledDepositNonce > review.depositNonce;

      if (lifecycleAdvanced && depositNonceAdvanced) {
        setDepositNotice(
          reconciledParticipant.state === PARTICIPANT_STATE.PENDING_ACTIVATION
            ? "The exact confidential deposit is mined and reconciled. Threshold settlement is the next separate explicit step."
            : "The exact confidential deposit is mined and the participant is already ACTIVE.",
        );

        setTransaction({
          kind: "included",
          label:
            reconciledParticipant.state === PARTICIPANT_STATE.PENDING_ACTIVATION
              ? "Exact confidential PoolV2 deposit included — threshold settlement pending"
              : "Exact confidential PoolV2 deposit fully reconciled",
          hash,
        });

        return;
      }

      setDepositNotice(
        "The exact transaction mined successfully, but the current PoolV2 lifecycle or application nonce has advanced differently than this screen expected. Do not submit another deposit. Refresh and continue only from authoritative live state.",
      );

      setTransaction({
        kind: "included",
        label: "Exact confidential PoolV2 deposit mined; live lifecycle requires review",
        hash,
        warning:
          "The exact transaction identity is conclusively included. No automatic retry is permitted.",
      });
    } catch (error: unknown) {
      setParticipantError(errorMessage(error));

      setTransaction({
        kind: "error",
        message: errorMessage(error),
      });
    } finally {
      setParticipantLoading(false);
    }
  }, [
    authenticatedAddress,
    connection,
    depositReview,
    exactAction,
    loadParticipant,
    operatorQuery,
    parsedAmount,
    publicClient,
    v2SaveKeys.deposit,
  ]);

  const verifyDepositSubmission = useCallback(async () => {
    const record = depositSubmission;
    if (!depositSubmissionStorageReady || record === null || publicClient === undefined) return;

    if (
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.address.toLowerCase() !== record.holder.toLowerCase() ||
      connection.chainId !== record.chainId
    ) {
      setDepositNotice(
        "Reconnect the exact authenticated wallet on Ethereum Sepolia before reconciling this deposit attempt.",
      );
      return;
    }

    try {
      if (record.hash !== null) {
        await reconcileMinedDeposit(record, record.hash);
        return;
      }

      const readNonces = async () =>
        Promise.all([
          publicClient.getTransactionCount({
            address: record.holder,
            blockTag: "latest",
          }),
          publicClient.getTransactionCount({
            address: record.holder,
            blockTag: "pending",
          }),
        ]);

      const [latestFirst, pendingFirst] = await readNonces();
      await new Promise((resolve) => window.setTimeout(resolve, 1_200));
      const [latestSecond, pendingSecond] = await readNonces();

      if (
        latestFirst === record.accountNonce &&
        pendingFirst === record.accountNonce &&
        latestSecond === record.accountNonce &&
        pendingSecond === record.accountNonce
      ) {
        setDepositNotice(
          "No transaction hash was returned and the reviewed nonce currently appears unused, but RPC nonce checks cannot prove that the wallet did not broadcast elsewhere. Keep this deposit attempt blocked unless the original wallet request was explicitly rejected.",
        );
        return;
      }

      if (pendingSecond > record.accountNonce && latestSecond <= record.accountNonce) {
        setDepositNotice(
          "The reviewed nonce appears pending but no hash was returned. Keep this attempt blocked until it is mined or otherwise conclusively reconciled.",
        );
        return;
      }

      if (latestSecond > record.accountNonce) {
        const latestBlock = await publicClient.getBlockNumber();
        const earliestBlock = latestBlock > 128n ? latestBlock - 128n : 0n;
        let locatedHash: Hex | null = null;

        for (let blockNumber = latestBlock; blockNumber >= earliestBlock; blockNumber -= 1n) {
          const block = await publicClient.getBlock({
            blockNumber,
            includeTransactions: true,
          });

          const match = block.transactions.find(
            (candidate) =>
              typeof candidate !== "string" &&
              candidate.from.toLowerCase() === record.holder.toLowerCase() &&
              candidate.nonce === record.accountNonce,
          );

          if (match !== undefined && typeof match !== "string") {
            const invalidReason = depositTransactionInvalidReason(record, {
              from: match.from,
              to: match.to,
              input: match.input,
              nonce: match.nonce,
              value: match.value,
            });

            if (invalidReason !== null) {
              setDepositNotice(
                `The reviewed nonce was consumed by a different transaction. ${invalidReason} Keep the deposit attempt blocked.`,
              );
              return;
            }

            locatedHash = match.hash;
            break;
          }

          if (blockNumber === 0n) break;
        }

        if (locatedHash === null) {
          setDepositNotice(
            "The reviewed nonce was consumed, but the exact transaction could not be located in the recent confirmed blocks. Keep this attempt blocked.",
          );
          return;
        }

        const submitted = withDepositSubmissionHash(record, locatedHash);
        preserveDepositSubmission(submitted);
        await reconcileMinedDeposit(submitted, locatedHash);
        return;
      }

      setDepositNotice(
        "The wallet attempt is not yet conclusive. Keep it blocked and verify again before any retry.",
      );
    } catch (error: unknown) {
      setDepositNotice(
        "Deposit reconciliation was not conclusive. Do not retry automatically. " +
          errorMessage(error),
      );
    }
  }, [
    authenticatedAddress,
    clearDepositSubmission,
    connection,
    depositSubmission,
    depositSubmissionStorageReady,
    preserveDepositSubmission,
    publicClient,
    reconcileMinedDeposit,
  ]);

  useEffect(() => {
    if (depositReview === null) return;

    const invalidReason = depositReviewInvalidReason(depositReview, {
      holder: address,
      chainId: connection.chainId,
      participant,
      amountBaseUnits: parsedAmount,
      depositNonce: depositReview.depositNonce,
      accountNonce: depositReview.accountNonce,
      operatorActive: operatorQuery.data === true,
      currentCalldata: depositReview.calldata,
      nowSeconds: Math.floor(Date.now() / 1000),
    });

    if (localAction !== "deposit" || invalidReason !== null) {
      setDepositReview(null);
      setDepositNotice(
        localAction !== "deposit"
          ? "The confidential-deposit review was closed. Encrypt again for any later deposit."
          : `${invalidReason ?? "The confidential-deposit review changed."} No replacement ciphertext was generated.`,
      );
    }
  }, [
    address,
    connection.chainId,
    depositReview,
    localAction,
    operatorQuery.data,
    parsedAmount,
    participant,
  ]);

  useEffect(() => {
    if (depositReview === null) return;

    const staleAt = (depositReview.preparedAt + DEPOSIT_REVIEW_MAX_AGE_SECONDS) * 1000;
    const delay = Math.max(0, staleAt - Date.now());

    const timeout = window.setTimeout(() => {
      setDepositReview(null);
      setDepositNotice(
        "The confidential-deposit review became stale. Its ciphertext and calldata were discarded; encrypt again to prepare a new review.",
      );
    }, delay);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [depositReview]);

  const reconcileThresholdSettlement = useCallback(
    async (record: ThresholdSubmissionRecord, hash: Hex) => {
      if (publicClient === undefined) {
        throw new Error("The Ethereum Sepolia public client is unavailable.");
      }

      const [receipt, minedTransaction] = await Promise.all([
        publicClient.getTransactionReceipt({ hash }),
        publicClient.getTransaction({ hash }),
      ]);

      if (receipt.status === "reverted") {
        clearThresholdSubmission();
        setThresholdReview(null);
        setTransaction({
          kind: "reverted",
          label: "Threshold settlement transaction reverted",
          hash,
          message:
            "The exact reviewed threshold settlement was mined with failure. Veilpot did not retry.",
        });
        return;
      }

      const identityReason = thresholdSettlementTransactionInvalidReason(record, {
        from: minedTransaction.from,
        to: minedTransaction.to,
        input: minedTransaction.input,
        nonce: minedTransaction.nonce,
        value: minedTransaction.value,
      });
      if (identityReason !== null) {
        setTransaction({
          kind: "submitted",
          label: "Mined threshold settlement failed exact identity verification",
          hash,
          message: identityReason + " Keep this settlement record blocked and do not retry.",
        });
        return;
      }

      clearThresholdSubmission();
      setThresholdReview(null);

      try {
        const liveParticipant = await loadParticipant(record.holder);
        setParticipant(liveParticipant);
        const expectedState = record.clearSatisfied ? ACTIVE_STATE : PENDING_REFUND_STATE;

        if (
          liveParticipant?.slotIndex === record.participantSlotIndex &&
          liveParticipant.registrationVersion === record.registrationVersion &&
          liveParticipant.reservationNonce === record.reservationNonce &&
          liveParticipant.state === expectedState
        ) {
          setThresholdNotice(
            record.clearSatisfied
              ? "The exact threshold proof was settled and the participant is ACTIVE."
              : "The exact threshold proof was settled FALSE and the participant moved to PENDING_REFUND.",
          );
          setTransaction({
            kind: "included",
            label: record.clearSatisfied
              ? "Exact activation settlement included — participant ACTIVE"
              : "Exact threshold settlement included — refund path required",
            hash,
          });
          return;
        }

        const currentState =
          liveParticipant === null
            ? "no current live participant registration"
            : participantStateName(liveParticipant.state);
        setThresholdNotice(
          `The exact threshold settlement is mined and its raw transaction identity is reconciled. The live lifecycle has since advanced to ${currentState}. Continue from current state; the old threshold proof cannot be reused.`,
        );
        setTransaction({
          kind: "included",
          label: "Exact threshold settlement included and conclusively reconciled",
          hash,
          warning:
            "The participant lifecycle advanced after this exact settlement. The old settlement attempt is closed; refresh and continue from live state rather than retrying it.",
        });
      } catch (stateError: unknown) {
        setThresholdNotice(
          "The exact threshold settlement is mined and its raw transaction identity is reconciled. Current participant state could not be refreshed, but the old settlement attempt is conclusively closed and must not be retried.",
        );
        setTransaction({
          kind: "included",
          label: "Exact threshold settlement included and conclusively reconciled",
          hash,
          warning:
            "Live participant refresh failed after conclusive settlement inclusion. " +
            errorMessage(stateError),
        });
      }
    },
    [clearThresholdSubmission, loadParticipant, publicClient],
  );

  const decryptPendingActivationThreshold = useCallback(async () => {
    setThresholdReview(null);
    setThresholdNotice(null);
    setTransaction({ kind: "idle" });

    if (!exactAction.storageReady) {
      setThresholdNotice("Veilpot is still checking for an unresolved exact Save wallet attempt.");
      return;
    }

    if (exactAction.attempt !== null) {
      setThresholdNotice(
        "Reconciling the existing exact Save wallet attempt before preparing another threshold proof.",
      );

      const reconciled = await exactAction.reconcile();

      if (!reconciled) {
        setThresholdNotice(
          "The existing exact Save wallet attempt is not conclusively reconciled. No new threshold proof was prepared.",
        );
        return;
      }

      const refreshed = await loadParticipant(authenticatedAddress);

      setParticipant(refreshed);

      setThresholdNotice(
        "The previous exact wallet attempt was reconciled. Refresh current lifecycle state before preparing another threshold proof.",
      );

      return;
    }

    if (exactAction.review !== null) {
      setThresholdNotice(
        "Another exact Save review is already prepared. Complete or discard it first.",
      );
      return;
    }

    if (!thresholdSubmissionStorageReady) {
      setThresholdNotice(
        "Veilpot is still checking historical threshold-settlement attempt state.",
      );
      return;
    }

    if (thresholdSubmission !== null) {
      setThresholdNotice(
        "A preserved historical threshold-settlement attempt must be reconciled before using the V2.x exact-action path.",
      );
      return;
    }

    if (
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId ||
      publicClient === undefined
    ) {
      setThresholdNotice(
        "Connect the authenticated wallet on Ethereum Sepolia before threshold decryption.",
      );
      return;
    }

    const connectedAddress = connection.address;

    setThresholdDecrypting(true);
    setParticipantLoading(true);
    setParticipantError(null);

    try {
      const liveParticipant = await loadParticipant(connectedAddress);

      setParticipant(liveParticipant);

      if (
        liveParticipant?.state !== PARTICIPANT_STATE.PENDING_ACTIVATION ||
        liveParticipant.owner.toLowerCase() !== connectedAddress.toLowerCase()
      ) {
        throw new Error("The exact PoolV2 participant is no longer PENDING_ACTIVATION.");
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

      setThresholdNotice(
        "Decrypting only the intentionally public PoolV2 threshold consequence. The confidential deposited amount remains encrypted.",
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
        loadParticipant(connectedAddress),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "thresholdHandle",
          args: [liveParticipant.slotIndex],
        }),
        publicClient.getTransactionCount({
          address: connectedAddress,
          blockTag: "pending",
        }),
      ]);

      setParticipant(postParticipant);

      if (
        postParticipant?.state !== PARTICIPANT_STATE.PENDING_ACTIVATION ||
        postParticipant.slotIndex !== liveParticipant.slotIndex ||
        postParticipant.owner.toLowerCase() !== liveParticipant.owner.toLowerCase() ||
        postParticipant.registrationVersion !== liveParticipant.registrationVersion ||
        postParticipant.reservationNonce !== liveParticipant.reservationNonce ||
        postParticipant.activationDeadline !== liveParticipant.activationDeadline ||
        postHandle.toLowerCase() !== thresholdHandle.toLowerCase()
      ) {
        throw new Error(
          "Pending-activation state or the exact threshold handle changed during public decryption. The proof was discarded.",
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
        account: connectedAddress,
      });

      const preparedAt = Math.floor(Date.now() / 1000);

      const review = createThresholdSettlementReview({
        holder: connectedAddress,
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
        key: v2SaveKeys.thresholdSettlement,
        label: clearSatisfied
          ? "Settle TRUE PoolV2 activation threshold"
          : "Settle FALSE PoolV2 activation threshold",
        consequence: clearSatisfied
          ? "Authenticate the exact intentionally public TRUE threshold proof and move this registration to ACTIVE."
          : "Authenticate the exact intentionally public FALSE threshold proof and move this registration into its repairable refund lifecycle.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        data: calldata,
        value: 0n,
      });

      if (
        exactReview?.key !== v2SaveKeys.thresholdSettlement ||
        exactReview.to.toLowerCase() !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase() ||
        exactReview.data.toLowerCase() !== calldata.toLowerCase() ||
        exactReview.accountNonce !== accountNonce ||
        exactReview.value !== 0n
      ) {
        exactAction.discardReview();

        throw new Error(
          "The exact-action review diverged from the authenticated public threshold proof.",
        );
      }

      setThresholdReview(review);

      setThresholdNotice(
        clearSatisfied
          ? "Public threshold consequence: TRUE. Exact ACTIVE-settlement calldata is simulated and ready for separate wallet review."
          : "Public threshold consequence: FALSE. Exact repairable refund-path settlement calldata is simulated and ready for separate wallet review.",
      );
    } catch (error: unknown) {
      exactAction.discardReview();
      setThresholdReview(null);
      setThresholdNotice(errorMessage(error));
    } finally {
      setThresholdDecrypting(false);
      setParticipantLoading(false);
    }
  }, [
    authenticatedAddress,
    connection,
    exactAction,
    loadParticipant,
    publicClient,
    thresholdSubmission,
    thresholdSubmissionStorageReady,
    v2SaveKeys.thresholdSettlement,
    zama.decryption,
  ]);

  const openThresholdSettlementWalletReview = useCallback(async () => {
    const review = thresholdReview;

    if (review === null || publicClient === undefined) {
      setThresholdNotice("Decrypt and inspect a fresh exact PoolV2 threshold review first.");
      return;
    }

    if (!exactAction.storageReady || exactAction.attempt !== null) {
      setThresholdReview(null);

      setThresholdNotice(
        "An unresolved exact Save wallet attempt must be reconciled before opening another wallet request.",
      );

      return;
    }

    if (
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId
    ) {
      exactAction.discardReview();
      setThresholdReview(null);

      setThresholdNotice(
        "The authenticated wallet context changed. Prepare a new threshold proof review.",
      );

      return;
    }

    const connectedAddress = connection.address;

    setParticipantLoading(true);
    setParticipantError(null);

    try {
      const [liveParticipant, thresholdHandle, accountNonce] = await Promise.all([
        loadParticipant(connectedAddress),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_V2_ABI,
          functionName: "thresholdHandle",
          args: [review.participant.slotIndex],
        }),
        publicClient.getTransactionCount({
          address: connectedAddress,
          blockTag: "pending",
        }),
      ]);

      setParticipant(liveParticipant);

      const currentCalldata = encodeFunctionData({
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleThreshold",
        args: [
          review.participant.slotIndex,
          review.participant.registrationVersion,
          review.participant.reservationNonce,
          review.clearSatisfied,
          review.decryptionProof,
        ],
      });

      const invalidReason = thresholdReviewInvalidReason(review, {
        holder: connectedAddress,
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
        setThresholdReview(null);

        throw new Error(`${invalidReason} No replacement proof or transaction was generated.`);
      }

      if (
        exactAction.review?.key !== v2SaveKeys.thresholdSettlement ||
        exactAction.review.to.toLowerCase() !==
          VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase() ||
        exactAction.review.data.toLowerCase() !== currentCalldata.toLowerCase() ||
        exactAction.review.accountNonce !== accountNonce ||
        exactAction.review.value !== 0n
      ) {
        exactAction.discardReview();
        setThresholdReview(null);

        throw new Error(
          "The exact wallet review no longer matches the frozen PoolV2 threshold settlement.",
        );
      }

      await publicClient.simulateContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "settleThreshold",
        args: [
          review.participant.slotIndex,
          review.participant.registrationVersion,
          review.participant.reservationNonce,
          review.clearSatisfied,
          review.decryptionProof,
        ],
        account: connectedAddress,
      });

      setThresholdReview(null);

      setTransaction({
        kind: "wallet",
        label: "Review the exact authenticated PoolV2 threshold settlement in your wallet",
      });

      const hash = await exactAction.openWallet();

      if (hash === null) {
        setThresholdNotice(
          "No conclusive new threshold-settlement hash was returned. Veilpot did not retry. Reconcile any preserved exact attempt before doing anything else.",
        );

        return;
      }

      const receipt = await publicClient.getTransactionReceipt({
        hash,
      });

      if (receipt.status !== "success") {
        setTransaction({
          kind: "reverted",
          label: "Exact PoolV2 threshold settlement reverted",
          hash,
          message:
            "The exact reviewed settlement was mined with failure. No automatic retry occurred.",
        });

        return;
      }

      const reconciledParticipant = await loadParticipant(connectedAddress);

      setParticipant(reconciledParticipant);

      const expectedState = review.clearSatisfied
        ? PARTICIPANT_STATE.ACTIVE
        : PARTICIPANT_STATE.PENDING_REFUND;

      const exactBinding =
        reconciledParticipant !== null &&
        reconciledParticipant.owner.toLowerCase() === connectedAddress.toLowerCase() &&
        reconciledParticipant.slotIndex === review.participant.slotIndex &&
        reconciledParticipant.registrationVersion === review.participant.registrationVersion &&
        reconciledParticipant.reservationNonce === review.participant.reservationNonce;

      if (exactBinding && reconciledParticipant.state === expectedState) {
        setThresholdNotice(
          review.clearSatisfied
            ? "The exact public TRUE threshold proof is mined and reconciled. The participant is ACTIVE."
            : "The exact public FALSE threshold proof is mined and reconciled. The participant entered the repairable refund lifecycle.",
        );

        setTransaction({
          kind: "included",
          label: review.clearSatisfied
            ? "Exact threshold settlement included — participant ACTIVE"
            : "Exact threshold settlement included — refund path active",
          hash,
        });

        return;
      }

      setThresholdNotice(
        "The exact threshold-settlement transaction is conclusively included, but the live lifecycle has advanced differently than this screen expected. Do not retry the proof. Refresh and continue from authoritative PoolV2 state.",
      );

      setTransaction({
        kind: "included",
        label: "Exact PoolV2 threshold settlement included; lifecycle requires refresh",
        hash,
        warning:
          "The reviewed proof is already consumed or the lifecycle advanced. No automatic resubmission is permitted.",
      });
    } catch (error: unknown) {
      setParticipantError(errorMessage(error));

      setThresholdNotice(errorMessage(error));

      setTransaction({
        kind: "error",
        message: errorMessage(error),
      });
    } finally {
      setParticipantLoading(false);
    }
  }, [
    authenticatedAddress,
    connection,
    exactAction,
    loadParticipant,
    publicClient,
    thresholdReview,
    v2SaveKeys.thresholdSettlement,
  ]);

  const verifyThresholdSubmission = useCallback(async () => {
    const record = thresholdSubmission;
    if (!thresholdSubmissionStorageReady || record === null || publicClient === undefined) return;

    if (
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.address.toLowerCase() !== record.holder.toLowerCase() ||
      connection.chainId !== record.chainId
    ) {
      setThresholdNotice(
        "Reconnect the exact authenticated wallet on Ethereum Sepolia before reconciliation.",
      );
      return;
    }

    try {
      if (record.hash !== null) {
        await reconcileThresholdSettlement(record, record.hash);
        return;
      }

      const readNonces = async () =>
        Promise.all([
          publicClient.getTransactionCount({ address: record.holder, blockTag: "latest" }),
          publicClient.getTransactionCount({ address: record.holder, blockTag: "pending" }),
        ]);

      const [latestFirst, pendingFirst] = await readNonces();
      await new Promise((resolve) => window.setTimeout(resolve, 1_200));
      const [latestSecond, pendingSecond] = await readNonces();

      if (
        latestFirst === record.accountNonce &&
        pendingFirst === record.accountNonce &&
        latestSecond === record.accountNonce &&
        pendingSecond === record.accountNonce
      ) {
        setThresholdNotice(
          "No settlement hash was returned and the reviewed nonce currently appears unused, but RPC nonce checks cannot prove that the wallet did not broadcast elsewhere. Keep this settlement attempt blocked unless the original wallet request was explicitly rejected.",
        );
        return;
      }

      if (pendingSecond > record.accountNonce && latestSecond <= record.accountNonce) {
        setThresholdNotice(
          "The reviewed settlement nonce appears pending but no hash was returned. Keep this attempt blocked.",
        );
        return;
      }

      if (latestSecond > record.accountNonce) {
        const latestBlock = await publicClient.getBlockNumber();
        const earliestBlock = latestBlock > 128n ? latestBlock - 128n : 0n;
        let locatedHash: Hex | null = null;

        for (let blockNumber = latestBlock; blockNumber >= earliestBlock; blockNumber -= 1n) {
          const block = await publicClient.getBlock({
            blockNumber,
            includeTransactions: true,
          });
          const match = block.transactions.find(
            (candidate) =>
              typeof candidate !== "string" &&
              candidate.from.toLowerCase() === record.holder.toLowerCase() &&
              candidate.nonce === record.accountNonce,
          );

          if (match !== undefined && typeof match !== "string") {
            const invalidReason = thresholdSettlementTransactionInvalidReason(record, {
              from: match.from,
              to: match.to,
              input: match.input,
              nonce: match.nonce,
              value: match.value,
            });
            if (invalidReason !== null) {
              setThresholdNotice(
                "The reviewed nonce was consumed by a different transaction. " +
                  invalidReason +
                  " Keep this settlement attempt blocked.",
              );
              return;
            }
            locatedHash = match.hash;
            break;
          }
          if (blockNumber === 0n) break;
        }

        if (locatedHash === null) {
          setThresholdNotice(
            "The reviewed nonce was consumed, but the exact settlement transaction could not be located in recent confirmed blocks. Keep this attempt blocked.",
          );
          return;
        }

        const submitted = withThresholdSubmissionHash(record, locatedHash);
        preserveThresholdSubmission(submitted);
        await reconcileThresholdSettlement(submitted, locatedHash);
        return;
      }

      setThresholdNotice(
        "The threshold-settlement wallet attempt is not conclusive. Keep it blocked and verify again before any retry.",
      );
    } catch (error: unknown) {
      setThresholdNotice(
        "Threshold-settlement reconciliation was not conclusive. Do not retry automatically. " +
          errorMessage(error),
      );
    }
  }, [
    authenticatedAddress,
    clearThresholdSubmission,
    connection,
    preserveThresholdSubmission,
    publicClient,
    reconcileThresholdSettlement,
    thresholdSubmission,
    thresholdSubmissionStorageReady,
  ]);

  useEffect(() => {
    if (thresholdReview === null) return;
    const staleAt = (thresholdReview.preparedAt + THRESHOLD_REVIEW_MAX_AGE_SECONDS) * 1000;
    const delay = Math.max(0, staleAt - Date.now());
    const timeout = window.setTimeout(() => {
      setThresholdReview(null);
      setThresholdNotice(
        "The threshold settlement review became stale. No replacement proof or calldata was generated.",
      );
    }, delay);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [thresholdReview]);

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
    if (!autopilotWalletWiringEnabled()) {
      setTransaction({
        kind: "error",
        message:
          "Autopilot wallet submission remains disabled until its corrected V2.x migration gate is complete.",
      });
      return;
    }

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
          chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
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
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId
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
          chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
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
            chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
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
    if (address === undefined || connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId) {
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
    if (!autopilotWalletWiringEnabled()) {
      setTransaction({
        kind: "error",
        message:
          "Autopilot wallet submission remains disabled until its corrected V2.x migration gate is complete.",
      });
      return;
    }

    if (
      !fundingReview ||
      address === undefined ||
      publicClient === undefined ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId ||
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
    connection.status === "connected" &&
    connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId;

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
                              {compactAddress(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken)}
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
                        setDepositReview(null);
                        setDepositNotice(null);
                        setTransaction({ kind: "idle" });
                      }}
                    />
                    <small>{tokenSymbol}</small>
                  </div>
                  <small className="financial-field-help">
                    The exact amount is encrypted for the Pool and your connected wallet. Veilpot
                    does not reveal it in this interface.
                  </small>
                </label>

                <div className="financial-step-card">
                  <span className="financial-step-icon">
                    {readinessBalance === null ? (
                      <CircleDashed size={18} />
                    ) : (
                      <CircleCheck size={18} />
                    )}
                  </span>
                  <div>
                    <strong>Optional one-time deposit readiness check</strong>
                    <p>
                      This explicitly decrypts only this wallet&apos;s cUSDTMock balance. It does
                      not submit a transaction, encrypt a deposit, or decrypt Veilpot principal.
                    </p>
                    {readinessBalance === null ? (
                      <button
                        className="financial-secondary-button"
                        type="button"
                        disabled={readinessBalanceQuery.isFetching}
                        onClick={() => {
                          void revealReadinessBalance();
                        }}
                      >
                        {readinessBalanceQuery.isFetching ? (
                          <>
                            <LoaderCircle size={15} /> Decrypting balance…
                          </>
                        ) : (
                          <>
                            <LockKeyhole size={15} /> Decrypt cUSDTMock balance once
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="financial-inline-success">
                        Available: {formatUnits(readinessBalance, tokenDecimals ?? 6)} {tokenSymbol}
                      </span>
                    )}
                    {readinessBalance !== null &&
                    readinessBalance < MIN_REGISTRATION_DEPOSIT_BASE_UNITS ? (
                      <p className="financial-field-help">
                        This balance is below the 1.000000 cUSDTMock registration minimum. Do not
                        prepare a deposit until the confidential balance is funded.
                      </p>
                    ) : null}
                    {readinessBalanceError !== null ? (
                      <p className="financial-field-help">{readinessBalanceError}</p>
                    ) : null}
                  </div>
                </div>

                {!depositSubmissionStorageReady ? (
                  <p className="financial-field-help">
                    Checking for any unresolved confidential-deposit wallet attempt…
                  </p>
                ) : depositSubmission !== null ? (
                  <div className="financial-state-card warning operator-verification-card">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>Exact deposit attempt must be reconciled before any retry</strong>
                      <p>
                        {depositSubmission.hash ??
                          `Wallet nonce ${depositSubmission.accountNonce.toString()} · no conclusive hash returned`}
                      </p>
                      <button
                        className="financial-secondary-button"
                        type="button"
                        disabled={participantLoading || writeMutation.isPending}
                        onClick={() => {
                          void verifyDepositSubmission();
                        }}
                      >
                        <RefreshCw size={15} /> Reconcile exact deposit attempt
                      </button>
                    </div>
                  </div>
                ) : depositReview === null ? (
                  <button
                    className="financial-primary-button"
                    type="button"
                    disabled={
                      parsedAmount === null ||
                      operatorQuery.data !== true ||
                      writeMutation.isPending ||
                      participantLoading ||
                      depositPreparing ||
                      transaction.kind === "wallet" ||
                      transaction.kind === "submitted"
                    }
                    onClick={() => {
                      void prepareRegistrationDepositReview();
                    }}
                  >
                    {depositPreparing ? (
                      <>
                        <LoaderCircle size={15} /> Encrypting & simulating…
                      </>
                    ) : (
                      <>
                        Encrypt & prepare exact review <LockKeyhole size={15} />
                      </>
                    )}
                  </button>
                ) : (
                  <div className="financial-plan-review operator-approval-review">
                    <div
                      className="action-review-table"
                      aria-label="Exact confidential deposit review"
                    >
                      <div>
                        <span>Holder</span>
                        <strong>{depositReview.holder}</strong>
                      </div>
                      <div>
                        <span>Confidential token · testnet mock</span>
                        <strong>{depositReview.token}</strong>
                      </div>
                      <div>
                        <span>Pool</span>
                        <strong>{depositReview.pool}</strong>
                      </div>
                      <div>
                        <span>Selected amount</span>
                        <strong>
                          {depositReview.amountDisplay} {depositReview.tokenSymbol}
                        </strong>
                      </div>
                      <div>
                        <span>Participant state</span>
                        <strong>{participantStateName(depositReview.participant.state)}</strong>
                      </div>
                      <div>
                        <span>Participant slot</span>
                        <strong>{depositReview.participant.slotIndex.toString()}</strong>
                      </div>
                      <div>
                        <span>Registration version</span>
                        <strong>{depositReview.participant.registrationVersion.toString()}</strong>
                      </div>
                      <div>
                        <span>Reservation nonce</span>
                        <strong>{depositReview.participant.reservationNonce.toString()}</strong>
                      </div>
                      <div>
                        <span>Deposit nonce</span>
                        <strong>{depositReview.depositNonce.toString()}</strong>
                      </div>
                      <div>
                        <span>Wallet transaction nonce</span>
                        <strong>{depositReview.accountNonce}</strong>
                      </div>
                      <div>
                        <span>Network</span>
                        <strong>{depositReview.network}</strong>
                      </div>
                      <div>
                        <span>chainId</span>
                        <strong>{depositReview.chainId}</strong>
                      </div>
                      <div>
                        <span>Simulation</span>
                        <strong>PASS · exact encrypted call</strong>
                      </div>
                      <div>
                        <span>Exact expected calldata</span>
                        <strong>{depositReview.calldata}</strong>
                      </div>
                    </div>

                    <p className="financial-field-help">
                      The selected amount was encrypted only after your explicit click. This exact
                      ciphertext, participant binding, deposit nonce, wallet nonce, and calldata are
                      frozen for five minutes. Opening the wallet re-reads live state and simulates
                      this same call again; it never re-encrypts or replaces the reviewed calldata.
                    </p>

                    <button
                      className="financial-primary-button"
                      type="button"
                      disabled={
                        writeMutation.isPending ||
                        participantLoading ||
                        transaction.kind === "wallet" ||
                        transaction.kind === "submitted"
                      }
                      onClick={() => {
                        void openRegistrationDepositWalletReview();
                      }}
                    >
                      Open wallet review <LockKeyhole size={15} />
                    </button>
                  </div>
                )}

                {depositNotice !== null ? (
                  <p className="financial-field-help">{depositNotice}</p>
                ) : null}
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
                      onClose();
                      window.dispatchEvent(
                        new CustomEvent("veilpot:navigate", { detail: "autopilot" }),
                      );
                    }}
                  >
                    Open live Autopilot controls <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            ) : null}
            {participant?.state === PARTICIPANT_STATE.PENDING_ACTIVATION ? (
              <div className="financial-plan-review operator-approval-review">
                {!thresholdSubmissionStorageReady ? (
                  <p className="financial-field-help">
                    Checking for an unresolved threshold-settlement wallet attempt…
                  </p>
                ) : thresholdSubmission !== null ? (
                  <div className="financial-state-card warning operator-verification-card">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>Exact threshold settlement attempt must be reconciled</strong>
                      <p>
                        {thresholdSubmission.hash ??
                          "Wallet nonce " +
                            thresholdSubmission.accountNonce.toString() +
                            " · no conclusive hash returned"}
                      </p>
                      <button
                        className="financial-secondary-button"
                        type="button"
                        disabled={participantLoading || writeMutation.isPending}
                        onClick={() => {
                          void verifyThresholdSubmission();
                        }}
                      >
                        <RefreshCw size={15} /> Reconcile exact threshold settlement attempt
                      </button>
                    </div>
                  </div>
                ) : thresholdReview === null ? (
                  <>
                    <p className="financial-field-help">
                      The next action publicly decrypts only the Pool&apos;s threshold boolean for
                      this exact pending activation. It does not decrypt the confidential deposited
                      amount or any private balance.
                    </p>
                    <button
                      className="financial-primary-button"
                      type="button"
                      disabled={
                        thresholdDecrypting || participantLoading || writeMutation.isPending
                      }
                      onClick={() => {
                        void decryptPendingActivationThreshold();
                      }}
                    >
                      {thresholdDecrypting ? (
                        <>
                          <LoaderCircle size={15} /> Decrypting threshold boolean…
                        </>
                      ) : (
                        <>
                          <LockKeyhole size={15} /> Decrypt threshold boolean for this activation
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    <div
                      className="action-review-table"
                      aria-label="Exact threshold settlement review"
                    >
                      <div>
                        <span>Holder</span>
                        <strong>{thresholdReview.holder}</strong>
                      </div>
                      <div>
                        <span>Pool</span>
                        <strong>{thresholdReview.pool}</strong>
                      </div>
                      <div>
                        <span>Participant slot</span>
                        <strong>{thresholdReview.participant.slotIndex.toString()}</strong>
                      </div>
                      <div>
                        <span>Registration version</span>
                        <strong>
                          {thresholdReview.participant.registrationVersion.toString()}
                        </strong>
                      </div>
                      <div>
                        <span>Reservation nonce</span>
                        <strong>{thresholdReview.participant.reservationNonce.toString()}</strong>
                      </div>
                      <div>
                        <span>Threshold result</span>
                        <strong>{thresholdReview.clearSatisfied ? "TRUE" : "FALSE"}</strong>
                      </div>
                      <div>
                        <span>Settlement consequence</span>
                        <strong>
                          {thresholdReview.clearSatisfied ? "ACTIVE" : "PENDING_REFUND"}
                        </strong>
                      </div>
                      <div>
                        <span>Activation deadline</span>
                        <strong>
                          {unixTimeLabel(thresholdReview.participant.activationDeadline)}
                        </strong>
                      </div>
                      <div>
                        <span>Threshold handle</span>
                        <strong>{thresholdReview.thresholdHandle}</strong>
                      </div>
                      <div>
                        <span>Wallet transaction nonce</span>
                        <strong>{thresholdReview.accountNonce}</strong>
                      </div>
                      <div>
                        <span>Network</span>
                        <strong>{thresholdReview.network}</strong>
                      </div>
                      <div>
                        <span>chainId</span>
                        <strong>{thresholdReview.chainId}</strong>
                      </div>
                      <div>
                        <span>Simulation</span>
                        <strong>PASS · exact public proof settlement</strong>
                      </div>
                      <div>
                        <span>Exact expected calldata</span>
                        <strong>{thresholdReview.calldata}</strong>
                      </div>
                    </div>
                    <p className="financial-field-help">
                      Only the public consequence boolean has been decrypted. The deposited amount
                      remains confidential. Opening the wallet re-reads the same pending activation,
                      threshold handle, wallet nonce, and simulates this exact proof again.
                    </p>
                    <button
                      className="financial-primary-button"
                      type="button"
                      disabled={participantLoading || writeMutation.isPending}
                      onClick={() => {
                        void openThresholdSettlementWalletReview();
                      }}
                    >
                      Open settlement wallet review <LockKeyhole size={15} />
                    </button>
                  </>
                )}

                {thresholdNotice !== null ? (
                  <p className="financial-field-help">{thresholdNotice}</p>
                ) : null}
              </div>
            ) : null}{" "}
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

        {isWithdraw ? <WithdrawalPanel authenticatedAddress={authenticatedAddress} /> : null}

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
