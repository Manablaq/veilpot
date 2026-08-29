# VeilDraw privacy analysis

## Public information

- draw id and state transitions;
- transaction senders, gas, ordering, timing, and other chain metadata;
- any participant registry required by a later protocol;
- the verified bucket exponent and therefore `B`;
- the fixed booleans `T=0` and `T<=2^120`;
- candidate batch size, batch number, and final batch-success boolean;
- whether and how many failed batches occurred;
- eventual public settlement metadata not designed in Gate 0.

## Private information

- individual principal/balance and TWAB weight;
- individual odds;
- exact aggregate `T` for positive supported rounds;
- every `X_i` and individual `X_i < T` predicate;
- accepted target `R`;
- prefix values, winner predicates, and winner identity;
- prize amount where a later architecture keeps it encrypted.

The probe calls `makePubliclyDecryptable` only on the bucket exponent, zero flag, supported-domain
flag, and one aggregate batch-success handle. Tests show public and user decryption fail for `T`,
candidates, reduction values, and `R`.

## Bucket leakage

For a positive minimal bucket greater than one, publication of `B` reveals

```text
B/2 < T <= B.
```

For `B=1`, it reveals `T=1`. This is **bucket privacy**, not information-theoretic hiding of the
aggregate. No claim of perfect aggregate hiding is made.

The public batch result leaks additional statistical information: a batch fails with `((B-T)/B)^m`.
Across repeated draws, or after an observable retry, an adversary can update beliefs about where `T`
lies inside the bucket. A smaller `T` near `B/2` makes failure more likely. This does not directly
decrypt `T`, but it is a real side channel and must appear in the protocol privacy model.

## Threshold-oracle resistance

Bucket discovery uses exactly seven internal comparisons in a fixed encrypted binary search. The
caller supplies no threshold, bound, exponent, seed, or candidate. Only the final fixed-domain
evidence is decryptable. The ABI test confirms there is no `isTotalAbove` or equivalent entry point.
Altered bucket evidence fails KMS-signature verification.

## Anonymity-set limits

Encryption cannot create anonymity. With one participant, a private winner is inferable. With a
small or highly uneven set, registry membership, deposits, timing, prize withdrawal, and public
failure history may reveal or strongly correlate winner identity and odds. Later gates must define
minimum set sizes, withdrawal timing, and metadata defenses; Gate 0 does not claim to solve them.
