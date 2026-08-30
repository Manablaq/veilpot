# Gate 0 decision

## Decision history and current status

The immutable local/pre-live baseline decision was **CONDITIONAL**: Sepolia evidence was still
required at that point. The complete live protocol audit subsequently reached
`PASS_READY_TO_FINALIZE`. The first finalization emission was rejected as evidence because its
snapshot was incomplete (see the finalization-emission incident record); it did not mutate protocol
state. The current status remains **PASS_READY_TO_FINALIZE** until the corrected finalizer emits a
validated bundle with `finalGateDecision: PASS` and `finalizationStatus: FINALIZED`. A future
successful corrected emission may then record the current final Gate 0 decision as **PASS** without
deleting this historical CONDITIONAL record.

## Objective

Determine whether Veilpot can perform exact proportional weighted selection with encrypted weights
and an encrypted exact aggregate, using current FHEVM primitives with acceptable correctness,
privacy, security, liveness, and cost.

## Verified dependencies

The compatible Hardhat generation is pinned to Hardhat 2.28.6, `@fhevm/solidity` 0.11.1,
`@fhevm/hardhat-plugin` and `@fhevm/mock-utils` 0.4.2, relayer SDK 0.4.1, ethers 6.16.0,
OpenZeppelin Confidential Contracts 0.5.3, Solidity 0.8.27, and TypeScript 5.9.3. The future
frontend direction is the Zama SDK v3 family, not the development relayer SDK. See
[`DEPENDENCY_BASELINE.md`](DEPENDENCY_BASELINE.md).

## Mathematical result

**MATHEMATICAL RESULT:** first-valid rejection sampling is exactly uniform on `[0,T)` conditioned on
batch success. Cryptographically proven whole-batch retries preserve exactness. Prefix intervals
then give exactly `P(i)=W_i/T`. Power-of-two totals and `T=1` are valid boundary cases; `T=0` has no
target distribution and is terminated separately.

## Reference-model result

**MEASURED RESULT:** the independent strict-TypeScript bigint model passed six test groups. Complete
enumeration across the configured `B=2,4,8` domains checked 7,052 tuples, established identical
serial/balanced outputs, and found equal exact counts for every accepted `x<T`. Deterministic larger
simulations passed as sanity checks, not proof substitutes.

## FHE implementation result

**MEASURED RESULT:** `VeilDrawProbe.sol` compiled and 26 mock-FHE tests passed. The encrypted binary
bucket search, bounded random calls, encrypted validation, both reductions, public proof flow, retry
state machine, ACL denials, and prefix selection all executed locally. Solidity results agree with
the independent reference behavior for tested cases.

**UNRESOLVED:** the Hardhat mock tracks clear values and FHE events; it does not exercise real
threshold FHE, Sepolia coprocessors, relayer availability, or real KMS latency.

## Privacy result

The exact positive `T`, candidates, individual validities, accepted `R`, prefix state, odds, and
winner remain non-public in the probe. Public evidence reveals the minimal bucket, whether `T=0`,
whether the fixed supported bound is met, and aggregate batch success. This is bucket privacy, not
perfect aggregate hiding. Batch failures also leak statistical information about `T` within `B`.

## Security result

The ABI has no caller-selected threshold, seed, candidate, or bound. Proofs bind clear results to
specific ordered ciphertext handles. Tests reject forged, altered, cross-draw, replayed, and stale
proofs; generation is blocked until failure proof and permanently blocked after success. Explicit
ACL is applied to every persisted derived handle. The application envelope proves aggregate TWAB
below `2^104`, within the fixed `2^120` probe domain and `euint128` capacity.

## Performance result

Bucket computation measured 4,056,064 global / 1,923,032 sequential HCU. For `m=8`, candidate
generation measured 1,920,000 / 240,000 HCU and balanced reduction 624,032 / 228,000 HCU. Prefix
selection measured 7,808,320 / 2,571,064 HCU for eight participants. Sixteen participants fit the
mock at 15,616,576 / 4,643,064 HCU but leave only 7.1% sequential headroom, so it is not a safe
production chunk size without live evidence.

## Best candidate batch size

**DESIGN DECISION:** use `m=8` for the next verification stage. Failure is strictly below `1/256`,
expected attempts are below `256/255`, and measured cost retains substantial headroom. `m=16` buys
little additional liveness for twice the candidates; `m=4` leaves a retry probability whose supremum
is 6.25%.

## Zero-total decision

**DESIGN DECISION:** publicly reveal the fixed `T=0` predicate and enter terminal
`NoEligibleWeight`; a later prize reserve may then roll the prize forward. This leaks that no
eligible weight exists, but prevents infinite retries and gives public liveness/verifiability.
Keeping zero existence encrypted would require an additional safe control architecture and would not
permit candidate sampling from an empty range. No batch is generated for zero.

## Remaining uncertainties

- real bounded-CSPRNG behavior and independence on current Sepolia;
- real KMS proof verification, ACL denial, and stale/wrong-handle behavior;
- actual HCU limit enforcement and any divergence from mock receipt accounting;
- public-decryption and retry wall-clock latency;
- production proof-relay incentives/censorship handling;
- safe chunked settlement using one immutable target and encrypted carried prefix.

## Sepolia runner preparation

**DESIGN DECISION:** the reproducible non-secret Sepolia runner is prepared in
`packages/contracts/scripts/run-sepolia.ts` and is documented in
[`GATE_0_SEPOLIA_VERIFICATION.md`](GATE_0_SEPOLIA_VERIFICATION.md). It creates live evidence only
after a real broadcast, stores no protected cleartext or credential, and resumes from public
contract state. At this decision revision, no Sepolia credentials were configured and no transaction
was broadcast; this is not live verification evidence.

## Required Sepolia tests

1. Deploy the exact compiled probe through `ZamaEthereumConfig` and confirm current addresses and
   compiler compatibility without hard-coded addresses.
2. Execute bucket values `0,1,2,3,129,255,256,2^120,2^120+1` and verify one ordered public proof.
3. Execute `m=1,2,4,8,16`; record real transaction gas, HCU/depth acceptance, relayer latency, and
   proof turnaround. Do not substitute estimates.
4. Verify real bounded candidates are private, in `[0,B)`, and not caller-influenceable.
5. Repeat ACL denial attempts for `T`, `X_i`, reduction values, and `R` through the real SDK/KMS.
6. Repeat forged, wrong-handle, cross-draw, stale, false-to-true, replay, and post-success reroll
   tests with real KMS proofs.
7. Run eight-participant prefix chunks and cautiously probe sixteen; confirm headroom before setting
   a production cap.

## Final status

The construction is mathematically exact, locally coherent, privacy-bounded, and well within mock
limits for the selected `m=8`. Because critical cryptographic, ACL, proof-latency, and live HCU
claims still require Sepolia, Gate 0 cannot be marked PASS. No mathematical or local security flaw
currently requires FAIL.

CONDITIONAL
