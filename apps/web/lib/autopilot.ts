import type { Address, Hex } from "@veilpot/protocol-sdk";

export const AUTOPILOT_PREPARATION_LEAD_SECONDS = 300;
export const AUTOPILOT_SCHEDULE_STORAGE_KEY = "veilpot:autopilot:schedules:v1";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const WEEKDAY_INDEX: Readonly<Partial<Record<string, number>>> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

export interface RecurringAutopilotInput {
  readonly cadence: "weekly" | "monthly";
  readonly day: string;
  readonly time: string;
  readonly windowHours: number;
  readonly executionCount: number;
}

export interface RecurringAutopilotWindow {
  readonly notBefore: bigint;
  readonly notAfter: bigint;
}

export interface PersistedAutopilotScheduleWindow {
  readonly index: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly proof: readonly Hex[];
}

export interface PersistedAutopilotScheduleRecord {
  readonly version: 1;
  readonly chainId: number;
  readonly vault: Address;
  readonly owner: Address;
  readonly planId: Hex;
  readonly scheduleRoot: Hex;
  readonly executionCount: number;
  readonly creationTxHash: Hex;
  readonly windows: readonly PersistedAutopilotScheduleWindow[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseClock(value: string): readonly [number, number] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!match) {
    throw new RangeError("Autopilot start time must use 24-hour HH:MM format.");
  }

  return [Number(match[1]), Number(match[2])] as const;
}

function firstWeeklyStart(weekday: string, hour: number, minute: number, afterMs: number): number {
  const weekdayIndex = WEEKDAY_INDEX[weekday];

  if (weekdayIndex === undefined) {
    throw new RangeError("Autopilot weekly day is not recognized.");
  }

  const after = new Date(afterMs);
  const todayAtTime = Date.UTC(
    after.getUTCFullYear(),
    after.getUTCMonth(),
    after.getUTCDate(),
    hour,
    minute,
    0,
    0,
  );

  const todayIndex = new Date(todayAtTime).getUTCDay();
  const daysForward = (weekdayIndex - todayIndex + 7) % 7;
  let candidate = todayAtTime + daysForward * DAY_MS;

  if (candidate < afterMs) {
    candidate += WEEK_MS;
  }

  return candidate;
}

function firstMonthlyStart(dayText: string, hour: number, minute: number, afterMs: number): number {
  if (!/^\d+$/.test(dayText)) {
    throw new RangeError("Autopilot monthly day must be an integer from 1 through 28.");
  }

  const day = Number(dayText);

  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new RangeError("Autopilot monthly day must be between 1 and 28.");
  }

  const after = new Date(afterMs);
  let candidate = Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), day, hour, minute, 0, 0);

  if (candidate < afterMs) {
    candidate = Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, day, hour, minute, 0, 0);
  }

  return candidate;
}

export function buildRecurringAutopilotWindows(
  input: RecurringAutopilotInput,
  nowMs = Date.now(),
): readonly RecurringAutopilotWindow[] {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("Autopilot schedule clock is invalid.");
  }

  if (
    !Number.isInteger(input.executionCount) ||
    input.executionCount < 1 ||
    input.executionCount > 1024
  ) {
    throw new RangeError("Autopilot execution count must be between 1 and 1024.");
  }

  if (!Number.isInteger(input.windowHours) || input.windowHours < 1 || input.windowHours > 24) {
    throw new RangeError(
      "Autopilot execution window must be a whole number from 1 through 24 hours.",
    );
  }

  const [hour, minute] = parseClock(input.time);
  const afterMs = Math.trunc(nowMs) + AUTOPILOT_PREPARATION_LEAD_SECONDS * 1000;

  const durationSeconds = BigInt(input.windowHours * 60 * 60);

  if (input.cadence === "weekly") {
    const firstStartMs = firstWeeklyStart(input.day, hour, minute, afterMs);

    return Array.from({ length: input.executionCount }, (_, index) => {
      const startMs = firstStartMs + index * WEEK_MS;
      const notBefore = BigInt(Math.floor(startMs / 1000));
      const notAfter = notBefore + durationSeconds - 1n;

      return { notBefore, notAfter };
    });
  }

  const monthlyDay = Number(input.day);
  const firstStartMs = firstMonthlyStart(input.day, hour, minute, afterMs);
  const firstDate = new Date(firstStartMs);

  return Array.from({ length: input.executionCount }, (_, index) => {
    const startMs = Date.UTC(
      firstDate.getUTCFullYear(),
      firstDate.getUTCMonth() + index,
      monthlyDay,
      hour,
      minute,
      0,
      0,
    );

    const notBefore = BigInt(Math.floor(startMs / 1000));
    const notAfter = notBefore + durationSeconds - 1n;

    return { notBefore, notAfter };
  });
}

export function saveAutopilotScheduleRecord(
  storage: StorageLike,
  record: PersistedAutopilotScheduleRecord,
): void {
  const previous = storage.getItem(AUTOPILOT_SCHEDULE_STORAGE_KEY);

  let parsed: unknown = [];

  if (previous !== null) {
    parsed = JSON.parse(previous);
  }

  if (!isUnknownArray(parsed)) {
    throw new Error("Existing Autopilot schedule storage is malformed.");
  }

  const retained = parsed.filter((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !("planId" in entry)) return true;

    const planId = (entry as { readonly planId?: unknown }).planId;
    return typeof planId !== "string" || planId.toLowerCase() !== record.planId.toLowerCase();
  });

  storage.setItem(AUTOPILOT_SCHEDULE_STORAGE_KEY, JSON.stringify([...retained, record]));
}

export interface AutopilotScheduleScope {
  readonly chainId: number;
  readonly vault: Address;
  readonly owner: Address;
}

export interface AutopilotScheduleMatch extends AutopilotScheduleScope {
  readonly planId: Hex;
  readonly scheduleRoot: Hex;
  readonly executionCount: number;
}

export interface AutopilotPlanCreatedEventSnapshot {
  readonly planId: Hex;
  readonly owner: Address;
  readonly planNonce: bigint;
  readonly slotIndex: bigint;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly executionCount: number;
  readonly scheduleRoot: Hex;
}

export interface AutopilotPlanMetadataSnapshot {
  readonly state: number;
  readonly owner: Address;
  readonly slotIndex: bigint;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly planNonce: bigint;
  readonly scheduleRoot: Hex;
  readonly executionCount: number;
  readonly nextExecutionIndex: number;
  readonly lastWindowNotAfter: bigint;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddressValue(value: unknown): value is Address {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isBytes32Value(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isNonzeroBytes32Value(value: unknown): value is Hex {
  return isBytes32Value(value) && !/^0x0{64}$/i.test(value);
}

function isUnsignedDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value);
}

function isPersistedAutopilotScheduleWindow(
  value: unknown,
  expectedIndex: number,
): value is PersistedAutopilotScheduleWindow {
  if (!isObjectRecord(value)) return false;

  if (value.index !== String(expectedIndex)) return false;
  if (!isUnsignedDecimalString(value.notBefore)) return false;
  if (!isUnsignedDecimalString(value.notAfter)) return false;

  const notBefore = BigInt(value.notBefore);
  const notAfter = BigInt(value.notAfter);

  if (notBefore > notAfter) return false;

  const proof = value.proof;

  if (!isUnknownArray(proof) || !proof.every(isBytes32Value)) {
    return false;
  }

  return true;
}

function isPersistedAutopilotScheduleRecord(
  value: unknown,
): value is PersistedAutopilotScheduleRecord {
  if (!isObjectRecord(value)) return false;

  if (value.version !== 1) return false;

  const chainId = value.chainId;
  const executionCount = value.executionCount;
  const windows = value.windows;

  if (typeof chainId !== "number" || !Number.isInteger(chainId) || chainId <= 0) {
    return false;
  }

  if (!isAddressValue(value.vault) || !isAddressValue(value.owner)) {
    return false;
  }

  if (
    !isNonzeroBytes32Value(value.planId) ||
    !isNonzeroBytes32Value(value.scheduleRoot) ||
    !isNonzeroBytes32Value(value.creationTxHash)
  ) {
    return false;
  }

  if (
    typeof executionCount !== "number" ||
    !Number.isInteger(executionCount) ||
    executionCount < 1 ||
    executionCount > 1024
  ) {
    return false;
  }

  if (!isUnknownArray(windows) || windows.length !== executionCount) {
    return false;
  }

  return windows.every((window, index) => isPersistedAutopilotScheduleWindow(window, index));
}

export function loadAutopilotScheduleRecords(
  storage: StorageLike,
  scope: AutopilotScheduleScope,
): readonly PersistedAutopilotScheduleRecord[] {
  if (
    !Number.isInteger(scope.chainId) ||
    scope.chainId <= 0 ||
    !isAddressValue(scope.vault) ||
    !isAddressValue(scope.owner)
  ) {
    throw new Error("Autopilot schedule scope is invalid.");
  }

  const stored = storage.getItem(AUTOPILOT_SCHEDULE_STORAGE_KEY);

  if (stored === null) return [];

  let parsed: unknown;

  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new Error("Stored Autopilot schedule data is malformed.");
  }

  if (!isUnknownArray(parsed)) {
    throw new Error("Stored Autopilot schedule data is malformed.");
  }

  const records: PersistedAutopilotScheduleRecord[] = [];

  for (const entry of parsed) {
    if (!isPersistedAutopilotScheduleRecord(entry)) {
      throw new Error("Stored Autopilot schedule data is malformed.");
    }

    records.push(entry);
  }

  return records.filter(
    (record) =>
      record.chainId === scope.chainId &&
      record.vault.toLowerCase() === scope.vault.toLowerCase() &&
      record.owner.toLowerCase() === scope.owner.toLowerCase(),
  );
}

export function findAutopilotScheduleRecord(
  records: readonly PersistedAutopilotScheduleRecord[],
  match: AutopilotScheduleMatch,
): PersistedAutopilotScheduleRecord | null {
  if (
    !isNonzeroBytes32Value(match.planId) ||
    !isNonzeroBytes32Value(match.scheduleRoot) ||
    !Number.isInteger(match.executionCount) ||
    match.executionCount < 1 ||
    match.executionCount > 1024
  ) {
    throw new Error("Autopilot schedule match is invalid.");
  }

  const matches = records.filter(
    (record) =>
      record.chainId === match.chainId &&
      record.vault.toLowerCase() === match.vault.toLowerCase() &&
      record.owner.toLowerCase() === match.owner.toLowerCase() &&
      record.planId.toLowerCase() === match.planId.toLowerCase() &&
      record.scheduleRoot.toLowerCase() === match.scheduleRoot.toLowerCase() &&
      record.executionCount === match.executionCount,
  );

  if (matches.length > 1) {
    throw new Error("Duplicate Autopilot schedule records were found for one plan.");
  }

  return matches[0] ?? null;
}

export function validateAutopilotDiscoveryEvents(
  events: readonly AutopilotPlanCreatedEventSnapshot[],
  owner: Address,
  nextPlanNonce: bigint,
): readonly AutopilotPlanCreatedEventSnapshot[] {
  if (!isAddressValue(owner) || nextPlanNonce < 0n) {
    throw new Error("Autopilot owner discovery input is invalid.");
  }

  if (nextPlanNonce > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Autopilot owner plan nonce exceeds the browser discovery limit.");
  }

  const expectedCount = Number(nextPlanNonce);

  if (events.length !== expectedCount) {
    throw new Error(
      "Autopilot owner discovery requires a complete sequential PlanCreated log set.",
    );
  }

  const ordered = [...events].sort((left, right) => {
    if (left.planNonce < right.planNonce) return -1;
    if (left.planNonce > right.planNonce) return 1;
    return 0;
  });

  const seenPlanIds = new Set<string>();

  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index];

    if (
      !isNonzeroBytes32Value(event.planId) ||
      !isNonzeroBytes32Value(event.scheduleRoot) ||
      !isAddressValue(event.owner) ||
      event.owner.toLowerCase() !== owner.toLowerCase() ||
      event.planNonce !== BigInt(index) ||
      event.slotIndex < 0n ||
      event.registrationVersion < 0n ||
      event.reservationNonce < 0n ||
      !Number.isInteger(event.executionCount) ||
      event.executionCount < 1 ||
      event.executionCount > 1024
    ) {
      throw new Error(
        "Autopilot owner discovery requires a complete sequential PlanCreated log set.",
      );
    }

    const normalizedPlanId = event.planId.toLowerCase();

    if (seenPlanIds.has(normalizedPlanId)) {
      throw new Error("Autopilot owner discovery contains a duplicate plan ID.");
    }

    seenPlanIds.add(normalizedPlanId);
  }

  return ordered;
}

export function reconcileAutopilotPlanMetadata(
  event: AutopilotPlanCreatedEventSnapshot,
  metadata: AutopilotPlanMetadataSnapshot,
): AutopilotPlanMetadataSnapshot {
  if (
    !Number.isInteger(metadata.state) ||
    metadata.state < 1 ||
    metadata.state > 4 ||
    !isAddressValue(metadata.owner) ||
    !isNonzeroBytes32Value(metadata.scheduleRoot) ||
    metadata.slotIndex < 0n ||
    metadata.registrationVersion < 0n ||
    metadata.reservationNonce < 0n ||
    metadata.planNonce < 0n ||
    !Number.isInteger(metadata.executionCount) ||
    metadata.executionCount < 1 ||
    metadata.executionCount > 1024 ||
    !Number.isInteger(metadata.nextExecutionIndex) ||
    metadata.nextExecutionIndex < 0 ||
    metadata.nextExecutionIndex > metadata.executionCount ||
    metadata.lastWindowNotAfter < 0n
  ) {
    throw new Error("Live Autopilot plan metadata is invalid.");
  }

  if (
    metadata.owner.toLowerCase() !== event.owner.toLowerCase() ||
    metadata.slotIndex !== event.slotIndex ||
    metadata.registrationVersion !== event.registrationVersion ||
    metadata.reservationNonce !== event.reservationNonce ||
    metadata.planNonce !== event.planNonce ||
    metadata.scheduleRoot.toLowerCase() !== event.scheduleRoot.toLowerCase() ||
    metadata.executionCount !== event.executionCount
  ) {
    throw new Error("Live Autopilot plan metadata does not match its PlanCreated event.");
  }

  return metadata;
}
