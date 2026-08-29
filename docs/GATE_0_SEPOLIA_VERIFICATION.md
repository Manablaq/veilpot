# Gate 0 Sepolia verification

## Status

**UNRESOLVED — NO LIVE TRANSACTIONS HAVE BEEN BROADCAST.** This record is a reproducible live-probe
plan and runner specification, not evidence of a Sepolia execution. Gate 0 remains `CONDITIONAL`
until the generated `evidence/gate0/sepolia/` artifacts contain actual transaction references and
all required scenarios pass.

## Baseline

The local baseline commit is `5b8483569b8ca63b821e7eb5ef5333ff86917b79`
(`gate0: establish conditional VeilDraw feasibility baseline`). It was checked under Node 22.23.2
before the live runner was added. The probe remains Solidity 0.8.27, optimizer enabled with 200
runs, `cancun` EVM, `@fhevm/solidity` 0.11.1, `@fhevm/hardhat-plugin` 0.4.2, and
`@zama-fhe/relayer-sdk` 0.4.1. No dependency version changed for live preparation.

The runner treats that hash as the immutable `localGate0BaselineCommit`; it does not derive it from
the current `HEAD`. Immediately before any RPC access or broadcast it derives the clean current
`HEAD` as `liveVerificationToolingCommit`, verifies that the baseline exists and is its ancestor,
requires a clean working tree and both required Hardhat variables, then verifies chain ID
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
because it uses a separate live probe and never loops to seek a desired random outcome:

```bash
pnpm --filter @veilpot/contracts live:sepolia:failure-drill
```

If its single `m=1`, `T=129` batch is naturally successful, it records that the failure path was not
observed; do not relabel it as a failure test. A later explicitly requested new drill is then needed
for the failure/retry condition.

Only after the primary, zero-total, interruption/resume, and failure-retry drills are all complete,
emit the commit-ready evidence bundle without new protocol work:

```bash
pnpm --filter @veilpot/contracts live:sepolia:finalize
```

Finalization refuses to write evidence if the zero-total or proven-failure retry condition is still
missing. Mutable progress remains outside the working tree, so every broadcast still begins from a
clean Git state.

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
