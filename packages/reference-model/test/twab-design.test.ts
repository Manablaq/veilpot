import { expect } from "chai";

import { LazyEpochTwabModel, type Epoch } from "../src/twab-design.js";

function expectSealed(model: LazyEpochTwabModel, user: string, epoch: Epoch): void {
  expect(model.snapshot(user)).to.equal(model.naiveWeight(user, epoch));
}

function sealAll(model: LazyEpochTwabModel, users: readonly string[]): Epoch {
  const epoch = model.snapshotEpoch;
  expect(epoch).not.to.equal(null);
  for (const user of users) expectSealed(model, user, epoch!);
  model.completeSnapshot(users);
  return epoch!;
}

describe("bounded O(1) lazy epoch-sealing TWAB design model", function () {
  it("matches the naive integral across cutoff mutations", function () {
    const model = new LazyEpochTwabModel(0n, 100n);
    model.advanceTime(10n);
    model.deposit("alice", 7n);
    model.advanceTime(99n);
    model.withdraw("alice", 2n);
    model.advanceTime(100n);
    const epoch = model.closeEpoch();
    model.advanceTime(101n);
    model.deposit("alice", 3n);
    expectSealed(model, "alice", epoch);
    expect(model.snapshot("alice")).to.equal(7n * 89n + 5n);
  });

  it("seals post-cutoff changes lazily without changing the prior epoch", function () {
    const model = new LazyEpochTwabModel(0n, 100n);
    model.advanceTime(50n);
    model.deposit("alice", 10n);
    model.advanceTime(100n);
    const epoch = model.closeEpoch();
    model.advanceTime(100n);
    model.withdraw("alice", 10n);
    expectSealed(model, "alice", epoch);
    expect(model.snapshot("alice")).to.equal(500n);
  });

  it("handles exact-cutoff, post-cutoff, zero-balance, and inactive users", function () {
    const model = new LazyEpochTwabModel(0n, 10n);
    model.deposit("alice", 4n);
    model.withdraw("alice", 4n);
    model.advanceTime(10n);
    const epoch = model.closeEpoch();
    model.deposit("alice", 9n);
    expectSealed(model, "alice", epoch);
    expectSealed(model, "bob", epoch);
    expect(model.snapshot("alice")).to.equal(0n);
    expect(model.snapshot("bob")).to.equal(0n);
  });

  it("is order-independent for arbitrary snapshot chunks", function () {
    const model = new LazyEpochTwabModel(0n, 10n);
    model.deposit("alice", 2n);
    model.advanceTime(4n);
    model.deposit("bob", 3n);
    model.advanceTime(10n);
    const epoch = model.closeEpoch();
    expectSealed(model, "bob", epoch);
    expectSealed(model, "alice", epoch);
    model.completeSnapshot(["alice", "bob"]);
  });

  it("requires completion before another epoch can close and supports multiple draws", function () {
    const model = new LazyEpochTwabModel(0n, 10n);
    model.deposit("alice", 2n);
    model.advanceTime(10n);
    const first = model.closeEpoch();
    expect(() => model.closeEpoch()).to.throw("previous snapshot is incomplete");
    sealAll(model, ["alice"]);
    model.advanceTime(20n);
    const second = model.closeEpoch();
    expectSealed(model, "alice", second);
    model.completeSnapshot(["alice"]);
    expect(model.naiveWeight("alice", first)).to.equal(20n);
  });

  it("preserves one pending sealed weight across post-cutoff mutations", function () {
    const model = new LazyEpochTwabModel(0n, 10n);
    model.deposit("alice", 2n);
    model.advanceTime(10n);
    const epoch = model.closeEpoch();
    model.advanceTime(11n);
    model.deposit("alice", 4n);
    model.withdraw("alice", 1n);
    const first = model.accountView("alice");
    expect(first.pendingEpoch).to.equal(epoch.id);
    expect(first.pendingWeight).to.equal(20n);
    expectSealed(model, "alice", epoch);
  });

  it("covers the maximum participant and balance envelope", function () {
    const model = new LazyEpochTwabModel(0n, 2_592_000n);
    const users = Array.from({ length: 128 }, (_, index) => `user-${String(index)}`);
    for (const user of users) model.deposit(user, 1_000_000_000_000n);
    model.advanceTime(2_592_000n);
    const epoch = model.closeEpoch();
    for (const user of [...users].reverse()) expectSealed(model, user, epoch);
    model.completeSnapshot(users);
  });
});
