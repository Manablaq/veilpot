# Gate 1A Additive Amendment: Historical Snapshot Beneficiary Binding

This document is an additive normative clarification to the frozen Gate 1A architecture. It does not
replace or rewrite Gate 1A, Gate 1B.1, Gate 1B.2, or the withdrawal replay amendment. Where
historical snapshot beneficiary identity was previously unspecified, this amendment is
authoritative.

## Scope and exact existing types

The current production participant record in `packages/contracts/contracts/VeilpotPool.sol` uses:

- `owner: address`;
- `registrationVersion: uint256`;
- `reservationNonce: uint256`;
- slot index: `uint256` (the index in the fixed `Participant[128]` array);
- epoch identifiers: `uint256` (`twabEpoch`, `pendingSnapshotEpoch`, and `activeEpochId`);
- snapshot identifiers: `uint256` (`currentSnapshotId`, `nextSnapshotId`);
- encrypted snapshot weight: `euint128`.

The current implementation stores `_snapshotWeights[snapshotId][slotIndex]` and processing/locking
markers, but does not yet store historical owner/version/registration identity beside that weight.
That omission is the reason production VeilDraw integration is blocked until the storage amendment
is implemented and tested.

## Canonical historical identity

For an eligible slot in a closing epoch, the canonical registration identity is:

```text
(owner: address, registrationVersion: uint256, reservationNonce: uint256)
```

The complete logical historical record is:

```text
HistoricalRecord(epochId: uint256, snapshotId: uint256, slotIndex: uint256) = {
    encryptedRawTwabWeight: euint128,
    owner: address,
    registrationVersion: uint256,
    reservationNonce: uint256
}
```

The slot index is a location, not an entitlement identity. For V1 the owner in this record is the
historical beneficiary. No caller, relayer, administrator, or later slot occupant may select or
replace the beneficiary.

## Capture-time rule

Weight sealing and beneficiary sealing are one atomic conceptual operation. The identity must be
bound no later than, and before completion of, the first operation that seals the closing epoch's
weight. It must occur before any operation can change or clear the registration identity, including:

- deregistration;
- `FREE` or `TOMBSTONED` transition;
- refund-completion slot release;
- reservation reuse; or
- re-registration.

Sealing a weight without sealing its matching identity, or sealing an identity without the matching
epoch/slot weight relationship, is invalid.

## Late snapshots and the two capture paths

Gate 1B.2 permits a snapshot to start after its historical cutoff. The cutoff remains the configured
epoch end, never the invocation timestamp. Therefore beneficiary binding cannot depend on immediate
snapshot processing.

Two semantic paths are valid and must produce the same record:

1. **Pre-snapshot seal.** If a post-cutoff lifecycle operation touches a registration before its old
   snapshot slot is materialized, it first atomically preserves the closing epoch, slot, encrypted
   weight, owner, registration version, and reservation nonce. Only then may the mutation continue.
2. **Lazy snapshot materialization.** If no identity-changing transition occurred, snapshot
   processing freezes the still-current registration identity together with the weight. This must
   equal the record Path A would have produced.

Once bound for an epoch/snapshot and slot, the identity is immutable. Later operations may observe
it or reject; they may never overwrite it with a new registration.

## Epoch and snapshot binding

The historical record is keyed by the exact closing `epochId` and `slotIndex`; the finalized
`snapshotId` permanently identifies the epoch whose records it consumes. An implementation may use
epoch-keyed staging or an equivalent deterministic mechanism. It must not require a future snapshot
ID to exist before pre-snapshot sealing, nor may it substitute an epoch-E record into an epoch-E+1
snapshot.

Future draw input is therefore:

```text
draw -> snapshotId -> closing epochId -> slotIndex
     -> frozen (owner, registrationVersion, reservationNonce) -> encrypted weight
```

Draw/prize logic must never consult current `participants[slot].owner`, current version, or current
reservation nonce to resolve an old snapshot beneficiary.

## Slot reuse and re-registration

Slots may be reused only for future participation under the existing lifecycle. For example, if
snapshot 10 records slot 4 as Alice with reservation nonce 7, later reuse of slot 4 by Bob cannot
alter snapshot 10; Bob's distinct registration instance can only contribute to a later snapshot.

The same-address case is identical: Alice's later registration with a new reservation nonce is not
registration A and cannot replace registration A in an earlier record.

An ineligible slot has no beneficiary entitlement record. A participant activated after the cutoff
is ineligible for that closed epoch and receives no historical beneficiary record for it. An
eligible zero-weight registration may retain its identity record, but encrypted zero occupies no
winner interval.

## Public metadata and privacy

Owner/address, registration version, reservation nonce, slot, epoch, and snapshot identifiers are
already public registration metadata. The amendment does not make encrypted principal, raw TWAB,
candidate, total, winner selector, or winner interval public. A public historical population does
not identify which beneficiary wins.

Beneficiary identity need not be encrypted. Winner privacy comes from the encrypted winner selector,
not from hiding already-public registration metadata. No new event is required; a future read-only
`snapshotBeneficiary(snapshotId, slotIndex)`-style getter may expose owner, version, nonce, and a
bound/eligible marker without exposing weight plaintext.

## Lifecycle audit requirement

Every identity-clearing path must preserve an unmaterialized closing-epoch record before clearing or
reusing the participant: deregistration, refund completion, `FREE`, `TOMBSTONED`, reservation reuse,
and re-registration. Normal withdrawal does not change identity, but if it seals a post-cutoff old
epoch it must seal the beneficiary in the same operation. Pending activation, pending refund, and
other never-eligible states cannot receive historical entitlement.

## Required invariants

1. For every historical weight `W(E,S)`, there exists at most one historical registration identity
   `R(E,S)`.
2. Once `R(E,S)` is bound, no future slot lifecycle may modify it.
3. A winner over `W(E,S)` can create entitlement only for `R(E,S)`, never for
   `currentParticipant(S)`.
4. Slot reuse may change current occupancy but cannot change any previously frozen `R(E,S)`.
5. Weight sealing and beneficiary sealing refer to the same closing epoch and registration instance.

Historical beneficiary metadata grows at most `O(snapshot count × 128 slots)`. This is bounded per
snapshot metadata, not an unbounded per-user history traversal; no operation may iterate across all
historical snapshots. Each draw reads only its own finalized snapshot.

## Mandatory implementation tests for the next gate

- Alice owns a weighted slot at cutoff; after legitimate release, Bob reuses the slot; the
  historical record remains Alice's registration identity.
- Alice registration A ends and Alice registration B begins; an old snapshot remains bound to A's
  version and reservation nonce.
- Alice mutates after cutoff before a late snapshot start; the old record remains Alice-at-cutoff.
- Activation after cutoff has no old-epoch beneficiary record.
- Any overwrite attempt after binding reverts or leaves the record byte-for-byte unchanged.
- Future draw code consumes historical weight and historical beneficiary as an immutable pair and
  never reads the current slot owner for that draw.

No admin correction, owner-set beneficiary, migration override, or arbitrary recipient fallback is
permitted. An incorrect binding must fail closed during development.
