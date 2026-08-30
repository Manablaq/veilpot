/**
 * Design-only bigint model for bounded, lazy epoch-sealing TWAB.
 * This intentionally keeps at most one unresolved snapshot epoch per account;
 * it is not production Solidity or an implementation of the pool.
 */

export interface Epoch {
  readonly id: number;
  readonly start: bigint;
  readonly end: bigint;
}

export interface AccountView {
  readonly balance: bigint;
  readonly accumulator: bigint;
  readonly lastCheckpoint: bigint;
  readonly activeEpoch: number;
  readonly pendingEpoch: number | null;
  readonly pendingWeight: bigint | null;
}

interface AccountState {
  balance: bigint;
  accumulator: bigint;
  lastCheckpoint: bigint;
  activeEpoch: number;
  pendingEpoch: number | null;
  pendingWeight: bigint | null;
}

interface Event {
  readonly time: bigint;
  readonly user: string;
  readonly delta: bigint;
}

function nonNegative(value: bigint, label: string): void {
  if (value < 0n) throw new RangeError(`${label} must be non-negative`);
}

/**
 * A closed epoch is sealed once per account. The next epoch accrues immediately,
 * so deposits and withdrawals remain live while snapshot chunks are processed.
 */
export class LazyEpochTwabModel {
  private readonly accounts = new Map<string, AccountState>();
  private readonly events: Event[] = [];
  private readonly epochLength: bigint;
  private active: Epoch;
  private pendingSnapshot: Epoch | null = null;
  private now: bigint;

  public constructor(epochStart: bigint, epochEnd: bigint) {
    nonNegative(epochStart, "epochStart");
    if (epochEnd <= epochStart) throw new RangeError("epochEnd must exceed epochStart");
    this.now = epochStart;
    this.epochLength = epochEnd - epochStart;
    this.active = { id: 0, start: epochStart, end: epochEnd };
  }

  public get currentEpoch(): Epoch {
    return this.active;
  }

  public get snapshotEpoch(): Epoch | null {
    return this.pendingSnapshot;
  }

  public get timestamp(): bigint {
    return this.now;
  }

  public advanceTime(timestamp: bigint): void {
    nonNegative(timestamp, "timestamp");
    if (timestamp < this.now) throw new RangeError("time cannot move backwards");
    this.now = timestamp;
  }

  /** Close the active epoch and open exactly one snapshotting epoch. */
  public closeEpoch(): Epoch {
    if (this.pendingSnapshot !== null) throw new RangeError("previous snapshot is incomplete");
    if (this.now !== this.active.end) throw new RangeError("closeEpoch requires exact epochEnd");
    const closed = this.active;
    this.pendingSnapshot = closed;
    this.active = {
      id: closed.id + 1,
      start: closed.end,
      end: closed.end + this.epochLength,
    };
    return closed;
  }

  /** Complete the bounded snapshot after the registered participant set is sealed. */
  public completeSnapshot(users: readonly string[]): void {
    if (this.pendingSnapshot === null) throw new RangeError("no snapshot in progress");
    for (const user of users) {
      if (this.account(user).pendingEpoch !== this.pendingSnapshot.id) {
        throw new RangeError(`snapshot is not sealed for ${user}`);
      }
    }
    this.pendingSnapshot = null;
  }

  public deposit(user: string, amount: bigint): void {
    this.mutate(user, amount);
  }

  public withdraw(user: string, amount: bigint): void {
    nonNegative(amount, "amount");
    const account = this.account(user);
    if (account.balance < amount) throw new RangeError("withdraw exceeds balance");
    this.mutate(user, -amount);
  }

  /** Seal one account in O(1), returning its immutable closed-epoch weight. */
  public snapshot(user: string): bigint {
    const epoch = this.pendingSnapshot;
    if (epoch === null) throw new RangeError("no snapshot in progress");
    const account = this.account(user);
    this.sealClosedEpoch(account, epoch);
    return account.pendingWeight!;
  }

  public accountView(user: string): AccountView {
    const account = this.account(user);
    return {
      balance: account.balance,
      accumulator: account.accumulator,
      lastCheckpoint: account.lastCheckpoint,
      activeEpoch: account.activeEpoch,
      pendingEpoch: account.pendingEpoch,
      pendingWeight: account.pendingWeight,
    };
  }

  /** Naive integral oracle, independent of lazy state. */
  public naiveWeight(user: string, epoch: Epoch): bigint {
    let balance = 0n;
    let area = 0n;
    let cursor = epoch.start;
    for (const event of this.events) {
      if (event.user !== user || event.time > epoch.end) continue;
      if (event.time < epoch.start) {
        balance += event.delta;
        continue;
      }
      area += balance * (event.time - cursor);
      cursor = event.time;
      balance += event.delta;
    }
    area += balance * (epoch.end - cursor);
    return area;
  }

  private mutate(user: string, delta: bigint): void {
    nonNegative(delta < 0n ? -delta : delta, "amount");
    const account = this.account(user);
    if (this.pendingSnapshot !== null) this.sealClosedEpoch(account, this.pendingSnapshot);
    this.accrue(account, this.now);
    const next = account.balance + delta;
    if (next < 0n) throw new RangeError("balance cannot be negative");
    account.balance = next;
    this.events.push({ time: this.now, user, delta });
  }

  private sealClosedEpoch(account: AccountState, epoch: Epoch): void {
    if (account.pendingEpoch === epoch.id) return;
    if (account.activeEpoch !== epoch.id) {
      throw new RangeError("account has an unresolved snapshot from another epoch");
    }
    this.accrue(account, epoch.end);
    account.pendingEpoch = epoch.id;
    account.pendingWeight = account.accumulator;
    account.activeEpoch = epoch.id + 1;
    account.accumulator = 0n;
    account.lastCheckpoint = this.active.start;
  }

  private accrue(account: AccountState, timestamp: bigint): void {
    if (timestamp < account.lastCheckpoint) throw new RangeError("checkpoint time moved backwards");
    account.accumulator += account.balance * (timestamp - account.lastCheckpoint);
    account.lastCheckpoint = timestamp;
  }

  private account(user: string): AccountState {
    let account = this.accounts.get(user);
    if (account === undefined) {
      const initialEpoch = this.pendingSnapshot ?? this.active;
      account = {
        balance: 0n,
        accumulator: 0n,
        lastCheckpoint: initialEpoch.start,
        activeEpoch: initialEpoch.id,
        pendingEpoch: null,
        pendingWeight: null,
      };
      this.accounts.set(user, account);
    }
    return account;
  }
}
