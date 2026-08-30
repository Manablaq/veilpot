import { expect } from "chai";
import {
  DAY_SECONDS,
  recognizeAgain,
  recognizeDrawYield,
  sweepActualYield,
} from "../src/simulated-yield.js";

describe("Gate 1A simulated-yield accounting model", function () {
  it("recognizes one draw's yield from the closed raw TWAB", function () {
    const state = recognizeDrawYield(7n, 1_000_000n * DAY_SECONDS, 100n);
    expect(state.grossSyntheticYield).to.equal(100n);
    expect(state.realizedSimulatedYield).to.equal(100n);
    expect(state.yieldRecognized).to.equal(true);
  });

  it("caps recognition by funded non-principal liquidity and supports partial actual transfer", function () {
    const state = recognizeDrawYield(1n, 1_000_000n * DAY_SECONDS, 50n);
    expect(state.realizedSimulatedYield).to.equal(50n);
    const partial = sweepActualYield(state, 20n);
    expect(partial.yieldSwept).to.equal(20n);
    expect(sweepActualYield(partial, 30n).yieldSwept).to.equal(50n);
  });

  it("rejects recognition replay, over-sweep, and negative values", function () {
    const state = recognizeDrawYield(2n, DAY_SECONDS, 1n);
    expect(() => recognizeAgain(state)).to.throw("already recognized");
    expect(() => sweepActualYield(state, 2n)).to.throw("exceeds");
    expect(() => recognizeDrawYield(2n, -1n, 1n)).to.throw("non-negative");
  });

  it("handles zero and maximum raw-TWAB draws without touching sponsor accounting", function () {
    expect(recognizeDrawYield(3n, 0n, 10n).realizedSimulatedYield).to.equal(0n);
    const maximum = recognizeDrawYield(4n, 331_776_000_000_000_000_000n, 384_000_000_000n);
    expect(maximum.grossSyntheticYield).to.equal(384_000_000_000n);
    expect(maximum.yieldSwept).to.equal(0n);
  });
});
