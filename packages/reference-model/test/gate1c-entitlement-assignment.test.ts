import { expect } from "chai";

import {
  GATE1C2B_ASSIGNMENT_CHUNK_SIZE,
  Gate1C2BEntitlementAssignmentModel,
  type HistoricalAssignmentSlot,
} from "../src/gate1c-entitlement-assignment.js";

const RESERVE = "canonical-reserve";
const DRAW_ID = 7n;
const PRIZE = 100n;
const ASSETS = 500n;
const LIABILITIES = 300n;

const historicalSlot = (
  index: number,
  overrides: Partial<HistoricalAssignmentSlot> = {},
): HistoricalAssignmentSlot => ({
  slotIndex: BigInt(index),
  owner: "owner-" + index.toString(),
  registrationVersion: 1n,
  reservationNonce: BigInt(1000 + index),
  bound: true,
  eligible: true,
  winner: false,
  ...overrides,
});

const historicalSlots = (count: number, winnerIndex: number | null): HistoricalAssignmentSlot[] =>
  Array.from({ length: count }, (_, index) =>
    historicalSlot(index, winnerIndex === index ? { winner: true } : {}),
  );

const modelFor = (slots: readonly HistoricalAssignmentSlot[]): Gate1C2BEntitlementAssignmentModel =>
  new Gate1C2BEntitlementAssignmentModel(
    RESERVE,
    DRAW_ID,
    PRIZE,
    slots,
    ASSETS,
    LIABILITIES,
    PRIZE,
  );

const requiredRecord = (model: Gate1C2BEntitlementAssignmentModel, slotIndex: bigint) => {
  const record = model.entitlementRecord(slotIndex);

  if (record === null) {
    throw new Error("expected assigned entitlement record");
  }

  return record;
};

describe("Gate 1C.2B independent entitlement-assignment oracle", function () {
  it("assigns the entire frozen prize to exactly one historical winner", function () {
    const model = modelFor(historicalSlots(8, 3));

    const chunk = model.assignNextChunk(0);

    expect(chunk.start).to.equal(0);
    expect(chunk.end).to.equal(8);
    expect(chunk.processed).to.equal(8);
    expect(chunk.state).to.equal("Claimable");

    expect(requiredRecord(model, 3n).entitlement).to.equal(PRIZE);

    expect(model.snapshot().assignedTotal).to.equal(PRIZE);

    expect(model.snapshot().state).to.equal("Claimable");
  });

  it("assigns zero to every nonwinner and never stores winner metadata in entitlement records", function () {
    const model = modelFor(historicalSlots(8, 6));

    model.assignNextChunk(0);

    for (let index = 0; index < 8; index += 1) {
      const record = requiredRecord(model, BigInt(index));

      expect(record.entitlement).to.equal(index === 6 ? PRIZE : 0n);

      expect("winner" in record).to.equal(false);
    }
  });

  it("cannot give value to unbound or ineligible slots even if malformed winner bits are supplied", function () {
    const slots = historicalSlots(8, 5);

    slots[1] = historicalSlot(1, {
      bound: false,
      winner: true,
    });

    slots[2] = historicalSlot(2, {
      eligible: false,
      winner: true,
    });

    const model = modelFor(slots);

    model.assignNextChunk(0);

    expect(requiredRecord(model, 1n).entitlement).to.equal(0n);

    expect(requiredRecord(model, 2n).entitlement).to.equal(0n);

    expect(requiredRecord(model, 5n).entitlement).to.equal(PRIZE);

    expect(model.snapshot().assignedTotal).to.equal(PRIZE);
  });

  it("copies immutable historical beneficiary identity instead of retaining mutable caller objects", function () {
    const mutable = {
      slotIndex: 0n,
      owner: "historical-owner",
      registrationVersion: 2n,
      reservationNonce: 19n,
      bound: true,
      eligible: true,
      winner: true,
    };

    const slots: HistoricalAssignmentSlot[] = [
      mutable,
      ...historicalSlots(7, null).map((slot, index) => ({
        ...slot,
        slotIndex: BigInt(index + 1),
        owner: "owner-" + (index + 1).toString(),
        reservationNonce: BigInt(2000 + index),
      })),
    ];

    const model = modelFor(slots);

    mutable.owner = "replacement-owner";
    mutable.registrationVersion = 99n;
    mutable.reservationNonce = 999n;
    mutable.bound = false;

    model.assignNextChunk(0);

    const record = requiredRecord(model, 0n);

    expect(record.owner).to.equal("historical-owner");
    expect(record.registrationVersion).to.equal(2n);
    expect(record.reservationNonce).to.equal(19n);
    expect(record.bound).to.equal(true);
    expect(record.entitlement).to.equal(PRIZE);
  });

  it("uses fixed chunks of eight and never early-stops after processing the winner", function () {
    expect(GATE1C2B_ASSIGNMENT_CHUNK_SIZE).to.equal(8);

    const model = modelFor(historicalSlots(17, 0));

    const first = model.assignNextChunk(0);

    expect(first.processed).to.equal(8);
    expect(first.end).to.equal(8);
    expect(first.state).to.equal("Assigning");
    expect(model.snapshot().assignmentCursor).to.equal(8);

    const second = model.assignNextChunk(8);

    expect(second.processed).to.equal(8);
    expect(second.end).to.equal(16);
    expect(second.state).to.equal("Assigning");
    expect(model.snapshot().assignmentCursor).to.equal(16);

    const third = model.assignNextChunk(16);

    expect(third.processed).to.equal(1);
    expect(third.end).to.equal(17);
    expect(third.state).to.equal("Claimable");
    expect(model.snapshot().assignmentCursor).to.equal(17);
  });

  it("rejects out-of-order, replayed, and stale assignment cursors", function () {
    const model = modelFor(historicalSlots(9, 8));

    expect(() => {
      model.assignNextChunk(1);
    }).to.throw("assignment cursor mismatch");

    model.assignNextChunk(0);

    expect(() => {
      model.assignNextChunk(0);
    }).to.throw("assignment cursor mismatch");

    expect(() => {
      model.assignNextChunk(9);
    }).to.throw("assignment cursor mismatch");

    const final = model.assignNextChunk(8);

    expect(final.state).to.equal("Claimable");
  });

  it("conserves the frozen prize exactly across a valid multi-chunk assignment", function () {
    const model = modelFor(historicalSlots(16, 14));

    model.assignNextChunk(0);

    expect(model.snapshot().assignedTotal).to.equal(0n);

    expect(model.snapshot().state).to.equal("Assigning");

    model.assignNextChunk(8);

    expect(model.snapshot().assignedTotal).to.equal(PRIZE);

    expect(model.snapshot().frozenPrize).to.equal(PRIZE);

    expect(model.snapshot().state).to.equal("Claimable");
  });

  it("rejects no-winner and multiple-winner malformed inputs through the conservation oracle", function () {
    const noWinner = modelFor(historicalSlots(8, null));

    expect(() => {
      noWinner.assignNextChunk(0);
    }).to.throw("assignment conservation mismatch");

    expect(noWinner.snapshot().assignmentCursor).to.equal(0);

    expect(noWinner.snapshot().assignedTotal).to.equal(0n);

    const twoWinners = historicalSlots(8, 2);

    twoWinners[5] = historicalSlot(5, { winner: true });

    const duplicate = modelFor(twoWinners);

    expect(() => {
      duplicate.assignNextChunk(0);
    }).to.throw("assignment conservation mismatch");

    expect(duplicate.snapshot().assignmentCursor).to.equal(0);

    expect(duplicate.snapshot().assignedTotal).to.equal(0n);
  });

  it("cannot mutate prize remaining, reserve assets, or outstanding liabilities during assignment", function () {
    const model = modelFor(historicalSlots(12, 10));

    const before = model.snapshot();

    model.assignNextChunk(0);

    const middle = model.snapshot();

    expect(middle.remaining).to.equal(before.remaining);
    expect(middle.accountedReserveAssets).to.equal(before.accountedReserveAssets);
    expect(middle.outstandingPrizeLiabilities).to.equal(before.outstandingPrizeLiabilities);

    model.assignNextChunk(8);

    const after = model.snapshot();

    expect(after.remaining).to.equal(before.remaining);
    expect(after.accountedReserveAssets).to.equal(before.accountedReserveAssets);
    expect(after.outstandingPrizeLiabilities).to.equal(before.outstandingPrizeLiabilities);

    expect(after.assignedTotal).to.equal(PRIZE);
    expect(after.state).to.equal("Claimable");
  });

  it("allows entitlement derivation only for the canonical reserve while assignment itself needs no participant authorization", function () {
    const model = modelFor(historicalSlots(8, 4));

    expect(() => {
      model.deriveEntitlement("attacker-contract", 4n);
    }).to.throw("only canonical reserve may derive entitlement");

    expect(model.deriveEntitlement(RESERVE, 4n)).to.equal(PRIZE);

    const chunk = model.assignNextChunk(0);

    expect(chunk.processed).to.equal(8);
    expect(chunk.state).to.equal("Claimable");
  });
});
