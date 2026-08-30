# Gate 1A — Security Model and Invariants

This is a pre-implementation threat model. No production contract is authorized by this document.

## Security objectives

1. User principal remains withdrawable under the documented liquidity policy and is never a prize
   source.
2. A draw's encrypted weights and total are immutable after snapshot.
3. VeilDraw selection remains exactly proportional; no caller, keeper, adapter, or admin can reroll
   or inject entropy.
4. FHE ACLs never grant accidental public or cross-user access.
5. Every asynchronous stage is permissionless, resumable, bounded, and replay-safe.
6. A prize entitlement can be claimed once and only by its actual winner.

## Threat actors and trust assumptions

| Actor                  | Capability                                                  | Security treatment                                                             |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Ordinary caller/keeper | Calls public stage functions, submits ciphertexts/proofs    | Cannot select randomness, thresholds, recipient, or snapshot                   |
| Participant            | Owns a confidential balance and may request withdrawal      | Only own ACL and authorized claim path                                         |
| Malicious participant  | Dust/spam deposits, flash timing, proof replay              | Bounded registry/checkpoints, snapshot freeze, nonce checks                    |
| Relayer/KMS observer   | Sees public metadata and permitted decryptions              | Never receives protected T, candidates, weights, or target                     |
| Yield adapter          | External calls and accounting reports                       | Immutable address, solvency checks, no principal transfer authority            |
| Token contract         | May reenter, charge fees, rebase, or fail                   | Explicitly supported token class only; CEI/reentrancy guard                    |
| Admin (if any)         | Operational pause/configuration                             | Cannot choose winner, change active weights, seize principal, or bypass proofs |
| Chain adversary        | Front-runs public transactions and observes calldata/events | No secret-dependent public branching; proof binding and snapshot IDs           |

FHE cryptography, host ACL contracts, KMS threshold signing, and the selected token implementation
remain external trust assumptions. For the Sepolia competition profile, read-only verification
confirmed cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491`, its underlying mock
`0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`, and wrapper registry
`0x2f0750Bbb0A246059d80e94c454586a7F27a128e`. The wrapper is owner-controlled, pausable, and
classified `UUPS_CONFIRMED` from official deployment metadata/source (the nonzero EIP-1967 slot is
corroborating evidence); the owner is an external Protocol DAO address. This is testnet trust, not
Veilpot admin authority.

## Principal and reserve invariants

- **I1 Solvency:** before any successful user withdrawal, redeemable principal assets plus idle
  principal backing are at least outstanding principal obligations.
- **I2 Separation:** reserve payout functions cannot call pool principal-transfer paths or reduce
  principal accounting.
- **I3 Yield provenance:** `Y` increases only after adapter accounting proves realized gain or
  explicit sponsor funding; token balance surplus alone is insufficient.
- **I4 Conservation:** deposits increase exactly one user's encrypted principal and aggregate `P`;
  withdrawals decrease both by the same verified amount.
- **I5 Loss mode:** adapter loss or illiquidity cannot silently create prize funds or overstate a
  user's withdrawable balance.
- **I6 No fee ambiguity:** unsupported fee-on-transfer/rebasing tokens are rejected before
  accounting is committed.
- **I6a Simulated yield provenance:** once draw `d` is `SnapshotReady`, recognized gain is the
  encrypted `floor(RAW_TOTAL_TWAB_d / (10,000 × 86,400))` capped by dedicated non-principal
  `fundedYieldLiquidity`; recognition is once per draw and sponsor funding is never yield.
- **I6b External incident safety:** wrapper pause/denylist/upgrade can delay movement but cannot
  rewrite obligations, redirect entitlements, or grant Veilpot winner authority.

## Confidential accounting invariants

- **I7 Ownership:** an encrypted balance handle is usable only by the pool and its account owner.
- **I8 Input binding:** external encrypted inputs require a valid proof bound to the pool, sender,
  type, and nonce/domain.
- **I9 No plaintext branch:** protocol decisions use encrypted comparisons or fixed public metadata;
  no secret-dependent Solidity branch is introduced.
- **I10 Snapshot immutability:** draw weights and total cannot change after `SnapshotReady`.
- **I11 Withdrawal isolation:** one user's encrypted subtraction cannot spend another user's handle.
- **I12 ACL persistence:** every handle retained across transactions receives explicit `allowThis`;
  user access is granted only where the interface documents it.

## TWAB and snapshot invariants

- **I13 No retroactivity:** a deposit contributes zero area before its timestamp.
- **I14 Accrual conservation:** checkpointing uses the old balance for the elapsed interval before
  applying a new balance.
- **I15 No flash bypass:** deposit/withdraw/redeposit within a block cannot manufacture historical
  area or alter a frozen snapshot.
- **I16 Bounded area:** `balance × elapsed time` and aggregate sums remain within proven encrypted
  widths.
- **I17 Version binding:** every draw proof and candidate batch references one immutable snapshot
  version and draw ID.
- **I18 Churn safety:** registry additions/removals affect future snapshots only.
- **I18a Epoch sealing:** each closed-epoch account weight is written exactly once before any
  post-cutoff mutation can affect the next epoch.

## VeilDraw and randomness invariants

- **I19 Exactness:** conditioned on batch success, the first-valid target is uniform over `[0,T)`;
  prefix intervals therefore yield `W_i/T`.
- **I20 Entropy authority:** only the protocol's bounded FHE RNG creates candidates; no seed,
  candidate, timestamp, blockhash, or backend winner is accepted.
- **I21 Proof-before-retry:** a new batch is authorized only after valid KMS proof that every prior
  candidate was invalid.
- **I22 Success irreversibility:** after a valid success proof, target acceptance is terminal and
  reroll attempts reject.
- **I23 No oracle:** bucket discovery uses fixed protocol comparisons only; no caller-selected
  threshold query exists.
- **I24 Zero total:** zero eligible weight enters a terminal no-eligible state without RNG.
- **I25 Reduction order:** serial and balanced reductions preserve original candidate order and
  produce equivalent first-valid semantics.

## Claim and reserve invariants

- **I26 Single claim:** claim state transitions once; replay and duplicate payout reject.
- **I27 Recipient binding:** a relayer cannot redirect a winner's entitlement.
- **I28 Nonwinner denial:** no account can claim another account's encrypted entitlement.
- **I29 Payout isolation:** reserve payout cannot decrement `P`, user balances, or TWAB.
- **I30 Public leakage:** only documented bucket/status booleans, addresses, timestamps, and
  settlement metadata become public.
- **I31 Transfer-failure safety:** a zero or partial confidential payout leaves the encrypted
  residual entitlement claimable until encrypted residual exhaustion or an explicitly authorized,
  proof-backed full-transfer transition.
- **I32 Claim authorization:** EIP-712-style authorization binds chain ID, reserve, draw ID,
  participant, immutable recipient, nonce, and expiry; each nonce is consumed once.
- **I33 Raw-weight exactness:** draw weights are raw encrypted TWAB integrals; no division or
  rounding occurs before VeilDraw bucket and prefix selection.
- **I34 Snapshot boundedness:** at most one unresolved prior epoch exists per account; every seal is
  O(1) and a second epoch cannot close before the registered snapshot completes.

## ACL matrix (design target)

| Handle                                  | Contract                                     | User                                                       | Public decrypt            | Lifetime                  |
| --------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- | ------------------------- | ------------------------- |
| User balance                            | `allowThis`                                  | Owner only when explicit reveal/withdraw protocol requires | No                        | Until balance replacement |
| TWAB accumulator                        | `allowThis`                                  | No by default                                              | No                        | Snapshot/account lifetime |
| Principal total `P`                     | `allowThis`                                  | No                                                         | No                        | Pool lifetime             |
| Draw weight/total                       | `allowThis`                                  | No                                                         | No                        | Draw lifetime             |
| Closed raw TWAB to immutable adapter    | `allow` to adapter, then adapter `allowThis` | No                                                         | No                        | One recognition per draw  |
| Bucket exponent/zero/support predicates | `allowThis`                                  | No                                                         | Yes, fixed predicate only | Bucket proof stage        |
| Candidate `X_i` and validity            | `allowThis`                                  | No                                                         | No                        | Batch lifetime            |
| Batch success predicate                 | `allowThis`                                  | No                                                         | Yes, boolean only         | Batch proof stage         |
| Accepted target                         | `allowThis`                                  | Claimant only through controlled claim path                | No                        | Draw/claim lifetime       |
| Prefix running sum/predicates           | `allowThis`                                  | No                                                         | No                        | Winner resolution         |
| Prize entitlement (`euint64`)           | `allowThis`                                  | Fixed participant only after valid authorization           | No                        | Until fully transferred   |

`allowTransient` is used only for the one-transaction pool-to-reserve entitlement handoff. No ACL
call is added speculatively; each must have a test proving both allowed and denied paths. Public
decryption is never granted to balances, weights, totals, candidates, targets, or entitlements.

For the ERC-7984 pull, the pool grants `requested` transiently to the token contract address. The
token-side consumer must verify `FHE.isAllowed(requested, address(this))`, not merely
`FHE.isAllowed(requested, msg.sender)`, before using the handle; it then grants the returned actual
amount transiently back to the pool. The design-only probe includes both positive and missing-grant
paths.

## Numeric bound proof obligations

FHE arithmetic wraps rather than reliably reverting. The frozen design envelope is six decimals, 128
participants, 30 days, 1,000,000 tokens per user, and 128,000,000,000,000 base units total. The
independent bigint model proves the following bit lengths; implementation must still check every
intermediate operation.

| Quantity              | Candidate type | Bound to prove                             | Operations      | Required margin        |
| --------------------- | -------------- | ------------------------------------------ | --------------- | ---------------------- |
| User balance          | `euint64`      | 40 bits                                    | add/sub/compare | `< 2^64` and `< 2^120` |
| Aggregate principal   | `euint128`     | 47 bits                                    | add             | `< 2^120`              |
| TWAB area             | `euint128`     | 62 bits user / 69 aggregate                | mul/add         | `< 2^120`              |
| Raw draw weight/total | `euint128`     | 69 bits aggregate                          | add/compare     | `< 2^120`              |
| Candidate/target      | `euint128`     | 69 value bits (`B ≤ 2^69`; B bitLength 70) | RNG/compare     | `< 2^120`              |
| Prefix accumulator    | `euint128`     | 69 bits                                    | add             | `< 2^120`              |
| Prize entitlement     | `euint64`      | 40 bits                                    | select/sub      | `< 2^64`               |

If requirements exceed these bounds, widen or partition; never rely on wraparound. Adapter
exchange-rate multiplication and decimal conversion require separate rounding and overflow proofs.

## Access control and admin model

The preferred v1 has no winner-selecting administrator and no upgrade authority. A pause, if
required for a token/adapter incident, may block new deposits or prize commitments but must not
rewrite an active snapshot, accepted target, or principal balance. Any emergency withdrawal path
must preserve the solvency invariant and be separately timelocked/audited. Admin cannot make private
handles public, replace randomness, bypass KMS proof checks, or redirect reserve payout.

## External calls and reentrancy

External calls are limited to the selected token wrapper, underlying token, and immutable yield
adapter. Follow CEI: validate encrypted/accounting state, update internal state, then call external
contracts, with a reentrancy guard and return-value checks. If an external call fails, revert the
entire state transition. Never make a second FHE-dependent decision after an external call whose
effects could be reentered.

## ERC-7984 pull-deposit and claim safety

Deposits use a pool-initiated `confidentialTransferFrom` and account the token-returned actual
`euint64`, not the requested external ciphertext. No receiver callback is part of the canonical
deposit path. Claims target the fixed registry participant and require participant authorization
binding chain ID, reserve, draw, recipient, nonce, and expiry; the reserve subtracts the token's
returned actual amount from encrypted `euint64` remaining entitlement. A zero/partial transfer
leaves the claim open rather than burning it.

## Denial of service and storage

Bound participant count, per-user checkpoint frequency, draw window, batch size, prefix chunk size,
and proof retries. The documented minimum activation deposit is one six-decimal token and the public
reservation bond is `1e15` wei for the Sepolia demo. Use tombstones/versioned snapshots instead of
unbounded historical iteration. Repeated invalid proofs must be cheap to reject and unable to mutate
state. A relayer/KMS outage requires permissionless retry of the same stage and an explicit
timeout/recovery path; it must not strand principal.

Participant lifecycle is fixed: a public `REGISTRATION_BOND_WEI = 1e15` native-ETH demo bond
(`SEPOLIA_DEMO_REGISTRATION_BOND`, not production Sybil economics) reserves a slot before the
ERC-7984 pull; pending actual-received escrow is threshold-checked at one six-decimal token and only
then activates the address. The pool pull moves `RESERVED → PENDING_ACTIVATION` without branching on
plaintext and records `activationDeadline = activationStartedAt + 86,400`; only a bound threshold
KMS proof at or before that deadline chooses `ACTIVE` or `PENDING_REFUND`. After the deadline,
anyone may move the pending registration to `PENDING_REFUND`, and late threshold proofs are
rejected. Under- threshold escrow is refundable, a full-cap reservation is rejected before token
movement, and zero-balance deregistration requires an explicit public proof. Refunds use
`PENDING_REFUND → REFUND_ATTEMPT_PENDING_PROOF → PENDING_REFUND/FREE`; no second refund transfer is
allowed while completion proof is pending. The bond is returned when activation, false-proof,
timeout, or unused-reservation expiry settles, independent of external token liveness. Tombstones
are reused only by later snapshot versions. An absent/expired/malformed reservation is rejected
before the pool's token call without principal, slot, or orphan storage. External-wrapper incidents
are fail-safe: pause blocks new deposits/claims and may delay withdrawals without rewriting
obligations; denylist blocks only the affected transfer while preserving the owed encrypted
principal/entitlement; an incompatible upgrade stops new deposits and migration until a new reviewed
version. Veilpot has no authority to redirect prize or seize principal.

## Liveness matrix

| State                | Anyone may progress               | Timeout/recovery            | Fairness effect                 |
| -------------------- | --------------------------------- | --------------------------- | ------------------------------- |
| Snapshotting         | Process next bounded chunk        | Resume same version         | None                            |
| Bucket pending       | Submit valid KMS proof            | Re-request same handles     | None                            |
| Batch proof pending  | Reduce/prove current batch        | Retry same batch evidence   | None                            |
| Candidate pending    | Generate next batch               | Only after false proof      | Fresh randomness, same snapshot |
| Winner resolving     | Process next chunk                | Resume cursor               | None                            |
| Claimable            | Winner or relayer calls claim     | User recovery path          | No reroll                       |
| Adapter loss         | Pause prize commitments           | Loss/liquidity mode         | Principal policy disclosed      |
| Reserved             | Anyone after reservation TTL      | Expire slot and return bond | No draw weight                  |
| Pending activation   | Anyone after activation TTL       | Move to pending refund      | No retroactive eligibility      |
| Pending refund       | Anyone with fixed recipient       | Retry transfer/proof        | No principal or draw mutation   |
| Refund proof pending | Nobody may start another transfer | Resolve current proof       | No duplicate subtraction        |

Winner resolution processes exactly `ceil(snapshotParticipantCount / 8)` chunks for the registered
snapshot length (at most 16 at the 128-participant cap), padding only a final short chunk. It must
not stop after discovering an encrypted winner; otherwise the public cursor or transaction count
would reveal the winning chunk.

## Gate 1A blocker matrix

| Blocker                        | Status                                 | Evidence                                   | Frozen decision                              | Gate 1B obligation                 |
| ------------------------------ | -------------------------------------- | ------------------------------------------ | -------------------------------------------- | ---------------------------------- |
| Registry/address consistency   | CLOSED                                 | read-only Sepolia calls and corrected docs | canonical registry address above             | assert exact address               |
| Raw TWAB arithmetic            | CLOSED at design level                 | bigint model/oracle tests                  | raw area, no normalization                   | FHE arithmetic differential tests  |
| O(1) epoch sealing             | CLOSED at model level                  | bounded model tests                        | one pending prior epoch                      | storage/state implementation tests |
| Pool pull actual accounting    | CLOSED_GATE_1A_DESIGN                  | pinned 0.5.3 source                        | account actual returned amount               | end-to-end pull tests              |
| Token-facing entitlement width | CLOSED at design level                 | pinned FHE overloads                       | `euint64` payout values                      | compile/runtime ACL tests          |
| Claim authorization/oracle     | CLOSED at interface level              | signed fixed-recipient design              | participant authorization required           | EIP-712/replay/failure tests       |
| Participant lifecycle/cap      | CLOSED_GATE_1A_DESIGN                  | bond reservation + pending escrow model    | reserve before pull; threshold proof settles | cap/dust/pull integration tests    |
| Simulated yield recognition    | CLOSED_GATE_1A_DESIGN                  | deterministic bigint model                 | formula + liquidity cap; sponsor separate    | adapter integration/property tests |
| Wrapper incident trust         | CLOSED_GATE_1A_DESIGN                  | source/live metadata + incident policy     | pause/denylist/upgrade fail-safe             | external incident tests            |
| Snapshot chunk/liveness        | GATE_1B_IMPLEMENTATION_TEST_OBLIGATION | bounded design + probes                    | permissionless chunks of 8                   | measure and fuzz                   |
| Cross-contract ACL             | GATE_1B_IMPLEMENTATION_TEST_OBLIGATION | choreography specified                     | exact calls in architecture                  | end-to-end allow/deny tests        |
| Adapter solvency/loss          | GATE_1B_IMPLEMENTATION_TEST_OBLIGATION | simulated model                            | immutable boundary                           | loss/liquidity/property tests      |
| Claim transfer failure         | GATE_1B_IMPLEMENTATION_TEST_OBLIGATION | residual model                             | residual remains claimable                   | malformed/partial transfer tests   |
| Solidity pull/wiring           | GATE_1B_IMPLEMENTATION_TEST_OBLIGATION | interface frozen                           | actual-return pull                           | integration tests                  |

No `TRUE_UNRESOLVED_BLOCKER` remains. Gate 1B obligations verify the frozen behavior in Solidity;
they are fail-closed implementation gates, not unresolved architecture policy.

Category summary: `CLOSED_GATE_1A_DESIGN` covers the frozen token, registry, TWAB, draw, claim,
yield, wrapper-incident, ACL-intent, leakage, and numeric decisions;
`GATE_1B_IMPLEMENTATION_TEST_OBLIGATION` covers their Solidity/integration realization;
`TRUE_UNRESOLVED_BLOCKER` is empty: the former direct-invalid-callback refund concern is removed
from the canonical path. Unsupported direct token sends remain outside Veilpot accounting and are
covered as a Gate 1B integration limitation.

The reference model requires explicit caller, timestamp, claimed pool, registration version,
reservation nonce, deposit nonce, and actual transfer for every pull. Threshold and
refund-completion proof abstractions require their participant/version/reservation/attempt
identifiers and current time where applicable. Any inspection of model plaintext residuals is a
`REFERENCE_MODEL_ORACLE_ASSERTION`; production uses encrypted `refundComplete` plus
`FHE.checkSignatures`.

Refund-completion liveness is intentionally conditional on Zama public decryption: any account may
re-request the same immutable completion handle and submit its proof, but no timestamp may release a
slot without proof and no second token transfer may occur while proof is pending.
