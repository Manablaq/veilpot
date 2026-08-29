import { expect } from "chai";

import {
  balancedFirstValid,
  batchFailureProbability,
  candidateValid,
  expectedBatchAttempts,
  nextPowerOfTwoBucket,
  selectWinnerFromPrefixes,
  serialFirstValid,
  SplitMix64,
} from "../src/model.js";

function enumerateTuples(bound: number, size: number, visit: (tuple: bigint[]) => void): void {
  const tuple = Array<bigint>(size).fill(0n);
  const recurse = (position: number): void => {
    if (position === size) {
      visit([...tuple]);
      return;
    }
    for (let value = 0; value < bound; value += 1) {
      tuple[position] = BigInt(value);
      recurse(position + 1);
    }
  };
  recurse(0);
}

describe("VeilDraw independent reference model", function () {
  it("computes minimal power-of-two buckets and rejects zero", function () {
    expect(nextPowerOfTwoBucket(1n)).to.equal(1n);
    expect(nextPowerOfTwoBucket(2n)).to.equal(2n);
    expect(nextPowerOfTwoBucket(3n)).to.equal(4n);
    expect(nextPowerOfTwoBucket(129n)).to.equal(256n);
    expect(() => nextPowerOfTwoBucket(0n)).to.throw("positive");
  });

  it("serial and ordered-balanced reductions agree exhaustively", function () {
    const configurations = [
      [2, 8],
      [4, 4],
      [8, 3],
    ] as const;
    for (const [bound, maximumSize] of configurations) {
      for (let size = 1; size <= maximumSize; size += 1) {
        for (let total = 1; total <= bound; total += 1) {
          enumerateTuples(bound, size, (tuple) => {
            expect(balancedFirstValid(tuple, BigInt(total))).to.deep.equal(
              serialFirstValid(tuple, BigInt(total)),
            );
          });
        }
      }
    }
  });

  it("is exactly uniform conditioned on exhaustive batch success", function () {
    for (const [bound, size] of [
      [2, 8],
      [4, 4],
      [8, 3],
    ] as const) {
      for (let total = 1; total <= bound; total += 1) {
        const counts = Array<number>(total).fill(0);
        enumerateTuples(bound, size, (tuple) => {
          const result = serialFirstValid(tuple, BigInt(total));
          if (result.valid) counts[Number(result.value)]! += 1;
        });
        expect(new Set(counts).size).to.equal(1);
      }
    }
  });

  it("serial and ordered-balanced reductions agree for deterministic large randomized cases", function () {
    const rng = new SplitMix64(0x5645494c44524157n);
    const cases = [
      { bucket: 1n << 20n, total: (1n << 19n) + 1n },
      { bucket: 1n << 40n, total: (1n << 40n) - 1n },
      { bucket: 1n << 63n, total: 1n << 62n },
    ];
    for (const { bucket, total } of cases) {
      for (const size of [1, 2, 4, 8, 16]) {
        for (let sample = 0; sample < 1_000; sample += 1) {
          const candidates = Array.from({ length: size }, () => rng.belowPowerOfTwo(bucket));
          expect(balancedFirstValid(candidates, total)).to.deep.equal(
            serialFirstValid(candidates, total),
          );
        }
      }
    }
  });

  it("selects exactly the weighted prefix interval", function () {
    const vectors = [
      [1n],
      [1n, 1n],
      [1n, 2n],
      [1n, 2n, 7n],
      [0n, 5n, 0n],
      [97n, 3n],
      [1n, 1n, 1n, 1n, 1n, 1n],
      [(1n << 80n) - 1n, 1n << 79n, 17n],
    ];
    for (const weights of vectors) {
      const total = weights.reduce((sum, weight) => sum + weight, 0n);
      const targets = new Set<bigint>([0n, total - 1n]);
      let prefix = 0n;
      for (const weight of weights) {
        if (weight > 0n) {
          targets.add(prefix);
          targets.add(prefix + weight - 1n);
        }
        prefix += weight;
      }
      for (const target of targets) {
        const winner = selectWinnerFromPrefixes(weights, target);
        expect(weights[winner]! > 0n).to.equal(true);
      }
    }
  });

  it("handles candidate and probability boundary cases", function () {
    expect(candidateValid(0n, 1n)).to.equal(true);
    expect(candidateValid(1n, 1n)).to.equal(false);
    expect(batchFailureProbability(5n, 8n, 4)).to.deep.equal({
      numerator: 81n,
      denominator: 4096n,
    });
    expect(expectedBatchAttempts(8n, 8n, 16)).to.deep.equal({
      numerator: 1n,
      denominator: 1n,
    });
  });
});
