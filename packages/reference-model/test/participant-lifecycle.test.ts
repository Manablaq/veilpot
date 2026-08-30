import { expect } from "chai";
import {
  MAX_ACTIVE_PARTICIPANTS,
  MIN_REGISTRATION_DEPOSIT_BASE_UNITS,
  ParticipantRegistryModel,
  REGISTRATION_ACTIVATION_PROOF_TTL_SECONDS,
  REGISTRATION_BOND_WEI,
  REGISTRATION_RESERVATION_TTL_SECONDS,
  SUPPORTED_REGISTRATION_VERSION,
} from "../src/participant-lifecycle.js";

const config = { poolDomain: "VeilpotPool", registrationVersion: SUPPORTED_REGISTRATION_VERSION };

describe("Gate 1A participant lifecycle model", function () {
  it("rejects unsupported registration versions at immutable model configuration", function () {
    expect(
      () =>
        new ParticipantRegistryModel({
          poolDomain: "VeilpotPool",
          registrationVersion: SUPPORTED_REGISTRATION_VERSION + 1n,
        }),
    ).to.throw("unsupported registration version");
  });

  it("keeps pull-deposit settlement asynchronous until a threshold proof settles it", function () {
    const model = new ParticipantRegistryModel(config);
    model.reserve("alice", 0n);
    model.setOperator("alice", 100n);
    const reservationNonce = model.reservationNonce("alice");
    model.poolDepositAttempt({
      depositor: "alice",
      caller: "alice",
      now: 1n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      depositNonce: 0n,
      actualTransferred: MIN_REGISTRATION_DEPOSIT_BASE_UNITS - 1n,
    });
    expect(model.status("alice")).to.equal("PENDING_ACTIVATION");
    model.settleThreshold({
      participant: "alice",
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      proofResult: false,
      now: 1n,
    });
    expect(model.status("alice")).to.equal("PENDING_REFUND");
    expect(model.bond("alice")).to.equal(0n);
    model.refundAttempt("alice", MIN_REGISTRATION_DEPOSIT_BASE_UNITS - 1n);
    model.settleRefundCompletion({
      participant: "alice",
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      refundAttemptNonce: 1n,
      proofComplete: true,
    });
    expect(model.status("alice")).to.equal("FREE");
  });

  it("times out pending activation permissionlessly and rejects late threshold proofs", function () {
    const model = new ParticipantRegistryModel(config);
    model.reserve("alice", 0n);
    model.setOperator("alice", 100n);
    const reservationNonce = model.reservationNonce("alice");
    model.poolDepositAttempt({
      depositor: "alice",
      caller: "alice",
      now: 10n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      depositNonce: 0n,
      actualTransferred: MIN_REGISTRATION_DEPOSIT_BASE_UNITS,
    });
    const deadline = model.activationDeadline("alice");
    expect(model.bond("alice")).to.equal(REGISTRATION_BOND_WEI);
    expect(() => {
      model.settleThreshold({
        participant: "alice",
        registrationVersion: SUPPORTED_REGISTRATION_VERSION,
        reservationNonce,
        proofResult: true,
        now: deadline + 1n,
      });
    }).to.throw("threshold proof expired");
    model.expirePendingActivation("alice", deadline + 1n);
    expect(model.status("alice")).to.equal("PENDING_REFUND");
    expect(model.bond("alice")).to.equal(0n);
  });

  it("accepts a threshold proof at the inclusive activation deadline", function () {
    const model = new ParticipantRegistryModel(config);
    model.reserve("alice", 0n);
    model.setOperator("alice", 100_000n);
    const reservationNonce = model.reservationNonce("alice");
    model.poolDepositAttempt({
      depositor: "alice",
      caller: "alice",
      now: 10n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      depositNonce: 0n,
      actualTransferred: MIN_REGISTRATION_DEPOSIT_BASE_UNITS,
    });
    model.settleThreshold({
      participant: "alice",
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      proofResult: true,
      now: model.activationDeadline("alice"),
    });
    expect(model.status("alice")).to.equal("ACTIVE");
  });

  it("rejects cap exhaustion before any irreversible pull accounting", function () {
    const model = new ParticipantRegistryModel(config);
    for (let i = 0; i < MAX_ACTIVE_PARTICIPANTS; i += 1) model.reserve(`user-${String(i)}`, 0n);
    expect(() => model.reserve("overflow", 0n)).to.throw("capacity full");
  });

  it("expires unused reservations and reuses tombstoned slots only after proof", function () {
    const model = new ParticipantRegistryModel(config);
    const reserved = model.reserve("alice", 0n);
    expect(() => {
      model.expire("alice", REGISTRATION_RESERVATION_TTL_SECONDS);
    }).to.throw("not expired");
    model.expire("alice", REGISTRATION_RESERVATION_TTL_SECONDS + 1n);
    expect(model.status("alice")).to.equal("FREE");
    model.reserve("bob", 0n);
    model.setOperator("bob", 100n);
    model.poolDepositAttempt({
      depositor: "bob",
      caller: "bob",
      now: 1n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce: model.reservationNonce("bob"),
      depositNonce: 0n,
      actualTransferred: MIN_REGISTRATION_DEPOSIT_BASE_UNITS,
    });
    model.settleThreshold({
      participant: "bob",
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce: model.reservationNonce("bob"),
      proofResult: true,
      now: 1n,
    });
    expect(model.status("bob")).to.equal("ACTIVE");
    model.deregister("bob", true);
    expect(model.reserve("carol", 0n)).to.equal(reserved);
  });

  it("rejects direct token sends instead of creating orphan storage", function () {
    const model = new ParticipantRegistryModel(config);
    expect(() => {
      model.directTokenSend();
    }).to.throw("UNSUPPORTED_DIRECT_TOKEN_SEND");
  });

  it("derives operator validity with inclusive expiry and revocation", function () {
    const model = new ParticipantRegistryModel(config);
    model.reserve("alice", 0n);
    expect(model.operatorAuthorized("alice", 1n)).to.equal(false);
    model.setOperator("alice", 2n);
    expect(model.operatorAuthorized("alice", 2n)).to.equal(true);
    expect(model.operatorAuthorized("alice", 3n)).to.equal(false);
    model.revokeOperator("alice");
    expect(model.operatorAuthorized("alice", 1n)).to.equal(false);
  });

  it("keeps an already-pulled pending principal unaffected by later operator revocation", function () {
    const model = new ParticipantRegistryModel(config);
    model.reserve("alice", 0n);
    model.setOperator("alice", 100n);
    const reservationNonce = model.reservationNonce("alice");
    model.poolDepositAttempt({
      depositor: "alice",
      caller: "alice",
      now: 1n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      depositNonce: 0n,
      actualTransferred: 10n,
    });
    model.revokeOperator("alice");
    expect(model.status("alice")).to.equal("PENDING_ACTIVATION");
    expect(model.nextDepositNonce("alice")).to.equal(1n);
  });

  it("binds caller, immutable domain/version, and application nonces before pull", function () {
    const model = new ParticipantRegistryModel(config);
    model.reserve("alice", 0n);
    model.setOperator("alice", 100n);
    const reservationNonce = model.reservationNonce("alice");
    const base = {
      depositor: "alice",
      caller: "alice",
      now: 1n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      depositNonce: 0n,
      actualTransferred: 10n,
    };
    expect(() => {
      model.poolDepositAttempt({ ...base, caller: "mallory" });
    }).to.throw("depositor caller mismatch");
    expect(() => {
      model.poolDepositAttempt({ ...base, claimedPool: "OtherPool" });
    }).to.throw("pool domain mismatch");
    expect(() => {
      model.poolDepositAttempt({ ...base, claimedVersion: 2n });
    }).to.throw("registration version mismatch");
    expect(() => {
      model.poolDepositAttempt({ ...base, reservationNonce: reservationNonce + 1n });
    }).to.throw("reservation nonce mismatch");
    expect(() => {
      model.poolDepositAttempt({ ...base, depositNonce: 1n });
    }).to.throw("deposit nonce mismatch");
    expect(model.nextDepositNonce("alice")).to.equal(0n);
    model.poolDepositAttempt(base);
    expect(model.nextDepositNonce("alice")).to.equal(1n);
  });

  it("rejects stale threshold proofs from an earlier reservation", function () {
    const model = new ParticipantRegistryModel(config);
    model.reserve("alice", 0n);
    model.setOperator("alice", 100n);
    const firstNonce = model.reservationNonce("alice");
    model.poolDepositAttempt({
      depositor: "alice",
      caller: "alice",
      now: 1n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce: firstNonce,
      depositNonce: 0n,
      actualTransferred: 1n,
    });
    model.expirePendingActivation("alice", model.activationDeadline("alice") + 1n);
    model.refundAttempt("alice", 1n);
    model.settleRefundCompletion({
      participant: "alice",
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce: firstNonce,
      refundAttemptNonce: 1n,
      proofComplete: true,
    });
    model.reserve("bob", 0n);
    model.setOperator("bob", 100n);
    const secondNonce = model.reservationNonce("bob");
    model.poolDepositAttempt({
      depositor: "bob",
      caller: "bob",
      now: 1n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce: secondNonce,
      depositNonce: 0n,
      actualTransferred: 1n,
    });
    expect(() => {
      model.settleThreshold({
        participant: "bob",
        registrationVersion: SUPPORTED_REGISTRATION_VERSION,
        reservationNonce: firstNonce,
        proofResult: true,
        now: 1n,
      });
    }).to.throw("reservation nonce mismatch");
    expect(model.status("bob")).to.equal("PENDING_ACTIVATION");
  });

  it("binds refund completion proofs to the current attempt and rejects replay", function () {
    const model = new ParticipantRegistryModel(config);
    model.reserve("alice", 0n);
    model.setOperator("alice", 100n);
    const reservationNonce = model.reservationNonce("alice");
    model.poolDepositAttempt({
      depositor: "alice",
      caller: "alice",
      now: 1n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      depositNonce: 0n,
      actualTransferred: 10n,
    });
    model.settleThreshold({
      participant: "alice",
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      proofResult: false,
      now: 1n,
    });
    model.refundAttempt("alice", 4n);
    model.settleRefundCompletion({
      participant: "alice",
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      refundAttemptNonce: 1n,
      proofComplete: false,
    });
    model.refundAttempt("alice", 0n);
    expect(() => {
      model.settleRefundCompletion({
        participant: "alice",
        registrationVersion: SUPPORTED_REGISTRATION_VERSION,
        reservationNonce,
        refundAttemptNonce: 1n,
        proofComplete: false,
      });
    }).to.throw("refund attempt nonce mismatch");
    model.settleRefundCompletion({
      participant: "alice",
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      refundAttemptNonce: 2n,
      proofComplete: false,
    });
    model.refundAttempt("alice", 6n);
    model.settleRefundCompletion({
      participant: "alice",
      registrationVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      refundAttemptNonce: 3n,
      proofComplete: true,
    });
    expect(model.status("alice")).to.equal("FREE");
    expect(() => {
      model.settleRefundCompletion({
        participant: "alice",
        registrationVersion: SUPPORTED_REGISTRATION_VERSION,
        reservationNonce,
        refundAttemptNonce: 3n,
        proofComplete: true,
      });
    }).to.throw("refund completion proof not pending");
  });

  it("keeps the activation proof TTL distinct from reservation TTL", function () {
    const model = new ParticipantRegistryModel(config);
    model.reserve("alice", 0n);
    model.setOperator("alice", 100_000n);
    const reservationNonce = model.reservationNonce("alice");
    model.poolDepositAttempt({
      depositor: "alice",
      caller: "alice",
      now: 123n,
      claimedPool: "VeilpotPool",
      claimedVersion: SUPPORTED_REGISTRATION_VERSION,
      reservationNonce,
      depositNonce: 0n,
      actualTransferred: 1n,
    });
    expect(model.activationDeadline("alice")).to.equal(
      123n + REGISTRATION_ACTIVATION_PROOF_TTL_SECONDS,
    );
  });
});
