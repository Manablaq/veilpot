/** Gate 1A design model only; not production Solidity. */
export const MAX_ACTIVE_PARTICIPANTS = 128;
export const REGISTRATION_RESERVATION_TTL_SECONDS = 86_400n;
export const REGISTRATION_ACTIVATION_PROOF_TTL_SECONDS = 86_400n;
export const REGISTRATION_BOND_WEI = 1_000_000_000_000_000n; // 0.001 native ETH
export const MIN_REGISTRATION_DEPOSIT_BASE_UNITS = 1_000_000n; // one six-decimal token
export const SUPPORTED_REGISTRATION_VERSION = 1n;

export type SlotStatus =
  | "FREE"
  | "RESERVED"
  | "PENDING_ACTIVATION"
  | "PENDING_REFUND"
  | "REFUND_ATTEMPT_PENDING_PROOF"
  | "ACTIVE"
  | "TOMBSTONED";

export interface ParticipantModelConfig {
  readonly poolDomain: string;
  readonly registrationVersion: bigint;
}

export interface PoolDepositAttempt {
  readonly depositor: string;
  readonly caller: string;
  readonly now: bigint;
  readonly claimedPool: string;
  readonly claimedVersion: bigint;
  readonly reservationNonce: bigint;
  readonly depositNonce: bigint;
  readonly actualTransferred: bigint;
}

export interface ThresholdSettlement {
  readonly participant: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly proofResult: boolean;
  readonly now: bigint;
}

export interface RefundCompletionSettlement {
  readonly participant: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly refundAttemptNonce: bigint;
  readonly proofComplete: boolean;
}

interface Slot {
  status: SlotStatus;
  owner: string | null;
  registrationVersion: bigint;
  reservationNonce: bigint;
  expiry: bigint;
  bondWei: bigint;
  pendingAmount: bigint;
  operatorUntil: bigint;
  activationStartedAt: bigint;
  activationDeadline: bigint;
  refundAttemptNonce: bigint;
  refundCompletionPending: boolean;
}

/** Pool-initiated pull model with immutable domain/version configuration. */
export class ParticipantRegistryModel {
  private readonly slots: Slot[] = [];
  private reservationNonceCounter = 0n;
  private readonly nextDepositNonceByAddress = new Map<string, bigint>();
  private readonly poolDomain: string;
  private readonly registrationVersion: bigint;

  public constructor(config: ParticipantModelConfig) {
    if (config.registrationVersion !== SUPPORTED_REGISTRATION_VERSION) {
      throw new Error("unsupported registration version");
    }
    this.poolDomain = config.poolDomain;
    this.registrationVersion = config.registrationVersion;
  }

  public reserve(address: string, now: bigint): number {
    if (
      this.slots.some(
        (slot) => slot.owner === address && !["FREE", "TOMBSTONED"].includes(slot.status),
      )
    ) {
      throw new Error("already registered");
    }
    const occupied = this.slots.filter(
      (slot) => !["FREE", "TOMBSTONED"].includes(slot.status),
    ).length;
    if (occupied >= MAX_ACTIVE_PARTICIPANTS) throw new Error("capacity full");
    const index = this.slots.findIndex(
      (slot) => slot.status === "TOMBSTONED" || slot.status === "FREE",
    );
    const slot: Slot = {
      status: "RESERVED",
      owner: address,
      registrationVersion: this.registrationVersion,
      reservationNonce: ++this.reservationNonceCounter,
      expiry: now + REGISTRATION_RESERVATION_TTL_SECONDS,
      bondWei: REGISTRATION_BOND_WEI,
      pendingAmount: 0n,
      operatorUntil: 0n,
      activationStartedAt: 0n,
      activationDeadline: 0n,
      refundAttemptNonce: 0n,
      refundCompletionPending: false,
    };
    if (index === -1) this.slots.push(slot);
    else this.slots[index] = slot;
    if (!this.nextDepositNonceByAddress.has(address))
      this.nextDepositNonceByAddress.set(address, 0n);
    return index === -1 ? this.slots.length - 1 : index;
  }

  public setOperator(address: string, until: bigint): void {
    const slot = this.slots.find(
      (candidate) => candidate.owner === address && candidate.status === "RESERVED",
    );
    if (slot === undefined) throw new Error("reservation required");
    slot.operatorUntil = until;
  }

  public revokeOperator(address: string): void {
    const slot = this.slots.find((candidate) => candidate.owner === address);
    if (slot === undefined) throw new Error("reservation required");
    slot.operatorUntil = 0n;
  }

  public operatorAuthorized(address: string, now: bigint): boolean {
    const slot = this.slots.find((candidate) => candidate.owner === address);
    return slot !== undefined && slot.operatorUntil > 0n && now <= slot.operatorUntil;
  }

  /** Every security-critical field is mandatory; failed checks never mutate state. */
  public poolDepositAttempt(attempt: PoolDepositAttempt): void {
    const {
      caller,
      depositor,
      now,
      claimedPool,
      claimedVersion,
      reservationNonce,
      depositNonce,
      actualTransferred,
    } = attempt;
    if (caller !== depositor) throw new Error("depositor caller mismatch");
    if (claimedPool !== this.poolDomain) throw new Error("pool domain mismatch");
    if (claimedVersion !== this.registrationVersion)
      throw new Error("registration version mismatch");
    const slot = this.slots.find((candidate) => candidate.owner === depositor);
    if (slot?.status !== "RESERVED") throw new Error("reservation required");
    if (now > slot.expiry) throw new Error("invalid or expired reservation");
    if (reservationNonce !== slot.reservationNonce) throw new Error("reservation nonce mismatch");
    const expectedDepositNonce = this.nextDepositNonceByAddress.get(depositor) ?? 0n;
    if (depositNonce !== expectedDepositNonce) throw new Error("deposit nonce mismatch");
    if (slot.operatorUntil === 0n || now > slot.operatorUntil) {
      throw new Error("operator unauthorized");
    }
    if (actualTransferred < 0n) throw new RangeError("actual amount must be non-negative");
    this.nextDepositNonceByAddress.set(depositor, expectedDepositNonce + 1n);
    slot.pendingAmount = actualTransferred;
    slot.activationStartedAt = now;
    slot.activationDeadline = now + REGISTRATION_ACTIVATION_PROOF_TTL_SECONDS;
    slot.status = "PENDING_ACTIVATION";
  }

  public settleThreshold(settlement: ThresholdSettlement): void {
    const { participant, registrationVersion, reservationNonce, proofResult, now } = settlement;
    const slot = this.slots.find(
      (candidate) => candidate.owner === participant && candidate.status === "PENDING_ACTIVATION",
    );
    if (slot === undefined) throw new Error("threshold proof not pending");
    if (registrationVersion !== this.registrationVersion) {
      throw new Error("registration version mismatch");
    }
    if (registrationVersion !== slot.registrationVersion) throw new Error("stale registration");
    if (reservationNonce !== slot.reservationNonce) throw new Error("reservation nonce mismatch");
    if (now > slot.activationDeadline) throw new Error("threshold proof expired");
    slot.status = proofResult ? "ACTIVE" : "PENDING_REFUND";
    slot.bondWei = 0n;
  }

  public expirePendingActivation(participant: string, now: bigint): void {
    const slot = this.slots.find(
      (candidate) => candidate.owner === participant && candidate.status === "PENDING_ACTIVATION",
    );
    if (slot === undefined) throw new Error("activation not pending");
    if (now <= slot.activationDeadline) throw new Error("activation proof not expired");
    slot.status = "PENDING_REFUND";
    slot.bondWei = 0n;
  }

  /** Apply actual refund; completion is settled separately by bound proof. */
  public refundAttempt(participant: string, actualRefunded: bigint): void {
    const slot = this.slots.find(
      (candidate) => candidate.owner === participant && candidate.status === "PENDING_REFUND",
    );
    if (slot === undefined) throw new Error("refund not pending");
    if (actualRefunded < 0n || actualRefunded > slot.pendingAmount) {
      throw new RangeError("actual refund exceeds pending amount");
    }
    slot.pendingAmount -= actualRefunded;
    slot.refundAttemptNonce += 1n;
    slot.refundCompletionPending = true;
    slot.status = "REFUND_ATTEMPT_PENDING_PROOF";
  }

  public settleRefundCompletion(settlement: RefundCompletionSettlement): void {
    const {
      participant,
      registrationVersion,
      reservationNonce,
      refundAttemptNonce,
      proofComplete,
    } = settlement;
    const slot = this.slots.find(
      (candidate) =>
        candidate.owner === participant && candidate.status === "REFUND_ATTEMPT_PENDING_PROOF",
    );
    if (slot === undefined) throw new Error("refund completion proof not pending");
    if (registrationVersion !== this.registrationVersion) {
      throw new Error("registration version mismatch");
    }
    if (registrationVersion !== slot.registrationVersion) throw new Error("stale registration");
    if (reservationNonce !== slot.reservationNonce) throw new Error("reservation nonce mismatch");
    if (refundAttemptNonce !== slot.refundAttemptNonce) {
      throw new Error("refund attempt nonce mismatch");
    }
    if (proofComplete && slot.pendingAmount !== 0n) {
      throw new Error("completion proof contradicts residual");
    }
    if (!proofComplete && slot.pendingAmount === 0n) {
      throw new Error("completion proof contradicts zero residual");
    }
    slot.refundCompletionPending = false;
    if (proofComplete) {
      slot.status = "FREE";
      slot.owner = null;
      slot.bondWei = 0n;
    } else {
      slot.status = "PENDING_REFUND";
    }
  }

  public expire(address: string, now: bigint): void {
    const slot = this.slots.find(
      (candidate) =>
        candidate.owner === address && candidate.status === "RESERVED" && now > candidate.expiry,
    );
    if (slot === undefined) throw new Error("reservation not expired");
    slot.status = "FREE";
    slot.owner = null;
    slot.bondWei = 0n;
  }

  public deregister(address: string, provenZeroBalance: boolean): void {
    if (!provenZeroBalance) throw new Error("zero-balance proof required");
    const slot = this.slots.find(
      (candidate) => candidate.owner === address && candidate.status === "ACTIVE",
    );
    if (slot === undefined) throw new Error("not active");
    slot.status = "TOMBSTONED";
    slot.owner = null;
    slot.bondWei = 0n;
  }

  public directTokenSend(): void {
    throw new Error("UNSUPPORTED_DIRECT_TOKEN_SEND");
  }

  public status(address: string): SlotStatus {
    return this.slots.find((slot) => slot.owner === address)?.status ?? "FREE";
  }

  public activeCount(): number {
    return this.slots.filter((slot) => slot.status === "ACTIVE").length;
  }

  public reservationNonce(address: string): bigint {
    return this.slots.find((slot) => slot.owner === address)?.reservationNonce ?? 0n;
  }

  public nextDepositNonce(address: string): bigint {
    return this.nextDepositNonceByAddress.get(address) ?? 0n;
  }

  public activationDeadline(address: string): bigint {
    return this.slots.find((slot) => slot.owner === address)?.activationDeadline ?? 0n;
  }

  public refundAttemptNonce(address: string): bigint {
    return this.slots.find((slot) => slot.owner === address)?.refundAttemptNonce ?? 0n;
  }

  public bond(address: string): bigint {
    return this.slots.find((slot) => slot.owner === address)?.bondWei ?? 0n;
  }
}
