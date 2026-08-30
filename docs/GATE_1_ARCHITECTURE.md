# Gate 1A — Production Architecture and Interface Freeze

Status: Gate 1A architecture freeze candidate. This document freezes design constraints and
interfaces only; it does not authorize production Solidity, deployments, token integrations, or
frontend work until operator review.

## Gate 0 anchor

The immutable Gate 0 evidence commit is:

`88bf981b3b071e96661b4d98241f7b4b2dd94caf`

Gate 0 proved the VeilDraw rejection-sampling primitive, not a production pool. `VeilDrawProbe.sol`
is measurement/test code and must not be copied into production without a separate review.

## Repository inventory and reuse boundary

| Area                                             | Exists                                 | Proven by Gate 0                                                    | Production status                                           |
| ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/contracts/contracts/VeilDrawProbe.sol` | Single probe contract                  | Local mock FHE plus live Sepolia draw/retry evidence                | Test-only; semantic reference, not an application contract  |
| `packages/contracts/test/VeilDrawProbe.test.ts`  | Mock-FHE and adversarial tests         | Bucket, RNG, reductions, ACL, proof/state, prefix behavior          | Reuse test cases and invariants, not implementation blindly |
| `packages/reference-model`                       | Independent bigint TypeScript model    | Exhaustive distribution and reduction equivalence in tested domains | Reuse as differential oracle                                |
| `packages/contracts/scripts`                     | Live runner, evidence and lock tooling | Sepolia lifecycle and evidence provenance                           | Operational tooling; not protocol runtime                   |
| `evidence/gate0`                                 | Local and finalized Sepolia evidence   | Immutable Gate 0 claims                                             | Frozen; never rewrite                                       |
| `apps/web`                                       | README placeholder only                | Nothing                                                             | No frontend exists                                          |
| `packages/protocol-sdk`                          | README placeholder only                | Nothing                                                             | Reserved for later typed integration                        |

The probe's public `state`, fixed single-draw storage, and benchmark-only prefix interface are not
acceptable production boundaries. Production code must preserve the proven semantics while adding
principal accounting, snapshots, claims, and adapter isolation.

## Verified Zama facts (source-backed, 2026-08-30)

The repository's frozen development stack is `@fhevm/solidity` 0.11.1, `@fhevm/hardhat-plugin`
0.4.2, `@fhevm/mock-utils` 0.4.2, and `@zama-fhe/relayer-sdk` 0.4.1. The installed `FHE.sol` source
exposes `euint8` through `euint256`, `ebool`, `eaddress`, `fromExternal`, `allow`, `allowThis`,
`allowTransient`, `makePubliclyDecryptable`, `checkSignatures`, and bounded `randEuint128(uint128)`;
the bounded upper bound is required to be a power of two. `fromExternal` verifies a non-empty input
proof and otherwise requires an already-authorized handle. `checkSignatures` verifies KMS signatures
bound to an ordered handle list and ABI-encoded clear values.

Primary sources reviewed:

- FHEVM library/API source:
  https://github.com/zama-ai/fhevm/blob/main/docs/protocol/architecture/library.md
- FHEVM protocol architecture (Gateway, coprocessor, KMS, relayer):
  https://github.com/zama-ai/fhevm/blob/main/docs/protocol/architecture/overview.md
- Official Hardhat template: https://github.com/zama-ai/fhevm-hardhat-template
- OpenZeppelin Confidential Contracts:
  https://github.com/OpenZeppelin/openzeppelin-confidential-contracts
- IERC-7984 confidential token interface:
  https://github.com/OpenZeppelin/openzeppelin-confidential-contracts/blob/master/contracts/interfaces/IERC7984.sol
- FHEVM Solidity implementation used locally:
  `node_modules/.pnpm/@fhevm+solidity@0.11.1/.../lib/FHE.sol`

The public repositories currently contain newer releases than this frozen stack. That is a
compatibility warning, not permission to migrate. Before implementation, every selected API must be
rechecked against the exact pinned package and a new compatibility record. The official testnet
address list identifies the cUSDT mock as a publicly mintable test asset, not production USDT; this
distinction is mandatory in every product surface.
([Sepolia address registry](https://github.com/zama-ai/protocol-apps/blob/main/docs/addresses/testnet/sepolia.md))

| Operation                     | Architecture interpretation                                                               | Required guard                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `FHE.fromExternal`            | Verifies user-supplied encrypted input/proof and binds it to the calling contract context | Input proof, sender, domain and replay tests                 |
| `FHE.allowThis`               | Persistent contract ACL for a handle                                                      | Apply to every handle retained in storage                    |
| `FHE.allow`                   | Persistent ACL for a specified account                                                    | Grant only to the owner/claimant when required               |
| `FHE.allowTransient`          | Current-transaction ACL for the pool/reserve boundary                                     | Prefer over persistent grants for one-call handoff flows     |
| `FHE.makePubliclyDecryptable` | Explicit public-decryption flag                                                           | Use only for fixed bucket/status booleans selected by policy |
| `FHE.checkSignatures`         | On-chain KMS proof verification; handle order and clear-value order are binding           | Never accept a clear value without this check                |
| `FHE.randEuint128(B)`         | Encrypted random value in `[0,B)` for power-of-two `B`                                    | Derive/validate `B` in protocol; caller supplies no entropy  |

The official FHEVM architecture describes encrypted handles as references to coprocessor state and
KMS threshold decryption; local mock plaintext tracking is not a privacy proof. OpenZeppelin's
confidential contracts repository labels the library experimental and warns that confidential
operations may fail without ordinary ERC-20-style reverts. `IERC7984` exposes encrypted balances and
confidential transfers; its interface documentation recommends six decimals.

### Pinned ERC-7984 pull findings

The exact installed 0.5.3 sources were inspected, rather than current master:

- `node_modules/.pnpm/@openzeppelin+confidential-contracts@0.5.3_*/node_modules/@openzeppelin/confidential-contracts/interfaces/IERC7984.sol`,
  lines 45–89: `isOperator`, `setOperator`, and both `confidentialTransferFrom` overloads; the
  external-input overload returns the actual encrypted amount transferred.
- `.../token/ERC7984/ERC7984.sol`, lines 99–145: operator authorization is
  `holder == spender || block.timestamp <= until`; both pull overloads require operator
  authorization, and the implementation grants the returned amount transiently to `msg.sender`.
- The same file, lines 290–320: `_update` uses `FHESafeMath.tryDecrease`; an over-balance request
  produces an encrypted zero `transferred` value rather than crediting the requested amount, then
  updates balances and ACLs with that actual value.
- The same file, lines 260–284: `confidentialTransferAndCall` performs a callback and only attempts
  a best-effort refund, which is why callbacks are excluded from the canonical Veilpot deposit path.

The pinned FHE source
`node_modules/.pnpm/@fhevm+solidity@0.11.1_*/node_modules/@fhevm/solidity/lib/FHE.sol` provides
`fromExternal(externalEuint64,bytes)`, `allowTransient(euint64,address)`, `allowThis(euint64)`,
`asEuint128(euint64)`, bounded `div(euint128,uint128)`, and `asEuint64(euint128)` (lines 6867,
8148–8259, 8598, 8843–9168). The latter cast is permitted only for the independently proven 39-bit
synthetic-yield result; it is not used for token-facing principal or claim values.

## Product contract boundaries

### `VeilpotPool`

The pool owns user principal obligations and encrypted per-user accounting. It accepts deposits,
requests withdrawals, maintains public participant membership and encrypted balances/TWAB, freezes
draw snapshots, and coordinates the draw and reserve. It never pays prizes from principal backing.

### `VeilpotPrizeReserve`

The reserve owns only explicitly non-principal assets: realized adapter yield and sponsor funding.
It exposes a narrow payout authorization that is bound to a pool draw, encrypted entitlement, and
one-time claim state. It cannot transfer pool principal and has no winner-selection authority.

### `IYieldAdapter`

The adapter boundary reports deposited strategy assets, redeemable liquidity, realized gain/loss,
and performs bounded deposits/redemptions. The v1 recommendation is one immutable adapter address
per pool. Adapter replacement is out of scope until a timelocked migration protocol proves that
principal solvency is preserved.

### Simulated Sepolia adapter

Any demo adapter is named and labeled `SIMULATED_YIELD_FOR_SEPOLIA_DEMO`. It may mint or account
synthetic yield only in a demo environment and must never be described as production yield or used
to support a production solvency claim.

### VeilDraw integration choice

Recommendation: embed the reviewed VeilDraw state machine inside `VeilpotPool` as a distinct
internal module/library boundary, with a separate `VeilpotPrizeReserve`. This removes
pool-to-separate-coordinator encrypted-handle edges while preserving a separately reviewed Gate 0
semantic module. The pool stores the immutable snapshot, bucket, candidates, reductions, retry
state, and accepted target; the reserve never receives winner-selection authority. Cross-contract
encrypted transfer is limited to the entitlement/payout edge.

## Principal/prize solvency model

Define:

- `P`: encrypted aggregate outstanding principal obligations;
- `A`: clear strategy assets attributable to principal, with adapter-reported redeemable value;
- `Y`: realized, available non-principal yield after losses and fees;
- `R`: reserve assets committed to prizes;
- `S`: explicit sponsor funding.

The economic invariant is `A + immediately redeemable idle principal >= P` at every state in which
withdrawals are offered. Prize funding may increase `R` only from realized `Y` or explicit `S`.
`tokenBalance - P` is not evidence of yield: donations, rebasing, fee behavior, and adapter debt
must be reconciled explicitly.

If an adapter loss makes `A < P`, the protocol must stop new prize commitments and enter a disclosed
loss/liquidity mode; it must not promise unconditional immediate withdrawal. A v1 adapter that can
lose principal is therefore a Gate 1 blocker unless the product promise is changed. Fee-on-transfer,
rebasing, and malicious-token behavior are unsupported until a dedicated adapter proves exact
received-amount accounting. All external token calls use checks-effects-interactions and a
reentrancy guard.

## Exact Sepolia competition token profile

Read-only Sepolia verification on 2026-08-30 confirmed chain ID `11155111`, code at the published
wrappers registry `0x2f0750Bbb0A246059d80e94c454586a7F27a128e`, code at cUSDTMock
`0x4E7B06D78965594eB5EF5414c357ca21E1554491`, and code at its underlying mock
`0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`. Read-only calls returned name
`Confidential USDT (Mock)`, symbol `cUSDTMock`, decimals `6`, ERC-7984 support `true`, the published
underlying address, registry validity `true`, and `paused() = false`. The wrapper owner is
`0x08e8a84c3c8c7cba165B1adcf67Ae4639eF84f52`; its EIP-1967 implementation slot is nonzero. The
deployer nonce stayed `487 → 487`.

Freeze the competition label as `OFFICIAL_ZAMA_TESTNET_MOCK_ASSET`,
`PUBLICLY_MINTABLE_TEST_UNDERLYING`, `NOT_PRODUCTION_USDT`. This is a testnet integration profile,
not a production-token endorsement. The wrapper, registry, owner, pause/denylist controls, and
upgrade path are external trust dependencies.

## Confidential deposit model

The canonical entry point is pool-initiated ERC-7984 pull:

`user → cUSDTMock.setOperator(pool, finiteUntil)`
`→ pool.deposit(externalEuint64, inputProof, version, pool, depositor, depositNonce, reservationNonce)`
`→ pool validates reservation/domain/nonce and calls FHE.fromExternal`
`→ pool FHE.allowTransient(requested, token)`
`→ token.confidentialTransferFrom(depositor, pool, requested)`
`→ pool receives actualTransferred euint64 and stores it with FHE.allowThis`.

The token's external-input verification is distinct from Veilpot application replay/state binding.
The pool binds version, pool address, depositor, deposit nonce, and reservation nonce before token
movement. Only actualTransferred controls pending accounting and the encrypted threshold predicate;
there is no IERC7984Receiver deposit path.

Pending threshold failure uses an explicit pool-controlled confidential transfer back to the
participant, subtracting the token-reported actual refund from encrypted residual state. Direct
token sends to the pool are unsupported and never affect Veilpot accounting.

`confidentialTransfer(pool, ...)` and `confidentialTransferAndCall(pool, ...)` issued directly to
the token are `UNSUPPORTED_DIRECT_TOKEN_SEND`: they do not register, credit principal, update TWAB,
create pending state, become yield/sponsor funding, or affect draw weights. Such sends may be
unrecoverable under the external token's semantics; the frontend must never use them and Reviewer
Mode must display this integration limitation. Veilpot never reconciles raw token-balance surplus
and exposes no arbitrary admin rescue path.

If an ordinary ERC-20 must be supported, the transfer amount is publicly visible and only the
post-transfer accounting can be encrypted. That is a different privacy product and must not be
advertised as end-to-end confidential deposits. The v1 implementation should choose one token
standard, one decimal precision, and one maximum deposit before coding; supporting both standards in
one path is not approved.

Amounts are integer base units. The design uses `euint64` for per-user token amounts and `euint128`
for aggregates; the conservative six-decimal envelope and its independent bigint proof are recorded
below. Production code must still machine-check every intermediate operation.

### Application replay binding

`depositData` is versioned and contains `(version, pool, depositor, depositNonce)`. The pool
requires `pool == address(this)`, `depositor == from`, and `version == SUPPORTED_DEPOSIT_VERSION`;
it accepts only `depositNonce == nextDepositNonce[from]` and consumes that nonce once after the
validated pull succeeds. No draw ID is included because deposits are not draw-specific. This
application binding is separate from the FHEVM external-input proof.

The design model makes every security-critical field mandatory on a deposit attempt: `depositor`,
`caller`, `now`, claimed pool domain, claimed registration version, reservation nonce, deposit
nonce, and actual transferred amount. The expected pool domain and supported version are immutable
model configuration, never call arguments. Threshold settlement likewise requires the participant,
registration version, reservation nonce, proof result, and current time; refund completion requires
participant, registration version, reservation nonce, refund-attempt nonce, and proof result. These
are `REFERENCE_MODEL_ORACLE_ASSERTION`s of production bindings, not plaintext FHE branches.

## Pinned encrypted type choreography

ERC-7984 values are `externalEuint64`/`euint64`. The pinned FHE library provides
`asEuint128(euint64)` and the explicitly bounded `asEuint64(euint128)` cast used only for synthetic
yield. Freeze:

`externalEuint64 → euint64 actualTransferred → euint128 aggregate/TWAB/draw values`; token-facing
entitlements and the bounded synthetic-yield result remain `euint64` through payout.

Per-user principal remains `euint64` under the selected cap. Aggregate principal, raw TWAB, draw
weights, total, candidates, target, and prefix use `euint128`; prize amount, claimable, remaining
claim, and actual transferred values remain `euint64`. This widening is safe for the source domain,
but still requires integration tests against the exact token. The pinned FHE library exposes
`FHE.select(ebool, euint64, euint64)`, so entitlement selection and residual subtraction remain in
the token-facing width without encrypted narrowing.

## Withdrawal model

Withdrawal is an explicit user action. The user submits an encrypted requested amount and proof; the
pool checks `requested <= encryptedBalance`, subtracts it, reduces future TWAB, and only then
performs the external token transfer. A confidential ERC-7984 transfer can keep the amount encrypted
on-chain. A conventional ERC-20 transfer necessarily reveals the clear amount in calldata/events or
recipient balance changes; the privacy ledger must state that leakage.

Partial and full withdrawals share the same nonce/replay and reentrancy protections. Failed external
transfers revert the whole state transition. A withdrawal does not alter an already-frozen draw
snapshot. The pool must not grant a private balance reveal merely to render a UI component.

## TWAB model

Use a bounded encrypted accumulator rather than iterating historical checkpoints. For user `u`, keep
encrypted balance `b_u` and accumulator `I_u` with public checkpoint time `t_u`:

`I_u(new) = I_u(old) + b_u * (t_new - t_u)`.

On deposit/withdraw, checkpoint first using the old balance, then update the encrypted balance and
set `t_u = block.timestamp`. At draw start, checkpoint each changed account before freezing the
draw's participant set; the draw weight is the raw interval integral, with no division or rounding:
`W_u = ∑ balance_old × elapsed_seconds`. For a common public duration `D`, dividing every weight by
`D` would cancel in `W_i / ∑W_j`, so normalization is unnecessary and is forbidden. Timestamps and
draw boundaries are public metadata; balances, accumulators and weights remain encrypted.

The equation is the mathematical basis; the lazy epoch-sealing implementation is still design-only.
The frozen envelope chooses maximum window duration `D`, maximum balance `B_u`, and maximum
participant count `N` such that `B_u * D * N` plus every prefix remains below the selected encrypted
type bound. A flash deposit gets zero historical area and cannot acquire retroactive weight. A flash
withdrawal cannot erase already accrued area. Snapshot creation must be resumable in bounded chunks;
no unbounded checkpoint loop is permitted.

## TWAB epoch-sealing correction

The simple accumulator above is implemented only through a bounded one-pending-epoch model. Freeze
conceptual state as `(activeEpoch, pendingSnapshotEpoch)` plus per-account
`(balance, activeAccumulator, lastCheckpoint, activeEpoch, pendingSealedWeight, pendingSealedEpoch, pendingSealed)`.
Closing an epoch opens exactly one `Snapshotting` epoch and the next accruing epoch. A mutation or
snapshot seals the pending prior epoch once using the old balance, resets that account's accumulator
at the new epoch start, then applies any mutation only to the new epoch. A second epoch cannot close
until the registered snapshot set is complete; no historical catch-up loop exists. Snapshot chunks
may run in arbitrary order and each account operation is O(1) in historical draw count. The
independent bigint model and tests in `packages/reference-model/src/twab-design.ts` compare this
bounded algorithm with a naive time-integral oracle.

## Draw snapshot and immutability

Each draw has a monotonically increasing `drawId`, a public window `[start,end]`, a snapshot
version, an immutable participant registry root/list, encrypted weights, and encrypted total. Once
snapshot finalization begins, no deposit or withdrawal may modify those handles. Later user activity
is stored under the next snapshot version. The embedded draw module rejects retries with any other
total, bucket, draw ID, or snapshot version. A failed candidate batch can unlock only a fresh batch
for the same frozen snapshot after valid false proof.

## VeilDraw semantic-parity map

| Gate 0 behavior                            | Production behavior                                        | Relation and obligation                                                        |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Encrypted `T` from verified external input | Pool’s embedded draw module supplies snapshot total handle | Adapted boundary; draw module requires pool-owned handle and snapshot ID       |
| Fixed encrypted bucket evidence            | Same fixed comparisons and public bucket/status predicates | Identical mathematics; no caller threshold                                     |
| `randEuint128(B)`                          | Embedded draw module calls the same bounded primitive      | Identical entropy source and power-of-two bound                                |
| Serial first-valid reduction               | Coordinator retains serial reference path                  | Identical order; production may use balanced tree only with differential proof |
| Ordered balanced reduction                 | Bounded internal tree in pool                              | Adapted for cost; must preserve original order                                 |
| Public batch-success boolean               | Only success/failure predicate is public                   | Identical leakage policy                                                       |
| Valid proof before retry                   | Retry transition requires verified false proof             | Identical anti-grinding rule                                                   |
| Accepted target is irreversible            | Snapshot target becomes immutable entitlement              | Stronger: bind to draw and reserve claim state                                 |
| `T=0` terminal path                        | No-eligible-weight draw terminal; no RNG                   | Identical liveness decision                                                    |
| Prefix interval winner predicate           | Chunked encrypted prefix scan                              | Adapted for scale; no chunk-level winner leakage                               |

Any adaptation creates a new unit/property/FHE/live test obligation. No production contract may
silently reuse the probe's fixed `MAX_TOTAL` or participant array.

## Frozen selection mathematics

For a snapshot with encrypted weights `W_i`, define `T = Σ_i W_i`. The protocol discloses only a
public power-of-two bucket `B` satisfying `B/2 < T ≤ B`. Each candidate is sampled by the bounded
FHE RNG as `X ~ Uniform[0,B)`, and the candidate is valid exactly when `X < T`. Conditioning on
validity gives `X | (X < T) ~ Uniform[0,T)`, so the first-valid prefix interval awards participant
`i` with probability `W_i/T` (for `T > 0`). A fixed ordered batch preserves this conditional
distribution: serial and order-preserving balanced reductions select the same first-valid position;
an all-invalid batch reveals only the approved failure boolean. A retry is authorized only after a
valid KMS proof that the complete prior batch was all-invalid, and retries use the same frozen
snapshot/total/bucket with fresh protocol-generated randomness. `T = 0` is terminal and generates no
candidate. These statements are mathematical obligations to re-prove against production handles, not
permission to copy the probe implementation.

## Participant lifecycle and chunking

Participant addresses are public registry metadata; balances, TWABs, weights, and target remain
encrypted. V1 selects public bond reservation (strategy D): `reserveParticipantSlot` runs before any
confidential transfer, requires `REGISTRATION_BOND_WEI = 1_000_000_000_000_000` wei
(`SEPOLIA_DEMO_REGISTRATION_BOND`, 0.001 native ETH; `NOT_PRODUCTION_SYBIL_ECONOMICS`), and
atomically reserves one of 128 slots. The pool pull then records the token-reported actual `euint64`
in pending escrow; an encrypted `actualTransferred >= 1 token` predicate is the only public
threshold disclosure. The successful pull records `activationStartedAt` and
`activationDeadline = activationStartedAt + REGISTRATION_ACTIVATION_PROOF_TTL = 86,400` seconds.
Only a valid threshold proof at or before that deadline activates the address and moves pending
escrow to principal. A false proof or permissionless timeout after the deadline moves the
reservation to `PENDING_REFUND`; the bond is returned at that transition while the encrypted refund
obligation remains bounded. Under-threshold or failed attempts never consume an active slot. A
reservation TTL of `REGISTRATION_RESERVATION_TTL = 86,400` seconds applies only while `RESERVED`;
expiry returns the bond and frees the slot. Registration is unique; active addresses and participant
count are public, exact amounts remain encrypted. At zero balance, an explicit user-authorized
public zero-balance proof may tombstone the slot. Tombstones are reusable only by a later registry
version/draw; historical snapshots retain their original address/index. During an active snapshot,
additions/removals affect only the next draw. A pool pull validates the reservation before token
movement; it never depends on receiver-hook rejection or token best-effort refunds. An absent,
malformed, wrong-owner, wrong-nonce, or expired reservation is rejected before the token call and
creates no principal, pending activation, slot, or orphaned per-sender storage.

The complete registration graph is `FREE → RESERVED → PENDING_ACTIVATION → ACTIVE` on a timely true
threshold proof, or
`PENDING_ACTIVATION → PENDING_REFUND → REFUND_ATTEMPT_PENDING_PROOF → PENDING_REFUND/FREE` on
false/timeout proof and residual refund settlement. An unused `RESERVED` slot may become `FREE` only
after the 86,400-second TTL; `ACTIVE → TOMBSTONED` requires the user's public zero-balance proof.
The native-ETH bond is held while `RESERVED` and pending activation, then fully returned on
activation, expiry, or entry to `PENDING_REFUND`; it is never principal, yield, or prize funding. A
second refund transfer is forbidden while a completion proof is pending.

Refund completion never branches directly on encrypted zero. Each attempt computes
`newRemaining = remainingRefund - actualRefunded`, derives encrypted
`refundComplete = (newRemaining == 0)`, and makes only that boolean eligible for KMS/public proof. A
bound proof of `refundComplete` (participant, reservation nonce, attempt nonce, and handle) moves
the slot to `FREE` only when true; false returns to `PENDING_REFUND`. The residual and completion
handle are retained until that proof settles, so zero/partial transfers cannot burn the obligation.

Winner resolution uses `PREFIX_CHUNK_SIZE = 8`; a draw stores an encrypted running prefix and public
chunk cursor. Snapshot sealing uses `SNAPSHOT_CHUNK_SIZE = 8`, selected from the local design probe
and subject to a fail-closed Gate 1B complete-transaction HCU check. Each permissionless call
processes one bounded chunk, preserves encrypted winner predicates, and cannot reveal the winning
chunk. The required call count is `ceil(snapshotParticipantCount / PREFIX_CHUNK_SIZE)`; only the
final short chunk is padded. The final call proves exactly one positive interval or the no-eligible
terminal.

### Epoch clock semantics

V1 chooses clock A: epoch `N+1` starts immediately at the public cutoff of `N` while snapshotting
`N` proceeds. Deposits and withdrawals remain possible and accrue only to `N+1`. `N+1` cannot close
until every registered account has sealed the pending `N` weight and the snapshot is
`SnapshotReady`. This gives exact cutoff semantics without locking principal or requiring historical
catch-up.

## Permissionless draw state machine

`Open → Snapshotting → SnapshotReady → BucketPending → BucketReady → CandidatePending → BatchProofPending →`

- `CandidatePending` after a proven false batch;
- `TargetAccepted` after a proven true batch;
- `WinnerResolving` for bounded prefix chunks;
- `PrizeAssigned → Claimable → Final`;
- `NoEligibleWeight` or `UnsupportedTotal` terminal states.

Every transition is idempotent or rejects duplicate calls. Any account may advance a safe stage. A
stage timeout may permit a retry of the same proof request, never a new random batch or changed
snapshot. Principal withdrawals remain available subject to the pool's explicit liquidity policy; a
relayer outage cannot consume principal or alter fairness.

## Winner privacy decision

Select private fixed-recipient entitlement (strategy B). Participant addresses are already public
registry metadata. For participant `i`, compute encrypted `winnerPredicate_i` and store
`claimable[drawId][i] = FHE.select(winnerPredicate_i, encryptedPrizeAmount, encryptedZero)`, with
all token-facing values as `euint64`. A relayer may submit
`claimFor(drawId, participant, authorization)`, but authorization is an EIP-712-style signature from
the immutable participant address binding chain ID, reserve, draw ID, participant, claim nonce, and
expiry. The relayer cannot supply a different recipient or probe arbitrary indices without
participant authorization. A public winner address is not emitted. Commitment/nullifier claims
remain a research alternative and are not frozen for v1.

## Prize amount and claims

Prize amount should be encrypted while assigned and exposed only to the entitled claimant. The
reserve receives an encrypted entitlement with `allowThis` and narrowly grants claimant access; it
must never make all reserve accounting public. A later ordinary ERC-20 transfer reveals the paid
amount, so the privacy promise is “private until settlement,” not invisible settlement.

`claimFor(drawId, participant, authorization)` is permissionless to relay but
participant-authorized. The recipient is read from the immutable public registry. The reserve stores
`remaining` as `euint64`, transfers only to that participant, and receives the actual `euint64`
transferred. A public `fullTransfer` proof is not required if an encrypted residual can remain
claimable; if a terminal state is retained, that boolean is publicly proved only after valid
authorization. Zero/partial transfers leave residual entitlement. Replay, double claim, nonwinner
claims, changed participant indices, and wrong recipients reject. Frontend rendering never requests
a private signature; authorization is an explicit user claim action.

The claim state machine is `Claimable → TransferAttempted → Claimable` on false/partial result and
`TransferAttempted → Claimed` only after either encrypted residual exhaustion or a valid public
proof of `fullTransfer`, with the participant authorization nonce consumed exactly once. This
follows the pinned ERC-7984 behavior: insufficient balance can produce an encrypted zero transfer
rather than a normal ERC-20 revert; the canonical pool pull never relies on callback refunds.

## Token and adapter decisions

For the Sepolia competition build, freeze cUSDTMock at `0x4E7B06D78965594eB5EF5414c357ca21E1554491`,
with registry `0x2f0750Bbb0A246059d80e94c454586a7F27a128e` and underlying mock
`0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`. It is labeled `OFFICIAL_ZAMA_TESTNET_MOCK_ASSET`,
`PUBLICLY_MINTABLE_TEST_UNDERLYING`, `NOT_PRODUCTION_USDT`. The pool-initiated
`confidentialTransferFrom` actual-received deposit flow is the only approved path. Ordinary ERC-20
wrapping or a dual token path is not approved.

The yield adapter is immutable in v1, non-upgradeable, and exposes only bounded deposit, redeemable
assets, and realized gain/loss. The Sepolia competition profile uses a deterministic
`SIMULATED_YIELD_FOR_SEPOLIA_DEMO` formula, never real DeFi yield. Once draw `d` reaches
`SnapshotReady`, recognize exactly once from its closed encrypted raw total TWAB:
`grossSyntheticYield_d = floor(RAW_TOTAL_TWAB_d × 1 / (10,000 × 86,400))`. Recognition is keyed by
`yieldRecognized[d]`; there is no current-principal-times-elapsed approximation. The realized amount
is `min(grossSyntheticYield_d, fundedYieldLiquidityAvailable)`, where funded liquidity is test
cUSDTMock committed solely to synthetic yield. Only actual ERC-7984 `actualTransferred` reduces
`fundedYieldLiquidityAvailable` and increases reserve funding; an under-transfer leaves unswept
recognized yield available. Sponsor deposits are tracked separately in `sponsorReserve` and never
relabeled as yield. The adapter rejects donation-based fake yield, rounding overflow, over-sweep,
and insufficient-liquidity recognition. No adapter may choose a winner or access encrypted balances
except through the specified ACL computation.

Its conceptual accounting is `fundedYieldLiquidity`, `rawTotalTwab`, `grossSyntheticYield`,
`realizedSimulatedYield`, `yieldSwept`, and `sponsorReserve`, with
`yieldSwept ≤ realizedSimulatedYield ≤ grossSyntheticYield` and one recognition per draw. The raw
TWAB handle is an ACL-authorized encrypted `euint128`; the fixed public rate/time scalar is applied
homomorphically. The recognized payout is computed in a token-safe `euint64` choreography using the
pinned `FHE.asEuint64(euint128)` cast only after the proven global bound
`MAX_GROSS_SYNTHETIC_YIELD = 384,000,000,000` base units (39 bits) below `2^64`. No principal
plaintext is revealed.

### External wrapper incident semantics

If the cUSDTMock wrapper pauses, new deposits and claims fail closed or remain pending; withdrawals
may be delayed by the external token, but Veilpot obligations are not rewritten or confiscated.
Reviewer Mode exposes `EXTERNAL_TOKEN_PAUSED`, and user/permissionless retries are allowed after
resume. If a denylist blocks one account, its encrypted principal or entitlement remains owed and
cannot be redirected; other accounts and draws continue where possible. The pinned token address,
ERC-7984 interface, decimals, underlying, and registry are immutable pool configuration. An
incompatible external implementation/registry upgrade stops new deposits and automatic migration;
withdrawal/claim continues only while the pinned interface remains usable. A new reviewed protocol
version is required for migration. These are external wrapper/registry trust incidents, not Veilpot
admin powers.

## Exact ACL choreography

| Edge                     | Handle                           | Timing                            | ACL                                                                                                                                                                                    | Persistence/publicity                             |
| ------------------------ | -------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Pool → token pull        | requested/actual `euint64`       | Same transaction                  | Pool calls `FHE.allowTransient(requested, token)`; token verifies `FHE.isAllowed(requested, address(this))`, grants returned actual transiently; pool calls `allowThis` before storage | Persistent actual in pool; never public           |
| Pool embedded draw       | snapshot total/weight `euint128` | Internal pool storage             | `FHE.allowThis` on every retained replacement                                                                                                                                          | Pool draw lifetime; never public                  |
| Draw internal candidates | candidate/validity/target        | Across draw stages                | `allowThis` on every stored replacement                                                                                                                                                | Embedded pool draw lifetime; never public         |
| Pool → simulated adapter | closed-draw raw TWAB `euint128`  | Recognition after `SnapshotReady` | `FHE.allow` to immutable adapter for this draw; adapter calls `allowThis` on retained result                                                                                           | Persistent only through recognition; never public |
| Draw → reserve           | winner predicate/entitlement     | Assignment transaction            | `FHE.allowTransient` for handoff; reserve calls `FHE.allowThis` before storing entitlement                                                                                             | Reserve/claim lifetime; never public              |
| Reserve → token payout   | remaining entitlement `euint64`  | Claim transaction                 | Reserve calls `FHE.allowTransient` to token for this call; no persistent token grant                                                                                                   | Remaining entitlement persists; no plaintext      |

No cross-contract handle is granted “just in case.” Every persistent grant must have an allowed and
denied test. Application nonces and draw IDs provide replay/state binding separately from FHEVM
input proof binding.

## Claim transfer-failure state machine

The pinned ERC-7984 implementation may return an encrypted zero/partial `transferred` value instead
of reverting on insufficient balance. The reserve therefore never clears an entitlement before
observing the actual returned amount. It stores `remaining = remaining - actualTransferred`, derives
`fullTransfer = (actualTransferred == requested)`, and makes only that boolean publicly decryptable.
After a proof of `fullTransfer == true`, the claim becomes `Claimed`; false/partial proof leaves it
`Claimable` with the residual amount. This avoids burning a valid claim on a failed transfer without
revealing the prize amount. Callback-based token refunds are not used for payout settlement.

## Public state-shape and winner-resolution policy

The participant count and chunk cursor are public scheduling metadata. Winner resolution always
processes every registered snapshot chunk, even after an encrypted winner predicate becomes true;
the number and timing of public calls therefore do not reveal the winning chunk. The required shape
is `ceil(snapshotParticipantCount / PREFIX_CHUNK_SIZE)` calls, not always 16; with the cap of 128
and chunk size 8 the maximum is 16. A short final chunk is padded with zero-weight entries under the
same encrypted operations. `PrizeAssigned` occurs only after the complete shape has run.

## Architecture decisions and Gate 1B obligations

| Decision                          | Alternatives                               | Consequence                                                                                 | Unresolved before implementation       |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| Pool with embedded draw + reserve | Separate coordinator; upgradeable diamond  | Removes unnecessary encrypted pool/coordinator edges while retaining a reviewed draw module | Gate 1B storage/ACL tests              |
| Immutable v1 adapter              | Owner-upgradeable; timelocked upgrade      | Removes adapter replacement attack                                                          | Gate 1B adapter integration            |
| Lazy-sealed encrypted TWAB        | Public balances; checkpoint iteration      | Prevents flash-period weighting without unbounded loops                                     | Gate 1B Solidity differential tests    |
| Fixed-recipient entitlement       | Public winner; encrypted address; ZK claim | Preserves winner privacy                                                                    | Gate 1B EIP-712/transfer tests         |
| cUSDTMock ERC-7984 profile        | Plain ERC-20; dual path                    | Exact six-decimal pull accounting from token-returned actual amount                         | Gate 1B wrapper incident tests         |
| Fixed chunk prefix scan           | Single large scan; off-chain winner        | Bounded FHE cost and permissionless progress                                                | Gate 1B complete-transaction HCU tests |

All architecture policy is frozen. Exact Solidity wiring, integration behavior, complete-transaction
HCU, malformed-token/reentrancy behavior, invalid direct-token-send behavior, and live Sepolia
checks are explicit `GATE_1B_IMPLEMENTATION_TEST_OBLIGATION`s, not unspecified policy.

### Final blocker categories

| Category                                 | Items                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOSED_GATE_1A_DESIGN`                  | token/profile and pull-deposit boundary; bond-reserved participant lifecycle; raw TWAB and O(1) epoch clock; snapshot immutability; embedded VeilDraw semantics; fixed-recipient authorized claims; deterministic simulated-yield recognition; wrapper pause/denylist/upgrade incidents; exact widths, caps, ACL intent, leakage, and solvency rules |
| `GATE_1B_IMPLEMENTATION_TEST_OBLIGATION` | Solidity wiring, EIP-712 implementation, ACL runtime checks, complete-transaction HCU/gas, reentrancy/malicious-token tests, adapter integration, and live Sepolia integration                                                                                                                                                                       |
| `TRUE_UNRESOLVED_BLOCKER`                | none                                                                                                                                                                                                                                                                                                                                                 |

## Architecture decision records

### ADR-1: confidential token boundary

- **DECISION:** Use the verified Sepolia cUSDTMock ERC-7984 profile for the competition build; keep
  production token selection separate.
- **ALTERNATIVES:** Plain ERC-20 accounting, an in-house wrapper, or dual token paths.
- **WHY CHOSEN:** ERC-7984 provides an explicit encrypted-balance/transfer boundary; dual paths
  would create two different privacy and solvency products.
- **SECURITY CONSEQUENCE:** Input proofs, sender binding, ACLs, and transfer failure semantics must
  be tested against the exact pinned implementation.
- **PRIVACY CONSEQUENCE:** Confidential transfer can keep amount private until settlement; plain
  ERC-20 deposits/withdrawals visibly disclose amounts.
- **PERFORMANCE CONSEQUENCE:** Encrypted transfer/accounting costs and token decimals constrain the
  pool cap and HCU budget.
- **GATE 1B OBLIGATION:** Verify the pinned wrapper ABI and incident behavior; production token
  selection remains a separate post-v1 decision.

### ADR-2: immutable yield adapter

- **DECISION:** Use one immutable adapter address per v1 pool and reject unsupported loss, rebasing,
  fee-on-transfer, or stale-valuation behavior.
- **ALTERNATIVES:** Upgradeable adapter, timelocked replacement, or no yield adapter.
- **WHY CHOSEN:** A fixed trust boundary prevents adapter replacement from changing principal
  solvency or prize provenance after deposits exist.
- **SECURITY CONSEQUENCE:** Adapter loss or illiquidity enters an explicit loss mode rather than
  silently funding prizes.
- **PRIVACY CONSEQUENCE:** Adapter assets/yield may be public operational metadata, but user
  balances and draw weights remain encrypted.
- **PERFORMANCE CONSEQUENCE:** Redemptions and valuation checks are bounded external calls.
- **GATE 1B OBLIGATION:** Implement and test loss/liquidity mode; policy is frozen as no new prize
  commitment and no principal confiscation.

### ADR-3: encrypted TWAB accumulator

- **DECISION:** Checkpoint an encrypted balance-time accumulator with lazy epoch sealing before
  every balance change and freeze a versioned snapshot in bounded chunks.
- **ALTERNATIVES:** Public balances, unbounded checkpoint iteration, or deposit-time-only weights.
- **WHY CHOSEN:** It prevents flash-period weighting while keeping balances private and work
  bounded.
- **SECURITY CONSEQUENCE:** Timestamp ordering, overflow bounds, and snapshot races require model,
  property, and live tests.
- **PRIVACY CONSEQUENCE:** Timestamps and registry membership are public; balances, areas, and
  weights are not.
- **PERFORMANCE CONSEQUENCE:** Snapshot and winner resolution must be chunked; a single large scan
  is prohibited.
- **GATE 1B OBLIGATION:** Measure complete checkpoint transactions and differential-test storage
  realization.

### ADR-4: embedded VeilDraw module

- **DECISION:** Embed a reviewed Gate 0-equivalent state machine as an internal pool module, with an
  independent serial reference path and an ordered balanced implementation.
- **ALTERNATIVES:** Separate coordinator contract, copy the probe, generic library, monolithic pool,
  or off-chain winner service.
- **WHY CHOSEN:** It removes an unnecessary encrypted pool/coordinator edge while keeping
  proof/retry storage and semantic parity auditable without granting a backend winner authority.
- **SECURITY CONSEQUENCE:** Snapshot ID, total, bucket, proof handles, and retry state are bound;
  accepted targets are irreversible.
- **PRIVACY CONSEQUENCE:** Only approved bucket/status booleans are publicly decryptable.
- **PERFORMANCE CONSEQUENCE:** Gate 0 HCU/gas measurements require bounded candidate and prefix
  chunks; live HCU remains unobservable.
- **GATE 1B OBLIGATION:** Execute the exact ACL matrix and fail closed if complete-transaction HCU
  exceeds the frozen chunk budget.

### ADR-5: private entitlement and chunked resolution

- **DECISION:** Resolve winners through bounded encrypted prefix chunks and issue a private
  fixed-recipient entitlement consumable through explicit `claimFor` authorization.
- **ALTERNATIVES:** Public winner address, one large prefix transaction, or off-chain winner choice.
- **WHY CHOSEN:** It preserves identity privacy and permissionless progress while retaining the Gate
  0 first-valid distribution.
- **SECURITY CONSEQUENCE:** Recipient binding, nullifier/replay protection, and no-reroll checks are
  mandatory.
- **PRIVACY CONSEQUENCE:** Winner identity and entitlement remain private until an explicit
  settlement boundary; ordinary token settlement may reveal amount.
- **PERFORMANCE CONSEQUENCE:** The frozen design chunk is 8 participants; complete production HCU is
  a fail-closed Gate 1B obligation.
- **GATE 1B OBLIGATION:** Implement EIP-712 verification and actual ERC-7984 residual-transfer
  tests.

## HCU and gas budget policy

Gate 0 provides a feasibility baseline, not production capacity. Local HCU is a deterministic
mock-operation measurement for identical inputs; it is distinct from live EVM gas, which is a
run-specific receipt measurement. Live HCU/depth is **NOT DIRECTLY OBSERVABLE ON LIVE SEPOLIA** in
the frozen stack.

| Action              | Local baseline / policy                                         | Production gate                                                           |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Deposit             | No production value yet                                         | Measure encrypted input, accounting, token call, and worst-case ACL path  |
| Withdrawal          | No production value yet                                         | Measure private amount path and clear-transfer boundary separately        |
| TWAB checkpoint     | No production value yet                                         | Bound elapsed-time multiplication and checkpoint frequency                |
| Draw snapshot/start | No production value yet                                         | Chunk participant snapshots; forbid unbounded loops                       |
| Candidate batch     | Gate 0 m=8: global HCU 1,922,560; sequential HCU 240,000        | Re-measure with pool-embedded draw handles; retain safety headroom        |
| Proof submission    | Gate 0 public proof path only                                   | Measure receipt gas and KMS latency; no live HCU claim                    |
| Winner chunk        | Gate 0 prefix-8: global HCU 7,808,320; sequential HCU 2,571,064 | Start at chunk ≤8; expand only after fresh evidence                       |
| Claim               | No production value yet                                         | Include entitlement ACL, nullifier, reserve transfer, and reentrancy path |

Composed design estimates (sum of measured components plus ordinary control-flow/ACL overhead) are
`COMPONENT_ESTIMATE` only: deposit ≥ widening + actual-received pull accounting; withdrawal ≥
residual arithmetic plus token transfer; TWAB seal ≈ raw multiply/add; snapshot chunk ≥
snapshot-chunk probe; candidate batch uses the Gate 0 m=8 baseline; winner chunk uses the
prefix-chunk probe; prize assignment uses entitlement select plus pool/reserve handoff; claim uses
residual arithmetic plus payout ACL. No row is a production acceptance number until the actual
interfaces exist.

The Gate 0 prefix-16 profile had narrow headroom, so production must not assume one transaction can
scan an arbitrary participant set. `SNAPSHOT_CHUNK_SIZE = 8` and `PREFIX_CHUNK_SIZE = 8` are frozen
design values; every complete-transaction measurement remains a fail-closed Gate 1B obligation, not
a placeholder safety claim.

## Gate 1 design-only FHE probes

`packages/contracts/contracts/Gate1DesignProbeOnly.sol` and its test are explicitly marked
`GATE_1_DESIGN_PROBE_ONLY`, `NOT_PRODUCTION`, and `MUST_NOT_DEPLOY`. They exercise only the local
Hardhat mock and measure widening, the corrected pool-pull actual-received path (including
token-side ACL use), raw TWAB multiply/add, one O(1) seal, an eight-entry snapshot and prefix chunk,
euint64 entitlement selection/residual arithmetic, and pool-to-reserve transient ACL handoff. Each
result is reported as `LOCAL_GLOBAL_HCU`, `LOCAL_SEQUENTIAL_HCU`, and `LOCAL_EVM_GAS_RUN_SPECIFIC`;
no result is live HCU or production capacity.

The local probe run measured: widening `32/32` HCU; corrected pull-deposit/token-side ACL
`278,032/278,032`; raw TWAB multiply/add `955,032/955,000`; snapshot chunk of eight
`2,072,032/2,072,032`; winner prefix chunk of eight `7,808,320/2,571,064`; `ebool`/`euint64`
entitlement select `55,032/55,032`; residual subtraction/equality `282,000/162,000`; and the
transient-ACL handoff added no FHE HCU in the fixture. Values are
`LOCAL_GLOBAL_HCU/LOCAL_SEQUENTIAL_HCU`; fixture EVM gas is run-specific. These are component
measurements, not complete production transaction estimates.

## Frozen competition constants and bound proof

The independent bigint envelope freezes these design constants for the Sepolia competition profile:

| Constant                            |                                           Value |
| ----------------------------------- | ----------------------------------------------: |
| `MAX_PARTICIPANTS`                  |                                             128 |
| `MAX_DRAW_DURATION`                 |                     2,592,000 seconds (30 days) |
| `MAX_USER_PRINCIPAL`                | 1,000,000 tokens = 1,000,000,000,000 base units |
| `MAX_POOL_PRINCIPAL`                |                  128,000,000,000,000 base units |
| `REGISTRATION_RESERVATION_TTL`      |                                  86,400 seconds |
| `REGISTRATION_ACTIVATION_PROOF_TTL` |                                  86,400 seconds |
| `REGISTRATION_BOND_WEI`             |                       1,000,000,000,000,000 wei |
| `CANDIDATE_BATCH_SIZE`              |                                               8 |
| `SNAPSHOT_CHUNK_SIZE`               |                                               8 |
| `PREFIX_CHUNK_SIZE`                 |                                               8 |
| `MAX_PRIZE_ENTITLEMENT`             |                    1,000,000,000,000 base units |

With six decimals, the proven worst-case bit lengths are: user principal 40, aggregate principal 47,
user raw TWAB area 62, aggregate raw TWAB area 69, aggregate raw draw total 69, raw prefix sum 69.
The maximum aggregate total is `331,776,000,000,000,000,000`, with
`2^68 = 295,147,905,179,352,825,856 < MAX_TOTAL < 2^69 = 590,295,810,358,705,651,712`. Therefore
`B_MAX = 2^69 = 590,295,810,358,705,651,712` and the maximum candidate/target is
`B_MAX - 1 = 590,295,810,358,705,651,711`. `B_MAX` has integer bitLength 70 because it is exactly
`2^69`; candidate values require at most 69 value bits. Never call this bucket `2^70`. Every value
is below `2^120`, while source ERC-7984 amounts remain below `2^64`. The model and assertions are in
`numeric-envelope.ts`; these are design constants, not yet Solidity constants. At the
one-basis-point per-day simulated rate, maximum synthetic yield is `384,000,000,000` base units
(`384,000` tokens, 39 bits), so the pinned cast is width-safe after an implementation bound
assertion. Exchange-rate multiplication, rounding, and adapter accounting require separate proofs.

## Frontend boundary (design only)

The future frontend may connect a wallet, initiate a confidential deposit, show public draw status
and proof progress, request an explicit private balance/claim reveal, request a withdrawal, submit a
claim, and display receipts. Rendering a component must never trigger a private decryption or wallet
signature. Any clear ERC-20 transfer amount must be labeled as public in the UI. The future client
should target the current official Zama SDK/RelayerWeb family only after its exact APIs are verified
against the frozen contract stack; no frontend package or code is created in Gate 1A.

## Reviewer Mode

Reviewer Mode is a future public-only view. It may expose chain ID, pool/reserve addresses, source
and tooling commits, runtime hashes, draw state, transaction hashes/blocks, public bucket interval,
batch-success booleans, proof status, privacy limitations, and the literal
`SIMULATED_YIELD_FOR_SEPOLIA_DEMO` label. It must not expose user balances, weights, candidate or
target plaintext, entitlements, private keys, RPC credentials, or raw KMS material.

## Competition trust disclosure

| Component              | Controller/trust                         |               Upgradeable?               |             Pausable?             | Failure impact                                   |             Can affect principal?             |       Can affect winner?        |        Can reveal private value?         |
| ---------------------- | ---------------------------------------- | :--------------------------------------: | :-------------------------------: | ------------------------------------------------ | :-------------------------------------------: | :-----------------------------: | :--------------------------------------: |
| VeilpotPool            | Veilpot code; no winner/admin authority  |                  No v1                   |        Bounded pause only         | Blocks new actions or enters liquidity mode      | Holds/accounting only; must preserve solvency |               No                |     Only documented status metadata      |
| PrizeReserve           | Veilpot code; isolated reserve           |                  No v1                   |        Bounded pause only         | Delays claims                                    |            No pool-principal path             |     No selection authority      | Success boolean/settlement metadata only |
| Draw logic             | Embedded reviewed VeilDraw state machine |                  No v1                   | No arbitrary pause of active draw | Stage retry/recovery                             |                      No                       |  Cannot reroll accepted target  |            Bucket/status only            |
| Zama protocol/KMS      | External protocol operators              |                 External                 |             External              | Delayed proofs/decryption                        |               No direct custody               | No caller-controlled randomness |        Only approved decryptions         |
| cUSDTMock wrapper      | External Protocol DAO owner              |             `UUPS_CONFIRMED`             |                Yes                | Transfers may pause or implementation may change |           Yes, external token trust           |          No selection           |     Token policy may expose metadata     |
| Wrapper registry       | External Protocol DAO owner              | `UPGRADE_MECHANISM_NOT_FULLY_ATTRIBUTED` |          Not applicable           | Registration/revocation changes integration      |                  Indirectly                   |               No                |         Public registry metadata         |
| Mock underlying        | Public test mint authority               |                 External                 |     Implementation-dependent      | Test supply is not production value              |            Yes for test asset only            |               No                |       Clear mint/transfer metadata       |
| Simulated yield source | Demo-only source/sponsor                 |             Separate review              |              Bounded              | Changes reserve funding only                     |           Must not touch principal            |               No                |     Publicly labeled synthetic yield     |

Wrapper trust classification: `UUPS_CONFIRMED` for cUSDTMock based on the official wrapper source
and deployment metadata; this is not inferred from the slot alone. The registry's exact upgrade
mechanism is `UPGRADE_MECHANISM_NOT_FULLY_ATTRIBUTED` pending deployment ABI evidence. The
competition profile therefore has no claim of trustless token infrastructure: external wrapper,
registry, mock underlying, and Zama protocol trust are explicit. Pause/denylist/upgrade incident
behavior is frozen above; Gate 1B must test the exact implementation.
