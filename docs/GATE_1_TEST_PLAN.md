# Gate 1A — Production Test Plan

This plan is a test matrix, not an implementation claim. Architecture constants and interfaces are
frozen for Gate 1A; implementation and integration rows below are fail-closed Gate 1B obligations.

## Test environments

| Class        | Purpose                                  | Evidence allowed                            |
| ------------ | ---------------------------------------- | ------------------------------------------- |
| UNIT         | Pure accounting/state/ACL helpers        | Deterministic assertions                    |
| PROPERTY     | Conservation, monotonicity, ordering     | Counterexamples and invariant traces        |
| FUZZ         | Boundary values, malformed proofs, churn | Seed, input class, minimized failure        |
| MODEL        | Independent bigint/TWAB/draw oracle      | Differential result; never Solidity-derived |
| FHE MOCK     | Ciphertext/ACL/proof workflow            | Local execution only; not privacy proof     |
| SEPOLIA LIVE | Relayer/KMS/token/adapter integration    | Receipt, latency, sanitized denial evidence |

## Matrix

| Requirement                                     | Unit | Property | Fuzz | Model | FHE mock |           Sepolia live           |
| ----------------------------------------------- | :--: | :------: | :--: | :---: | :------: | :------------------------------: |
| Deposit/withdraw principal conservation         |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Confidential input sender/domain binding        |  ✓   |          |  ✓   |       |    ✓     |                ✓                 |
| ERC-7984 pull accounts token-returned actual    |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Token-side transient ACL (positive/negative)    |  ✓   |          |  ✓   |       |    ✓     |                ✓                 |
| Operator expiry/revocation semantics            |  ✓   |    ✓     |  ✓   |   ✓   |          |                ✓                 |
| Direct depositor caller/domain binding          |  ✓   |    ✓     |  ✓   |   ✓   |          |                ✓                 |
| Balance ACL isolation                           |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Raw TWAB update equation                        |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                                  |
| No retroactive/flash eligibility                |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                                  |
| Snapshot race and version immutability          |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Draw total/weight overflow bounds               |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                                  |
| Exact VeilDraw distribution                     |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |         Existing Gate 0          |
| Bucket oracle resistance                        |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| RNG has no caller entropy                       |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Proof-before-retry                              |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Duplicate stage idempotence                     |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Wrong/empty/stale/cross-draw proofs             |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Accepted target irreversibility                 |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Zero-total terminal path                        |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Serial/balanced ordered equivalence             |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     | ✓ with disclosed live limitation |
| Chunked prefix selection                        |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| No chunk winner leakage                         |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Principal/prize separation                      |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Adapter gain/loss accounting                    |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Adapter donation/rounding resistance            |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Adapter liquidity shortage                      |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Reentrancy/external-call failure                |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Claim replay/double claim                       |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Participant authorization and recipient binding |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Zero/partial payout preserves entitlement       |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| User-decrypt authorization                      |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Public/private leakage ledger                   |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Participant cap and dust DOS                    |  ✓   |    ✓     |  ✓   |       |    ✓     |                                  |
| Bond reservation / pending escrow               |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Activation timeout and late-proof rejection     |  ✓   |    ✓     |  ✓   |   ✓   |          |                ✓                 |
| Refund residual/completion-proof ordering       |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                ✓                 |
| Threshold proof reservation/version binding     |  ✓   |    ✓     |  ✓   |   ✓   |          |                ✓                 |
| Refund proof attempt/version binding            |  ✓   |    ✓     |  ✓   |   ✓   |          |                ✓                 |
| Checkpoint/storage boundedness                  |  ✓   |    ✓     |  ✓   |   ✓   |    ✓     |                                  |
| Relayer/KMS interruption recovery               |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Permissionless stage progression                |  ✓   |    ✓     |  ✓   |       |    ✓     |                ✓                 |
| Source/runtime/dependency parity                |      |          |      |       |          |                ✓                 |

## Required property suites

### Accounting

- Generate arbitrary valid deposit/withdraw sequences and assert encrypted-model principal
  conservation.
- Assert no withdrawal exceeds the caller's balance, including repeated/replayed requests.
- Assert reserve payout leaves `P` and principal backing unchanged.
- Generate adapter losses and assert prize commitments stop before solvency violation.

### TWAB and snapshots

- Compare checkpoint accumulator against an independent integer integral model.
- Test same-block deposit/withdraw/redeposit, timestamp boundaries, maximum duration, and snapshot
  races.
- Prove that a post-snapshot action changes only the next version.
- Compare bounded lazy epoch sealing with the naive integral under arbitrary snapshot order, exact
  cutoff, inactive accounts, and multiple completed draws. Assert no historical catch-up loop and at
  most one pending prior epoch.

### VeilDraw

- Reuse Gate 0 exhaustive domains and extend them to production chunk sizes.
- Differentially compare serial and balanced reductions without exposing candidate plaintext in live
  evidence.
- Attempt caller-supplied seed/candidate/bound/threshold, proof replay, cross-draw proof, and reroll
  after success.

### Confidential claims

- Fuzz EIP-712 participant authorization, recipient substitution, claim replay, lost-claim recovery,
  unauthorized user decrypt, and relayer `claimFor` ordering.
- Assert no UI-facing read path triggers wallet signatures or decryption.
- Exercise zero/partial confidential transfers: residual entitlement remains claimable until a
  proof-backed full-transfer transition.

### Adapters and tokens

- Test non-standard token return values, fee-on-transfer rejection, rebasing rejection, adapter
  reentrancy, donation, stale valuation, rounding, and liquidity failure.
- Verify simulated yield is labeled `SIMULATED_YIELD_FOR_SEPOLIA_DEMO` and sponsor funding is
  tracked separately in every public surface.

### Gate 1A design-only FHE probes

Files marked `GATE_1_DESIGN_PROBE_ONLY`, `NOT_PRODUCTION`, and `MUST_NOT_DEPLOY` measure locally:

- `euint64 → euint128` widening;
- corrected pool-pull token-side ACL positive/negative paths;
- pending-activation true/false/deadline/timeout proof ordering;
- refund residual attempts, completion proofs, replay, and fixed-recipient settlement;
- raw TWAB multiply/add and one O(1) seal;
- one eight-entry snapshot/prefix chunk;
- `ebool + euint64` entitlement selection;
- `euint64` residual subtraction/equality;
- token-side ACL negative control (missing pool grant);
- pool-to-reserve transient-ACL handoff.

`packages/reference-model/src/claim-residual.ts` and its tests model authorization nonce
consumption, zero/partial/full actual transfers, residual claims, replay, wrong
participant/recipient, expiry, and overflow rejection.

Each result records local global HCU, local sequential HCU, and run-specific local EVM gas. These
are component estimates only and never Sepolia evidence.

## Gate 1B implementation obligations

These rows are deferred implementation tests, not unresolved architecture policy: ERC-7984 pool-pull
wiring and actual-received accounting; exact ACL allow/deny behavior; complete-transaction HCU/gas
at chunk size 8; EIP-712 signature and nonce consumption; reentrancy and malicious-token behavior;
encrypted arithmetic-bound assertions; simulated-adapter loss/liquidity semantics; wrapper
pause/denylist/upgrade incidents; and live Sepolia integration. Any failure or HCU overrun must
return to architecture review and lower the approved chunk/cap before deployment.

## Live test gates before production

1. Verify exact pinned confidential-token API and deployed Sepolia dependencies.
2. Run representative deposit/withdraw/TWAB/snapshot flows with two independent wallets.
3. Verify KMS public/user decryption latency and denial paths without recording plaintext.
4. Exercise chunked winner resolution at the selected participant cap.
5. Exercise adapter loss and no-liquidity behavior.
6. Compare deployed runtime/source/compiler inputs and freeze a new manifest.

The current design-only model and numeric tests run locally without production contracts. HCU probes
for cross-contract ACL, pull widening, entitlement selection, TWAB multiplication, and the
eight-entry winner chunk are deferred until the exact production interfaces exist; no production HCU
claim is made here.

Any failed Gate 1B obligation blocks implementation release, but does not reopen a design decision
already frozen in Gate 1A unless the measured result contradicts that design.

The former direct malformed/expired callback-refund concern is closed by the canonical pull
boundary. Gate 1B must test invalid direct token sends as unsupported/non-accounting and verify the
pinned token's operator, actual-return, and residual-refund behavior without introducing orphan
escrow.
