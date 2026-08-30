import { expect } from "chai";

import { ClaimResidualModel, type ClaimAuthorization } from "../src/claim-residual.js";

const baseAuthorization = (nonce: bigint): ClaimAuthorization => ({
  chainId: 11155111n,
  reserve: "reserve",
  drawId: 7n,
  participant: "alice",
  recipient: "alice",
  nonce,
  expiry: 100n,
});

describe("GATE_1_DESIGN_PROBE_ONLY claim residual model", function () {
  it("keeps zero and partial transfers claimable", function () {
    const claim = new ClaimResidualModel(100n, 11155111n, "reserve", 7n, "alice");
    claim.claim(baseAuthorization(0n), 0n, 1n);
    expect(claim.remaining).to.equal(100n);
    claim.claim(baseAuthorization(1n), 40n, 2n);
    expect(claim.remaining).to.equal(60n);
    expect(claim.state).to.equal("Claimable");
  });

  it("marks a full transfer claimed and rejects repeat calls", function () {
    const claim = new ClaimResidualModel(100n, 11155111n, "reserve", 7n, "alice");
    claim.claim(baseAuthorization(0n), 100n, 1n);
    expect(claim.remaining).to.equal(0n);
    expect(claim.state).to.equal("Claimed");
    expect(() => {
      claim.claim(baseAuthorization(1n), 0n, 2n);
    }).to.throw("claim already completed");
  });

  it("rejects replayed authorization, wrong participant, and changed recipient", function () {
    const claim = new ClaimResidualModel(100n, 11155111n, "reserve", 7n, "alice");
    const auth = baseAuthorization(0n);
    claim.claim(auth, 10n, 1n);
    expect(() => {
      claim.claim(auth, 10n, 2n);
    }).to.throw("invalid claim authorization");
    expect(() => {
      claim.claim({ ...baseAuthorization(1n), participant: "bob" }, 10n, 2n);
    }).to.throw("invalid claim authorization");
    expect(() => {
      claim.claim({ ...baseAuthorization(1n), recipient: "bob" }, 10n, 2n);
    }).to.throw("invalid claim authorization");
  });

  it("rejects actual transfer overflow, underflow, and expired authorization", function () {
    const claim = new ClaimResidualModel(100n, 11155111n, "reserve", 7n, "alice");
    expect(() => {
      claim.claim(baseAuthorization(0n), 101n, 1n);
    }).to.throw("actual transfer exceeds requested residual");
    expect(() => {
      claim.claim({ ...baseAuthorization(0n), expiry: 2n }, 10n, 3n);
    }).to.throw("invalid claim authorization");
    expect(() => {
      claim.claim(baseAuthorization(0n), -1n, 1n);
    }).to.throw("actual transfer exceeds requested residual");
  });
});
