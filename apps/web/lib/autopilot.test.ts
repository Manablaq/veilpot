import assert from "node:assert/strict";
import test from "node:test";

import type { Address, Hex } from "@veilpot/protocol-sdk";

import {
  AUTOPILOT_SCHEDULE_STORAGE_KEY,
  buildRecurringAutopilotWindows,
  saveAutopilotScheduleRecord,
  type PersistedAutopilotScheduleRecord,
  findAutopilotScheduleRecord,
  loadAutopilotScheduleRecords,
  reconcileAutopilotPlanMetadata,
  validateAutopilotDiscoveryEvents,
  type AutopilotPlanCreatedEventSnapshot,
  type AutopilotPlanMetadataSnapshot,
} from "./autopilot";

void test("weekly schedules use the next eligible UTC occurrence and exact inclusive window", () => {
  const now = Date.UTC(2026, 8, 4, 5, 0, 0, 0);

  const windows = buildRecurringAutopilotWindows(
    {
      cadence: "weekly",
      day: "Friday",
      time: "08:00",
      windowHours: 2,
      executionCount: 2,
    },
    now,
  );

  const first = BigInt(Date.UTC(2026, 8, 4, 8, 0, 0, 0) / 1000);

  assert.equal(windows.length, 2);
  assert.equal(windows[0]?.notBefore, first);
  assert.equal(windows[0]?.notAfter, first + 7_199n);
  assert.equal(windows[1]?.notBefore, first + 604_800n);
});

void test("weekly schedules roll forward when the chosen time is inside the preparation lead", () => {
  const now = Date.UTC(2026, 8, 4, 7, 58, 0, 0);

  const windows = buildRecurringAutopilotWindows(
    {
      cadence: "weekly",
      day: "Friday",
      time: "08:00",
      windowHours: 1,
      executionCount: 1,
    },
    now,
  );

  assert.equal(windows[0]?.notBefore, BigInt(Date.UTC(2026, 8, 11, 8, 0, 0, 0) / 1000));
});

void test("monthly schedules preserve UTC day and time across months", () => {
  const now = Date.UTC(2026, 8, 20, 10, 0, 0, 0);

  const windows = buildRecurringAutopilotWindows(
    {
      cadence: "monthly",
      day: "15",
      time: "09:30",
      windowHours: 3,
      executionCount: 3,
    },
    now,
  );

  assert.equal(windows[0]?.notBefore, BigInt(Date.UTC(2026, 9, 15, 9, 30, 0, 0) / 1000));
  assert.equal(windows[1]?.notBefore, BigInt(Date.UTC(2026, 10, 15, 9, 30, 0, 0) / 1000));
  assert.equal(windows[2]?.notBefore, BigInt(Date.UTC(2026, 11, 15, 9, 30, 0, 0) / 1000));
});

void test("invalid schedule inputs fail closed", () => {
  assert.throws(() =>
    buildRecurringAutopilotWindows({
      cadence: "weekly",
      day: "Friday",
      time: "25:00",
      windowHours: 2,
      executionCount: 12,
    }),
  );

  assert.throws(() =>
    buildRecurringAutopilotWindows({
      cadence: "monthly",
      day: "31",
      time: "08:00",
      windowHours: 2,
      executionCount: 12,
    }),
  );

  assert.throws(() =>
    buildRecurringAutopilotWindows({
      cadence: "weekly",
      day: "Friday",
      time: "08:00",
      windowHours: 0,
      executionCount: 12,
    }),
  );

  assert.throws(() =>
    buildRecurringAutopilotWindows({
      cadence: "weekly",
      day: "Friday",
      time: "08:00",
      windowHours: 2,
      executionCount: 1025,
    }),
  );
});

void test("schedule persistence replaces one plan record instead of duplicating it", () => {
  let persisted: string | null = null;

  const storage = {
    getItem(key: string) {
      assert.equal(key, AUTOPILOT_SCHEDULE_STORAGE_KEY);
      return persisted;
    },
    setItem(key: string, value: string) {
      assert.equal(key, AUTOPILOT_SCHEDULE_STORAGE_KEY);
      persisted = value;
    },
  };

  const owner = "0x1111111111111111111111111111111111111111" as Address;
  const vault = "0x2222222222222222222222222222222222222222" as Address;
  const planId: Hex = `0x${"33".repeat(32)}`;
  const scheduleRoot: Hex = `0x${"44".repeat(32)}`;
  const creationTxHash: Hex = `0x${"55".repeat(32)}`;

  const record: PersistedAutopilotScheduleRecord = {
    version: 1,
    chainId: 11155111,
    vault,
    owner,
    planId,
    scheduleRoot,
    executionCount: 1,
    creationTxHash,
    windows: [
      {
        index: "0",
        notBefore: "100",
        notAfter: "200",
        proof: [] as readonly Hex[],
      },
    ],
  };

  saveAutopilotScheduleRecord(storage, record);
  saveAutopilotScheduleRecord(storage, record);

  assert.ok(persisted);
  const parsed = JSON.parse(persisted) as unknown[];
  assert.equal(parsed.length, 1);
});

function discoveryStorage(initial: string | null) {
  let value = initial;

  return {
    getItem(key: string): string | null {
      assert.equal(key, AUTOPILOT_SCHEDULE_STORAGE_KEY);
      return value;
    },
    setItem(key: string, nextValue: string): void {
      assert.equal(key, AUTOPILOT_SCHEDULE_STORAGE_KEY);
      value = nextValue;
    },
  };
}

void test("schedule loading is scoped and local root matching is exact", () => {
  const owner: Address = "0x1111111111111111111111111111111111111111";
  const otherOwner: Address = "0x2222222222222222222222222222222222222222";
  const vault: Address = "0x3333333333333333333333333333333333333333";
  const planId: Hex = `0x${"44".repeat(32)}`;
  const otherPlanId: Hex = `0x${"45".repeat(32)}`;
  const scheduleRoot: Hex = `0x${"55".repeat(32)}`;
  const wrongRoot: Hex = `0x${"56".repeat(32)}`;
  const creationTxHash: Hex = `0x${"66".repeat(32)}`;

  const record: PersistedAutopilotScheduleRecord = {
    version: 1,
    chainId: 11155111,
    vault,
    owner,
    planId,
    scheduleRoot,
    executionCount: 1,
    creationTxHash,
    windows: [
      {
        index: "0",
        notBefore: "100",
        notAfter: "199",
        proof: [],
      },
    ],
  };

  const storage = discoveryStorage(
    JSON.stringify([
      record,
      {
        ...record,
        owner: otherOwner,
        planId: otherPlanId,
      },
    ]),
  );

  const records = loadAutopilotScheduleRecords(storage, {
    chainId: 11155111,
    vault,
    owner,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.planId, planId);

  const matched = findAutopilotScheduleRecord(records, {
    chainId: 11155111,
    vault,
    owner,
    planId,
    scheduleRoot,
    executionCount: 1,
  });

  assert.equal(matched?.planId, planId);

  const mismatched = findAutopilotScheduleRecord(records, {
    chainId: 11155111,
    vault,
    owner,
    planId,
    scheduleRoot: wrongRoot,
    executionCount: 1,
  });

  assert.equal(mismatched, null);
});

void test("malformed schedule storage fails closed", () => {
  const owner: Address = "0x1111111111111111111111111111111111111111";
  const vault: Address = "0x3333333333333333333333333333333333333333";

  assert.throws(
    () =>
      loadAutopilotScheduleRecords(discoveryStorage("[{}]"), {
        chainId: 11155111,
        vault,
        owner,
      }),
    /malformed/,
  );
});

void test("owner discovery requires a complete sequential PlanCreated log set", () => {
  const owner: Address = "0x1111111111111111111111111111111111111111";

  const first: AutopilotPlanCreatedEventSnapshot = {
    planId: `0x${"71".repeat(32)}`,
    owner,
    planNonce: 0n,
    slotIndex: 2n,
    registrationVersion: 1n,
    reservationNonce: 9n,
    executionCount: 12,
    scheduleRoot: `0x${"81".repeat(32)}`,
  };

  const second: AutopilotPlanCreatedEventSnapshot = {
    ...first,
    planId: `0x${"72".repeat(32)}`,
    planNonce: 1n,
    reservationNonce: 10n,
    scheduleRoot: `0x${"82".repeat(32)}`,
  };

  const ordered = validateAutopilotDiscoveryEvents([second, first], owner, 2n);

  assert.deepEqual(
    ordered.map((event) => event.planNonce),
    [0n, 1n],
  );

  assert.throws(
    () => validateAutopilotDiscoveryEvents([first], owner, 2n),
    /complete sequential PlanCreated log set/,
  );
});

void test("live plan metadata must match its event binding", () => {
  const owner: Address = "0x1111111111111111111111111111111111111111";

  const event: AutopilotPlanCreatedEventSnapshot = {
    planId: `0x${"91".repeat(32)}`,
    owner,
    planNonce: 0n,
    slotIndex: 3n,
    registrationVersion: 1n,
    reservationNonce: 14n,
    executionCount: 8,
    scheduleRoot: `0x${"92".repeat(32)}`,
  };

  const metadata: AutopilotPlanMetadataSnapshot = {
    state: 1,
    owner,
    slotIndex: 3n,
    registrationVersion: 1n,
    reservationNonce: 14n,
    planNonce: 0n,
    scheduleRoot: event.scheduleRoot,
    executionCount: 8,
    nextExecutionIndex: 0,
    lastWindowNotAfter: 0n,
  };

  assert.equal(reconcileAutopilotPlanMetadata(event, metadata), metadata);

  assert.throws(
    () =>
      reconcileAutopilotPlanMetadata(event, {
        ...metadata,
        scheduleRoot: `0x${"93".repeat(32)}`,
      }),
    /does not match/,
  );
});
