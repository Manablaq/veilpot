import { randomUUID } from "node:crypto";
import { open, readFile, unlink, writeFile } from "node:fs/promises";

export type InvocationStatus = "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED" | "BOUNDED_STOP";

export type RunnerMode = "primary" | "primary-interrupt" | "failure-retry-drill" | "finalize";

export interface LiveInvocation {
  readonly invocationId: string;
  readonly runnerMode: RunnerMode;
  readonly startedAt: string;
  readonly startingConfirmedNonce: number;
  readonly toolingCommit: string;
  readonly deployerAddress: string;
  status: InvocationStatus;
  stage: string;
  completedAt?: string;
  failure?: Record<string, unknown>;
}

export interface LiveRunLock {
  readonly invocationId: string;
  readonly runnerMode: RunnerMode;
  readonly startedAt: string;
  readonly startingConfirmedNonce: number;
  readonly toolingCommit: string;
  readonly deployerAddress: string;
  readonly pid: number;
  status: InvocationStatus;
  stage: string;
}

export const STATE_BUCKET_READY = 1n;
export const STATE_AWAITING_CANDIDATE_BATCH = 2n;
export const STATE_AWAITING_BATCH_PROOF = 3n;
export const STATE_CANDIDATE_ACCEPTED = 4n;

export type FailureDrillAction =
  | "GENERATE_NEXT_BATCH"
  | "PROCESS_CURRENT_BATCH"
  | "STOP_ACCEPTED"
  | "BOUNDED_STOP";

/**
 * Pure resume policy used by the live runner and local regression tests. The
 * generated count is per invocation, so a resumed historical probe receives a
 * new explicit bound instead of silently inheriting an unlimited loop.
 */
export function nextFailureDrillAction(
  state: bigint,
  generatedThisInvocation: number,
  maximumNewBatches: number,
): FailureDrillAction {
  if (maximumNewBatches < 1) throw new Error("failure drill batch bound must be positive");
  if (state === STATE_CANDIDATE_ACCEPTED) return "STOP_ACCEPTED";
  if (state === STATE_AWAITING_BATCH_PROOF) return "PROCESS_CURRENT_BATCH";
  if (state === STATE_BUCKET_READY || state === STATE_AWAITING_CANDIDATE_BATCH) {
    return generatedThisInvocation >= maximumNewBatches ? "BOUNDED_STOP" : "GENERATE_NEXT_BATCH";
  }
  throw new Error(`unsupported failure-drill resume state ${state.toString()}`);
}

export function createInvocation(
  runnerMode: RunnerMode,
  startingConfirmedNonce: number,
  toolingCommit: string,
  deployerAddress: string,
): LiveInvocation {
  const startedAt = new Date().toISOString();
  return {
    invocationId: randomUUID(),
    runnerMode,
    startedAt,
    startingConfirmedNonce,
    toolingCommit,
    deployerAddress,
    status: "RUNNING",
    stage: "created-before-live-mutation",
  };
}

function lockPayload(invocation: LiveInvocation): LiveRunLock {
  return {
    invocationId: invocation.invocationId,
    runnerMode: invocation.runnerMode,
    startedAt: invocation.startedAt,
    startingConfirmedNonce: invocation.startingConfirmedNonce,
    toolingCommit: invocation.toolingCommit,
    deployerAddress: invocation.deployerAddress,
    pid: process.pid,
    status: invocation.status,
    stage: invocation.stage,
  };
}

/** Atomically acquires the lock; an existing lock is always fail-closed. */
export async function acquireLiveRunLock(path: string, invocation: LiveInvocation): Promise<void> {
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(lockPayload(invocation), null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "EEXIST") {
      let existing = "unreadable";
      try {
        existing = (await readFile(path, "utf8")).trim() || "empty";
      } catch {
        // The lock still exists and must remain fail-closed.
      }
      throw new Error(
        `live runner lock already exists; inspect explicit stale-lock recovery before retrying (${existing})`,
      );
    }
    throw error;
  }
}

export async function updateLiveRunLock(path: string, invocation: LiveInvocation): Promise<void> {
  await writeFile(path, `${JSON.stringify(lockPayload(invocation), null, 2)}\n`, "utf8");
}

/** Only normal, explicitly recorded completion releases an acquired lock. */
export async function releaseLiveRunLock(path: string): Promise<void> {
  await unlink(path);
}

export function appendToolingRevision(
  existing: readonly string[] | undefined,
  originalToolingCommit: string,
  currentToolingCommit: string,
): string[] {
  const revisions = [...(existing ?? [originalToolingCommit])];
  if (!revisions.includes(currentToolingCommit)) revisions.push(currentToolingCommit);
  return revisions;
}
