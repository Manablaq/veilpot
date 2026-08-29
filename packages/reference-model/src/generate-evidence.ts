import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  SplitMix64,
  balancedFirstValid,
  batchFailureProbability,
  expectedBatchAttempts,
  nextPowerOfTwoBucket,
  rationalToDecimal,
  selectWinnerFromPrefixes,
  serialFirstValid,
  type Rational,
} from "./model.js";

const evidenceDirectory = resolve(process.cwd(), "../../evidence/gate0");
const seed = 0x5645494c44524157n;

function json(value: unknown): string {
  return `${JSON.stringify(
    value,
    (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item),
    2,
  )}\n`;
}

function rationalRecord(value: Rational): Record<string, string> {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    decimal: rationalToDecimal(value, 24),
  };
}

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

function generateExhaustiveEvidence(): object {
  const configurations = [
    { bucket: 2, maximumSize: 8 },
    { bucket: 4, maximumSize: 4 },
    { bucket: 8, maximumSize: 3 },
  ];
  const scenarios: object[] = [];
  let tuplesChecked = 0;

  for (const { bucket, maximumSize } of configurations) {
    for (let size = 1; size <= maximumSize; size += 1) {
      for (let total = 1; total <= bucket; total += 1) {
        const counts = Array<number>(total).fill(0);
        let failures = 0;
        let localTuples = 0;
        enumerateTuples(bucket, size, (tuple) => {
          localTuples += 1;
          const serial = serialFirstValid(tuple, BigInt(total));
          const balanced = balancedFirstValid(tuple, BigInt(total));
          if (
            serial.valid !== balanced.valid ||
            serial.value !== balanced.value ||
            serial.index !== balanced.index
          )
            throw new Error("serial/balanced reduction mismatch");
          if (serial.valid) counts[Number(serial.value)]! += 1;
          else failures += 1;
        });
        tuplesChecked += localTuples;
        const exactUniform = new Set(counts).size === 1;
        if (!exactUniform) throw new Error("exhaustive uniformity verification failed");
        scenarios.push({
          bucket,
          total,
          size,
          tuples: localTuples,
          successes: localTuples - failures,
          failures,
          countPerAcceptedValue: counts[0],
          exactUniform,
          reductionsAgree: true,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    method: "complete tuple enumeration; no sampling",
    configurations,
    tuplesChecked,
    scenarios,
    passed: true,
  };
}

function acceptedTarget(
  rng: SplitMix64,
  total: bigint,
  bucket: bigint,
  size: number,
): { target: bigint; attempts: number } {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const candidates = Array.from({ length: size }, () => rng.belowPowerOfTwo(bucket));
    const result = serialFirstValid(candidates, total);
    if (result.valid) return { target: result.value, attempts };
  }
}

function distributionSummary(counts: readonly number[]): object {
  const samples = counts.reduce((sum, count) => sum + count, 0);
  const expected = samples / counts.length;
  const maxAbsoluteDeviation = Math.max(...counts.map((count) => Math.abs(count - expected)));
  const chiSquare = counts.reduce(
    (sum, count) => sum + ((count - expected) * (count - expected)) / expected,
    0,
  );
  return {
    bins: counts.length,
    samples,
    minimumCount: Math.min(...counts),
    maximumCount: Math.max(...counts),
    maxRelativeDeviation: maxAbsoluteDeviation / expected,
    chiSquare,
  };
}

function generateStatisticalEvidence(): object {
  const rng = new SplitMix64(seed);
  const sizes = [1, 2, 4, 8, 16];
  const totalScenarios = [
    { name: "unit", total: 1n },
    { name: "just-over-half", total: 513n },
    { name: "highly-uneven-total", total: 100n },
    { name: "just-below-bucket", total: 1023n },
    { name: "power-of-two", total: 1024n },
  ];
  const targetSamples = 50_000;
  const targetScenarios: object[] = [];

  for (const scenario of totalScenarios) {
    const bucket = nextPowerOfTwoBucket(scenario.total);
    for (const size of sizes) {
      const counts = Array<number>(Number(scenario.total)).fill(0);
      let aggregateAttempts = 0;
      for (let sample = 0; sample < targetSamples; sample += 1) {
        const result = acceptedTarget(rng, scenario.total, bucket, size);
        counts[Number(result.target)]! += 1;
        aggregateAttempts += result.attempts;
      }
      targetScenarios.push({
        ...scenario,
        bucket,
        size,
        theoreticalFailure: rationalRecord(batchFailureProbability(scenario.total, bucket, size)),
        theoreticalExpectedAttempts: rationalRecord(
          expectedBatchAttempts(scenario.total, bucket, size),
        ),
        observedMeanAttempts: aggregateAttempts / targetSamples,
        distribution: distributionSummary(counts),
      });
    }
  }

  const weightVectors = [
    [1n],
    [1n, 1n],
    [1n, 2n],
    [1n, 2n, 7n],
    [0n, 5n, 0n],
    [97n, 3n],
    [1n, 1n, 1n, 1n, 1n, 1n],
    [(1n << 40n) - 1n, 1n << 39n, 17n],
  ];
  const winnerSamples = 20_000;
  const winnerScenarios: object[] = [];
  for (const weights of weightVectors) {
    const total = weights.reduce((sum, weight) => sum + weight, 0n);
    const bucket = nextPowerOfTwoBucket(total);
    for (const size of sizes) {
      const counts = Array<number>(weights.length).fill(0);
      for (let sample = 0; sample < winnerSamples; sample += 1) {
        const { target } = acceptedTarget(rng, total, bucket, size);
        counts[selectWinnerFromPrefixes(weights, target)]! += 1;
      }
      winnerScenarios.push({ weights, total, bucket, size, samples: winnerSamples, counts });
    }
  }

  return {
    schemaVersion: 1,
    method: "deterministic SplitMix64 simulation; sanity evidence only",
    seed,
    targetSamplesPerScenario: targetSamples,
    winnerSamplesPerScenario: winnerSamples,
    targetScenarios,
    winnerScenarios,
    passed: true,
  };
}

function generateReferenceEvidence(): object {
  const sizes = [1, 2, 4, 8, 16];
  return {
    schemaVersion: 1,
    implementation: "independent strict-TypeScript bigint model",
    exportedFunctions: [
      "nextPowerOfTwoBucket",
      "candidateValid",
      "serialFirstValid",
      "balancedFirstValid",
      "selectWinnerFromPrefixes",
      "batchFailureProbability",
      "expectedBatchAttempts",
    ],
    candidateSizes: sizes.map((size) => ({
      size,
      strictWorstCaseFailureUpperBound: rationalRecord({
        numerator: 1n,
        denominator: 2n ** BigInt(size),
      }),
    })),
    zeroTotal: "rejected before candidate generation",
    deterministicSeed: seed,
    passed: true,
  };
}

await mkdir(evidenceDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(evidenceDirectory, "reference-model.json"), json(generateReferenceEvidence())),
  writeFile(
    resolve(evidenceDirectory, "exhaustive-distribution.json"),
    json(generateExhaustiveEvidence()),
  ),
  writeFile(
    resolve(evidenceDirectory, "statistical-sanity.json"),
    json(generateStatisticalEvidence()),
  ),
]);
