import { rename, rm } from "node:fs/promises";
import { join } from "node:path";

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
      executionModeEvidence: "RECEIPT_BACKED_TRANSACTION",
    };
  }
  if (record.actual === "REVERTED") {
    return {
      ...record,
      executionMode: "STATICCALL_REJECTION" satisfies EvidenceExecutionMode,
      ethereumTransactionBroadcast: false,
      executionModeEvidence: "LEGACY_EXPECTED_FAILURE_STATICCALL_PATH",
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

export interface StagedBundlePublicationOptions {
  readonly stagingDirectory: string;
  readonly outputDirectory: string;
  readonly componentFilenames: readonly string[];
  readonly markerFilename: string;
  readonly hashFile: (path: string) => Promise<string>;
  readonly validatePublished: () => Promise<void>;
  readonly renameFile?: (source: string, destination: string) => Promise<void>;
  readonly removeFile?: (path: string) => Promise<void>;
}

/**
 * Publishes a validated component set and writes the marker last. Removing any
 * prior marker first ensures a failed replacement cannot leave a valid snapshot.
 */
export async function publishStagedBundle(options: StagedBundlePublicationOptions): Promise<void> {
  const renameFile = options.renameFile ?? ((source, destination) => rename(source, destination));
  const removeFile = options.removeFile ?? ((path) => rm(path, { force: true }));
  const markerPath = join(options.outputDirectory, options.markerFilename);
  const stagedHashes = new Map<string, string>();
  await removeFile(markerPath);
  try {
    for (const filename of options.componentFilenames) {
      stagedHashes.set(filename, await options.hashFile(join(options.stagingDirectory, filename)));
    }
    for (const filename of options.componentFilenames) {
      await renameFile(
        join(options.stagingDirectory, filename),
        join(options.outputDirectory, filename),
      );
    }
    for (const filename of options.componentFilenames) {
      const stagedHash = stagedHashes.get(filename);
      const publishedHash = await options.hashFile(join(options.outputDirectory, filename));
      if (stagedHash !== publishedHash) {
        throw new Error(`published artifact hash mismatch for ${filename}`);
      }
    }
    await renameFile(join(options.stagingDirectory, options.markerFilename), markerPath);
    try {
      await options.validatePublished();
    } catch (error: unknown) {
      await removeFile(markerPath).catch(() => undefined);
      throw error;
    }
  } catch (error: unknown) {
    await removeFile(markerPath).catch(() => undefined);
    throw error;
  }
}
