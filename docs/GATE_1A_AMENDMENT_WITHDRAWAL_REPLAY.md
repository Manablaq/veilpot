# Gate 1A Addendum — Withdrawal Replay Binding

This file is an additive normative clarification to the frozen Gate 1A architecture. It does not
modify or replace `docs/GATE_1_ARCHITECTURE.md`, `docs/GATE_1_SECURITY_MODEL.md`,
`docs/GATE_1_PRIVACY_LEDGER.md`, or `docs/GATE_1_TEST_PLAN.md`. Where withdrawal replay semantics
were previously unspecified, this amendment is authoritative.

## Canonical V1 operation

Withdrawal is direct-owner initiated and has a fixed recipient. The conceptual Solidity-compatible
signature is:

```solidity
withdraw(
    externalEuint64 encryptedRequestedAmount,
    bytes calldata inputProof,
    uint256 registrationVersion,
    uint256 reservationNonce,
    uint256 withdrawalNonce
)
```

The participant is `msg.sender`. There is no caller-supplied beneficiary, arbitrary recipient,
relayer, signature, meta-transaction, deadline, or `claimedPool`/`expectedPool` pair. The token
transfer recipient is the registered owner (`msg.sender`) for the current participant registration.
The external encrypted input is created for the VeilpotPool address and that participant.

The production types are `uint256` for `registrationVersion`, `reservationNonce`, and
`withdrawalNonce`, matching the existing Gate 1B.1 `Participant` fields, reservation nonce, and
`nextDepositNonce` mapping.

## Application binding versus FHE binding

`FHE.fromExternal` validates the encrypted input according to the pinned FHEVM external-input
domain. It does not provide application replay binding for registration version, reservation nonce,
or withdrawal nonce. Veilpot performs those checks independently in contract state.

The required pre-token checks are, in order: an existing participant owned by `msg.sender`; a state
that permits withdrawal; `registrationVersion == SUPPORTED_REGISTRATION_VERSION` and the current
registration version; `reservationNonce` equal to the current registration nonce; and
`withdrawalNonce == nextWithdrawNonce[msg.sender]`. The external input/proof is then validated, the
requested amount is bounded to the participant's encrypted principal, and the minimum token ACL is
prepared before token movement.

## Nonce storage and mutation

The pool stores:

```solidity
mapping(address => uint256) nextWithdrawNonce;
```

It is address-scoped, monotonically increasing, and is never reset by full withdrawal,
deregistration, slot release, `TOMBSTONED`, or re-registration. A withdrawal request can produce at
most one successful canonical token movement for one participant registration state.

The nonce increments exactly once only after `confidentialTransfer` successfully returns a valid,
usable encrypted `actualWithdrawn` handle and the canonical accounting transition can proceed. EVM
atomicity means it remains unchanged when public validation, `FHE.fromExternal`, token movement,
returned-handle validation, ACL preparation, or subsequent accounting reverts.

## Amount and accounting rules

The pool constructs an encrypted eligible amount equivalent to:

```text
eligibleRequest = min(requestedWithdrawal, participantPrincipal)
```

using pinned FHE operations. Raw token balance is never a withdrawal limit. The requested and
clamped ciphertexts are never accounting truth. Only token-returned `actualWithdrawn` may decrease
the participant principal and aggregate principal. `actualWithdrawn` is bounded by construction, and
the old principal is used for the TWAB checkpoint before mutation.

If the token call succeeds with encrypted zero, the request is processed, consumes one nonce, and
changes principal by zero. A partial actual transfer also consumes one nonce; the request cannot be
replayed to withdraw its remainder. A later withdrawal requires a fresh encrypted request and the
next nonce.

## Registration binding and replay cases

Every withdrawal binds simultaneously to the current address, current registration version, current
reservation nonce, and current withdrawal nonce. Consequently, an old request from registration A
cannot become valid for registration B, even when the address made no earlier withdrawal. Slot reuse
by another participant cannot validate an old request because checks are address- and registration-
bound, never slot-index-only.

The mandatory Gate 1B.2 tests are:

| Case                                | Required result                                             |
| ----------------------------------- | ----------------------------------------------------------- |
| Exact calldata replay after success | Reject stale withdrawal nonce                               |
| Copied calldata from another wallet | Reject caller and external-input domain                     |
| Stale or future withdrawal nonce    | Reject before token movement                                |
| Stale registration version          | Reject before token movement                                |
| Stale reservation nonce             | Reject before token movement                                |
| Deregister then re-register         | Old request rejects on registration binding                 |
| Token call reverts                  | Same nonce remains retryable                                |
| Malformed returned ciphertext       | Whole call reverts; nonce remains retryable                 |
| Successful encrypted-zero return    | Nonce increments once; zero accounting delta                |
| Successful partial return           | Nonce increments once; actual-only accounting               |
| Paused token then retry             | Failed call preserves nonce; later success processes it     |
| Reentrancy attempt                  | Nested mutation rejects; no duplicate movement              |
| Over-principal request              | Encrypted clamp prevents spending other obligations/surplus |

## Privacy and lifecycle interaction

Withdrawal nonce, registration version, and reservation nonce are public metadata. Requested amount,
actual amount, principal, and TWAB remain encrypted; this amendment introduces no amount disclosure.
Full withdrawal does not itself deregister a participant. Existing encrypted zero-balance proof
semantics remain authoritative for deregistration, and `nextWithdrawNonce[msg.sender]` survives
every slot lifecycle transition.

Failed transactions do not consume a nonce. Successfully processed zero, partial, and full actual
transfers do consume exactly one nonce. No deadline or signature/meta-transaction layer is added in
V1.
