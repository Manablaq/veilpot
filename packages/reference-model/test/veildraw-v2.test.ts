import { expect } from "chai";

import { selectWinnerFromPrefixes, SplitMix64 } from "../src/model.js";
import {
  activeShardCount,
  allocateRoundDrawIds,
  allocateThreePrizeFunding,
  resolveLegacyWinner,
  resolvePrivateShardedWinner,
  resolveThreePrizeRound,
  shardTotals,
  totalWeight,
  VEILDRAW_V2_MAX_PARTICIPANTS,
  VEILDRAW_V2_PRIZE_SLOTS,
  VEILDRAW_V2_SHARD_COUNT,
  VEILDRAW_V2_SHARD_SIZE,
  winnerPredicates,
} from "../src/veildraw-v2.js";

function enumerateWeightVectors(
  length: number,
  maximumWeight: number,
  visit: (weights: readonly bigint[]) => void,
): void {
  const weights = Array<bigint>(length).fill(0n);

  const recurse = (position: number): void => {
    if (position === length) {
      visit([...weights]);
      return;
    }

    for (let value = 0; value <= maximumWeight; value += 1) {
      weights[position] = BigInt(value);
      recurse(position + 1);
    }
  };

  recurse(0);
}

describe("VeilDraw V2 private sharded multi-prize reference model", function () {
  it("locks the 128-seat, 16 x 8, three-prize topology", function () {
    expect(VEILDRAW_V2_MAX_PARTICIPANTS).to.equal(128);
    expect(VEILDRAW_V2_SHARD_SIZE).to.equal(8);
    expect(VEILDRAW_V2_SHARD_COUNT).to.equal(16);
    expect(VEILDRAW_V2_PRIZE_SLOTS).to.equal(3);

    expect(activeShardCount(0)).to.equal(0);
    expect(activeShardCount(1)).to.equal(1);
    expect(activeShardCount(8)).to.equal(1);
    expect(activeShardCount(9)).to.equal(2);
    expect(activeShardCount(127)).to.equal(16);
    expect(activeShardCount(128)).to.equal(16);
  });

  it("computes exact eight-seat shard totals without changing the global total", function () {
    const weights = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 11n];

    const totals = shardTotals(weights);

    expect(totals.length).to.equal(16);
    expect(totals[0]).to.equal(36n);
    expect(totals[1]).to.equal(11n);

    for (let index = 2; index < totals.length; index += 1) {
      expect(totals[index]).to.equal(0n);
    }

    expect(totals.reduce((sum, value) => sum + value, 0n)).to.equal(totalWeight(weights));
  });

  it("matches the legacy winner exactly at shard and participant boundaries", function () {
    const weights = [10n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 20n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 30n];

    for (const target of [0n, 9n, 10n, 29n, 30n, 59n]) {
      const legacy = resolveLegacyWinner(weights, target);
      const sharded = resolvePrivateShardedWinner(weights, target);

      expect(sharded.winnerIndex).to.equal(legacy);
      expect(sharded.shardIndex).to.equal(Math.floor(legacy / VEILDRAW_V2_SHARD_SIZE));
    }
  });

  it("handles empty shards and the final participant slot without fabricating a winner", function () {
    const weights = Array<bigint>(128).fill(0n);

    weights[80] = 7n;
    weights[127] = 13n;

    const first = resolvePrivateShardedWinner(weights, 0n);
    const boundary = resolvePrivateShardedWinner(weights, 6n);
    const last = resolvePrivateShardedWinner(weights, 7n);
    const finalTarget = resolvePrivateShardedWinner(weights, 19n);

    expect(first.winnerIndex).to.equal(80);
    expect(boundary.winnerIndex).to.equal(80);
    expect(last.winnerIndex).to.equal(127);
    expect(finalTarget.winnerIndex).to.equal(127);
  });

  it("is exhaustively identical to the legacy weighted-prefix rule for small vectors", function () {
    for (let length = 1; length <= 5; length += 1) {
      enumerateWeightVectors(length, 3, (weights) => {
        const total = totalWeight(weights);

        if (total === 0n) return;

        for (let target = 0n; target < total; target += 1n) {
          const legacy = selectWinnerFromPrefixes(weights, target);
          const sharded = resolvePrivateShardedWinner(weights, target);

          expect(sharded.winnerIndex).to.equal(legacy);
        }
      });
    }
  });

  it("is identical to the legacy weighted-prefix rule for 4096 deterministic large cases", function () {
    const rng = new SplitMix64(0x5645494c4452415732n);

    for (let sample = 0; sample < 4_096; sample += 1) {
      const participantCount = 1 + Number(rng.next() % BigInt(VEILDRAW_V2_MAX_PARTICIPANTS));

      const weights = Array.from({ length: participantCount }, () => rng.next() % 1_000_001n);

      let total = totalWeight(weights);

      if (total === 0n) {
        weights[participantCount - 1] = 1n;
        total = 1n;
      }

      const target = rng.next() % total;

      const legacy = resolveLegacyWinner(weights, target);
      const sharded = resolvePrivateShardedWinner(weights, target);

      expect(sharded.winnerIndex).to.equal(legacy);
      expect(weights[sharded.winnerIndex]! > 0n).to.equal(true);
      expect(sharded.shardIndex).to.equal(Math.floor(sharded.winnerIndex / VEILDRAW_V2_SHARD_SIZE));
      expect(sharded.localIndex).to.equal(sharded.winnerIndex % VEILDRAW_V2_SHARD_SIZE);
    }
  });

  it("produces exactly one private winner predicate for every positive draw", function () {
    const weights = [5n, 0n, 7n, 2n, 0n, 9n, 1n, 0n, 4n, 8n];

    const total = totalWeight(weights);

    for (let target = 0n; target < total; target += 1n) {
      const predicates = winnerPredicates(weights, target);
      const winner = resolveLegacyWinner(weights, target);

      expect(predicates.length).to.equal(weights.length);
      expect(predicates.filter(Boolean).length).to.equal(1);
      expect(predicates[winner]).to.equal(true);
    }
  });

  it("has an explicit no-randomness, no-winner path for zero-total rounds", function () {
    const round = resolveThreePrizeRound([0n, 0n, 0n, 0n], [null, null, null]);

    expect(round).to.deep.equal([null, null, null]);

    expect(() => resolveThreePrizeRound([0n, 0n], [0n, null, null])).to.throw("zero-total");

    expect(() => resolvePrivateShardedWinner([0n, 0n], 0n)).to.throw("positive aggregate");
  });

  it("rejects malformed bounds, negative weights, invalid targets, and incomplete positive prize rounds", function () {
    expect(() => totalWeight(Array<bigint>(129).fill(1n))).to.throw("128");

    expect(() => totalWeight([1n, -1n])).to.throw("non-negative");

    expect(() => activeShardCount(129)).to.throw("envelope");

    expect(() => resolvePrivateShardedWinner([1n, 2n], -1n)).to.throw("outside");

    expect(() => resolvePrivateShardedWinner([1n, 2n], 3n)).to.throw("outside");

    expect(() => resolveThreePrizeRound([1n, 2n], [0n, null, 1n])).to.throw("all three");
  });

  it("resolves three independent prizes and permits the same saver to win multiple slots", function () {
    const round = resolveThreePrizeRound([1n, 1n], [0n, 1n, 1n]);

    if (round[0] === null || round[1] === null || round[2] === null) {
      throw new Error("positive round unexpectedly produced a null prize");
    }

    expect(round[0].winnerIndex).to.equal(0);
    expect(round[1].winnerIndex).to.equal(1);
    expect(round[2].winnerIndex).to.equal(1);
  });

  it("allocates exactly three monotonic child draw IDs per snapshot round", function () {
    expect(allocateRoundDrawIds(0n)).to.deep.equal([1n, 2n, 3n]);

    expect(allocateRoundDrawIds(999n)).to.deep.equal([1000n, 1001n, 1002n]);

    expect(() => allocateRoundDrawIds(-1n)).to.throw("non-negative");
  });

  it("splits one recognized prize amount across three slots with exact conservation", function () {
    const values: bigint[] = [];

    for (let value = 0n; value <= 1_000n; value += 1n) {
      values.push(value);
    }

    values.push((1n << 64n) - 1n);

    for (const value of values) {
      const allocation = allocateThreePrizeFunding(value);

      expect(allocation[0] + allocation[1] + allocation[2]).to.equal(value);

      expect(allocation[0]).to.equal(value / 3n);
      expect(allocation[1]).to.equal(value / 3n);

      expect(allocation[2] - allocation[0]).to.be.oneOf([0n, 1n, 2n]);
    }

    expect(() => allocateThreePrizeFunding(-1n)).to.throw("non-negative");
  });
});
