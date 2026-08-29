# VeilDraw mathematics

## Definitions

Let participant weights be non-negative integers `W_i`, let `T = sum(W_i)`, and assume first that
`T > 0`. Let `B` be the smallest power of two satisfying `T <= B`. Therefore, except for `B = 1`,
`B/2 < T <= B`.

Each candidate `X_j` is an independent uniform encrypted draw from `[0, B)`. A candidate is valid
exactly when `X_j < T`. Neither candidates nor validity predicates are decrypted. Define

```text
q = P(X_j >= T) = (B - T) / B.
```

## Fixed finite batch

For any fixed `x` with `0 <= x < T`, the event that position `j` (one-indexed) is the first valid
position and has value `x` requires `j-1` invalid draws followed by the particular value `x`:

```text
P(first valid value is x at position j) = q^(j-1) * 1/B.
```

For a batch of size `m`:

```text
P(R=x and batch succeeds)
  = (1/B) * sum[j=0..m-1] q^j
  = (1/B) * (1-q^m)/(1-q).
```

Because `1-q = T/B`, this equals `(1-q^m)/T`. The batch success probability is `1-q^m`, so

```text
P(R=x | batch succeeds) = ((1-q^m)/T) / (1-q^m) = 1/T.
```

This is an exact discrete equality, not an approximation or a statistical assertion.

## Retrying a wholly failed batch

Suppose entire batches are independent, and another batch can be generated only after a valid
public-decryption proof establishes that the previous batch's encrypted success boolean was false.
For retry number `k >= 1`:

```text
P(final R=x at retry k) = (q^m)^(k-1) * (1-q^m)/T.
```

Summing the geometric series gives `1/T`. Conditioning on eventual termination gives the same
result; termination has probability one because `q^m < 1`. The expected number of batches is
`1/(1-q^m)`.

The proof requirement is essential. If a caller can discard a successful encrypted batch, observe or
influence a candidate, provide a seed, or request a replacement before the result is proven, this
argument does not apply. The probe state machine binds proofs to the exact stored success handle and
makes acceptance irreversible.

## First-valid reductions

The serial invariant after processing positions `0..k` is: `chosenValid` is their disjunction, and
`chosenValue` is the smallest-index valid value or zero when none is valid.

For the balanced ordered tree, a node represents a contiguous original interval. Inductively,
`valid` is the interval disjunction and `value` is its smallest-index valid value. Combining left
before right with `select(left.valid, left.value, right.value)` preserves that invariant. The final
invalid value is normalized to zero. Thus balanced and serial return identical `(value, valid)`.

**MEASURED RESULT:** the independent TypeScript model compared the variants for every tuple in the
configured `B=2,4,8` domains. See
[`exhaustive-distribution.json`](../evidence/gate0/exhaustive-distribution.json).

## Weighted winner

Let `P_i = sum[k < i] W_k`. The half-open intervals `[P_i, P_i + W_i)` are disjoint and partition
`[0,T)`, ignoring empty zero-weight intervals. Because `R` is uniform on `[0,T)`, participant `i`
wins with exactly `W_i` accepted targets and therefore probability `W_i/T`.

## Boundaries

- `T=B`: `q=0`; every candidate is valid and the first candidate is uniform on `[0,T)`.
- `T=1`: minimal `B=1`; the only target is zero and it is selected with probability one.
- `T=0`: `[0,T)` is empty, so exact weighted selection is undefined. Candidate generation is not
  attempted. Gate 0 deliberately reveals the fixed zero predicate and terminates as
  `NoEligibleWeight`.

## Assumptions

The proof depends on independent, unbiased outputs from Zama's bounded encrypted CSPRNG, a public
power-of-two bound, no candidate/seed input from callers, no candidate or individual-validity
decryption, and KMS-authenticated state transitions. Zama documents bounded output as `[0,B)` and
requires state-changing transactions. Real-network realization of these assumptions remains a
Sepolia condition; the local mock validates contract behavior, not cryptographic entropy.
