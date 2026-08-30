import { expect } from "chai";

import {
  MAX_DRAW_DURATION_SECONDS,
  MAX_CANDIDATE,
  MAX_TOTAL,
  MAX_BUCKET,
  MAX_GROSS_SYNTHETIC_YIELD,
  MAX_POOL_PRINCIPAL_BASE_UNITS,
  MAX_USER_PRINCIPAL_BASE_UNITS,
  bitLength,
  conservativeEnvelope,
  nextPowerOfTwo,
} from "../src/numeric-envelope.js";

describe("Gate 1A design numeric envelope", function () {
  it("proves the proposed six-decimal envelope has wide euint128 margin", function () {
    const values = conservativeEnvelope();
    expect(MAX_USER_PRINCIPAL_BASE_UNITS).to.equal(1_000_000_000_000n);
    expect(MAX_POOL_PRINCIPAL_BASE_UNITS).to.equal(128_000_000_000_000n);
    expect(MAX_DRAW_DURATION_SECONDS).to.equal(2_592_000n);
    expect(values.userTwabArea).to.equal(2_592_000_000_000_000_000n);
    expect(values.aggregateTwabArea).to.equal(331_776_000_000_000_000_000n);
    expect(values.bucket).to.equal(590_295_810_358_705_651_712n);
    expect(MAX_TOTAL > 2n ** 68n).to.equal(true);
    expect(MAX_TOTAL < 2n ** 69n).to.equal(true);
    expect(nextPowerOfTwo(MAX_TOTAL)).to.equal(2n ** 69n);
    expect(MAX_BUCKET).to.equal(2n ** 69n);
    expect(values.bucket).to.equal(MAX_BUCKET);
    expect(MAX_CANDIDATE).to.equal(2n ** 69n - 1n);
    expect(MAX_GROSS_SYNTHETIC_YIELD).to.equal(384_000_000_000n);
    expect(bitLength(MAX_GROSS_SYNTHETIC_YIELD)).to.equal(39);
    expect(MAX_GROSS_SYNTHETIC_YIELD < 2n ** 64n).to.equal(true);
    expect(values.candidate).to.equal(MAX_CANDIDATE);

    for (const value of Object.values(values)) {
      expect(value < 1n << 120n).to.equal(true);
    }
    expect(bitLength(values.userPrincipal)).to.equal(40);
    expect(bitLength(values.aggregatePrincipal)).to.equal(47);
    expect(bitLength(values.userTwabArea)).to.equal(62);
    expect(bitLength(values.aggregateTwabArea)).to.equal(69);
    expect(bitLength(values.aggregateDrawTotal)).to.equal(69);
    expect(bitLength(values.prefixSum)).to.equal(69);
    expect(bitLength(values.bucket)).to.equal(70);
    expect(bitLength(values.candidate)).to.equal(69);
    expect(bitLength(values.target)).to.equal(69);
    expect(bitLength(values.prizeEntitlement)).to.equal(40);
  });

  it("keeps ERC-7984 euint64 transfer values within their source width", function () {
    const values = conservativeEnvelope();
    expect(values.userPrincipal < 1n << 64n).to.equal(true);
    expect(values.aggregatePrincipal < 1n << 128n).to.equal(true);
    expect(values.userTwabArea < 1n << 128n).to.equal(true);
  });
});
