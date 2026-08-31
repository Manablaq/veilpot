import { expect } from "chai";

import {
  GATE1C_DAY_SECONDS,
  Gate1CPrizeReserveModel,
  Gate1CYieldAdapterModel,
  type Gate1CClaimAuthorization,
  type HistoricalClaimIdentity,
} from "../src/gate1c-prize-yield.js";

const CHAIN_ID = 11155111n;
const RESERVE = "reserve";
const POOL = "pool";
const ADAPTER = "adapter";

const identity = (drawId = 7n, participant = "alice"): HistoricalClaimIdentity => ({
  drawId,
  slotIndex: 3n,
  participant,
  registrationVersion: 2n,
  reservationNonce: 19n,
});

const authorization = (
  nonce = 0n,
  drawId = 7n,
  participant = "alice",
): Gate1CClaimAuthorization => ({
  chainId: CHAIN_ID,
  reserve: RESERVE,
  pool: POOL,
  drawId,
  slotIndex: 3n,
  participant,
  recipient: participant,
  registrationVersion: 2n,
  reservationNonce: 19n,
  nonce,
  expiry: 100n,
});

describe("Gate 1C prize/yield production accounting oracle", function () {
  it("derives deterministic synthetic yield from immutable raw TWAB", function () {
    const adapter = new Gate1CYieldAdapterModel();

    adapter.fundYield(500n);

    const result = adapter.recognize(1n, 1_000_000n * GATE1C_DAY_SECONDS);

    expect(result.grossYield).to.equal(100n);
    expect(result.recognizedYield).to.equal(100n);
    expect(result.remainingUnswept).to.equal(100n);
    expect(adapter.fundedAvailable).to.equal(400n);
    expect(adapter.committedUnswept).to.equal(100n);
  });

  it("reserves funded liquidity at recognition so draws cannot double count backing", function () {
    const adapter = new Gate1CYieldAdapterModel();

    adapter.fundYield(150n);

    const first = adapter.recognize(1n, 1_000_000n * GATE1C_DAY_SECONDS);
    const second = adapter.recognize(2n, 1_000_000n * GATE1C_DAY_SECONDS);

    expect(first.recognizedYield).to.equal(100n);
    expect(second.recognizedYield).to.equal(50n);
    expect(adapter.fundedAvailable).to.equal(0n);
    expect(adapter.committedUnswept).to.equal(150n);
    adapter.assertBackingInvariant();
  });

  it("preserves unswept yield through zero and partial actual transfers", function () {
    const adapter = new Gate1CYieldAdapterModel();

    adapter.fundYield(100n);
    adapter.recognize(1n, 1_000_000n * GATE1C_DAY_SECONDS);

    expect(adapter.beginSweep(1n, 0n)).to.equal(0n);
    expect(adapter.snapshot(1n).remainingUnswept).to.equal(100n);
    adapter.settleSweep(1n, false);

    expect(adapter.beginSweep(1n, 40n)).to.equal(40n);
    expect(adapter.snapshot(1n).remainingUnswept).to.equal(60n);
    adapter.settleSweep(1n, false);

    expect(adapter.beginSweep(1n, 60n)).to.equal(60n);
    expect(adapter.snapshot(1n).remainingUnswept).to.equal(0n);
    adapter.settleSweep(1n, true);

    expect(adapter.snapshot(1n).state).to.equal("FundingFinalized");
  });

  it("rejects recognition replay, over-sweep, and false completion evidence", function () {
    const adapter = new Gate1CYieldAdapterModel();

    adapter.fundYield(100n);
    adapter.recognize(1n, 1_000_000n * GATE1C_DAY_SECONDS);

    expect(() => adapter.recognize(1n, 1_000_000n * GATE1C_DAY_SECONDS)).to.throw(
      "already recognized",
    );

    expect(() => adapter.beginSweep(1n, 101n)).to.throw("exceeds");

    adapter.beginSweep(1n, 10n);

    expect(() => adapter.settleSweep(1n, true)).to.throw("invalid yield sweep completion proof");
  });

  it("does not turn direct token donations into recognized yield backing", function () {
    const adapter = new Gate1CYieldAdapterModel();

    adapter.directDonation(1_000n);

    const result = adapter.recognize(1n, 1_000_000n * GATE1C_DAY_SECONDS);

    expect(result.grossYield).to.equal(100n);
    expect(result.recognizedYield).to.equal(0n);
    expect(adapter.rawTokenBalance).to.equal(1_000n);
    expect(adapter.accountedBacking).to.equal(0n);
  });

  it("records only adapter-returned actual yield and keeps sponsor funding distinct", function () {
    const reserve = new Gate1CPrizeReserveModel(CHAIN_ID, RESERVE, POOL, ADAPTER);

    expect(() => reserve.recordYield("attacker", 7n, 25n)).to.throw("unauthorized yield source");

    reserve.recordYield(ADAPTER, 7n, 25n);
    reserve.fundSponsorForDraw(7n, 10n);

    const result = reserve.snapshot(7n);

    expect(result.yieldFunding).to.equal(25n);
    expect(result.sponsorFunding).to.equal(10n);
    expect(reserve.accountedReserveAssets).to.equal(35n);
  });

  it("ignores reserve donations and freezes funding before prize claims", function () {
    const reserve = new Gate1CPrizeReserveModel(CHAIN_ID, RESERVE, POOL, ADAPTER);

    reserve.recordYield(ADAPTER, 7n, 25n);
    reserve.directDonation(1_000n);

    expect(reserve.rawTokenBalance).to.equal(1_025n);
    expect(reserve.accountedReserveAssets).to.equal(25n);

    expect(() => reserve.preparePrize(7n, false)).to.throw("adapter funding not finalized");

    reserve.preparePrize(7n, true);

    expect(reserve.snapshot(7n).remaining).to.equal(25n);
    expect(reserve.outstandingPrizeLiabilities).to.equal(25n);

    expect(() => reserve.fundSponsorForDraw(7n, 1n)).to.throw("funding already frozen");
  });

  it("has a proof-backed zero-prize terminal path", function () {
    const reserve = new Gate1CPrizeReserveModel(CHAIN_ID, RESERVE, POOL, ADAPTER);

    reserve.preparePrize(9n, true);

    expect(reserve.snapshot(9n).state).to.equal("StatusProofPending");

    expect(() => reserve.settlePrizeStatus(9n, false)).to.throw("invalid prize status proof");

    reserve.settlePrizeStatus(9n, true);

    expect(reserve.snapshot(9n).state).to.equal("NoPrize");
    expect(reserve.outstandingPrizeLiabilities).to.equal(0n);
  });

  it("binds claim authorization to every historical and protocol domain component", function () {
    const reserve = new Gate1CPrizeReserveModel(CHAIN_ID, RESERVE, POOL, ADAPTER);
    const expectedIdentity = identity();

    reserve.recordYield(ADAPTER, 7n, 100n);
    reserve.preparePrize(7n, true);
    reserve.settlePrizeStatus(7n, false);

    const mutations: Gate1CClaimAuthorization[] = [
      { ...authorization(), chainId: 1n },
      { ...authorization(), reserve: "other-reserve" },
      { ...authorization(), pool: "other-pool" },
      { ...authorization(), drawId: 8n },
      { ...authorization(), slotIndex: 4n },
      { ...authorization(), participant: "bob" },
      { ...authorization(), recipient: "bob" },
      { ...authorization(), registrationVersion: 3n },
      { ...authorization(), reservationNonce: 20n },
      { ...authorization(), expiry: 1n },
    ];

    for (const changed of mutations) {
      expect(() => reserve.beginClaim(changed, expectedIdentity, true, 10n, 2n)).to.throw(
        "invalid claim authorization",
      );
    }
  });

  it("consumes claim nonces exactly once and rejects replay", function () {
    const reserve = new Gate1CPrizeReserveModel(CHAIN_ID, RESERVE, POOL, ADAPTER);
    const expectedIdentity = identity();

    reserve.recordYield(ADAPTER, 7n, 100n);
    reserve.preparePrize(7n, true);
    reserve.settlePrizeStatus(7n, false);

    reserve.beginClaim(authorization(0n), expectedIdentity, true, 10n, 2n);
    reserve.settleClaim(7n, "alice", 0n, false);

    expect(reserve.nextClaimNonce("alice")).to.equal(1n);

    expect(() => reserve.beginClaim(authorization(0n), expectedIdentity, true, 10n, 3n)).to.throw(
      "invalid claim nonce",
    );
  });

  it("cannot let a nonwinner reduce or close another participant's prize", function () {
    const reserve = new Gate1CPrizeReserveModel(CHAIN_ID, RESERVE, POOL, ADAPTER);
    const expectedIdentity = identity();

    reserve.recordYield(ADAPTER, 7n, 100n);
    reserve.preparePrize(7n, true);
    reserve.settlePrizeStatus(7n, false);

    reserve.beginClaim(authorization(0n), expectedIdentity, false, 0n, 2n);

    expect(reserve.snapshot(7n).remaining).to.equal(100n);
    expect(reserve.outstandingPrizeLiabilities).to.equal(100n);

    expect(() => reserve.settleClaim(7n, "alice", 0n, true)).to.throw(
      "invalid claim completion proof",
    );

    reserve.settleClaim(7n, "alice", 0n, false);

    expect(reserve.snapshot(7n).state).to.equal("Claimable");
  });

  it("preserves winner residual through partial transfer and closes only after full actual payout", function () {
    const reserve = new Gate1CPrizeReserveModel(CHAIN_ID, RESERVE, POOL, ADAPTER);
    const expectedIdentity = identity();

    reserve.recordYield(ADAPTER, 7n, 100n);
    reserve.preparePrize(7n, true);
    reserve.settlePrizeStatus(7n, false);

    reserve.beginClaim(authorization(0n), expectedIdentity, true, 40n, 2n);

    expect(reserve.snapshot(7n).remaining).to.equal(60n);
    reserve.settleClaim(7n, "alice", 0n, false);

    reserve.beginClaim(authorization(1n), expectedIdentity, true, 60n, 3n);

    expect(reserve.snapshot(7n).remaining).to.equal(0n);
    reserve.settleClaim(7n, "alice", 1n, true);

    expect(reserve.snapshot(7n).state).to.equal("Claimed");
    expect(reserve.outstandingPrizeLiabilities).to.equal(0n);
    expect(reserve.accountedReserveAssets).to.equal(0n);
  });

  it("maintains adapter backing and reserve solvency across a complete multi-draw sequence", function () {
    const adapter = new Gate1CYieldAdapterModel();
    const reserve = new Gate1CPrizeReserveModel(CHAIN_ID, RESERVE, POOL, ADAPTER);

    adapter.fundYield(250n);

    adapter.recognize(7n, 1_000_000n * GATE1C_DAY_SECONDS);
    adapter.recognize(8n, 2_000_000n * GATE1C_DAY_SECONDS);

    expect(adapter.snapshot(7n).recognizedYield).to.equal(100n);
    expect(adapter.snapshot(8n).recognizedYield).to.equal(150n);
    expect(adapter.fundedAvailable).to.equal(0n);

    const firstActual = adapter.beginSweep(7n, 100n);
    reserve.recordYield(ADAPTER, 7n, firstActual);
    adapter.settleSweep(7n, true);

    const secondPartial = adapter.beginSweep(8n, 75n);
    reserve.recordYield(ADAPTER, 8n, secondPartial);
    adapter.settleSweep(8n, false);

    const secondFinal = adapter.beginSweep(8n, 75n);
    reserve.recordYield(ADAPTER, 8n, secondFinal);
    adapter.settleSweep(8n, true);

    reserve.preparePrize(7n, true);
    reserve.settlePrizeStatus(7n, false);

    reserve.preparePrize(8n, true);
    reserve.settlePrizeStatus(8n, false);

    adapter.assertBackingInvariant();
    reserve.assertSolvent();

    expect(adapter.rawTokenBalance).to.equal(0n);
    expect(adapter.accountedBacking).to.equal(0n);
    expect(reserve.accountedReserveAssets).to.equal(250n);
    expect(reserve.outstandingPrizeLiabilities).to.equal(250n);
  });
});
