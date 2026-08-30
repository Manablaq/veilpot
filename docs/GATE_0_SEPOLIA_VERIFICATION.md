# Gate 0 Sepolia verification

## Status

**CONDITIONAL — PARTIAL OFFICIAL LIVE EVIDENCE EXISTS, BUT IS NOT FINALIZED.** This record contains
the reproducible live-probe plan, tooling incidents, and measured partial Sepolia results. Gate 0
remains `CONDITIONAL` until the generated `evidence/gate0/sepolia/` artifacts contain all required
transaction references and every mandatory scenario is complete.

The first finalization attempt under `58ad8c0b464e0dca68b0a98e80bb5dcacd29e883` completed without an
Ethereum transaction but emitted an invalid snapshot: it captured its own invocation before the
terminal status was persisted, omitted an explicit final decision, and did not materialize all
execution-mode/provenance fields. That snapshot is archived in Git metadata and recorded as a
`FINALIZATION_EVIDENCE_EMISSION_DEFECT` tooling incident. The corrected emitter is being reviewed;
the current protocol status is `PASS_READY_TO_FINALIZE`, not yet `FINALIZED`.

## Tooling incident: excluded pre-official deployment

**TOOLING INCIDENT — NOT A PROTOCOL FAIL.** On 2026-08-29, tooling commit
`7a1b228f91849b8ebd5ad22929eff35d38391774` deployed diagnostic probe
`0x815D3Ad40AC60A43971A9e64918D0B83faEdcf3F` in transaction
`0xcd52bc9c93891c6c469d919eb79c0e96d55021463bf3faf00149b247b7c3a537` on Sepolia (chain ID 11155111).
It stopped before encrypted input creation because the runner had not called the installed plugin's
supported `initializeCLIApi()` API. The observed state was `AwaitingBucket` (0), `drawStarted` was
false, and no candidate batch was generated.

The deployment is permanently excluded from final Gate 0 success evidence: VeilDraw privacy,
fairness, randomness, proof binding, and liveness were **NOT TESTED** by it. Its non-secret machine
record is [`tooling-incidents.json`](../evidence/gate0/sepolia/tooling-incidents.json), and its
stale mutable progress was archived only in `.git` metadata as
`.git/veilpot-gate0-sepolia-progress.failed-tooling-7a1b228.json`.

## Tooling incident: unsupported metadata guard in the frozen stack

**TOOLING INCIDENT — NOT A PROTOCOL FAIL.** On tooling commit
`97ddc31881e4b03465ecba9909f88453e6fd6abf`, the transaction-free Sepolia sanity check reached
`initializeCLIApi()`, confirmed `isMock === false`, and created an encrypted-input object. It sent
no protocol transaction, deployed no fresh probe, and created no active progress record. Its final
`getRelayerMetadata()` guard then failed with sanitized `HardhatFhevmError`:
`Relayer signer address is not defined`.

**VERIFIED FACT (installed `@fhevm/hardhat-plugin` 0.4.2):** there is no `runSetup()` function,
signature, or public API in the installed plugin, mock-utils package, or bundled type declarations;
the only occurrence is stale text in that error. Therefore it is classified as **D — unresolved / no
callable implementation** and was not called. The plugin's `initializeCLIApi()` is the typed public,
idempotent per-process API. It initializes the Sepolia provider, resolves FHEVM addresses, builds a
contracts repository, and constructs the relayer SDK instance. `createEncryptedInput()` then
succeeds locally without an on-chain transaction.

The same source shows why the metadata guard is invalid for this frozen stack: the public
`getRelayerMetadata()` calls a mock-utils custom RPC method. The plugin provider handles that method
whenever `useEmbeddedMockEngine` is true, then requests `_relayerSignerAddress`; that field is only
assigned on non-Ethereum mock setup, not the Sepolia Ethereum branch. This is not a missing operator
setup action and cannot be repaired by calling a nonexistent `runSetup()` API. The current official
Hardhat template was also checked: its test suite skips Sepolia and does not supply a `runSetup()`
lifecycle call for this plugin family.

Accordingly, `getRelayerMetadata()` is removed as an invalid readiness requirement; it is not worked
around and `runSetup()` is not called. The source-backed real-Sepolia readiness sequence is:
provenance/credential preflight → chain ID 11155111 → `initializeCLIApi()` → reject `isMock` →
create a domain-bound encrypted-input builder → `add128()` → `encrypt()` → verify one returned
handle and a non-empty input proof. The second incident is recorded separately in
[`tooling-incidents.json`](../evidence/gate0/sepolia/tooling-incidents.json).

**VERIFIED FACT (installed `@zama-fhe/relayer-sdk` 0.4.1):** an encrypted builder's `encrypt()`
locally produces the TFHE ciphertext and ZK proof, then invokes the relayer provider's HTTP
`fetchPostInputProofWithZKProof` request and locally verifies the returned signatures. This path
does not call an Ethers signer or an Ethereum JSON-RPC transaction method. It is therefore
classified as **A — transaction-free encryption/readiness activity**, while still being a real
networked relayer operation. The checker uses the excluded diagnostic deployment only as this
input's domain-binding target and never submits its handle or proof to that contract. It discards
the returned handle and proof immediately and records neither protected plaintext nor proof.

## Tooling incident: premature Phase A interruption and artifact-hash investigation

**TOOLING INCIDENT — NOT A PROTOCOL FAIL.** On tooling commit
`8d729489f4a0a7d042bacb34a33f5acd13d97995`, a fresh diagnostic-only probe
`0x80852aDa4673eC934ed310739b326a58baf79dFb` was deployed in
`0x044e045a5820b6cce902ee86f302be03c4e5420389ae78223229b383073fbc33`. It successfully received an
encrypted total, prepared/proved its bucket, and reached `BucketReady` (`1`), but its `batchId` and
`batchSize` remained zero. No candidate value was generated, decrypted, or selected.

The root cause was runner control flow: `main()` returned on
`VEILPOT_LIVE_STOP_AFTER=batch-generated` immediately after bucket preparation, before calling
`executePrimaryM8()`. The probe and its persisted progress are excluded from final success evidence;
the active progress was archived in `.git` as
`.git/veilpot-gate0-sepolia-progress.failed-interrupt-8d729489.json`.

The incident also exposed a reproducibility issue. Default compilation produced full runtime hash
`0x1b4a70043435b230bcca8f50135082c7ee969e661b5c6c007dc032c38fa45533`, while the Sepolia build and
deployment produced `0x0899bb09e16b75bdb0db03f09a001d7abf40f3ecdbe0e9d2a60cc17ca444f51e`. The full
forensic comparison and compiler-baseline decision are recorded in
[`bytecode-reproducibility.json`](../evidence/gate0/bytecode-reproducibility.json). This incident
tested neither VeilDraw randomness nor fairness.

**MEASURED RESULT (clean Node 22 paths):** the historical default and Sepolia compiler inputs
differed only in `@fhevm/solidity/config/ZamaConfig.sol`: the plugin substituted the Sepolia KMS
verifier address for the default-network address. With Solidity's default IPFS metadata enabled,
that source hash changed only the 51-byte CBOR metadata trailer. The first differing byte was offset
8,992; the 8,982-byte executable bodies had identical hash
`0x76a6e2d1554f64cd0f28a634f56e94cd90f32abf3d2c3649e99d6be203c1e3f0`. This is therefore metadata
only—not a library link, optimizer, source-code, or executable FHEVM transformation difference.

**DESIGN DECISION:** adopt the current official Zama template's compiler settings that apply to this
stack: Solidity 0.8.27, Cancun, optimizer enabled at 800 runs, and `metadata.bytecodeHash = "none"`.
The original 200-run optimizer setting was an undocumented Hardhat default rather than a Veilpot
design decision. The metadata setting is necessary to make the full deployed runtime hash stable
across the plugin's legitimate Sepolia `ZamaConfig` input substitution. Clean default and
`hardhat run --network sepolia` builds now produce the identical full runtime hash
`0xa0098465cd670a0b150f52035cd9677da4fa1de34fd0d917120146a8cd57899f`. The 800-run change creates a
new artifact baseline, so all local measurements are regenerated before any fresh deployment.

## Baseline

The local baseline commit is `5b8483569b8ca63b821e7eb5ef5333ff86917b79`
(`gate0: establish conditional VeilDraw feasibility baseline`). It was checked under Node 22.23.2
before the live runner was added. The probe remains Solidity 0.8.27, optimizer enabled with 800
runs, `metadata.bytecodeHash = "none"`, `cancun` EVM, `@fhevm/solidity` 0.11.1,
`@fhevm/hardhat-plugin` 0.4.2, and `@zama-fhe/relayer-sdk` 0.4.1. No dependency version changed for
live preparation.

The runner treats that hash as the immutable `localGate0BaselineCommit`; it does not derive it from
the current `HEAD`. Immediately before any RPC access or broadcast it derives the clean current
`HEAD` as `liveVerificationToolingCommit`, verifies that the baseline exists and is its ancestor,
requires a clean working tree and all three required Hardhat variables, then verifies chain ID
`11155111`. Both provenance values are written to every generated deployment/evidence manifest.

## Verified live integration facts

**VERIFIED FACT:** Zama's current official Hardhat template supports `--network sepolia` and uses
Hardhat variables for local credentials. Its current configuration requires Cancun-compatible
Solidity and uses `ZamaEthereumConfig` for Sepolia host-contract configuration.

**VERIFIED FACT:** official Zama documentation says bounded `FHE.randEuint128(B)` requires a
power-of-two `B`, returns values in `[0,B)`, is cryptographically secure, and keeps values encrypted
unless intentionally decrypted. The retained probe derives `B` internally from public bucket
evidence; no seed, candidate, or bound parameter is caller-controlled.

**VERIFIED FACT:** current public decryption is a Relayer call returning clear values plus an ABI
encoding and decryption proof. The contract validates a proof against ordered ciphertext handles
with `FHE.checkSignatures`. The request total type limit is 2,048 encrypted bits. The runner only
public-decrypts the three explicitly public bucket predicates (264 bits) and the explicitly public
batch-success predicate (1 bit).

**VERIFIED FACT:** user decryption requires ACL permission for both the user and contract. The probe
does not grant users access to `T`, candidates, or `R`; an optional independent wallet therefore
must be denied.

Primary sources:
[Zama randomness guide](https://docs.zama.org/protocol/solidity-guides/smart-contract/operations/random),
[public-decryption guide](https://docs.zama.org/protocol/relayer-sdk-guides/fhevm-relayer/decryption/public-decryption),
[user-decryption guide](https://docs.zama.org/protocol/relayer-sdk-guides/fhevm-relayer/decryption/user-decryption),
and [official Hardhat template](https://github.com/zama-ai/fhevm-hardhat-template).

## Credential handling and runner

The repository does not read `.env`; it uses Hardhat variables stored outside the working tree. With
Node 22 active, set all three interactively on the operator's machine:

```bash
pnpm --filter @veilpot/contracts exec hardhat vars set SEPOLIA_RPC_URL
pnpm --filter @veilpot/contracts exec hardhat vars set DEPLOYER_PRIVATE_KEY
pnpm --filter @veilpot/contracts exec hardhat vars set UNAUTHORIZED_PRIVATE_KEY
```

Use a dedicated, funded Sepolia-only deployer and a separate non-authorized test wallet. The runner
derives only their public addresses and refuses to run when they are equal.

Do not put values in `.env`, source files, evidence, shell history, or chat. After setting all three
required variables, use:

```bash
pnpm --filter @veilpot/contracts live:sepolia
```

The runner is [run-sepolia.ts](../packages/contracts/scripts/run-sepolia.ts). It persists only
non-secret resumable progress in local Git metadata, emits the commit-ready evidence bundle only at
the end of a completed run, reads on-chain state on restart, and never generates a new batch from
`AwaitingBatchProof` or `CandidateAccepted`. This preserves the mandatory clean worktree gate before
every broadcast. Run the explicit interruption drill once after primary deployment:

```bash
pnpm --filter @veilpot/contracts live:sepolia:interrupt
pnpm --filter @veilpot/contracts live:sepolia
```

The first command stops after m=8 batch generation; the second must resume reduction/proof work
without another candidate-generation transaction. The failure-retry drill is intentionally opt-in
because it uses a separate live probe and a recorded per-invocation batch bound rather than an
unlimited retry loop:

```bash
pnpm --filter @veilpot/contracts live:sepolia:failure-drill
```

For `m=1`, `T=129`, a naturally successful batch is recorded honestly and never relabelled as a
failure test. A naturally failed batch can be resumed on the same probe only after its valid false
proof is accepted; a bounded continuation then generates the next batch.

Only after the primary, zero-total, interruption/resume, and failure-retry drills are all complete,
emit the commit-ready evidence bundle without new protocol work:

```bash
pnpm --filter @veilpot/contracts live:sepolia:finalize
```

Finalization refuses to write evidence if the zero-total or proven-failure retry condition is still
missing. Mutable progress remains outside the working tree, so every broadcast still begins from a
clean Git state.

Before a fresh official deployment, the transaction-free initialization command must complete the
source-backed encrypted-input flow above. It prints only the public deployer address, safe readiness
flags, returned-handle count, proof-presence boolean, and confirmed transaction count before/after.
The count must remain unchanged; the command does not deploy a probe, invoke a contract, decrypt
data, or emit tracked live protocol evidence:

```bash
pnpm --filter @veilpot/contracts live:sepolia:check-init
```

## Required generated evidence

The runner generates the artifacts listed in
[evidence-schema.json](../evidence/gate0/sepolia/evidence-schema.json) only after live execution.
They include deployment and bytecode-parity hashes, sanitized transaction data, privacy/proof
attempt outcomes, anti-grinding and zero-total state outcomes, recovery records, and observed
Sepolia timings. It labels live HCU/depth as `NOT_DIRECTLY_OBSERVABLE_ON_LIVE_SEPOLIA` unless an
authoritative live endpoint actually reports it.

Source verification is intentionally not claimed by the runner. Its mandatory parity check compares
the compiled artifact runtime-bytecode hash with code read from the deployed address. A Sourcify
result may be added only after a real request returns a real result.

## Live scenarios and acceptance

The primary flow encrypts a known test total, derives and proves only the bucket evidence, executes
`m=8`, verifies serial/balanced reductions, publicly proves only aggregate success, accepts `R`, and
attempts forbidden post-success generation. It attempts public decryption of `T`, one `Xi`, and
accepted `R` without recording cleartext. It also tests altered clear values, empty proofs,
cross-draw proof handles, stale/replayed proofs, and mandatory independent-wallet user decryption
denial of `T`. Finalization refuses to emit a complete bundle unless that attempted operation
returns the expected denial and records only its public wallet address, sanitized error category,
and timing.

The separate zero-total probe must end in `NoEligibleWeight` without candidate generation. The
separate failure drill tests that generation before a valid failure proof reverts and that a proof
from the preceding batch cannot advance the next batch. Prefix benchmark calls cover 4, 8, 12, and
16 participants; live gas and transaction counts are recorded separately from mock HCU numbers.

No Sepolia assertion above is currently a measured result. Any missing live scenario, unavailable
relayer behavior, parity mismatch, protected-value disclosure, proof-binding failure, reroll path,
or impractical cost must keep Gate 0 `CONDITIONAL` or change it to `FAIL` based on the evidence.

## Partial live failure/retry evidence and resumability correction

**MEASURED RESULT — PARTIAL, NOT FINALIZED.** Under tooling commit
`10742cd4de1330970b4e38a87d4f7dded4b0fb97`, dedicated probe
`0x90aA8B2C43387E9FEE60b5500A34D0a7350b7065` produced two real natural `m=1` failures with `T=129`
and public bucket `B=256`. Batch 1 was generated once, its real false proof was accepted, and only
then was batch 2 generated. Batch 2 also failed naturally and its real false proof was accepted. The
contract is therefore correctly in `AwaitingCandidateBatch`, with `batchId=2`; no batch 3 exists.
This is valid partial proof-before-retry evidence, not a protocol failure.

The historical runner recorded no durable process invocation identity. Consequently, the chain
proves the ordered transactions but cannot attribute its later batch-2 reduction/proof transactions
to one of two visible local invocations. Historical transaction records deliberately remain without
an `invocationId`; they are not backfilled with guesses.

**TOOLING CORRECTION:** subsequent runner revisions preserve the original live tooling commit while
recording an explicit tooling-revision history. Every new mutating invocation atomically acquires a
non-secret lock under `.git`, records `invocationId`, runner mode, start time, starting confirmed
nonce, public deployer address, tooling commit, stage, and completion status, and tags new
transaction/probe records with that `invocationId`. A pre-existing or failed lock is fail-closed and
requires explicit operator inspection; it is never silently removed. Normal completion, intentional
interruption, and bounded-stop completion release the lock only after their state is persisted.

The corrected failure-drill runner is resumable on the _same_ probe from `BucketReady`,
`AwaitingBatchProof`, and `AwaitingCandidateBatch`. It never redeploys a probe merely because a
retry failed. It permits at most six newly generated m=1 batches per invocation and stops honestly
when the bound is exhausted. For every false result it performs applicable exact-state rejection
simulations before submitting the valid false proof: wrong clear value, empty proof, prior-batch
proof when available in-process, and retry before proof. Protected candidate values and raw proofs
are never persisted.

The correction does not alter `VeilDrawProbe.sol`; the existing probe can be resumed directly
because retry authorization is on-chain state (`AwaitingCandidateBatch`) rather than runner-local
state. Future evidence must identify the provenance transition explicitly: historical drill
transactions belong to tooling `10742cd…`; subsequent records carry the corrected tooling commit and
an invocation ID.

## Reduction-equivalence disclosure

**SUFFICIENT FOR GATE 0 WITH DISCLOSED LIMITATION.** Local FHE tests directly decrypt and compare
serial/balanced outputs for `m = 1, 2, 4, 8, 16`, and the independent bigint model exhaustively
checks its small-domain coverage. Both reductions independently executed successfully on Sepolia. No
live encrypted serial-versus-balanced equality assertion was performed; final Gate 0 wording must
not claim one.

## Evidence taxonomy hardening

The mock FHEVM receipt analyzer produces deterministic global and sequential HCU counts for an
identical operation. Receipt `evmGas` is intentionally classified as **RUN-SPECIFIC**: mock input
handles and proofs are generated with cryptographic randomness, and their calldata zero-byte
patterns change intrinsic EVM gas by small amounts between otherwise equivalent runs. The HCU counts
remain the primary local computational-cost evidence; each retained gas value is an observed run
value and is not presented as a reproducible constant.

The duplicate-launch result is classified as `PASS_LOCAL_WITH_LIVE_NONMUTATION_CORROBORATION`: the
atomic lock is a local control, while the live chain/progress showed no second invocation or
mutation. The six-batch retry cap is `PASS_LOCAL`; the live continuation succeeded on its sixth new
batch, so the live `BOUNDED_STOP` branch itself was not observed. These classifications are encoded
in [`evidence-schema.json`](../evidence/gate0/sepolia/evidence-schema.json).
