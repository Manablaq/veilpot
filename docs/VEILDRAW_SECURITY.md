# VeilDraw security analysis

## Security invariants

1. The caller cannot provide a seed, candidate, random value, bucket, or comparison threshold.
2. A batch cannot be replaced while its proof is unresolved.
3. Only the aggregate success predicate is publicly decryptable; individual validities are not.
4. A `true` proof makes `CandidateAccepted` irreversible.
5. A fresh batch is enabled only by a valid `false` proof bound to the current success handle.
6. `T`, `X_i`, reduction values, prefix values, winner predicates, and `R` retain contract-only ACL.
7. The zero case terminates before candidate generation.

## Randomness and proof binding

**VERIFIED FACT:** official Zama documentation and installed `@fhevm/solidity` 0.11.1 source define
`FHE.randEuint128(uint128 upperBound)` as encrypted bounded randomness on `[0,upperBound)`, require
a power-of-two bound, and require a state-changing transaction. Zama describes the PRNG as
cryptographically secure.

**DESIGN DECISION:** the probe derives `B` from a KMS-authenticated bucket exponent, computes
`1 << exponent` internally, and calls this API without a user seed. The public-decryption proof is
checked with `FHE.checkSignatures` against an ordered handle list and ABI-encoded clear values.

**MEASURED RESULT:** local adversarial tests rejected altered clear values, empty/fake proofs,
proofs from another contract/draw, stale proofs after a new batch, a forged success using a failure
proof, reroll before resolution, and reroll/replay after success.

## ACL reasoning

- External encrypted `T` is verified by `FHE.fromExternal`, stored, and given permanent contract
  permission with `allowThis`.
- Generated candidates and derived validities receive explicit contract permission because later
  transactions reduce them.
- Serial/balanced outputs, accepted target, prefixes, winner count, and winner predicates each
  receive explicit contract permission before persistence.
- No caller receives permanent decryption permission in the draw flow.
- Public permission is applied only to controlled evidence handles.
- No cross-contract call needs transient permission in this probe.

ACL inheritance is not assumed. Successful later-transaction reductions are positive evidence that
stored operand permission persists. Failed public/user decryption attempts are negative evidence for
protected handles. Real relayer/KMS enforcement remains a Sepolia test condition.

## State and liveness

The implemented path is:

```text
AwaitingBucket -> BucketReady -> AwaitingBatchProof
                                    | true  -> CandidateAccepted (terminal)
                                    | false -> AwaitingCandidateBatch -> AwaitingBatchProof
AwaitingBucket -> NoEligibleWeight (T=0, terminal)
AwaitingBucket -> UnsupportedTotal (T>2^120, terminal)
```

Proof preparation and both reductions occur while `AwaitingBatchProof`; no function can generate a
replacement there. Since a positive batch succeeds with probability `1-q^m > 0`, permissionless
proof relay plus retries terminates almost surely. Production still needs an incentive or timeout
policy for censorship/lack of relayers; cryptography cannot force someone to submit a proof.

## Numeric ranges and overflow

FHE unsigned arithmetic wraps. Gate 0 therefore defines candidate/probe support as `T <= 2^120` and
publicly proves the fixed supported-domain predicate before deriving `B`.

A proposed later application envelope is:

| Quantity                      |                      Bound | Derivation                                          |
| ----------------------------- | -------------------------: | --------------------------------------------------- |
| participant count `N`         |                `N <= 2^16` | public registry cap                                 |
| individual principal `P`      | `P <= 2^56-1` atomic units | application deposit cap                             |
| observation duration `D`      |      `D <= 2^32-1` seconds | public round-duration cap                           |
| aggregate principal           |                   `< 2^72` | `N * P < 2^16 * 2^56`                               |
| individual TWAB numerator     |                   `< 2^88` | `P * D < 2^56 * 2^32`                               |
| aggregate TWAB / final prefix |                  `< 2^104` | `N * P * D < 2^16 * 2^56 * 2^32`                    |
| selected probe domain         |               `T <= 2^120` | 16 bits of headroom over the application TWAB bound |
| bucket/candidate              |      `B <= 2^120`, `X < B` | minimal power-of-two bucket for supported `T`       |
| winner count                  |                  `<= 2^16` | at most one predicate per registered participant    |

Thus principal addition, TWAB multiplication, total accumulation, prefix accumulation, and candidate
comparison fit in `euint128` under these bounds. The exact maximum aggregate TWAB is
`(2^16)(2^56-1)(2^32-1) < 2^104`, so it cannot approach the `2^128` wrap boundary.

Prize accounting is not implemented. A later encrypted reserve must separately enforce a public
economic cap no greater than `2^120-1` and prove every credit/debit preserves it; merely choosing
`euint128` is insufficient. The probe test accepts `2^120` and sends `2^120+1` to the terminal
unsupported state.

## Residual security conditions

- Real CSPRNG entropy, KMS threshold signatures, ACL enforcement, and HCU reverts are not exercised
  by cleartext mocks.
- Permissionless proof submission needs an availability/incentive design.
- A production implementation must bind draw inputs to protocol-computed totals rather than accept
  an external total as this measurement probe does.
- Production settlement should chunk no more than the HCU-supported participant count and bind
  chunks to one immutable `R` and prefix continuation.
