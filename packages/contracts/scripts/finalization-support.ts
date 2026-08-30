export type EvidenceExecutionMode = "STATE_CHANGING_TRANSACTION" | "STATICCALL_REJECTION";

export type EvidenceRecord = Record<string, unknown>;

export interface FinalizationInvocationLike {
  readonly invocationId: string;
  readonly runnerMode: string;
  readonly status: string;
  readonly stage: string;
  readonly completedAt?: string;
}

export function normalizeEvidenceRecord(record: EvidenceRecord): EvidenceRecord {
  if (record.executionMode !== undefined) return record;
  if (record.transactionHash !== undefined) {
    return {
      ...record,
      executionMode: "STATE_CHANGING_TRANSACTION" satisfies EvidenceExecutionMode,
      ethereumTransactionBroadcast: true,
    };
  }
  if (record.actual === "REVERTED") {
    return {
      ...record,
      executionMode: "STATICCALL_REJECTION" satisfies EvidenceExecutionMode,
      ethereumTransactionBroadcast: false,
    };
  }
  const label = typeof record.label === "string" ? record.label : "";
  if (
    label.includes("valid-proof") ||
    label.includes("proof-accepted") ||
    label === "failure-retry-after-proven-failure"
  ) {
    return {
      ...record,
      executionMode: "STATE_CHANGING_TRANSACTION" satisfies EvidenceExecutionMode,
      ethereumTransactionBroadcast: true,
    };
  }
  return record;
}

export function normalizeEvidenceRecords(records: readonly EvidenceRecord[]): EvidenceRecord[] {
  return records.map(normalizeEvidenceRecord);
}

export function assertFinalizationPreconditions(notes: readonly string[]): void {
  const required = [
    "zero-total-complete",
    "prefix-measurements-complete",
    "interruption-resume-complete",
    "failure-retry-drill-accepted",
    "unauthorized-user-decrypt-total-denied",
  ];
  const missing = required.filter((note) => !notes.includes(note));
  if (missing.length > 0) {
    throw new Error(`finalization evidence is incomplete: ${missing.join(", ")}`);
  }
}

export function assertTerminalFinalizationInvocation(invocation: FinalizationInvocationLike): void {
  if (
    invocation.runnerMode !== "finalize" ||
    invocation.status !== "COMPLETED" ||
    invocation.stage !== "runner-completed" ||
    invocation.completedAt === undefined
  ) {
    throw new Error("finalization invocation is not terminal before evidence emission");
  }
}

export function assertFinalBundleSummary(
  summary: EvidenceRecord,
  expectedInvocationId: string,
): void {
  if (summary.finalGateDecision !== "PASS" || summary.finalizationStatus !== "FINALIZED") {
    throw new Error("final Gate 0 decision is not PASS/FINALIZED");
  }
  if (summary.finalizationInvocationId !== expectedInvocationId) {
    throw new Error("finalization invocation binding is missing");
  }
}
