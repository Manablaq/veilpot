export const GATE1C2B_ASSIGNMENT_CHUNK_SIZE = 8;
export const GATE1C2B_MAX_PARTICIPANTS = 128;

const requireNonNegative = (value: bigint, name: string): void => {
  if (value < 0n) {
    throw new RangeError(name + " must be non-negative");
  }
};

export type EntitlementAssignmentState = "Assigning" | "Claimable";

export interface HistoricalAssignmentSlot {
  readonly slotIndex: bigint;
  readonly owner: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly bound: boolean;
  readonly eligible: boolean;
  readonly winner: boolean;
}

export interface AssignedEntitlement {
  readonly drawId: bigint;
  readonly slotIndex: bigint;
  readonly owner: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly bound: boolean;
  readonly eligible: boolean;
  readonly entitlement: bigint;
}

export interface EntitlementAssignmentSnapshot {
  readonly state: EntitlementAssignmentState;
  readonly drawId: bigint;
  readonly participantCount: number;
  readonly assignmentCursor: number;
  readonly assignedTotal: bigint;
  readonly frozenPrize: bigint;
  readonly remaining: bigint;
  readonly accountedReserveAssets: bigint;
  readonly outstandingPrizeLiabilities: bigint;
}

export interface AssignmentChunkResult {
  readonly start: number;
  readonly end: number;
  readonly processed: number;
  readonly state: EntitlementAssignmentState;
}

export class Gate1C2BEntitlementAssignmentModel {
  private readonly slots: HistoricalAssignmentSlot[];
  private readonly assignments: (AssignedEntitlement | undefined)[];

  private assignmentCursorValue = 0;
  private assignedTotalValue = 0n;
  private assignmentState: EntitlementAssignmentState = "Assigning";

  public constructor(
    private readonly canonicalReserve: string,
    private readonly drawIdValue: bigint,
    private readonly frozenPrizeValue: bigint,
    historicalSlots: readonly HistoricalAssignmentSlot[],
    private readonly accountedReserveAssetsValue: bigint,
    private readonly outstandingPrizeLiabilitiesValue: bigint,
    private readonly remainingValue: bigint,
  ) {
    if (canonicalReserve.length === 0) {
      throw new Error("canonical reserve is required");
    }

    if (drawIdValue <= 0n) {
      throw new RangeError("drawId must be positive");
    }

    if (frozenPrizeValue <= 0n) {
      throw new RangeError("frozenPrize must be positive");
    }

    requireNonNegative(accountedReserveAssetsValue, "accountedReserveAssets");
    requireNonNegative(outstandingPrizeLiabilitiesValue, "outstandingPrizeLiabilities");
    requireNonNegative(remainingValue, "remaining");

    if (historicalSlots.length === 0 || historicalSlots.length > GATE1C2B_MAX_PARTICIPANTS) {
      throw new RangeError("participant count outside Gate 1C.2B envelope");
    }

    if (remainingValue !== frozenPrizeValue) {
      throw new Error("assignment must begin from the frozen prize residual");
    }

    if (outstandingPrizeLiabilitiesValue < frozenPrizeValue) {
      throw new Error("frozen prize exceeds outstanding liabilities");
    }

    if (accountedReserveAssetsValue < outstandingPrizeLiabilitiesValue) {
      throw new Error("reserve is insolvent before assignment");
    }

    this.slots = historicalSlots.map((slot, index) => {
      requireNonNegative(slot.slotIndex, "slotIndex");
      requireNonNegative(slot.registrationVersion, "registrationVersion");
      requireNonNegative(slot.reservationNonce, "reservationNonce");

      if (slot.slotIndex !== BigInt(index)) {
        throw new Error("historical slots must be fixed and contiguous");
      }

      return {
        slotIndex: slot.slotIndex,
        owner: slot.owner,
        registrationVersion: slot.registrationVersion,
        reservationNonce: slot.reservationNonce,
        bound: slot.bound,
        eligible: slot.eligible,
        winner: slot.winner,
      };
    });

    this.assignments = new Array<AssignedEntitlement | undefined>(this.slots.length);
  }

  public deriveEntitlement(caller: string, slotIndex: bigint): bigint {
    if (caller !== this.canonicalReserve) {
      throw new Error("only canonical reserve may derive entitlement");
    }

    const slot = this.requireSlot(slotIndex);

    if (!slot.bound || !slot.eligible || !slot.winner) {
      return 0n;
    }

    return this.frozenPrizeValue;
  }

  public assignNextChunk(expectedCursor: number): AssignmentChunkResult {
    if (this.assignmentState !== "Assigning") {
      throw new Error("assignment already complete");
    }

    if (!Number.isInteger(expectedCursor) || expectedCursor < 0) {
      throw new RangeError("invalid assignment cursor");
    }

    if (expectedCursor !== this.assignmentCursorValue) {
      throw new Error("assignment cursor mismatch");
    }

    if (this.assignmentCursorValue >= this.slots.length) {
      throw new Error("assignment cursor already complete");
    }

    const start = this.assignmentCursorValue;

    const end = Math.min(start + GATE1C2B_ASSIGNMENT_CHUNK_SIZE, this.slots.length);

    const pending: AssignedEntitlement[] = [];

    let projectedAssignedTotal = this.assignedTotalValue;

    for (let index = start; index < end; index += 1) {
      if (this.assignments[index] !== undefined) {
        throw new Error("historical slot already assigned");
      }

      const slot = this.slots[index]!;

      const entitlement = this.deriveEntitlement(this.canonicalReserve, slot.slotIndex);

      pending.push({
        drawId: this.drawIdValue,
        slotIndex: slot.slotIndex,
        owner: slot.owner,
        registrationVersion: slot.registrationVersion,
        reservationNonce: slot.reservationNonce,
        bound: slot.bound,
        eligible: slot.eligible,
        entitlement,
      });

      projectedAssignedTotal += entitlement;
    }

    if (end === this.slots.length && projectedAssignedTotal !== this.frozenPrizeValue) {
      throw new Error("assignment conservation mismatch");
    }

    for (const record of pending) {
      this.assignments[Number(record.slotIndex)] = record;
    }

    this.assignedTotalValue = projectedAssignedTotal;

    this.assignmentCursorValue = end;

    if (end === this.slots.length) {
      this.assignmentState = "Claimable";
    }

    return {
      start,
      end,
      processed: end - start,
      state: this.assignmentState,
    };
  }

  public entitlementRecord(slotIndex: bigint): AssignedEntitlement | null {
    const slot = this.requireSlot(slotIndex);

    const record = this.assignments[Number(slot.slotIndex)];

    if (record === undefined) {
      return null;
    }

    return {
      drawId: record.drawId,
      slotIndex: record.slotIndex,
      owner: record.owner,
      registrationVersion: record.registrationVersion,
      reservationNonce: record.reservationNonce,
      bound: record.bound,
      eligible: record.eligible,
      entitlement: record.entitlement,
    };
  }

  public historicalIdentity(slotIndex: bigint): Omit<HistoricalAssignmentSlot, "winner"> {
    const slot = this.requireSlot(slotIndex);

    return {
      slotIndex: slot.slotIndex,
      owner: slot.owner,
      registrationVersion: slot.registrationVersion,
      reservationNonce: slot.reservationNonce,
      bound: slot.bound,
      eligible: slot.eligible,
    };
  }

  public snapshot(): EntitlementAssignmentSnapshot {
    return {
      state: this.assignmentState,
      drawId: this.drawIdValue,
      participantCount: this.slots.length,
      assignmentCursor: this.assignmentCursorValue,
      assignedTotal: this.assignedTotalValue,
      frozenPrize: this.frozenPrizeValue,
      remaining: this.remainingValue,
      accountedReserveAssets: this.accountedReserveAssetsValue,
      outstandingPrizeLiabilities: this.outstandingPrizeLiabilitiesValue,
    };
  }

  private requireSlot(slotIndex: bigint): HistoricalAssignmentSlot {
    if (slotIndex < 0n || slotIndex >= BigInt(this.slots.length)) {
      throw new RangeError("invalid historical slot");
    }

    return this.slots[Number(slotIndex)]!;
  }
}
