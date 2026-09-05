"use client";

import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  LockKeyhole,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseUnits, type Address, type Hex } from "viem";
import { useMetadata, useZamaSDK } from "@zama-fhe/react-sdk";
import { useConnection, usePublicClient } from "wagmi";

import {
  PARTICIPANT_STATE,
  VEILPOT_AUTOPILOT_VAULT_ABI,
  VEILPOT_POOL_V2_ABI,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  autopilotPlanStateName,
  buildV2AdvanceMissedAutopilotWindowCall,
  buildV2AutopilotFundingCall,
  buildV2AutopilotPlanIdCall,
  buildV2AutopilotPlanMetadataCall,
  buildAutopilotSchedule,
  buildV2CreateAutopilotPlanCall,
  buildV2ExecuteAutopilotPlanCall,
  buildV2PauseAutopilotPlanCall,
  buildV2ResumeAutopilotPlanCall,
  buildV2RevokeAutopilotPlanCall,
  buildV2SkipAutopilotWindowCall,
  buildV2WithdrawAutopilotPlanFundsCall,
  encryptV2AutopilotFundingAmount,
  encryptV2AutopilotPlanAmounts,
} from "@veilpot/protocol-sdk";

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
import { ExactActionReviewCard, useExactAction } from "@/components/exact-action-control";
import { VEILPOT_V2_EXACT_ACTION_SCOPE } from "@/lib/deployment-scope";

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
const SCAN_CHUNK = 900n;
const SCAN_RETRY_ATTEMPTS = 3;

interface ParticipantSnapshot {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
}

interface LivePlan {
  readonly event: AutopilotPlanCreatedEventSnapshot;
  readonly metadata: AutopilotPlanMetadataSnapshot;
  readonly schedule: PersistedAutopilotScheduleRecord | null;
}

interface CreationDraft {
  readonly name: string;
  readonly amount: string;
  readonly lifetimeCap: string;
  readonly cadence: "weekly" | "monthly";
  readonly day: string;
  readonly time: string;
  readonly windowHours: string;
  readonly executionCount: string;
}

interface PendingCreation {
  readonly planId: Hex;
  readonly scheduleRoot: Hex;
  readonly executionCount: number;
  readonly windows: readonly {
    readonly index: bigint;
    readonly notBefore: bigint;
    readonly notAfter: bigint;
    readonly proof: readonly Hex[];
  }[];
}

const INITIAL_DRAFT: CreationDraft = {
  name: "",
  amount: "",
  lifetimeCap: "",
  cadence: "weekly",
  day: "Friday",
  time: "08:00",
  windowHours: "2",
  executionCount: "4",
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Autopilot action stopped safely.";
}

async function retryRpc<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown = new Error("RPC request failed.");

  for (let attempt = 0; attempt < SCAN_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt + 1 < SCAN_RETRY_ATTEMPTS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 180 * (attempt + 1));
        });
      }
    }
  }

  throw lastError;
}

function timeLabel(value: bigint): string {
  return new Date(Number(value) * 1000).toLocaleString();
}

function isFundable(state: number): boolean {
  return state !== 3 && state !== 4;
}

export function MeridianAutopilotControl({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  const connection = useConnection();
  const publicClient = usePublicClient({ chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId });
  const metadata = useMetadata(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken);
  const zama = useZamaSDK();
  const exact = useExactAction(authenticatedAddress, VEILPOT_V2_EXACT_ACTION_SCOPE);

  const [participant, setParticipant] = useState<ParticipantSnapshot | null>(null);
  const [plans, setPlans] = useState<readonly LivePlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<Hex | null>(null);
  const [draft, setDraft] = useState<CreationDraft>(INITIAL_DRAFT);
  const [fundingAmount, setFundingAmount] = useState("");
  const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null);
  const [loading, setLoading] = useState(false);
  const [snapshotBlock, setSnapshotBlock] = useState<bigint | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tokenDecimals = metadata.data?.decimals;
  const tokenSymbol = metadata.data?.symbol ?? "cUSDTMock";

  const selectedPlan = useMemo(
    () =>
      selectedPlanId === null
        ? null
        : (plans.find(
            (candidate) => candidate.event.planId.toLowerCase() === selectedPlanId.toLowerCase(),
          ) ?? null),
    [plans, selectedPlanId],
  );

  const loadParticipant = useCallback(async (): Promise<ParticipantSnapshot | null> => {
    if (publicClient === undefined) return null;

    const maximum = await publicClient.readContract({
      address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_V2_ABI,
      functionName: "MAX_PARTICIPANTS",
    });

    for (let index = 0; index < Number(maximum); index += 1) {
      const state = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "participantState",
        args: [BigInt(index)],
      });
      if (state === PARTICIPANT_STATE.FREE || state === PARTICIPANT_STATE.TOMBSTONED) {
        continue;
      }

      const row = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "participantMetadata",
        args: [BigInt(index)],
      });

      if (row[1].toLowerCase() === authenticatedAddress.toLowerCase()) {
        return {
          slotIndex: BigInt(index),
          state: row[0],
          owner: row[1],
          registrationVersion: row[2],
          reservationNonce: row[3],
        };
      }
    }
    return null;
  }, [authenticatedAddress, publicClient]);

  const discover = useCallback(async () => {
    if (
      publicClient === undefined ||
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId
    ) {
      setNotice("Connect the authenticated wallet on Ethereum Sepolia.");
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      const owner = connection.address;
      const [liveParticipant, latest] = await Promise.all([
        loadParticipant(),
        publicClient.getBlock({ blockTag: "latest" }),
      ]);
      setParticipant(liveParticipant);

      const pinnedBlock = latest.number;
      const pinnedHash = latest.hash;
      const deploymentBlock = BigInt(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.blocks.vault);
      const nextPlanNonce = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
        abi: VEILPOT_AUTOPILOT_VAULT_ABI,
        functionName: "nextPlanNonce",
        args: [owner],
        blockNumber: pinnedBlock,
      });

      const events: AutopilotPlanCreatedEventSnapshot[] = [];

      if (nextPlanNonce > 0n) {
        let toBlock = pinnedBlock;

        while (toBlock >= deploymentBlock && BigInt(events.length) < nextPlanNonce) {
          const earliestFullChunkEnd = deploymentBlock + SCAN_CHUNK - 1n;
          const fromBlock =
            toBlock >= earliestFullChunkEnd ? toBlock - SCAN_CHUNK + 1n : deploymentBlock;

          const logs = await retryRpc(() =>
            publicClient.getContractEvents({
              address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
              abi: VEILPOT_AUTOPILOT_VAULT_ABI,
              eventName: "PlanCreated",
              args: { owner },
              fromBlock,
              toBlock,
              strict: true,
            }),
          );

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

          if (fromBlock === deploymentBlock) break;
          toBlock = fromBlock - 1n;
        }
      }

      if (BigInt(events.length) !== nextPlanNonce) {
        throw new Error(
          `Autopilot discovery found ${events.length.toString()} of ${nextPlanNonce.toString()} expected owner plan events at the pinned Sepolia snapshot.`,
        );
      }

      const ordered = validateAutopilotDiscoveryEvents(events, owner, nextPlanNonce);

      let schedules: readonly PersistedAutopilotScheduleRecord[] = [];
      try {
        schedules = loadAutopilotScheduleRecords(window.localStorage, {
          chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
          vault: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
          owner,
        });
      } catch (error: unknown) {
        setNotice(
          "Live plans were discovered, but local public schedule storage is unavailable. " +
            errorMessage(error),
        );
      }

      const nextPlans: LivePlan[] = [];
      for (const event of ordered) {
        const row = await publicClient.readContract({
          ...buildV2AutopilotPlanMetadataCall(event.planId),
          blockNumber: pinnedBlock,
        });

        const planMetadata: AutopilotPlanMetadataSnapshot = {
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

        reconcileAutopilotPlanMetadata(event, planMetadata);
        const schedule = findAutopilotScheduleRecord(schedules, {
          chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
          vault: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
          owner,
          planId: event.planId,
          scheduleRoot: event.scheduleRoot,
          executionCount: event.executionCount,
        });

        nextPlans.push({ event, metadata: planMetadata, schedule });
      }

      const confirmation = await publicClient.getBlock({ blockNumber: pinnedBlock });
      if (confirmation.hash !== pinnedHash) {
        throw new Error("The Sepolia discovery snapshot changed during the scan.");
      }

      setPlans(nextPlans);
      setSnapshotBlock(pinnedBlock);
      if (
        selectedPlanId !== null &&
        !nextPlans.some(
          (candidate) => candidate.event.planId.toLowerCase() === selectedPlanId.toLowerCase(),
        )
      ) {
        setSelectedPlanId(null);
      }
    } catch (error: unknown) {
      setPlans([]);
      setSnapshotBlock(null);
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [authenticatedAddress, connection, loadParticipant, publicClient, selectedPlanId]);

  useEffect(() => {
    void discover();
  }, [discover]);

  useEffect(() => {
    if (exact.status.kind === "included") {
      if (pendingCreation !== null) {
        try {
          saveAutopilotScheduleRecord(window.localStorage, {
            version: 1,
            chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
            vault: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
            owner: authenticatedAddress,
            planId: pendingCreation.planId,
            scheduleRoot: pendingCreation.scheduleRoot,
            executionCount: pendingCreation.executionCount,
            creationTxHash: exact.status.hash,
            windows: pendingCreation.windows.map((window) => ({
              index: window.index.toString(),
              notBefore: window.notBefore.toString(),
              notAfter: window.notAfter.toString(),
              proof: window.proof,
            })),
          });
          setPendingCreation(null);
        } catch (error: unknown) {
          setNotice(
            "The plan transaction was included but public schedule persistence needs review. " +
              errorMessage(error),
          );
        }
      }
      void discover();
    }
  }, [authenticatedAddress, discover, exact.status, pendingCreation]);

  const prepareCreation = useCallback(async () => {
    if (
      publicClient === undefined ||
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId ||
      tokenDecimals === undefined
    ) {
      setNotice("Authenticated Sepolia wallet and token metadata are required.");
      return;
    }

    setLoading(true);
    setNotice(null);
    setPendingCreation(null);

    try {
      const liveParticipant = await loadParticipant();
      setParticipant(liveParticipant);
      if (liveParticipant?.state !== PARTICIPANT_STATE.ACTIVE) {
        throw new Error("Autopilot creation requires the exact ACTIVE participant.");
      }

      const count = Number(draft.executionCount);
      const windowHours = Number(draft.windowHours);
      if (
        draft.name.trim().length < 2 ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 1024 ||
        !Number.isInteger(windowHours) ||
        windowHours < 1 ||
        windowHours > 24
      ) {
        throw new Error("Enter a pot name, 1–1024 executions, and a 1–24 hour window.");
      }

      const periodAmount = parseUnits(draft.amount.trim(), tokenDecimals);
      const lifetimeCap = parseUnits(draft.lifetimeCap.trim(), tokenDecimals);
      const maxUint64 = (1n << 64n) - 1n;
      if (
        periodAmount <= 0n ||
        lifetimeCap <= 0n ||
        periodAmount > maxUint64 ||
        lifetimeCap > maxUint64
      ) {
        throw new Error("Contribution and lifetime cap must be positive uint64 token amounts.");
      }

      const planNonce = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
        abi: VEILPOT_AUTOPILOT_VAULT_ABI,
        functionName: "nextPlanNonce",
        args: [connection.address],
      });

      const planId = await publicClient.readContract(
        buildV2AutopilotPlanIdCall(
          connection.address,
          liveParticipant.registrationVersion,
          liveParticipant.reservationNonce,
          planNonce,
        ),
      );

      const windows = buildRecurringAutopilotWindows({
        cadence: draft.cadence,
        day: draft.day,
        time: draft.time,
        windowHours,
        executionCount: count,
      });
      const schedule = buildAutopilotSchedule(planId, windows);

      const encrypted = await encryptV2AutopilotPlanAmounts(
        zama,
        periodAmount,
        lifetimeCap,
        connection.address,
      );

      const [postParticipant, postNonce] = await Promise.all([
        loadParticipant(),
        publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
          abi: VEILPOT_AUTOPILOT_VAULT_ABI,
          functionName: "nextPlanNonce",
          args: [connection.address],
        }),
      ]);

      if (
        postParticipant?.state !== PARTICIPANT_STATE.ACTIVE ||
        postParticipant.slotIndex !== liveParticipant.slotIndex ||
        postParticipant.registrationVersion !== liveParticipant.registrationVersion ||
        postParticipant.reservationNonce !== liveParticipant.reservationNonce ||
        postNonce !== planNonce
      ) {
        throw new Error(
          "Participant or plan nonce changed while encrypting. The encrypted plan review was discarded.",
        );
      }

      const descriptor = buildV2CreateAutopilotPlanCall({
        encrypted,
        owner: connection.address,
        slotIndex: postParticipant.slotIndex,
        registrationVersion: postParticipant.registrationVersion,
        reservationNonce: postParticipant.reservationNonce,
        planNonce,
        scheduleRoot: schedule.root,
        executionCount: schedule.executionCount,
      });

      const data = encodeFunctionData({
        abi: descriptor.abi,
        functionName: descriptor.functionName,
        args: descriptor.args,
      });

      const prepared = await exact.prepare({
        key: `autopilot-create:${planId}`,
        label: `Create Autopilot plan "${draft.name.trim()}"`,
        consequence:
          "Create one immutable schedule commitment with encrypted period amount and encrypted lifetime cap. Funding remains a separate action.",
        to: descriptor.address,
        data,
        value: 0n,
      });

      if (prepared !== null) {
        setPendingCreation({
          planId,
          scheduleRoot: schedule.root,
          executionCount: schedule.executionCount,
          windows: schedule.windows,
        });
        setNotice(
          "Plan amounts encrypted and exact creation calldata simulated. No funding was sent and no private amount was decrypted.",
        );
      }
    } catch (error: unknown) {
      setNotice(errorMessage(error));
      setPendingCreation(null);
    } finally {
      setLoading(false);
    }
  }, [
    authenticatedAddress,
    connection,
    draft,
    exact,
    loadParticipant,
    publicClient,
    tokenDecimals,
    zama,
  ]);

  const prepareFunding = useCallback(async () => {
    setPendingCreation(null);
    if (
      selectedPlan === null ||
      publicClient === undefined ||
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      tokenDecimals === undefined
    ) {
      setNotice("Select a live owner plan and connect the authenticated wallet.");
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      const amount = parseUnits(fundingAmount.trim(), tokenDecimals);
      if (amount <= 0n || amount > (1n << 64n) - 1n) {
        throw new Error("Funding amount must be a positive uint64 token amount.");
      }

      const row = await publicClient.readContract(
        buildV2AutopilotPlanMetadataCall(selectedPlan.event.planId),
      );
      const latest: AutopilotPlanMetadataSnapshot = {
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
      reconcileAutopilotPlanMetadata(selectedPlan.event, latest);
      if (!isFundable(latest.state)) {
        throw new Error("REVOKED and COMPLETED plans cannot receive new funding.");
      }

      const encrypted = await encryptV2AutopilotFundingAmount(zama, amount, connection.address);

      const descriptor = buildV2AutopilotFundingCall({
        encrypted,
        owner: connection.address,
        planId: selectedPlan.event.planId,
      });
      const data = encodeFunctionData({
        abi: descriptor.abi,
        functionName: descriptor.functionName,
        args: descriptor.args,
      });

      const prepared = await exact.prepare({
        key: `autopilot-fund:${selectedPlan.event.planId}`,
        label: "Fund selected Autopilot plan confidentially",
        consequence:
          "Transfer the encrypted requested token amount to the immutable Vault and bind it to this exact plan ID.",
        to: descriptor.address,
        data,
        value: 0n,
      });

      if (prepared !== null) {
        setNotice(
          `Encrypted the entered ${fundingAmount.trim()} ${tokenSymbol} funding request. The transferred amount remains confidential.`,
        );
      }
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [
    authenticatedAddress,
    connection,
    exact,
    fundingAmount,
    publicClient,
    selectedPlan,
    tokenDecimals,
    tokenSymbol,
    zama,
  ]);

  const stageDescriptor = useCallback(
    async (
      key: string,
      label: string,
      consequence: string,
      descriptor: {
        readonly address: Address;
        readonly abi: typeof VEILPOT_AUTOPILOT_VAULT_ABI;
        readonly functionName:
          | "pausePlan"
          | "resumePlan"
          | "revokePlan"
          | "withdrawPlanFunds"
          | "execute"
          | "skipNext"
          | "advanceMissed";
        readonly args: readonly unknown[];
      },
    ) => {
      const data = encodeFunctionData({
        abi: descriptor.abi,
        functionName: descriptor.functionName,
        args: descriptor.args as never,
      });

      await exact.prepare({
        key,
        label,
        consequence,
        to: descriptor.address,
        data,
        value: 0n,
      });
    },
    [exact],
  );

  const currentWindow = useMemo(() => {
    if (!selectedPlan) return null;

    const { metadata: planMetadata, schedule } = selectedPlan;
    if (!schedule) return null;

    const row = schedule.windows.at(planMetadata.nextExecutionIndex);
    if (row === undefined) return null;

    return {
      index: BigInt(row.index),
      notBefore: BigInt(row.notBefore),
      notAfter: BigInt(row.notAfter),
      proof: row.proof,
    };
  }, [selectedPlan]);

  const stagePlanAction = useCallback(
    async (action: "pause" | "resume" | "revoke" | "withdraw" | "execute" | "skip" | "advance") => {
      setPendingCreation(null);
      if (selectedPlan === null) return;
      const planId = selectedPlan.event.planId;

      if (action === "pause") {
        const descriptor = buildV2PauseAutopilotPlanCall(planId);
        await stageDescriptor(
          `autopilot-pause:${planId}`,
          "Pause Autopilot plan",
          "Stop future execution while preserving the committed schedule and Vault funds.",
          descriptor,
        );
        return;
      }
      if (action === "resume") {
        const descriptor = buildV2ResumeAutopilotPlanCall(planId);
        await stageDescriptor(
          `autopilot-resume:${planId}`,
          "Resume Autopilot plan",
          "Return the paused plan to ACTIVE without changing its schedule or encrypted limits.",
          descriptor,
        );
        return;
      }
      if (action === "revoke") {
        const descriptor = buildV2RevokeAutopilotPlanCall(planId);
        await stageDescriptor(
          `autopilot-revoke:${planId}`,
          "Permanently revoke Autopilot plan",
          "Terminally stop future execution. Residual accounted Vault funds remain owner-withdrawable.",
          descriptor,
        );
        return;
      }
      if (action === "withdraw") {
        const descriptor = buildV2WithdrawAutopilotPlanFundsCall(planId);
        await stageDescriptor(
          `autopilot-withdraw-funds:${planId}`,
          "Withdraw all accounted Vault funds",
          "Return the plan's encrypted accounted Vault funds to the immutable plan owner.",
          descriptor,
        );
        return;
      }

      if (currentWindow === null) {
        setNotice(
          "The exact public schedule proof for the next window is not available in this browser.",
        );
        return;
      }

      const input = {
        planId,
        index: currentWindow.index,
        notBefore: currentWindow.notBefore,
        notAfter: currentWindow.notAfter,
        proof: currentWindow.proof,
      };

      if (action === "execute") {
        const descriptor = buildV2ExecuteAutopilotPlanCall(input);
        await stageDescriptor(
          `autopilot-execute:${planId}:${currentWindow.index.toString()}`,
          "Execute exact due Autopilot window",
          "Permissionlessly move only the encrypted amount bounded by period cap, remaining lifetime budget, Vault funds, and Pool capacity.",
          descriptor,
        );
      } else if (action === "skip") {
        const descriptor = buildV2SkipAutopilotWindowCall(input);
        await stageDescriptor(
          `autopilot-skip:${planId}:${currentWindow.index.toString()}`,
          "Skip exact next Autopilot window",
          "Consume the exact committed next schedule slot without moving confidential value.",
          descriptor,
        );
      } else {
        const descriptor = buildV2AdvanceMissedAutopilotWindowCall(input);
        await stageDescriptor(
          `autopilot-advance:${planId}:${currentWindow.index.toString()}`,
          "Advance exact expired Autopilot window",
          "Consume one already-expired committed window without moving confidential value.",
          descriptor,
        );
      }
    },
    [currentWindow, selectedPlan, stageDescriptor],
  );

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

  return (
    <section className="workspace-stack">
      <article className="workspace-card block">
        <CalendarClock size={20} />
        <span className="eyebrow">AUTOPILOT · V2.x</span>
        <h2>One immutable policy, explicit funding, owner controls.</h2>
        <p>
          Live plans are discovered from the corrected V2.x Vault's owner-indexed Sepolia events and
          reconciled against Vault metadata. Confidential period amounts, remaining budgets, and
          Vault funds are not decrypted by discovery.
        </p>

        <div className="financial-live-status">
          <div>
            <span>Participant</span>
            <strong>
              {participant?.state === PARTICIPANT_STATE.ACTIVE ? "ACTIVE" : "Not ACTIVE"}
            </strong>
          </div>
          <div>
            <span>Owner plans</span>
            <strong>{plans.length}</strong>
          </div>
          <div>
            <span>Discovery snapshot</span>
            <strong>{snapshotBlock?.toString() ?? "Not loaded"}</strong>
          </div>
        </div>

        <button
          className="financial-secondary-button"
          type="button"
          disabled={loading || exact.isWalletPending}
          onClick={() => {
            void discover();
          }}
        >
          <RefreshCw size={15} /> Refresh canonical plan discovery
        </button>
      </article>

      <article className="workspace-card block financial-form">
        <span className="eyebrow">CREATE</span>
        <h2>Create a confidential recurring savings policy.</h2>
        <div className="financial-form-grid">
          <label>
            <span>Pot name</span>
            <input
              value={draft.name}
              placeholder="Emergency runway"
              onChange={(event) => {
                setDraft((current) => ({ ...current, name: event.target.value }));
                exact.discardReview();
                setPendingCreation(null);
              }}
            />
          </label>
          <label>
            <span>Contribution</span>
            <div className="financial-input-unit">
              <input
                inputMode="decimal"
                value={draft.amount}
                placeholder="1.00"
                onChange={(event) => {
                  setDraft((current) => ({ ...current, amount: event.target.value }));
                  exact.discardReview();
                  setPendingCreation(null);
                }}
              />
              <small>{tokenSymbol}</small>
            </div>
          </label>
        </div>

        <div className="financial-form-grid">
          <label>
            <span>Cadence</span>
            <select
              value={draft.cadence}
              onChange={(event) => {
                const cadence = event.target.value as "weekly" | "monthly";
                setDraft((current) => ({
                  ...current,
                  cadence,
                  day: cadence === "weekly" ? "Friday" : "1",
                }));
                setPendingCreation(null);
                exact.discardReview();
              }}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>
            <span>{draft.cadence === "weekly" ? "Weekday" : "Month day"}</span>
            <select
              value={draft.day}
              onChange={(event) => {
                setDraft((current) => ({ ...current, day: event.target.value }));
                setPendingCreation(null);
                exact.discardReview();
              }}
            >
              {draft.cadence === "weekly"
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
          </label>
        </div>

        <div className="financial-form-grid">
          <label>
            <span>Start time (UTC)</span>
            <input
              type="time"
              value={draft.time}
              onChange={(event) => {
                setDraft((current) => ({ ...current, time: event.target.value }));
                setPendingCreation(null);
                exact.discardReview();
              }}
            />
          </label>
          <label>
            <span>Window hours</span>
            <input
              type="number"
              min="1"
              max="24"
              value={draft.windowHours}
              onChange={(event) => {
                setDraft((current) => ({ ...current, windowHours: event.target.value }));
                setPendingCreation(null);
                exact.discardReview();
              }}
            />
          </label>
        </div>

        <div className="financial-form-grid">
          <label>
            <span>Execution count</span>
            <input
              type="number"
              min="1"
              max="1024"
              value={draft.executionCount}
              onChange={(event) => {
                setDraft((current) => ({ ...current, executionCount: event.target.value }));
                setPendingCreation(null);
                exact.discardReview();
              }}
            />
          </label>
          <label>
            <span>Lifetime authorization cap</span>
            <div className="financial-input-unit">
              <input
                inputMode="decimal"
                value={draft.lifetimeCap}
                placeholder="4.00"
                onChange={(event) => {
                  setDraft((current) => ({ ...current, lifetimeCap: event.target.value }));
                  exact.discardReview();
                  setPendingCreation(null);
                }}
              />
              <small>{tokenSymbol}</small>
            </div>
          </label>
        </div>

        <button
          className="financial-primary-button"
          type="button"
          disabled={
            loading ||
            participant?.state !== PARTICIPANT_STATE.ACTIVE ||
            exact.attempt !== null ||
            exact.isWalletPending
          }
          onClick={() => {
            void prepareCreation();
          }}
        >
          <LockKeyhole size={15} /> Encrypt & prepare exact plan creation
        </button>
      </article>

      <article className="workspace-card block">
        <span className="eyebrow">DISCOVER & CONTROL</span>
        <h2>Your live Vault plans.</h2>
        {plans.length === 0 ? (
          <div className="financial-state-card">
            <CircleDashed size={18} />
            <div>
              <strong>No owner plans at the pinned snapshot</strong>
              <p>No plan is invented from demo data.</p>
            </div>
          </div>
        ) : null}

        {plans.map((plan) => {
          const selected = selectedPlanId?.toLowerCase() === plan.event.planId.toLowerCase();
          return (
            <div className="financial-state-card" key={plan.event.planId}>
              {selected ? <CircleCheck size={18} /> : <CircleDashed size={18} />}
              <div>
                <strong>
                  {autopilotPlanStateName(plan.metadata.state)} · plan nonce{" "}
                  {plan.metadata.planNonce.toString()}
                </strong>
                <p>
                  {plan.event.planId.slice(0, 12)}…{plan.event.planId.slice(-8)}
                </p>
                <span>
                  Next window {plan.metadata.nextExecutionIndex}/{plan.metadata.executionCount} ·{" "}
                  {plan.schedule === null
                    ? "schedule proofs unavailable in this browser"
                    : "schedule proof matched"}
                </span>
                <button
                  className="financial-secondary-button"
                  type="button"
                  onClick={() => {
                    setSelectedPlanId(plan.event.planId);
                    setFundingAmount("");
                    setPendingCreation(null);
                    exact.discardReview();
                  }}
                >
                  {selected ? "Selected" : "Select plan"}
                </button>
              </div>
            </div>
          );
        })}

        {selectedPlan !== null ? (
          <>
            <div className="financial-live-status">
              <div>
                <span>State</span>
                <strong>{autopilotPlanStateName(selectedPlan.metadata.state)}</strong>
              </div>
              <div>
                <span>Next index</span>
                <strong>{selectedPlan.metadata.nextExecutionIndex}</strong>
              </div>
              <div>
                <span>Committed windows</span>
                <strong>{selectedPlan.metadata.executionCount}</strong>
              </div>
              <div>
                <span>Schedule root</span>
                <strong>
                  {selectedPlan.metadata.scheduleRoot.slice(0, 10)}…
                  {selectedPlan.metadata.scheduleRoot.slice(-8)}
                </strong>
              </div>
            </div>

            {currentWindow !== null ? (
              <div className="financial-state-card">
                <CalendarClock size={18} />
                <div>
                  <strong>Exact next committed window</strong>
                  <p>
                    #{currentWindow.index.toString()} · {timeLabel(currentWindow.notBefore)} –{" "}
                    {timeLabel(currentWindow.notAfter)}
                  </p>
                  <span>
                    {nowSeconds < currentWindow.notBefore
                      ? "Future"
                      : nowSeconds > currentWindow.notAfter
                        ? "Expired"
                        : "Due now"}
                  </span>
                </div>
              </div>
            ) : null}

            <label>
              <span>Confidential funding amount</span>
              <div className="financial-input-unit">
                <input
                  inputMode="decimal"
                  value={fundingAmount}
                  placeholder="1.00"
                  onChange={(event) => {
                    setFundingAmount(event.target.value);
                    exact.discardReview();
                  }}
                />
                <small>{tokenSymbol}</small>
              </div>
            </label>

            <div className="workspace-inline-actions">
              <button
                className="financial-primary-button"
                type="button"
                disabled={
                  !isFundable(selectedPlan.metadata.state) || loading || exact.attempt !== null
                }
                onClick={() => {
                  void prepareFunding();
                }}
              >
                <LockKeyhole size={15} /> Encrypt & prepare funding
              </button>

              {selectedPlan.metadata.state === 1 ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  onClick={() => {
                    void stagePlanAction("pause");
                  }}
                >
                  <Pause size={15} /> Prepare pause
                </button>
              ) : null}

              {selectedPlan.metadata.state === 2 ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  onClick={() => {
                    void stagePlanAction("resume");
                  }}
                >
                  <Play size={15} /> Prepare resume
                </button>
              ) : null}

              {selectedPlan.metadata.state !== 3 ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  onClick={() => {
                    void stagePlanAction("revoke");
                  }}
                >
                  <XCircle size={15} /> Prepare revoke
                </button>
              ) : null}

              <button
                className="financial-secondary-button"
                type="button"
                onClick={() => {
                  void stagePlanAction("withdraw");
                }}
              >
                <WalletCards size={15} /> Prepare Vault funds withdrawal
              </button>

              {currentWindow !== null && selectedPlan.metadata.state === 1 ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={
                    nowSeconds < currentWindow.notBefore || nowSeconds > currentWindow.notAfter
                  }
                  onClick={() => {
                    void stagePlanAction("execute");
                  }}
                >
                  <Play size={15} /> Prepare due execution
                </button>
              ) : null}

              {currentWindow !== null &&
              selectedPlan.metadata.state !== 3 &&
              selectedPlan.metadata.state !== 4 ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  onClick={() => {
                    void stagePlanAction("skip");
                  }}
                >
                  <SkipForward size={15} /> Prepare skip next
                </button>
              ) : null}

              {currentWindow !== null &&
              nowSeconds > currentWindow.notAfter &&
              selectedPlan.metadata.state !== 3 &&
              selectedPlan.metadata.state !== 4 ? (
                <button
                  className="financial-secondary-button"
                  type="button"
                  onClick={() => {
                    void stagePlanAction("advance");
                  }}
                >
                  <RefreshCw size={15} /> Prepare missed-window advance
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </article>

      <ExactActionReviewCard controller={exact} />

      {notice !== null ? (
        <div className="financial-state-card warning">
          <ShieldCheck size={18} />
          <div>
            <strong>Autopilot notice</strong>
            <p>{notice}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
