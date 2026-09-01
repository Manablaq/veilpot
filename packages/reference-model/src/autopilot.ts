/**
 * Gate 2C-A independent Autopilot authorization/accounting model.
 *
 * This is deliberately plaintext and independent from production Solidity.
 * Encrypted production values are represented as bigint values so the
 * authorization, replay, schedule, cap, custody, and accounting invariants
 * can be tested without trusting the contract implementation.
 */

export const MAX_AUTOPILOT_EXECUTIONS = 1_024;

export type AutopilotPlanState = "ACTIVE" | "PAUSED" | "REVOKED" | "COMPLETED";

export interface AutopilotScheduleWindow {
  readonly index: number;
  readonly notBefore: bigint;
  readonly notAfter: bigint;
}

export interface AutopilotPlanConfig {
  readonly chainId: bigint;
  readonly managerDomain: string;
  readonly poolDomain: string;
  readonly tokenDomain: string;
  readonly owner: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly planNonce: bigint;
  readonly scheduleCommitment: string;
  readonly periodAmount: bigint;
  readonly lifetimeCap: bigint;
  readonly initialPrincipal: bigint;
  readonly maxUserPrincipal: bigint;
  readonly windows: readonly AutopilotScheduleWindow[];
}

export interface AutopilotFundingCallback {
  readonly tokenCaller: string;
  readonly operator: string;
  readonly from: string;
  readonly planNonce: bigint;
  readonly actualReceived: bigint;
}

export interface AutopilotExecutionAttempt {
  readonly executor: string;
  readonly now: bigint;
  readonly policyIdentity: string;
  readonly scheduleCommitment: string;
  readonly owner: string;
  readonly chainId: bigint;
  readonly managerDomain: string;
  readonly poolDomain: string;
  readonly tokenDomain: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly planNonce: bigint;
  readonly index: number;
  readonly notBefore: bigint;
  readonly notAfter: bigint;
  readonly tokenActualTransferred: bigint;
}

export interface AutopilotExecutionResult {
  readonly requested: bigint;
  readonly actualTransferred: bigint;
  readonly priorPrincipal: bigint;
  readonly newPrincipal: bigint;
  readonly remainingBudget: bigint;
  readonly remainingVaultFunds: bigint;
  readonly nextIndex: number;
}

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n) {
    throw new RangeError(`${label} must be non-negative`);
  }
}

function minBigint(...values: readonly bigint[]): bigint {
  if (values.length === 0) {
    throw new Error("minimum requires values");
  }

  let result = values[0];

  if (result === undefined) {
    throw new Error("minimum requires values");
  }

  for (const value of values.slice(1)) {
    if (value < result) {
      result = value;
    }
  }

  return result;
}

export class AutopilotVaultPlanModel {
  private readonly chainId: bigint;
  private readonly managerDomain: string;
  private readonly poolDomain: string;
  private readonly tokenDomain: string;
  private readonly owner: string;
  private readonly registrationVersion: bigint;
  private readonly reservationNonce: bigint;
  private readonly planNonce: bigint;
  private readonly scheduleCommitment: string;
  private readonly periodAmount: bigint;
  private readonly maxUserPrincipal: bigint;
  private readonly windows: readonly AutopilotScheduleWindow[];

  private paused = false;
  private revoked = false;
  private nextExecutionIndex = 0;
  private vaultFunds = 0n;
  private remainingLifetimeBudget: bigint;
  private participantPrincipal: bigint;
  private aggregatePrincipalAmount: bigint;
  private canonicalReceivedAmount = 0n;
  private directDonationAmount = 0n;
  private checkpointCountValue = 0;
  private lastCheckpointedPrincipalValue: bigint | null = null;

  public constructor(config: AutopilotPlanConfig) {
    assertNonNegative(config.periodAmount, "period amount");

    assertNonNegative(config.lifetimeCap, "lifetime cap");

    assertNonNegative(config.initialPrincipal, "initial principal");

    assertNonNegative(config.maxUserPrincipal, "maximum principal");

    if (config.initialPrincipal > config.maxUserPrincipal) {
      throw new Error("initial principal exceeds maximum");
    }

    for (const [label, value] of [
      ["manager domain", config.managerDomain],
      ["pool domain", config.poolDomain],
      ["token domain", config.tokenDomain],
      ["owner", config.owner],
      ["schedule commitment", config.scheduleCommitment],
    ] as const) {
      if (value.length === 0) {
        throw new Error(`${label} must not be empty`);
      }
    }

    if (config.windows.length === 0 || config.windows.length > MAX_AUTOPILOT_EXECUTIONS) {
      throw new Error("invalid schedule window count");
    }

    let previous: AutopilotScheduleWindow | undefined;

    for (let position = 0; position < config.windows.length; position += 1) {
      const window = config.windows[position];

      if (window === undefined) {
        throw new Error("schedule window missing");
      }

      if (window.index !== position) {
        throw new Error("schedule index mismatch");
      }

      if (window.notBefore > window.notAfter) {
        throw new Error("invalid schedule window");
      }

      if (previous !== undefined && previous.notAfter >= window.notBefore) {
        throw new Error("schedule windows overlap");
      }

      previous = window;
    }

    this.chainId = config.chainId;
    this.managerDomain = config.managerDomain;
    this.poolDomain = config.poolDomain;
    this.tokenDomain = config.tokenDomain;
    this.owner = config.owner;
    this.registrationVersion = config.registrationVersion;
    this.reservationNonce = config.reservationNonce;
    this.planNonce = config.planNonce;
    this.scheduleCommitment = config.scheduleCommitment;
    this.periodAmount = config.periodAmount;
    this.maxUserPrincipal = config.maxUserPrincipal;
    this.windows = [...config.windows];
    this.remainingLifetimeBudget = config.lifetimeCap;
    this.participantPrincipal = config.initialPrincipal;
    this.aggregatePrincipalAmount = config.initialPrincipal;
  }

  public policyIdentity(): string {
    return [
      this.chainId.toString(),
      this.managerDomain,
      this.poolDomain,
      this.tokenDomain,
      this.owner,
      this.registrationVersion.toString(),
      this.reservationNonce.toString(),
      this.planNonce.toString(),
    ].join("|");
  }

  public state(): AutopilotPlanState {
    if (this.revoked) {
      return "REVOKED";
    }

    if (this.nextExecutionIndex >= this.windows.length) {
      return "COMPLETED";
    }

    return this.paused ? "PAUSED" : "ACTIVE";
  }

  public requiresUserTokenOperator(): boolean {
    return false;
  }

  public fixedDestination(): string {
    return this.poolDomain;
  }

  public currentWindow(): AutopilotScheduleWindow | undefined {
    return this.windows[this.nextExecutionIndex];
  }

  public fundViaConfidentialCallback(funding: AutopilotFundingCallback): void {
    if (this.revoked) {
      throw new Error("plan revoked");
    }

    if (this.nextExecutionIndex >= this.windows.length) {
      throw new Error("plan completed");
    }

    if (funding.tokenCaller !== this.tokenDomain) {
      throw new Error("noncanonical token callback");
    }

    if (funding.operator !== this.owner || funding.from !== this.owner) {
      throw new Error("funding must be direct owner transfer");
    }

    if (funding.planNonce !== this.planNonce) {
      throw new Error("funding plan nonce mismatch");
    }

    assertNonNegative(funding.actualReceived, "actual received");

    this.vaultFunds += funding.actualReceived;
  }

  public recordUnsupportedDirectDonation(amount: bigint): void {
    assertNonNegative(amount, "direct donation");

    this.directDonationAmount += amount;
  }

  public pause(caller: string): void {
    this.requireOwner(caller);
    this.requireNotTerminal();

    if (this.paused) {
      throw new Error("plan already paused");
    }

    this.paused = true;
  }

  public resume(caller: string): void {
    this.requireOwner(caller);

    if (this.revoked) {
      throw new Error("plan revoked");
    }

    if (this.nextExecutionIndex >= this.windows.length) {
      throw new Error("plan completed");
    }

    if (!this.paused) {
      throw new Error("plan not paused");
    }

    this.paused = false;
  }

  public revoke(caller: string): void {
    this.requireOwner(caller);

    if (this.revoked) {
      throw new Error("plan already revoked");
    }

    this.revoked = true;
    this.paused = false;
  }

  public skipNext(caller: string, index: number): void {
    this.requireOwner(caller);
    this.requireNotTerminal();

    const window = this.requireCurrentWindow();

    if (index !== window.index) {
      throw new Error("skip index mismatch");
    }

    this.nextExecutionIndex += 1;
  }

  public advanceMissed(index: number, now: bigint): void {
    if (this.revoked) {
      throw new Error("plan revoked");
    }

    const window = this.requireCurrentWindow();

    if (index !== window.index) {
      throw new Error("missed index mismatch");
    }

    if (now <= window.notAfter) {
      throw new Error("window not expired");
    }

    this.nextExecutionIndex += 1;
  }

  public execute(attempt: AutopilotExecutionAttempt): AutopilotExecutionResult {
    if (this.revoked) {
      throw new Error("plan revoked");
    }

    if (this.paused) {
      throw new Error("plan paused");
    }

    const window = this.requireCurrentWindow();

    this.requireExecutionIdentity(attempt);

    if (attempt.index !== window.index) {
      throw new Error("execution index mismatch");
    }

    if (attempt.notBefore !== window.notBefore || attempt.notAfter !== window.notAfter) {
      throw new Error("schedule window mismatch");
    }

    if (attempt.now < window.notBefore) {
      throw new Error("execution too early");
    }

    if (attempt.now > window.notAfter) {
      throw new Error("execution window expired");
    }

    assertNonNegative(attempt.tokenActualTransferred, "actual transferred");

    const remainingCapacity = this.maxUserPrincipal - this.participantPrincipal;

    const requested = minBigint(
      this.periodAmount,
      this.remainingLifetimeBudget,
      this.vaultFunds,
      remainingCapacity,
    );

    if (attempt.tokenActualTransferred > requested) {
      throw new Error("token actual exceeds authorized request");
    }

    const actual = attempt.tokenActualTransferred;

    const priorPrincipal = this.participantPrincipal;

    this.lastCheckpointedPrincipalValue = priorPrincipal;

    this.checkpointCountValue += 1;
    this.nextExecutionIndex += 1;
    this.vaultFunds -= actual;
    this.remainingLifetimeBudget -= actual;
    this.participantPrincipal += actual;
    this.aggregatePrincipalAmount += actual;
    this.canonicalReceivedAmount += actual;

    return {
      requested,
      actualTransferred: actual,
      priorPrincipal,
      newPrincipal: this.participantPrincipal,
      remainingBudget: this.remainingLifetimeBudget,
      remainingVaultFunds: this.vaultFunds,
      nextIndex: this.nextExecutionIndex,
    };
  }

  public withdrawPlanFunds(caller: string, actualTransferred: bigint): void {
    this.requireOwner(caller);

    assertNonNegative(actualTransferred, "withdraw actual");

    if (actualTransferred > this.vaultFunds) {
      throw new Error("withdraw exceeds accounted plan funds");
    }

    this.vaultFunds -= actualTransferred;
  }

  public planFunds(): bigint {
    return this.vaultFunds;
  }

  public remainingBudget(): bigint {
    return this.remainingLifetimeBudget;
  }

  public principal(): bigint {
    return this.participantPrincipal;
  }

  public aggregatePrincipal(): bigint {
    return this.aggregatePrincipalAmount;
  }

  public canonicalReceived(): bigint {
    return this.canonicalReceivedAmount;
  }

  public unsupportedDonations(): bigint {
    return this.directDonationAmount;
  }

  public nextIndex(): number {
    return this.nextExecutionIndex;
  }

  public checkpointCount(): number {
    return this.checkpointCountValue;
  }

  public lastCheckpointedPrincipal(): bigint | null {
    return this.lastCheckpointedPrincipalValue;
  }

  private requireExecutionIdentity(attempt: AutopilotExecutionAttempt): void {
    if (attempt.policyIdentity !== this.policyIdentity()) {
      throw new Error("policy identity mismatch");
    }

    if (attempt.scheduleCommitment !== this.scheduleCommitment) {
      throw new Error("schedule commitment mismatch");
    }

    if (attempt.owner !== this.owner) {
      throw new Error("owner mismatch");
    }

    if (attempt.chainId !== this.chainId) {
      throw new Error("chain mismatch");
    }

    if (attempt.managerDomain !== this.managerDomain) {
      throw new Error("manager domain mismatch");
    }

    if (attempt.poolDomain !== this.poolDomain) {
      throw new Error("pool domain mismatch");
    }

    if (attempt.tokenDomain !== this.tokenDomain) {
      throw new Error("token domain mismatch");
    }

    if (attempt.registrationVersion !== this.registrationVersion) {
      throw new Error("registration version mismatch");
    }

    if (attempt.reservationNonce !== this.reservationNonce) {
      throw new Error("reservation nonce mismatch");
    }

    if (attempt.planNonce !== this.planNonce) {
      throw new Error("plan nonce mismatch");
    }

    if (attempt.executor.length === 0) {
      throw new Error("executor must not be empty");
    }
  }

  private requireOwner(caller: string): void {
    if (caller !== this.owner) {
      throw new Error("owner authorization required");
    }
  }

  private requireNotTerminal(): void {
    if (this.revoked) {
      throw new Error("plan revoked");
    }

    if (this.nextExecutionIndex >= this.windows.length) {
      throw new Error("plan completed");
    }
  }

  private requireCurrentWindow(): AutopilotScheduleWindow {
    const window = this.currentWindow();

    if (window === undefined) {
      throw new Error("plan completed");
    }

    return window;
  }
}
