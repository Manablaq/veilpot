# Veilpot Validation Ledger

## Purpose

This is Veilpot's reviewer-facing engineering validation record. A checkpoint is marked **PASS**
only after its command output, state transition, hashes, or browser/runtime evidence has been
inspected. This ledger does not treat transaction inclusion as confidential finality, does not infer
private values, and does not mark release work complete before it has actually passed.

## Environment identity

- Network: Ethereum Sepolia
- Chain ID: `11155111`
- Frontend runtime: Node.js `v22.23.2`
- Package manager: pnpm `10.18.3`
- Frontend branch during F7 validation: `frontend/veilpot-masterpiece-v1`
- Backend baseline HEAD: `1afbc79cd6e13a4fb5b9372230c21a5646f95abc`

### Deployed protocol

- VeilpotPool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- AutopilotVault: `0x7dF64925Af938a0535F30dE9cFBf97BB3ab30487`
- SimulatedYieldAdapter: `0xEa9868e982b98B57C52B95853EdE2552dAD74b64`
- PrizeReserve: `0xbEe24d1060d94d435272550fAa5616faD59Ad1a1`
- Zama Sepolia Confidential USDT mock: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`

The current deployment uses testnet assets and a simulated-yield adapter for the Sepolia
demonstration. It must not be represented as production/mainnet savings or production yield.

# Passed checkpoints

## Backend protocol regression — PASS

Validated protocol suites:

- Reference model: **102 passing**
- Solidity contracts: **212 passing**
- Protocol SDK: **16 passing**
- Combined protocol tests: **330 passing**

Additional passed gates include contract compilation, Solidity lint, TypeScript validation, protocol
SDK build, reference-model build, ABI parity checks, deployment-evidence validation,
runtime-evidence validation, and mock-FHE regression.

The Solidity, protocol SDK, and evidence directories are frozen boundaries during frontend release
work.

## F6-A — live recovery / finality verification — PASS

The controlled Sepolia recovery sequence completed successfully:

1. confidential registration deposit entered `PENDING_ACTIVATION`
2. public threshold consequence resolved false
3. false settlement completed
4. refund attempt completed
5. refund-complete public consequence resolved true
6. true refund settlement completed
7. participant returned to `FREE`
8. refundable registration bond was withdrawn
9. final active participant count was `0`
10. final pending bond refund was `0`
11. final Pool ETH balance was `0`

Successful writes and decryptions from this sequence are not automatically retried.

## Frontend provenance repair — PASS

The interface was audited so presentation-only examples cannot be mistaken for authoritative
protocol state.

Confirmed protections:

- private balances are not automatically decrypted
- account values are not inferred from presentation fixtures
- active-pot counts are not fabricated
- funded-window counts are not fabricated
- next-contribution schedules are not fabricated
- Autopilot runway is not inferred
- VeilDraw examples are labeled as previews/examples
- notification examples are non-authoritative
- deployment identity is sourced from the protocol SDK

## Local production runtime verification — PASS

Fresh Next.js production runtime smoke passed:

- `/` -> HTTP `200`
- `/app` -> HTTP `200`
- `/icon.svg` -> HTTP `200`

A stale local Next.js listener causing the earlier favicon `404` was identified and only the exact
listener was terminated. No broad process kill was used.

## Desktop visual QA — PASS

Browser inspection confirmed truthful preview labeling, Sepolia test-asset/simulated-yield
disclosure, private values hidden by default, no fabricated live account state, successful favicon
loading, and no Veilpot application console error.

## F7-A — frontend wiring matrix audit — PASS

Read-only audit confirmed the frontend already had:

- wallet connection
- SIWE authentication/session handling
- Sepolia network binding
- live participant discovery
- participant-slot reservation
- short-lived Pool operator approval
- confidential registration deposit
- confidential withdrawal
- receipt tracking
- participant-state refresh

The audit also identified Autopilot lifecycle integration as incomplete and made it the explicit
F7-B implementation target.

No transaction, wallet signature, decryption, or protocol-file modification was performed during the
audit.

## F7-B1 — Autopilot insertion-point audit — PASS

Read-only source inspection established the exact frontend integration points and confirmed:

- the existing participant scanner would be reused
- no second participant scanner was required
- the frozen SDK already exports the required Autopilot call builders
- the frozen SDK already exports deterministic Merkle schedule construction
- the frozen SDK already exports Autopilot encryption helpers
- Solidity changes were unnecessary
- protocol SDK changes were unnecessary

No file change, transaction, signature, or decryption occurred in this audit.

## F7-B2A — Autopilot plan creation wiring — PASS

Autopilot plan creation is wired through the frozen protocol SDK.

Implemented flow:

1. require an `ACTIVE` Veilpot participant
2. require an explicit lifetime authorization cap
3. read live owner-scoped `nextPlanNonce`
4. derive the exact protocol plan ID through the frozen SDK
5. construct recurring UTC execution windows
6. build the deterministic SDK Merkle commitment
7. encrypt period amount and lifetime cap using one shared FHE proof
8. build the exact frozen SDK `createPlan` descriptor
9. request explicit wallet approval only at the final write boundary
10. wait for the transaction receipt
11. reconcile mined state against live Vault metadata
12. persist the public Merkle schedule/proofs locally for later lifecycle actions
13. never automatically recreate a plan after a mined transaction

Schedule rules:

- committed timezone: **UTC**
- preparation lead: **300 seconds**
- weekly recurrence supported
- monthly days limited to `1-28`
- deterministic execution windows
- invalid schedules fail closed

Frontend Autopilot unit tests: **5/5 passing**

Covered:

- weekly schedule generation
- preparation-lead rollover
- monthly UTC recurrence
- invalid input rejection
- schedule-record persistence without duplication

Static/release validation:

- Prettier: **PASS**
- TypeScript: **PASS**
- ESLint: **PASS**
- Next.js 16.3.4 production build: **PASS**
- stale pre-wiring placeholder: **absent**
- frozen Solidity boundary: **unchanged**
- frozen SDK boundary: **unchanged**
- frozen evidence boundary: **unchanged**

Frozen frontend hashes after F7-B2A:

- `apps/web/components/action-sheet.tsx`:
  `020cd37023cfd5d1a4c0726847430a611dce0f411c4d58430cb0dc36f0edb957`
- `apps/web/lib/autopilot.ts`: `ebf04d3b4c69dc370855ff79184704b7f86d4a2c08ade4e9e82abca7482bb9f5`
- `apps/web/lib/autopilot.test.ts`:
  `f669ab725adbb5d45f63f3b52e79a75b164a7fb1b7fff9c2c99304718bd47b17`

Safety result during F7-B2A static implementation/validation:

- transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- Autopilot funding sent: **no**
- Autopilot execution sent: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B1 — Autopilot discovery / funding insertion audit — PASS

Read-only inspection established the post-F7-B2A integration boundary for Autopilot discovery and
confidential funding.

Confirmed:

- the existing F7-B2A action sheet remains the integration surface
- local schedule persistence is stored under `veilpot:autopilot:schedules:v1`
- the frozen SDK exposes `buildAutopilotFundingCall`
- the frozen SDK exposes `encryptAutopilotFundingAmount`
- funding is built as confidential-token `confidentialTransferAndCall`
- the funding destination is the frozen AutopilotVault
- the exact `planId` is passed as callback data
- no separate Pool or Vault operator approval is required for this funding path
- live plan metadata remains the reconciliation source
- no private plan amount, remaining budget, or plan-fund value is required for discovery

Safety result during F7-B2B1:

- files modified: **0**
- transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B1A — canonical owner-plan discovery proof — PASS

Static protocol proof established the canonical discovery model that must be used by the frontend.

Confirmed from the frozen Vault ABI and SDK:

- `PlanCreated.planId` is indexed
- `PlanCreated.owner` is indexed
- `PlanCreated.planNonce` is indexed
- `PlanCreated` also emits `slotIndex`, `registrationVersion`, `reservationNonce`, `executionCount`,
  and `scheduleRoot`
- `planIdFor` is bound to owner, registration version, reservation nonce, and plan nonce
- deriving historical plans from only the current participant registration would be incomplete and
  is therefore rejected
- canonical owner discovery begins from the frozen Vault deployment block `11614332`
- discovered candidates must be reconciled against live `planMetadata`
- confidential funding is a direct confidential-token transfer-and-call to the Vault using the exact
  `planId`
- no separate Autopilot operator approval is part of this funding path

This checkpoint proves the static discovery/funding contract surface only. It does **not** claim
that a browser RPC event scan or a funding transaction has already been executed.

Safety result during F7-B2B1A:

- files modified: **0**
- transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2A — Autopilot discovery-model foundation — PASS

The frontend discovery foundation was implemented and statically validated before any browser RPC
event scan or confidential funding write was enabled.

Implemented and validated:

- fail-closed parsing of browser-persisted Autopilot public schedule records
- schedule loading scoped by chain ID, Vault address, and owner
- exact local schedule matching by plan ID, schedule root, and execution count
- complete owner-plan discovery validation against sequential owner-scoped plan nonces
- rejection of incomplete or duplicated `PlanCreated` event sets
- reconciliation of each discovered `PlanCreated` binding against live-plan metadata
- validation of owner, slot index, registration version, reservation nonce, plan nonce, schedule
  root, and execution count
- no private plan amount, remaining budget, or plan-fund decryption required by the discovery model

Autopilot frontend unit tests: **9/9 passing**.

Static/release validation:

- Prettier: **PASS**
- TypeScript: **PASS**
- ESLint: **PASS**
- Next.js 16.3.4 production build: **PASS**
- frozen Solidity boundary: **unchanged**
- frozen protocol SDK boundary: **unchanged**
- frozen evidence boundary: **unchanged**
- F7-B2A action-sheet integration: **unchanged**

Frozen frontend hashes after F7-B2B2A:

- `apps/web/lib/autopilot.ts`: `44a1a9cbfceb541d930e0cde038d62f15547a26162e5d3495eb0ad1fdb74e379`
- `apps/web/lib/autopilot.test.ts`:
  `90880c6303a5ebbfed263f2b596fe54a28ed82c4b8ec4fc9b5c375e74f532470`
- `apps/web/components/action-sheet.tsx`:
  `020cd37023cfd5d1a4c0726847430a611dce0f411c4d58430cb0dc36f0edb957`

This checkpoint establishes the pure discovery/reconciliation model only. It does **not** claim that
a browser `PlanCreated` RPC scan has been executed, that any plan has been funded through the
frontend, or that any private Autopilot value has been decrypted.

Safety result during F7-B2B2A:

- browser RPC event scans executed: **0**
- Autopilot funding transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- Solidity modified: **no**
- frozen protocol SDK modified: **no**
- frozen evidence modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2B1 — live discovery / funding insertion capture — PASS

A read-only source capture froze the exact frontend insertion surface immediately before live
Autopilot owner discovery and explicit confidential funding are wired.

Confirmed:

- `apps/web/components/action-sheet.tsx` remains the existing wallet/write integration surface
- the F7-B2B2A discovery/reconciliation library remains available without further protocol-SDK
  changes
- `PlanCreated.planId`, `PlanCreated.owner`, and `PlanCreated.planNonce` are indexed
- `PlanCreated` emits the exact registration binding and schedule root needed for reconciliation
- canonical event discovery begins at frozen Vault deployment block `11614332`
- live plan reconciliation uses the frozen SDK `buildAutopilotPlanMetadataCall` surface
- live owner-plan completeness is checked against `nextPlanNonce(owner)`
- browser discovery must use one pinned Sepolia block snapshot for both nonce reading and event-log
  completeness
- event scanning will be bounded into block chunks rather than assuming an unlimited RPC log range
- confidential funding uses frozen `encryptAutopilotFundingAmount`
- confidential funding uses frozen `buildAutopilotFundingCall`
- the resulting write is confidential-token `confidentialTransferAndCall` to the immutable Autopilot
  Vault with the exact selected `planId` as callback data
- no separate Autopilot Pool or Vault operator approval is required
- current frontend runtime dependencies are wagmi `3.7.7` and viem `2.56.0`
- no pre-existing browser event-scan implementation was found in `apps/web`
- the existing transaction path waits for a transaction receipt and checks receipt success before
  claiming inclusion

The next implementation must preserve these safety rules:

- discovery is public/read-only and must never trigger a private-value decryption
- partial or incomplete `PlanCreated` results must fail closed rather than presenting an incomplete
  plan list
- local schedule proofs are matched exactly by plan ID, schedule root, and execution count when
  available
- absence of local schedule proofs must never fabricate them
- the user must explicitly select the plan and enter the funding amount
- the exact confidential-token destination, Vault destination, selected plan ID, and user-entered
  amount must be reviewable before wallet approval
- the selected plan binding must be re-read from live state immediately before encryption/signing
- REVOKED or COMPLETED plans must not be funded
- a successful mined funding transaction must never be automatically resubmitted because later
  reconciliation or browser-state persistence fails
- no funding retry may occur automatically

Frozen frontend hashes at this capture:

- `apps/web/components/action-sheet.tsx`:
  `020cd37023cfd5d1a4c0726847430a611dce0f411c4d58430cb0dc36f0edb957`
- `apps/web/lib/autopilot.ts`: `44a1a9cbfceb541d930e0cde038d62f15547a26162e5d3495eb0ad1fdb74e379`
- `apps/web/lib/autopilot.test.ts`:
  `90880c6303a5ebbfed263f2b596fe54a28ed82c4b8ec4fc9b5c375e74f532470`

This was an insertion capture only. It does **not** claim that the browser has scanned Sepolia logs
or that an Autopilot funding transaction has been submitted.

Safety result during F7-B2B2B1:

- action-sheet files modified: **0**
- browser RPC event scans executed: **0**
- Autopilot funding transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- Solidity modified: **no**
- frozen protocol SDK modified: **no**
- frozen evidence modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2B — live Autopilot discovery and confidential funding wiring — STATIC PASS

The browser integration for canonical Autopilot owner-plan discovery and explicit confidential
funding was implemented and passed the complete static validation gate.

Implemented and validated:

- explicit Create plan and Fund existing Autopilot modes
- owner-indexed `PlanCreated` discovery beginning at frozen Vault deployment block `11614332`
- one pinned Sepolia block snapshot for event discovery and owner `nextPlanNonce` completeness
- bounded `PlanCreated` scanning in block chunks
- snapshot-hash confirmation after discovery to detect a changed or reorganized block
- fail-closed owner-plan completeness validation against sequential owner plan nonces
- live `planMetadata` reconciliation for every discovered plan
- exact reconciliation of owner, slot index, registration version, reservation nonce, plan nonce,
  schedule root, and execution count
- local public schedule storage treated as supplemental rather than chain-authoritative
- malformed or unavailable local schedule proofs do not fabricate data and do not block verified
  on-chain funding
- explicit plan selection before confidential funding
- explicit positive uint64 funding amount review
- exact confidential-token address, Vault destination, selected plan ID, entered amount, and funding
  path shown before final wallet action
- latest live plan metadata re-read immediately before encryption and signing
- REVOKED and COMPLETED plans rejected from new funding
- funding encryption uses frozen `encryptAutopilotFundingAmount`
- funding descriptor uses frozen `buildAutopilotFundingCall`
- resulting frozen path is confidential-token `confidentialTransferAndCall` to the Autopilot Vault
  with the exact selected `planId` as callback data
- no separate Autopilot operator approval
- successful mined funding inclusion is preserved even if later reconciliation fails
- submitted transaction hash is preserved and surfaced before any manual retry is considered
- no automatic discovery
- no automatic funding retry
- no private Autopilot value decryption

Static validation:

- Prettier: **PASS**
- Autopilot unit tests: **9/9 PASS**
- TypeScript: **PASS**
- ESLint: **PASS**
- Next.js 16.3.4 production build: **PASS**
- explicit discovery-only invocation assertion: **PASS**
- explicit funding-only invocation assertion: **PASS**
- frozen Solidity boundary: **unchanged**
- frozen protocol SDK boundary: **unchanged**
- frozen evidence boundary: **unchanged**

Frozen frontend hashes after F7-B2B2B:

- `apps/web/components/action-sheet.tsx`:
  `39514338076663d737a229cc3204eda583eb7f87659f942c8d07cd20cf804758`
- `apps/web/lib/autopilot.ts`: `44a1a9cbfceb541d930e0cde038d62f15547a26162e5d3495eb0ad1fdb74e379`
- `apps/web/lib/autopilot.test.ts`:
  `90880c6303a5ebbfed263f2b596fe54a28ed82c4b8ec4fc9b5c375e74f532470`

This checkpoint is a source/static-validation result only. It does **not** claim that the browser
has executed the owner `PlanCreated` RPC scan, submitted an Autopilot funding transaction, requested
a wallet signature, or decrypted a private value.

Safety result during F7-B2B2B static validation:

- browser RPC event scans executed: **0**
- Autopilot funding transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- Solidity modified: **no**
- frozen protocol SDK modified: **no**
- frozen evidence modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C — fresh production runtime preparation — PASS

A fresh local production runtime was started from the frozen F7-B2B2B frontend before any live
Autopilot browser discovery or wallet interaction.

Runtime verification:

- Next.js runtime: `16.3.4`
- production URL: `http://127.0.0.1:3177`
- `/`: **HTTP 200**
- `/app`: **HTTP 200**
- `/api/auth/session`: **HTTP 200**
- fresh listener successfully established on port `3177`
- frozen F7-B2B2B action-sheet hash preserved
- frozen Autopilot discovery-model hashes preserved
- frozen Solidity, protocol SDK, and evidence boundaries preserved

The `200` response from `/api/auth/session` is only an HTTP transport result. This checkpoint does
**not** claim that a browser wallet session is authenticated; session-body and browser-cookie state
remain to be inspected separately.

No Autopilot action occurred during runtime preparation:

- browser `PlanCreated` RPC scans executed: **0**
- Autopilot funding transactions sent: **0**
- protocol transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- source files modified by runtime preparation: **0**
- commit created: **no**
- push performed: **no**

Frozen source hashes at this checkpoint:

- `apps/web/components/action-sheet.tsx`:
  `39514338076663d737a229cc3204eda583eb7f87659f942c8d07cd20cf804758`
- `apps/web/lib/autopilot.ts`: `44a1a9cbfceb541d930e0cde038d62f15547a26162e5d3495eb0ad1fdb74e379`
- `apps/web/lib/autopilot.test.ts`:
  `90880c6303a5ebbfed263f2b596fe54a28ed82c4b8ec4fc9b5c375e74f532470`

## F7-B2B2C1 — authentication session semantics capture — PASS

The production authentication/session path was inspected without wallet interaction.

Observed runtime result:

- cookieless `GET /api/auth/session`: **HTTP 200**
- cookieless response body: `{ "authenticated": false }`
- HTTP 200 therefore represents a successful session-status request, not proof of authentication

Verified authentication semantics:

- the session route requires both `veilpot_session_message` and `veilpot_session_signature` cookies
- the stored SIWE message must match the current request origin
- the stored SIWE message must remain bound to Ethereum Sepolia
- the stored SIWE session must not be expired
- the stored wallet signature is cryptographically re-verified before `authenticated: true` is
  returned
- invalid or expired session cookies are cleared
- successful SIWE verification stores the signed message and signature in HttpOnly, SameSite-strict
  cookies
- the frontend requests `/api/auth/session` with same-origin credentials and only accepts
  `authenticated === true`

Important boundary:

- the cookieless terminal request cannot determine whether the actual browser currently holds a
  valid Veilpot session cookie
- browser cookie/session state therefore remains unresolved
- no new SIWE signature is authorized or requested by this checkpoint

Safety result:

- browser cookie state inspected: **no**
- wallet connected by this gate: **no**
- SIWE signatures requested: **0**
- browser `PlanCreated` scans executed: **0**
- Autopilot funding transactions sent: **0**
- protocol transactions sent: **0**
- decryptions requested: **0**
- source files modified: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C2 — browser authenticated-session state — PASS

The already-running local production application was opened in the normal Veilpot browser profile
for a browser-state inspection only.

Observed browser state:

- `/app` resolved directly to the authenticated Veilpot workspace
- the sign-in gate was not displayed
- the workspace displayed `Your private account is ready.`
- the active network indicator displayed `Sepolia`
- the account UI displayed `0x1f87…5024`
- no session/wallet mismatch warning was visible
- the browser state is therefore consistent with an existing authenticated session and matching
  connected Sepolia wallet

Boundary of this observation:

- exact HttpOnly session-cookie contents were not exposed or inspected
- no new SIWE authentication was performed
- no nonce request was intentionally initiated
- no wallet signature prompt appeared
- no Autopilot owner-plan discovery was initiated
- `Discover my live plans` was not clicked
- no transaction or private-value decryption was initiated

Safety result:

- new SIWE signatures requested: **0**
- browser `PlanCreated` discovery scans intentionally executed: **0**
- Autopilot funding transactions sent: **0**
- protocol transactions sent: **0**
- decryptions requested: **0**
- source files modified: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C3 — live-discovery control view — PASS

The browser Autopilot action sheet was opened in `Fund existing` mode without executing live
discovery.

Observed browser controls:

- action-sheet heading: `Discover the exact plan before you fund it.`
- `Fund existing` mode visibly active
- `Discover my live plans` control visibly present
- canonical-discovery explanation visible before execution
- the explanation states that Veilpot pins one Sepolia block
- the explanation states that owner-indexed `PlanCreated` events are scanned from the frozen Vault
  deployment
- the explanation states that owner-plan completeness is checked against the owner plan nonce
- the explanation states that every result is reconciled against live public plan metadata
- the explanation states that no private amount is decrypted

Execution boundary:

- `Discover my live plans` had not yet been clicked
- no live owner-event scan had been intentionally executed
- no plan had been selected for funding
- no funding amount had been entered
- no wallet signature prompt appeared
- no transaction approval prompt appeared
- no encryption or decryption operation was initiated

Safety result:

- browser `PlanCreated` discovery scans intentionally executed: **0**
- Autopilot funding transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- source files modified: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C4 — first live Autopilot discovery — FAILED CLOSED

The first explicit browser `Discover my live plans` execution reached the live Sepolia RPC read path
and failed closed before any funding action.

Observed failure:

- the browser issued the live Autopilot owner-plan discovery flow
- the RPC rejected the `eth_getLogs` request
- returned reason: `Request exceeds defined limit`
- returned detail: `Log response size exceeded`
- returned provider limit: maximum requested block range is `1000` blocks
- the current frontend discovery chunk is `5000` blocks
- the UI surfaced `Plan discovery failed closed`
- no discovered plan result was accepted after the failed log query

Diagnosis:

- this is an RPC log-range compatibility failure, not a Solidity or protocol-state failure
- the existing bounded event-scan architecture remains valid
- the browser scan chunk must be reduced to a provider-safe range before retry
- because the loop uses an inclusive `fromBlock`/`toBlock` range with `chunk - 1`, a chunk value of
  `1000` requests at most exactly 1000 blocks

Retry boundary:

- the failed 5000-block request must not be repeated unchanged
- no automatic discovery retry occurred
- no funding action followed the failed discovery

Safety result:

- live Sepolia read-only discovery attempted: **yes**
- `eth_getLogs` discovery completed successfully: **no**
- accepted discovered plans: **0**
- Autopilot funding transactions sent: **0**
- protocol transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- Solidity modified: **no**
- frozen protocol SDK modified: **no**
- frozen evidence modified: **no**
- source repair applied in this checkpoint: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C5 — RPC log-range compatibility repair — STATIC PASS

The live-discovery RPC compatibility failure from F7-B2B2C4 was repaired with one narrowly scoped
frontend change.

Repair:

- `AUTOPILOT_EVENT_SCAN_CHUNK_BLOCKS` changed from `5_000n` to `1_000n`
- the existing inclusive range calculation remains `fromBlock + chunk - 1`
- therefore each `eth_getLogs` request covers at most exactly `1000` blocks
- no discovery architecture, contract, SDK, or evidence logic was changed

Preserved discovery architecture:

- latest Sepolia block is pinned before scanning
- owner `nextPlanNonce` is read at the pinned snapshot block
- owner-indexed `PlanCreated` logs are scanned in bounded chunks
- complete sequential owner-event history is validated
- each event is reconciled against live `planMetadata` at the same pinned block
- the pinned block hash is confirmed after scanning to detect snapshot movement/reorg
- discovery remains explicit-only
- funding remains explicit-only

Static validation after the repair:

- Prettier: **PASS**
- Autopilot unit tests: **9/9 PASS**
- TypeScript: **PASS**
- ESLint: **PASS**
- Next.js 16.3.4 production build: **PASS**
- discovery architecture preservation assertions: **PASS**
- explicit discovery-only assertion: **PASS**
- explicit funding-only assertion: **PASS**
- frozen Solidity boundary: **unchanged**
- frozen protocol SDK boundary: **unchanged**
- frozen evidence boundary: **unchanged**

Frozen frontend hashes after the repair:

- `apps/web/components/action-sheet.tsx`:
  `57660dd4898ee20beeded797ce17a5daed228dd3f3bdd27626ff0753486584ea`
- `apps/web/lib/autopilot.ts`: `44a1a9cbfceb541d930e0cde038d62f15547a26162e5d3495eb0ad1fdb74e379`
- `apps/web/lib/autopilot.test.ts`:
  `90880c6303a5ebbfed263f2b596fe54a28ed82c4b8ec4fc9b5c375e74f532470`

Execution boundary:

- the old production runtime was stopped before this source repair
- the repaired production runtime has not yet been started
- live discovery has not yet been retried
- no Autopilot funding transaction was sent
- no wallet signature was requested
- no private value was decrypted

Safety result:

- discovery retries performed during this repair: **0**
- browser RPC event scans executed by this repair gate: **0**
- Autopilot funding transactions sent: **0**
- protocol transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- Solidity modified: **no**
- frozen protocol SDK modified: **no**
- frozen evidence modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C6 — repaired production runtime preparation — PASS

A fresh production runtime was started from the statically validated F7-B2B2C5 RPC-range repair
before retrying live Autopilot discovery.

Runtime verification:

- Next.js runtime: `16.3.4`
- production URL: `http://127.0.0.1:3177`
- `/`: **HTTP 200**
- `/app`: **HTTP 200**
- `/api/auth/session`: **HTTP 200**
- cookieless session response remained `{ "authenticated": false }`
- fresh production listener successfully established

Repaired discovery source active in this build:

- `AUTOPILOT_EVENT_SCAN_CHUNK_BLOCKS = 1_000n`
- each inclusive `eth_getLogs` request is therefore capped at 1000 blocks
- frozen action-sheet hash: `57660dd4898ee20beeded797ce17a5daed228dd3f3bdd27626ff0753486584ea`

Execution boundary:

- live Autopilot discovery has not yet been retried
- no browser event scan was executed by this runtime-preparation gate
- no Autopilot funding transaction was sent
- no wallet signature was requested
- no private value was decrypted

Safety result:

- discovery retries performed: **0**
- browser RPC event scans executed by this gate: **0**
- Autopilot funding transactions sent: **0**
- protocol transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- source files modified by this runtime gate: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C7 — repaired-runtime browser session continuity — PASS

After the repaired production runtime was started, the existing browser `/app` session was
hard-refreshed before retrying live Autopilot discovery.

Observed browser state:

- authenticated workspace rendered successfully
- heading `Your private account is ready.` was visible
- Sepolia remained the selected network
- account chip displayed `0x1f87…5024`, consistent with the expected owner wallet
- no sign-in gate was visible
- no visible session/wallet mismatch warning appeared
- private savings remained hidden and marked `Never auto-decrypted`
- Autopilot next window remained `Not loaded`
- Autopilot plan state remained `Not loaded`

Execution boundary:

- repaired `Discover my live plans` retry had not yet been executed
- `New saving pot` had not yet been opened during this checkpoint
- no funding plan had been selected
- no funding amount had been entered
- no wallet signature prompt was visible
- no transaction approval prompt was visible
- no encryption or decryption prompt was visible

Safety result:

- discovery retries performed after the RPC repair: **0**
- browser RPC event scans executed by this checkpoint: **0**
- Autopilot funding transactions sent: **0**
- protocol transactions sent: **0**
- wallet signatures requested by this checkpoint: **0**
- decryptions requested by this checkpoint: **0**
- source files modified: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C8 — repaired live Autopilot discovery — PASS

The repaired browser Autopilot discovery flow was explicitly executed once against live Ethereum
Sepolia after reducing the bounded `eth_getLogs` scan range to 1000 blocks.

Runtime result:

- live discovery completed successfully
- the prior RPC block-range failure did not recur
- discovery snapshot block: `11632210`
- owner plans returned: `1`
- private values remained `Not decrypted`
- one owner plan was reconciled and rendered
- visible plan identifier: `0x2c9d9797...cac4c534`
- live plan state: `COMPLETED`
- owner plan nonce: `0`
- next window index: `1/1`
- the UI reported that public schedule proofs are not stored in this browser
- the UI correctly reported that `REVOKED` and `COMPLETED` plans cannot receive new funding

RPC compatibility result:

- `AUTOPILOT_EVENT_SCAN_CHUNK_BLOCKS = 1_000n` is now live-runtime validated
- the repaired scanner successfully traversed the required bounded owner-event history
- canonical owner-plan discovery completed without repeating the previous provider range-limit
  failure

Funding boundary:

- the discovered plan is terminal (`COMPLETED`)
- no attempt was made to fund the completed plan
- no plan was selected for funding
- no funding amount was entered
- no funding review or approval flow was entered

Confidentiality and signing boundary:

- private values remained hidden
- no private amount was decrypted
- no wallet signature prompt appeared
- no transaction approval prompt appeared
- no Autopilot funding transaction was intentionally initiated

Safety result:

- repaired live discovery retries performed: **1**
- repaired live discovery result: **PASS**
- accepted owner plans returned: **1**
- terminal completed plans returned: **1**
- Autopilot funding transactions sent: **0**
- protocol transactions intentionally initiated: **0**
- wallet signatures intentionally requested: **0**
- decryptions intentionally requested: **0**
- Solidity modified: **no**
- frozen protocol SDK modified: **no**
- frozen evidence modified: **no**
- source files modified by this runtime checkpoint: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C9 — Autopilot creation post-mine safety audit — HAZARD CONFIRMED

A read-only source audit was performed on the Autopilot plan-creation callback before creating
another live plan.

Confirmed safe behavior already present:

- the plan-creation receipt is awaited and a reverted receipt fails closed
- after a successful receipt, transaction state is changed to `included` before live reconciliation
- live Vault metadata reconciliation failures are converted to post-mine warnings
- public schedule-proof persistence failures are converted to post-mine warnings
- both warning paths explicitly tell the user not to recreate or automatically resubmit the mined
  plan
- the final successful transaction label is `Autopilot plan created — funding has not been sent`

Confirmed remaining hazard:

- after the final mined-success state is established, `await refreshParticipant()` still runs
  directly inside the outer transaction `try`
- if that refresh rejects, execution falls into the outer generic `catch`
- the outer generic `catch` can therefore replace an already-mined successful plan creation with
  `kind: error`
- this could misrepresent a mined transaction as failed and is not acceptable before live
  plan-creation E2E

Required repair boundary:

- the already-mined plan creation must remain represented as included/successful
- participant refresh failure after mining must become warning-only
- the warning must state that the transaction was mined and must not be automatically resubmitted
- the repair must not alter transaction arguments, encryption, Solidity, SDK logic, schedule
  construction, or plan-ID derivation

Scope control:

- this gate is audit/documentation only
- no source repair was applied
- no live plan was created
- no transaction was sent
- no wallet signature was requested
- no private value was decrypted
- no commit was created
- no push was performed

## F7-B2B2C10 — Autopilot creation post-mine refresh repair — STATIC PASS

The Autopilot creation callback was repaired so a participant-state refresh failure after a
successfully mined plan creation cannot overwrite the mined transaction state with a generic error.

Repair:

- the final post-mine `refreshParticipant()` call is now isolated in its own `try`/`catch`
- participant refresh failure is converted into a warning through `setPlanPersistenceWarning`
- the warning explicitly states that the plan transaction was mined
- the warning explicitly states that the mined plan must not be automatically resubmitted
- the already-established `included` transaction state remains intact
- the outer generic transaction `catch` remains unchanged for failures that occur before successful
  completion of the mined-success path

Scope:

- only the Autopilot creation post-mine refresh path was repaired
- registration reservation refresh behavior was not changed
- confidential deposit refresh behavior was not changed
- confidential withdrawal refresh behavior was not changed
- funding behavior was not changed
- transaction arguments were not changed
- encryption behavior was not changed
- schedule construction was not changed
- plan-ID derivation was not changed
- Solidity was not changed
- frozen protocol SDK was not changed
- frozen evidence was not changed

Validation:

- creation post-mine warning-only assertion: **PASS**
- creation-only scope assertion: **PASS**
- Autopilot unit tests: **9/9 PASS**
- TypeScript: **PASS**
- ESLint: **PASS**
- Next.js 16.3.4 production build: **PASS**
- creation post-mine safety sentinels: **PASS**
- RPC discovery scan repair (`1000` blocks): **preserved**
- frozen protocol boundary: **PASS**
- diff integrity: **PASS**

Frozen frontend hashes after this repair:

- `apps/web/components/action-sheet.tsx`:
  `ab2bba1ae101c65c1625ca225b786fd1f36a68041acd6f0cfbf956cb4c345587`
- `apps/web/lib/autopilot.ts`: `44a1a9cbfceb541d930e0cde038d62f15547a26162e5d3495eb0ad1fdb74e379`
- `apps/web/lib/autopilot.test.ts`:
  `90880c6303a5ebbfed263f2b596fe54a28ed82c4b8ec4fc9b5c375e74f532470`

Execution boundary:

- production runtime remains stopped
- no live plan was created
- no transaction was sent
- no wallet signature was requested
- no private value was decrypted
- no commit was created
- no push was performed

## F7-B2B2C11 — post-mine-repaired production runtime preparation — PASS

A fresh Next.js production runtime was started from the statically validated Autopilot creation
post-mine safety repair.

Runtime verification:

- Next.js runtime: `16.3.4`
- production URL: `http://127.0.0.1:3177`
- `/`: **HTTP 200**
- `/app`: **HTTP 200**
- `/api/auth/session`: **HTTP 200**
- cookieless session response remained `{ "authenticated": false }`
- a `next-server` listener was successfully established on port `3177`

Exact repaired frontend active in this build:

- frozen action-sheet hash: `ab2bba1ae101c65c1625ca225b786fd1f36a68041acd6f0cfbf956cb4c345587`
- Autopilot discovery chunk remains `1000` blocks
- creation post-mine participant refresh remains isolated as warning-only
- a participant-refresh failure after successful plan mining cannot replace the mined create state
  with a generic transaction error

Execution boundary:

- browser plan creation has not yet been attempted on this runtime
- no new ACTIVE Autopilot plan was created
- no Autopilot funding was attempted
- no wallet signature was requested
- no transaction was sent
- no private value was decrypted

Safety result:

- plans created by this gate: **0**
- Autopilot funding transactions sent: **0**
- protocol transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- source files modified by this runtime gate: **0**
- Solidity modified: **no**
- frozen protocol SDK modified: **no**
- frozen evidence modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C12 — post-mine-repaired browser session continuity — PASS

The browser `/app` page was hard-refreshed against the F7-B2B2C11 production runtime before opening
the Autopilot plan-creation flow.

Observed browser state:

- authenticated workspace rendered successfully
- heading `Your private account is ready.` was visible
- Sepolia remained selected
- account chip displayed `0x1f87…5024`, consistent with the expected owner wallet
- no sign-in gate was visible
- no visible session/wallet mismatch warning appeared
- private savings remained hidden
- Autopilot next window remained `Not loaded`
- Autopilot plan state remained `Not loaded`

Execution boundary:

- `New saving pot` had not yet been opened
- Autopilot plan creation had not been started
- no plan was created
- no funding was attempted
- no wallet signature prompt appeared
- no transaction approval prompt appeared
- no encryption or decryption prompt appeared

Safety result:

- plans created: **0**
- Autopilot funding transactions sent: **0**
- protocol transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- source files modified: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C13 — Autopilot create-plan default browser view — PASS

The Autopilot `Create plan` action sheet was opened on the post-mine-repaired production runtime
without changing fields or entering review.

Observed untouched browser values:

- mode: `Create plan`
- pot name: `Emergency fund`
- contribution amount: `25.00 cUSDTMock`
- cadence: `Weekly`
- weekday: `Friday`
- start time: `08:00 UTC`
- execution window: `2` hours
- number of contributions: `12`
- lifetime authorization cap: not entered; UI displayed `Optional until final review`
- `Review plan` control was visible

Execution boundary:

- no field was intentionally changed
- `Review plan` was not clicked
- no create-plan review was entered
- no encryption was initiated
- no wallet signature prompt appeared
- no transaction approval prompt appeared
- no plan was created
- no funding was attempted
- no private value was decrypted

Safety result:

- plans created: **0**
- transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- source files modified: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C14 — exact live E2E Autopilot plan values staged — PASS

The fresh Autopilot live-E2E plan fields were populated in the browser on the repaired production
runtime, but the review step was not entered.

Exact staged values:

- pot name: `Autopilot live E2E`
- confidential contribution amount: `1.00 cUSDTMock`
- cadence: `Weekly`
- weekday: `Friday`
- start time: `10:00 UTC`
- execution window: `12` hours
- number of contributions: `2`
- lifetime authorization cap: `2.00 cUSDTMock`

Intended E2E properties:

- two weekly execution windows are requested
- the authorization cap equals two contributions of `1.00 cUSDTMock`
- successful execution of the first window alone should not exhaust the configured execution count

Execution boundary:

- `Review plan` had not yet been clicked
- no schedule review was entered
- no plan-creation encryption was initiated
- no wallet signature prompt appeared
- no transaction approval prompt appeared
- no plan-creation transaction was sent
- no plan was created
- no funding was attempted
- no private value was decrypted

Safety result:

- plans created: **0**
- transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- source files modified: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C15 — Autopilot create review blocked by participant state — PASS

The exact staged Autopilot live-E2E policy was advanced to the browser review screen, but no
creation attempt was made because the live participant status rendered as `Not registered`.

Reviewed policy:

- pot: `Autopilot live E2E`
- contribution: `1.00 cUSDTMock`
- schedule: `weekly · Friday · 10:00 UTC`
- execution window: `12 hour(s)`
- contributions: `2`
- lifetime cap: `2.00 cUSDTMock`
- network: `Ethereum Sepolia`

Review-screen protocol preparation notice:

- the UI states that Veilpot will read the live owner plan nonce
- the UI states that the frozen plan ID will be derived
- the UI states that the deterministic SDK Merkle schedule will be built
- the UI states that the period amount and lifetime cap will be encrypted under one shared proof
- the UI states that wallet approval is requested only for the exact creation call
- schedule times are committed in UTC

Blocking live state:

- participant status rendered as `Not registered`
- `Create Autopilot plan` rendered locked/disabled
- no attempt was made to bypass the participant requirement

Execution boundary:

- the create button was not activated
- no plan-creation encryption was initiated
- no wallet signature prompt appeared
- no transaction approval prompt appeared
- no plan-creation transaction was sent
- no plan was created
- no funding was attempted
- no private value was decrypted

Safety result:

- plans created: **0**
- transactions sent: **0**
- wallet signatures requested: **0**
- decryptions requested: **0**
- source files modified: **0**
- commit created: **no**
- push performed: **no**

## F7-B2B2C16 — participant registration and recovery audit — PASS

A read-only audit established the exact frozen participant registration, activation,
refund-recovery, and frontend discovery semantics before any new registration transaction.

Exact participant lifecycle ordinals:

- `FREE = 0`
- `RESERVED = 1`
- `PENDING_ACTIVATION = 2`
- `ACTIVE = 3`
- `PENDING_REFUND = 4`
- `REFUND_ATTEMPT_PENDING_PROOF = 5`
- `TOMBSTONED = 6`

Registration bond:

- frozen SDK: `1000000000000000 wei`
- frozen Pool: `1000000000000000 wei`
- human value: `0.001 ETH`
- the registration bond is refundable through the contract-defined release/credit paths

Frontend current-participant semantics:

- the frontend scans `MAX_PARTICIPANTS`
- it reads `participantState(slotIndex)`
- it excludes `FREE` and `TOMBSTONED` slots from current-live ownership matching
- it reads `participantMetadata(slotIndex)` for remaining occupied slots
- it displays `Not registered` when no current live owner match is found
- therefore the UI label `Not registered` must not be interpreted as a specific chain ordinal
  without a direct state probe

Registration path:

- first write: `reserveParticipantSlot` with the exact refundable bond
- deposit is only valid while the participant is `RESERVED`
- the direct confidential deposit requires the live `reservationNonce`
- the direct confidential deposit requires the live `nextDepositNonce(owner)`
- the Pool must have a short-lived confidential-token operator permission before the direct deposit
- successful deposit inclusion moves the lifecycle to `PENDING_ACTIVATION`, not immediately to
  `ACTIVE`
- Autopilot requires the exact participant state `ACTIVE`

Recovery/liveness paths confirmed:

- expired unused reservations have `expireReservation(slotIndex)`
- expired pending activations have `expirePendingActivation(slotIndex)`
- refund progress uses `refundAttemptNonce` and confidential refund-completion state
- public `pendingBondRefund(owner)` is available for bond-credit accounting

Execution boundary:

- audit used source/static inspection only
- no live direct Sepolia participant-state probe has yet been executed after this audit
- no source file was modified
- no plan was created
- no transaction was sent
- no wallet signature was requested
- no encryption was requested
- no decryption was requested
- no commit was created
- no push was performed

## F7-B2B2C17 — direct Sepolia participant probe rate-limit failure — FAILED CLOSED

A direct pinned-block read-only Sepolia participant-state probe was attempted using the public
Thirdweb Sepolia RPC endpoint.

Probe design:

- expected chain ID: `11155111`
- Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- owner: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- no wallet connector was used
- no signer was used
- no transaction path existed in the probe
- no encryption or decryption path existed in the probe
- reads were intended to be pinned to one Sepolia block

Observed failure:

- RPC endpoint returned `HTTP 429`
- provider reported strict public-good RPC rate limits
- failure occurred during `participantState(37)`
- the direct participant probe terminated before completing the full participant-slot scan
- the probe result is therefore incomplete and is not accepted as authoritative chain state

Fail-closed handling:

- no participant-state ordinal is inferred from the partial result
- the browser label `Not registered` remains insufficient to infer a specific chain ordinal
- no registration transaction is authorized from this failed probe
- no reservation transaction is authorized from this failed probe
- no deposit transaction is authorized from this failed probe
- no Autopilot creation transaction is authorized from this failed probe

Cleanup:

- the aborted ephemeral probe file was confirmed present after the `set -e` abort
- only that ephemeral probe file was removed
- source hashes remained unchanged
- the validation ledger remained unchanged before this documentation gate
- the production runtime remained running

Required retry strategy:

- do not repeat the high-request sequential slot scan against the same public endpoint
- retry must materially reduce RPC request volume
- pinned-block consistency must remain enforced
- the retry must remain read-only and signer-free
- no chain-state conclusion is permitted until the reduced-request probe completes

Safety result:

- direct participant probe completed: **no**
- participant chain state accepted: **no**
- RPC retries performed after failure: **0**
- transactions sent: **0**
- wallet signatures requested: **0**
- encryptions requested: **0**
- decryptions requested: **0**
- source files modified: **0**
- plan created: **no**
- Autopilot funding sent: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C18 — reduced-request pinned Sepolia participant probe — PASS

The replacement participant-state probe completed successfully using a low-request Multicall
strategy against one pinned Ethereum Sepolia block.

Pinned snapshot:

- chain ID: `11155111`
- block: `11632440`
- block hash: `0xac868908d3d044d3c65ca4d14354ba6f2821577eb4a2c86efb8fb92a71294276`
- Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- owner: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- Multicall3: `0xca11bde05977b3631167028862be2a173976ca11`
- pinned block hash was re-read and confirmed unchanged before accepting the result

Pool-wide participant state:

- maximum participants: `128`
- `FREE`: `127`
- `RESERVED`: `0`
- `PENDING_ACTIVATION`: `0`
- `ACTIVE`: `0`
- `PENDING_REFUND`: `0`
- `REFUND_ATTEMPT_PENDING_PROOF`: `0`
- `TOMBSTONED`: `1`
- live occupied slots: `0`
- active participant count: `0`

Connected-owner result:

- current live participant found: **no**
- current live slot index: **none**
- current live participant state: **none**
- therefore the browser `Not registered` result agrees with this pinned live-chain snapshot
- the single TOMBSTONED slot was not treated as a current live registration and no historical-owner
  inference is made from it

Registration prerequisites observed at the same pinned block:

- SDK registration bond: `1000000000000000 wei`
- on-chain registration bond: `1000000000000000 wei`
- registration bond: `0.001 ETH`
- next reservation nonce: `2`
- owner next deposit nonce: `2`
- owner pending bond refund: `0 wei`
- owner ETH balance: `134549818093191704 wei`
- owner ETH balance: `0.134549818093191704 ETH`

Probe integrity:

- read strategy: low-volume Multicall
- probe was read-only
- no signer was used
- no wallet connector was used by the probe
- no transaction path existed
- no encryption was requested
- no decryption was requested
- ephemeral probe file was removed after execution
- source and validation ledger were preserved before this documentation gate

Authorization boundary:

- this checkpoint establishes current live state only
- it does not authorize `reserveParticipantSlot`
- it does not authorize the confidential-token operator grant
- it does not authorize a registration deposit
- it does not authorize Autopilot plan creation
- the reservation write path still requires separate post-mine reconciliation safety review before
  any signature

Safety result:

- direct participant probe completed: **yes**
- participant chain state accepted: **yes**
- current live participant exists: **no**
- transactions sent: **0**
- wallet signatures requested: **0**
- encryptions requested: **0**
- decryptions requested: **0**
- source files modified: **0**
- plan created: **no**
- Autopilot funding sent: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C19A — reservation post-mine refresh repair — PASS

The registration-reservation frontend write path was repaired so a successfully mined
`reserveParticipantSlot` transaction cannot be converted into an ordinary error merely because the
subsequent participant-state refresh fails.

Repair scope:

- modified file: `apps/web/components/action-sheet.tsx`
- new action-sheet SHA-256: `f97d0bb0a3c7cff3e882478d5f5d463558257c90de48b2b7192e2351d8501577`
- frozen Solidity was not modified
- frozen protocol SDK was not modified
- Autopilot source helper and test files were not modified
- registration transaction construction remains `buildReserveParticipantSlotCall()`
- the existing receipt-success requirement remains intact

Post-mine behavior:

- successful reservation receipt first persists transaction state as `included`
- participant refresh then runs inside its own warning-only `try/catch`
- refresh failure preserves the mined transaction hash
- refresh failure remains `included` rather than becoming a generic transaction error
- the UI warning explicitly says `Do not resubmit it automatically.`
- pre-mine and reverted-transaction failures continue through the existing outer error path

Regression boundary:

- the existing Autopilot creation post-mine warning repair remains present
- total `refreshParticipant()` call sites remain `4`
- deposit and withdrawal post-mine paths were intentionally not changed in this gate

Validation:

- Prettier: **PASS**
- Autopilot unit tests: **PASS**
- TypeScript: **PASS**
- ESLint for `action-sheet.tsx`: **PASS**
- frozen contract/SDK/evidence boundary: **PASS**

Runtime boundary:

- the currently running production server was not restarted in this source-repair gate
- therefore runtime validation of this exact repaired source remains pending
- no registration write is authorized until a fresh production build/runtime validates this source

Safety result:

- transactions sent: **0**
- wallet signatures requested: **0**
- encryptions requested: **0**
- decryptions requested: **0**
- registration write authorized: **no**
- plan created: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C19B — repaired production build and fresh runtime — PASS

The exact F7-B2B2C19A reservation post-mine repair was production-built and started in a fresh local
Next.js production runtime.

Exact source identity:

- `apps/web/components/action-sheet.tsx` SHA-256:
  `f97d0bb0a3c7cff3e882478d5f5d463558257c90de48b2b7192e2351d8501577`
- Autopilot helper SHA-256 remained
  `44a1a9cbfceb541d930e0cde038d62f15547a26162e5d3495eb0ad1fdb74e379`
- Autopilot test SHA-256 remained `90880c6303a5ebbfed263f2b596fe54a28ed82c4b8ec4fc9b5c375e74f532470`

Production validation:

- Next.js production build: **PASS**
- old port `3177` runtime was stopped by exact PID only
- fresh start PID: `33103`
- fresh listener PID: `33110`
- fresh runtime log: `/tmp/veilpot-f7-b2b2c19b-runtime.log`
- fresh listener identified as `next-server`

HTTP smoke:

- `/`: `200`
- `/app`: `200`
- `/api/auth/session`: `200`
- cookieless session remained `{ authenticated: false }`

Integrity:

- repaired action-sheet source hash survived build and runtime start unchanged
- frozen Solidity was not modified
- frozen protocol SDK was not modified
- frozen evidence was not modified
- `git diff --check`: **PASS**

Authorization boundary:

- this runtime gate does not authorize `reserveParticipantSlot`
- browser continuity on this fresh runtime remains to be confirmed before any wallet transaction
  review
- no registration transaction was sent
- no wallet signature was requested
- no encryption was requested
- no decryption was requested
- no plan was created
- no commit was created
- no push was performed

## F7-B2B2C19C — repaired-runtime browser continuity — PASS

The browser was reopened on the exact F7-B2B2C19B production runtime and the Private Deposit action
was inspected without initiating any wallet write.

Observed browser state:

- application URL: `http://127.0.0.1:3177/app`
- authenticated workspace remained available
- connected wallet displayed `0x1f87…5024`
- network displayed `Ethereum Sepolia`
- participant displayed `Not registered`
- Private Deposit exposed the first registration step
- reservation control displayed `Reserve slot · 0.001 ETH`

Chain-state consistency:

- the browser `Not registered` state agrees with the previously accepted pinned Sepolia participant
  probe
- no current live participant was inferred beyond that accepted pinned-state evidence

Safety boundary:

- `Reserve slot · 0.001 ETH` was not clicked
- no wallet transaction review was opened
- no wallet signature was requested
- no transaction was submitted
- no encryption was requested
- no decryption was requested
- no Autopilot plan was created
- registration write remains unauthorized until the exact reservation transaction is separately
  reviewed

## F7-B2B2C20A — exact reservation transaction review — PASS

The exact participant-reservation transaction was independently derived from the frozen protocol SDK
and reviewed against a fresh pinned Ethereum Sepolia state before any wallet signing authorization.

Exact reviewed transaction:

- chain: `Ethereum Sepolia`
- chain ID: `11155111`
- sender: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- target Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- function: `reserveParticipantSlot`
- arguments: `0`
- calldata: `0xd4936cd6`
- selector: `0xd4936cd6`
- value: `1000000000000000 wei`
- value: `0.001 ETH`

SDK identity checks:

- `buildReserveParticipantSlotCall()` produced the exact frozen Pool target
- descriptor function was exactly `reserveParticipantSlot`
- descriptor contained zero arguments
- descriptor value exactly matched the frozen SDK registration bond
- on-chain `REGISTRATION_BOND_WEI` exactly matched the SDK value

Pinned pre-sign state:

- snapshot block: `11632514`
- snapshot hash: `0x73552a7c06e779fbc7c6a2c0015b4994bf517d27adece5648235cf2405547fcc`
- maximum participants: `128`
- `FREE`: `127`
- `RESERVED`: `0`
- `PENDING_ACTIVATION`: `0`
- `ACTIVE`: `0`
- `PENDING_REFUND`: `0`
- `REFUND_ATTEMPT_PENDING_PROOF`: `0`
- `TOMBSTONED`: `1`
- live occupied slots: `0`
- current live participant for the owner: **no**
- active participant count: `0`
- next reservation nonce: `2`
- owner next deposit nonce: `2`
- owner pending bond refund: `0 wei`
- owner ETH balance: `134549818093191704 wei`
- owner ETH balance: `0.134549818093191704 ETH`

Simulation:

- the exact `reserveParticipantSlot()` descriptor was simulated with `eth_call`
- simulated sender was the intended owner
- simulated target remained the frozen Pool
- simulated value remained exactly `0.001 ETH`
- simulation result: **PASS**
- pinned block hash was re-read and confirmed unchanged before accepting the result

Execution boundary:

- review probe was read-only
- no signer was used
- no wallet connector was used by the review probe
- no reservation button was clicked
- no transaction was submitted
- no wallet signature was requested
- no encryption was requested
- no decryption was requested
- ephemeral review probe was removed

Authorization boundary:

- this checkpoint does not itself grant signing authorization
- `Reserve slot · 0.001 ETH` remains unclicked
- state must be freshly revalidated immediately before the separate signing gate
- only the exact reviewed Pool/function/value transaction may later be authorized
- any wallet review showing a different chain, target, value, or effective call must be rejected

Safety result:

- transaction review: **PASS**
- `eth_call` simulation: **PASS**
- signing authorization granted: **no**
- transactions sent: **0**
- wallet signatures requested: **0**
- encryptions requested: **0**
- decryptions requested: **0**
- source modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C20B — immediate reservation pre-sign revalidation — PASS

Immediately before any wallet interaction, the exact previously reviewed participant-reservation
transaction was re-derived from the frozen SDK and simulated again against a fresh pinned Ethereum
Sepolia block.

Exact transaction identity:

- chain ID: `11155111`
- Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- function: `reserveParticipantSlot`
- arguments: `0`
- calldata: `0xd4936cd6`
- value: `1000000000000000 wei`
- value: `0.001 ETH`

Fresh pinned state:

- snapshot block: `11632529`
- snapshot hash: `0x19075058022300f5ae38686ea7e799b38703e3050c746714e330a4752518d638`
- maximum participants: `128`
- on-chain registration bond: `1000000000000000 wei`
- next reservation nonce: `2`
- owner next deposit nonce: `2`
- owner pending bond refund: `0 wei`
- active participant count: `0`
- owner ETH balance: `134549818093191704 wei`
- owner ETH balance: `0.134549818093191704 ETH`

Pre-sign simulation:

- exact descriptor identity revalidation: **PASS**
- fresh exact `reserveParticipantSlot()` simulation: **PASS**
- simulated target remained the frozen Pool
- simulated function remained `reserveParticipantSlot`
- simulated value remained exactly `0.001 ETH`
- pinned block hash was re-read and confirmed unchanged

Safety boundary:

- no wallet prompt was opened
- no reservation button was clicked
- no signing authorization was granted during this probe
- no transaction was submitted
- no wallet signature was requested
- no encryption was requested
- no decryption was requested
- source, ledger, and production runtime were preserved during the probe

Next gate:

- only after this checkpoint is preserved may the browser reservation button be used to open the
  wallet review
- opening wallet review is not authorization to confirm/sign
- the wallet review must be inspected before signature
- any mismatch in chain, target, value, or transaction purpose must be rejected

## F7-B2B2C20C-R1 — reservation nonce semantics audit — PASS

The first post-reservation forensic probe failed closed on a verifier assumption that the newly
emitted reservation nonce should equal the pre-transaction `nextReservationNonce` value. A static
audit of the exact frozen Pool source proved that assumption incorrect.

Frozen source identity:

- `packages/contracts/contracts/VeilpotPool.sol` SHA-256:
  `bd06e4f9217ffa6d584a518cb93ae0504221c760e4c6f17656d114262a82710e`
- `packages/protocol-sdk/src/calls.ts` SHA-256:
  `014cc29963259159619a6bd84cbf3e7e07d6734b6f1e8ccb212fce8ffe9f6c71`

Exact Solidity semantics:

- reservation executes `uint256 nonce = ++nextReservationNonce;`
- the operation is a prefix increment
- `candidate.reservationNonce` is assigned that incremented `nonce`
- `ParticipantReserved` emits that same incremented `nonce`
- therefore a pre-transaction `nextReservationNonce` value of `2` legitimately produces reservation
  nonce `3`

Interpretation of F7-B2B2C20C:

- the forensic probe found a new `ParticipantReserved` event before reaching its nonce assertion
- its slot-`1` assertion had already passed
- the probe then failed because it incorrectly expected event reservation nonce `2`
- observed reservation nonce `3` is consistent with the frozen contract implementation
- the nonce mismatch is a forensic-verifier defect, not evidence by itself of a duplicate
  reservation
- F7-B2B2C20C remains incomplete because transaction hash, calldata, value, receipt, and final
  current state were not reached after the failed assertion

Required correction:

- corrected forensics must expect post-reservation nonce `3` when the accepted pre-sign counter was
  `2`
- corrected forensics must independently verify the actual mined transaction target, calldata, ETH
  value, sender, receipt status, event identity, and current RESERVED state
- reservation must not be retried
- operator approval remains unauthorized until corrected forensics completes

Safety boundary:

- source audit was static and read-only
- RPC requests: `0`
- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- source modified: **no**
- reservation retry authorized: **no**
- operator approval authorized: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C20C-R2 — corrected mined reservation forensics — PASS

Corrected read-only forensics recovered and independently verified the participant reservation
transaction that had already been mined through the browser flow.

Exact mined transaction:

- transaction hash: `0xc3f2a8c822561c44ddac5811431837c3c956038a240b2b51c11afe1b6185b153`
- Ethereum account nonce: `516`
- chain ID: `11155111`
- sender: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- target Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- function selector / calldata: `0xd4936cd6`
- value: `1000000000000000 wei`
- value: `0.001 ETH`
- receipt status: `success`

Canonical reservation event:

- reservation block: `11632541`
- reservation block hash: `0xbb20b25b435248befeed06dfc88ac9f998d557055504ad5da7ab9421105ae0f7`
- reservation block time: `2026-09-04T09:17:36.000Z`
- participant: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- slot: `1`
- reservation nonce: `3`
- registration version: `1`
- reservation expiry: `2026-09-05T09:17:36.000Z`

Corrected nonce interpretation:

- accepted pre-reservation `nextReservationNonce` was `2`
- frozen Pool uses prefix increment `++nextReservationNonce`
- emitted and stored reservation nonce `3` is therefore correct
- the earlier nonce-`2` forensic expectation was a verifier defect, not a protocol fault

Current pinned state after mining:

- forensic snapshot block: `11632582`
- forensic snapshot hash: `0x46bd5addea860bfe667d55a8ebd3cb84eaa31ea19aa2c6e58ae404f722fb4dc0`
- forensic snapshot time: `2026-09-04T09:26:12.000Z`
- participant state ordinal: `1`
- participant state: `RESERVED`
- current `nextReservationNonce`: `3`
- owner next deposit nonce: `2`
- pending bond refund: `0 wei`
- active participant count: `0`
- Pool ETH balance: `1000000000000000 wei`
- Pool ETH balance: `0.001 ETH`
- owner ETH balance: `0.133013323550683676 ETH`
- reservation was still unexpired at the accepted forensic snapshot

Transaction identity result:

- sender matched the intended owner: **PASS**
- target matched the frozen Pool: **PASS**
- calldata matched the reviewed `reserveParticipantSlot()` call: **PASS**
- ETH value matched the exact registration bond: **PASS**
- receipt succeeded: **PASS**
- event and receipt transaction/block identities matched: **PASS**
- current state remained `RESERVED`: **PASS**
- pinned forensic block was reconfirmed unchanged: **PASS**

Safety boundary:

- the reservation transaction is already mined and must not be retried
- reservation retry authorized: **no**
- operator approval authorized: **no**
- the operator-approval frontend path still requires its separate post-mine reconciliation safety
  repair before any approval signature
- no new transaction was sent by the forensic probe
- no wallet signature was requested by the forensic probe
- no encryption was requested
- no decryption was requested
- frozen Solidity, SDK, evidence, frontend source, and production runtime were preserved
- commit created: **no**
- push performed: **no**

## F7-B2B2C21A — operator-approval post-mine refresh repair — PASS

The confidential-token Pool operator-approval frontend path was repaired so a successfully included
operator transaction cannot be converted into an ordinary error solely because the subsequent
operator-status refetch fails.

Repair scope:

- modified file: `apps/web/components/action-sheet.tsx`
- new action-sheet SHA-256: `b7aa5f5b4af258a886589dfba5e309cf193e4329c3039a919bc0f6f4801d77b9`
- only the post-inclusion `operatorQuery.refetch()` handling inside `approvePoolOperator` was
  changed
- frozen Solidity was not modified
- frozen protocol SDK was not modified
- frozen evidence was not modified

Post-mine behavior:

- the operator mutation result and mined transaction hash remain preserved
- operator-status refetch now executes inside its own warning-only `try/catch`
- a refetch failure preserves transaction state as `included`
- the mined transaction hash remains `result.txHash`
- the warning explicitly says `Do not resubmit it automatically.`
- failures before a successful operator transaction remain handled by the existing outer error path

Regression boundary:

- the reservation post-mine refresh repair remains present
- the Autopilot creation post-mine refresh repair remains present
- total `refreshParticipant()` call sites remain `4`
- registration-deposit and withdrawal post-mine refresh paths were intentionally not changed in this
  gate

Validation:

- Prettier: **PASS**
- Autopilot unit tests: **PASS**
- TypeScript: **PASS**
- ESLint for `action-sheet.tsx`: **PASS**
- frozen Solidity/SDK/evidence boundary: **PASS**

Runtime boundary:

- the current production runtime was not rebuilt or restarted in this source-repair gate
- runtime validation of this exact new action-sheet source therefore remains pending
- operator approval remains unauthorized until a fresh production build/runtime validates this exact
  repair

Registration boundary:

- the already-mined reservation transaction remains canonical and must not be retried
- current registration progression remains at the operator-approval stage
- this checkpoint does not authorize clicking `Approve Pool for 30 minutes`

Safety result:

- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- operator approval authorized: **no**
- reservation retry authorized: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C21B — operator-repaired production build and fresh runtime — PASS

The exact F7-B2B2C21A operator post-mine reconciliation repair was production-built and started in a
fresh local Next.js production runtime.

Exact source identity:

- `apps/web/components/action-sheet.tsx` SHA-256:
  `b7aa5f5b4af258a886589dfba5e309cf193e4329c3039a919bc0f6f4801d77b9`
- frozen Solidity, protocol SDK, and evidence remained unchanged

Production validation:

- Next.js production build: **PASS**
- prior port `3177` runtime was stopped by exact PID
- fresh start PID: `38650`
- fresh listener PID: `38657`
- runtime log: `/tmp/veilpot-f7-b2b2c21b-runtime.log`
- fresh listener identified as `next-server`

HTTP smoke:

- `/`: `200`
- `/app`: `200`
- `/api/auth/session`: `200`
- cookieless session remained `{ authenticated: false }`

Integrity:

- repaired action-sheet hash survived build and runtime start unchanged
- `git diff --check`: **PASS**
- frozen Solidity/SDK/evidence boundary: **PASS**

Registration boundary:

- the existing mined reservation was not retried
- this runtime gate did not submit an operator approval
- browser continuity and current reservation validity still require fresh confirmation before
  operator transaction review
- operator approval remains unauthorized

Safety result:

- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- commit created: **no**
- push performed: **no**

## F7-B2B2C21C — live reservation revalidation after runtime replacement — PASS

After the operator-approval post-mine repair was production-built and started in a fresh runtime,
the existing participant reservation was revalidated directly against a fresh pinned Ethereum
Sepolia block.

Canonical reservation identity:

- transaction: `0xc3f2a8c822561c44ddac5811431837c3c956038a240b2b51c11afe1b6185b153`
- slot: `1`
- participant: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- registration version: `1`
- reservation nonce: `3`
- reservation expiry: `1788599856`
- reservation expiry UTC: `2026-09-05T09:17:36.000Z`

Fresh pinned state:

- snapshot block: `11632609`
- snapshot hash: `0x13cac1ccc17b8de437f6cd6116ab5ad6a47340186106afa1670747d4a1dc6ea0`
- snapshot time: `2026-09-04T09:31:48.000Z`
- current participant state ordinal: `1`
- current participant state: `RESERVED`
- current owner matched the intended wallet
- current registration version: `1`
- current reservation nonce: `3`
- current reservation expiry matched the canonical event
- bond held: `true`
- current `nextReservationNonce`: `3`
- owner next deposit nonce: `2`
- pending bond refund: `0 wei`
- active participant count: `0`
- Pool ETH balance: `1000000000000000 wei`
- Pool ETH balance: `0.001 ETH`
- reservation seconds remaining at snapshot: `85548`

Integrity checks:

- canonical reservation receipt remained `success`
- slot state remained exactly `RESERVED`
- owner, registration version, reservation nonce, and expiry all matched the canonical reservation
- reservation was unexpired at the accepted snapshot
- Pool still held at least the exact registration bond
- pinned snapshot block hash was reconfirmed unchanged
- source, validation ledger, and fresh production runtime were preserved during the probe

Authorization boundary:

- reservation retry authorized: **no**
- operator approval authorized: **no**
- no operator transaction has been submitted
- browser continuity on runtime PID `38657` remains to be visually confirmed before
  operator-approval transaction review
- no wallet signature was requested
- no encryption was requested
- no decryption was requested

Safety result:

- live reservation revalidation: **PASS**
- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- source modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C21D — browser continuity on operator-repaired runtime — PASS

The browser was hard-refreshed on the fresh operator-repaired production runtime and the Private
Deposit interface remained aligned with the directly revalidated Sepolia participant reservation.

Fresh browser evidence:

- URL: `http://127.0.0.1:3177/app`
- runtime listener PID: `38657`
- connected wallet displayed: `0x1f87…5024`
- network displayed: `Ethereum Sepolia`
- participant displayed: `RESERVED`
- registration displayed: `Registration slot reserved`
- slot displayed: `1`
- reservation expiry displayed: `05/09/2026, 10:17:36`
- operator action displayed: `Approve Pool for 30 minutes`
- deposit amount field displayed `25.00 cUSDTMock`, but no deposit submission occurred

Continuity with accepted chain state:

- browser participant state matched direct-chain `RESERVED`
- browser slot matched direct-chain slot `1`
- browser owner/account matched `0x1f87Ae197af539253978d435aD45cCf28Fb95024` in compact form
- browser network matched Ethereum Sepolia chain ID `11155111`
- displayed reservation expiry matched the canonical reservation expiry in local time

Authorization boundary:

- the operator button was visible but was not clicked
- no operator approval transaction was submitted
- no wallet confirmation or signature was requested
- no deposit transaction was submitted
- no encryption was requested
- no decryption was requested
- reservation retry remains forbidden
- operator approval remains unauthorized until exact operator-call review completes

Safety result:

- browser continuity: **PASS**
- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- source modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C21E/R1 — exact Zama operator-approval mechanics — PASS

Static inspection of the installed Zama React SDK and core SDK established the exact on-chain
mechanics behind Veilpot’s short-lived Pool operator approval before any wallet interaction.

Installed implementation:

- `@zama-fhe/react-sdk`: `3.5.1`
- `@zama-fhe/sdk`: `3.5.1`
- the React mutation forwards `{ operator, until }` directly to `Token.setOperator(operator, until)`
- `Token.setOperator` uses the shared SDK transaction pipeline and returns a `TransactionResult`
- `TransactionResult` contains the transaction hash and mined receipt

Exact transaction schema:

- chain: Ethereum Sepolia
- chain ID: `11155111`
- expected sender: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- transaction target / confidential token: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- authorized operator / Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- Solidity function: `setOperator(address,uint48)`
- function selector: `0xd4febb96`
- argument 1: Pool address as `address`
- argument 2: expiration timestamp as `uint48`
- state mutability: `nonpayable`
- expected native ETH value: `0`

Expiry semantics:

- Veilpot explicitly supplies `floor(Date.now() / 1000) + 30 * 60`
- requested operator window: `1800` seconds
- the exact `until` timestamp is dynamic and does not exist until the operator button is clicked
- the core SDK default one-hour expiry is not used because Veilpot supplies its own 30-minute
  timestamp

Mining semantics:

- the core SDK documents `setOperator` as returning the transaction hash and mined receipt
- the frontend therefore treats the mutation result as post-mine state
- the previously added warning-only `operatorQuery.refetch()` handling protects against accidental
  resubmission after a mined operator transaction

Wallet-review boundary:

- wallet review was not opened during either static audit
- operator signing remains unauthorized
- before signing, the wallet transaction must be inspected against the exact token target, zero ETH
  value, Pool operator argument, and dynamic `uint48 until`

Safety result:

- F7-B2B2C21E wrapper audit: **PASS**
- F7-B2B2C21E-R1 core SDK audit: **PASS**
- selector derivation was offline only
- RPC requests: `0`
- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- source modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C21F — operator wallet transaction review — PASS

Rabby opened the pending Sepolia operator-approval transaction after one authorized click of
`Approve Pool for 30 minutes`. The wallet review was inspected but not signed.

Wallet-visible transaction identity:

- origin: `http://127.0.0.1:3177`
- wallet: Rabby
- chain: `Sepolia`
- chain ID: `11155111`
- sender: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- target: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- target identity: frozen Sepolia confidential token
- wallet transaction nonce: `517`
- raw nonce: `0x205`
- gas limit: `51581`
- raw gas limit: `0xc97d`
- raw gas price: `0x4cb81991`
- no native ETH value field was present in the Rabby raw transaction object, consistent with the
  expected zero-value nonpayable call

Exact ABI interpretation:

- canonical calldata reconstructed from the wallet-visible selector and arguments:
  `0xd4febb960000000000000000000000002029d8b7ae6abe7daa0c2a71e960839171a34601000000000000000000000000000000000000000000000000000000006a9a9b62`
- calldata size: `68` bytes
- selector: `0xd4febb96`
- function: `setOperator(address,uint48)`
- operator: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- `until`: `1788517218`
- `until` hex: `0x6a9a9b62`
- `until` UTC: `2026-09-04T10:20:18.000Z`

Recovery note:

- the first offline documentation attempt failed before ledger mutation because the manually
  transcribed second ABI word contained one extra leading zero
- that malformed local transcription had `129` argument hex characters instead of the required `128`
- the transaction displayed by Rabby was not changed
- no wallet signature was submitted during the failed local decode attempt
- this recovery reconstructs the canonical calldata from the exact ABI, Pool argument, and displayed
  `uint48 until` rather than relying on manual zero counting

Wallet simulation boundary:

- Rabby displayed `Simulation Not Supported`
- this is not treated as a successful simulation
- an independent read-only Sepolia simulation of the exact canonical calldata remains required
  immediately before signing

Authorization boundary:

- wallet review opened: **yes**
- transaction signed: **no**
- signing authorized: **no**
- reservation retry authorized: **no**
- wallet should remain open while the exact transaction is independently simulated and state is
  revalidated

Safety result:

- corrected offline ABI encode/decode: **PASS**
- selector identity: **PASS**
- token target identity: **PASS**
- Pool operator identity: **PASS**
- `uint48 until` identity: **PASS**
- transactions sent by this recovery gate: `0`
- wallet signatures submitted: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- source modified: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C21G/R1 — final operator pre-sign simulation and zsh recovery — PASS

The first F7-B2B2C21G shell wrapper aborted after a successful read-only probe because it used Bash
`PIPESTATUS` syntax under zsh. No transaction, signature, source change, or ledger change occurred
before that wrapper failure.

A fresh recovery probe was then executed without a pipeline and reconfirmed the exact pending
Rabby-reviewed operator transaction immediately before any signing authorization.

Fresh pinned state:

- block: `11632743`
- block hash: `0x4a9217d12c5cc1e88ce1086d378e226a3c2627fe5e7728a472c789818296b88e`
- block time UTC: `2026-09-04T09:59:24.000Z`

Exact pending transaction:

- sender: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- target token: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- function: `setOperator(address,uint48)`
- selector: `0xd4febb96`
- Pool operator: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- `until`: `1788517218`
- `until` UTC: `2026-09-04T10:20:18.000Z`
- native ETH value: `0 wei`
- wallet transaction nonce: `517`

Fresh simulation and state:

- exact Sepolia `eth_call`: **PASS**
- latest account nonce: `517`
- pending account nonce: `517`
- wallet nonce `517` remained unused
- Pool was not already an active operator
- participant remained `RESERVED`
- slot remained `1`
- reservation nonce remained `3`
- next deposit nonce remained `2`
- bond remained held
- operator seconds remaining: `1254`
- reservation seconds remaining: `83892`
- minimum operator signing margin `600` seconds: **PASS**

Safety:

- this recovery was read-only
- transactions sent: `0`
- signatures submitted: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- reservation retry authorized: **no**
- operator signature was not submitted inside this gate
- commit created: **no**
- push performed: **no**

## F7-B2B2C21H — operator approval post-sign chain recovery — PASS

After the reviewed Rabby operator transaction was signed, the frontend displayed a
receipt-resolution error instead of treating the action as complete. No retry was performed. Direct
pinned Sepolia reads were used to recover authoritative on-chain state.

Frontend observation:

- Veilpot displayed `Action stopped safely`
- the error stated that a transaction receipt could not be found for a hash beginning
  `0x729a9d68...`
- the message noted that an ERC-4337 connector may return a UserOperation hash instead of a normal
  transaction hash
- the operator approval control became visible again
- that reappearing control was not treated as permission to retry

Direct-chain recovery snapshot:

- chain ID: `11155111`
- block: `11632770`
- block hash: `0x4e2f3d12c2501c31b3cead5643514541a3359bd10ade13697f344e276b45401f`
- block time UTC: `2026-09-04T10:05:00.000Z`

Operator result:

- reviewed wallet nonce: `517`
- latest account nonce: `518`
- pending account nonce: `518`
- confidential token: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- holder: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- Pool operator: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- `isOperator(holder, Pool)`: `true`
- reviewed operator expiry: `1788517218`
- operator seconds remaining at recovery snapshot: `918`
- recovery classification: `OPERATOR_ACTIVE_ONCHAIN_DO_NOT_RETRY`

Registration state:

- participant state: `RESERVED`
- slot: `1`
- reservation nonce: `3`
- reservation expiry: `1788599856`
- reservation seconds remaining at recovery snapshot: `83556`
- bond held: `true`
- next deposit nonce: `2`
- pending bond refund: `0 wei`

Interpretation:

- the operator authorization succeeded on-chain despite the frontend receipt-resolution error
- wallet nonce `517` was consumed
- the Pool is already an active confidential-token operator
- the operator transaction must not be resubmitted
- exact mined transaction-hash forensics remain recoverable later from chain history and are not
  required to risk the short-lived active operator window

Next safety gate:

- confidential deposit remains unauthorized
- the deposit frontend path still has a known post-mine `refreshParticipant()` hazard
- that deposit post-mine path must be repaired, validated, production-built, and loaded in a fresh
  runtime before any deposit signature

Safety result:

- operator retry authorized: **no**
- deposit authorized: **no**
- recovery probe transactions sent: `0`
- recovery probe wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- frozen Solidity/SDK/evidence preserved
- source modified by recovery probe: **no**
- commit created: **no**
- push performed: **no**

## F7-B2B2C22A/R1 — confidential deposit post-mine refresh repair — PASS

The first F7-B2B2C22A wrapper stopped during its pre-modification audit because of a Python
shell-quoting error. It stopped before source or ledger mutation.

The corrected recovery then repaired only the post-inclusion participant refresh inside
`submitRegistrationDeposit`.

Source identity:

- modified file: `apps/web/components/action-sheet.tsx`
- new action-sheet SHA-256: `b4b022068f82bb6d88d5f9819694a2783f43c23344adc874efa0b5345998734b`
- frozen Solidity: unchanged
- frozen protocol SDK: unchanged
- frozen evidence: unchanged

Deposit semantics preserved:

- deposit remains restricted to participant state `RESERVED`
- the amount continues to be encrypted locally
- live `nextDepositNonce` is still read before descriptor construction
- the frozen protocol SDK still builds the deposit call
- wallet submission behavior before successful inclusion is unchanged
- transaction inclusion still means confidential activation settlement remains pending

Post-mine safety repair:

- the post-inclusion `refreshParticipant()` now has a dedicated warning-only `try/catch`
- refresh failure keeps the transaction state as `included`
- the transaction hash remains preserved
- the warning states `Do not resubmit it automatically.`
- failures before inclusion still use the existing outer error path

Regression boundary:

- reservation post-mine repair: preserved
- operator post-mine repair: preserved
- Autopilot post-mine repair: preserved
- total `refreshParticipant()` call sites: `4`
- withdrawal post-mine handling was not changed

Validation:

- Prettier: **PASS**
- Autopilot unit tests: **PASS**
- TypeScript: **PASS**
- ESLint: **PASS**
- frozen Solidity/SDK/evidence boundary: **PASS**

Runtime boundary:

- production build of this exact repaired source has not yet run
- fresh runtime validation has not yet run
- confidential deposit remains unauthorized

Operator boundary:

- the previously successful nonce-`517` operator approval must never be retried
- current operator status will be re-read after the repaired production runtime is started
- if that short-lived permission has expired, a fresh explicit approval will be reviewed as a new
  transaction

Safety result:

- deposit authorized: **no**
- operator retry authorized: **no**
- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested by this repair gate: `0`
- decryptions requested: `0`
- commit created: **no**
- push performed: **no**

## F7-B2B2C22B — deposit-repaired production build and fresh runtime — PASS

The exact F7-B2B2C22A/R1 confidential-deposit post-mine safety repair was production-built and
started in a fresh local Next.js production runtime.

Source identity:

- `apps/web/components/action-sheet.tsx` SHA-256:
  `b4b022068f82bb6d88d5f9819694a2783f43c23344adc874efa0b5345998734b`
- frozen Solidity, protocol SDK, and evidence remained unchanged

Production validation:

- Next.js production build: **PASS**
- old port `3177` runtime stopped by exact PID
- fresh start PID: `46375`
- fresh listener PID: `46382`
- fresh listener identified as `next-server`
- runtime log: `/tmp/veilpot-f7-b2b2c22b-runtime.log`

HTTP smoke:

- `/`: `200`
- `/app`: `200`
- `/api/auth/session`: `200`
- cookieless session: `{ authenticated: false }`

Integrity:

- repaired action-sheet source survived build unchanged
- frozen Solidity/SDK/evidence boundary: **PASS**
- `git diff --check`: **PASS**

Transaction boundary:

- no deposit transaction was submitted
- no operator transaction was submitted
- the successful nonce-`517` operator approval was not retried
- operator status must be read fresh from Sepolia after this runtime replacement
- deposit remains unauthorized until live participant/operator state is revalidated

Safety result:

- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- commit created: **no**
- push performed: **no**

## F7-B2B2C22C — live confidential-deposit readiness state — PASS

After the confidential-deposit post-mine safety repair was production-built and loaded in a fresh
runtime, direct pinned Sepolia reads revalidated the registration and short-lived confidential-token
operator state without performing any wallet action, encryption, decryption, or transaction.

Fresh pinned snapshot:

- block: `11632813`
- block hash: `0x33fadcba3888f801572ab4cd27c29d711a1a01b9cf9e5131394d72b9e94ed3a0`
- block time UTC: `2026-09-04T10:14:00.000Z`
- latest owner account nonce: `518`
- pending owner account nonce: `518`

Registration state:

- participant state ordinal: `1`
- participant state: `RESERVED`
- slot: `1`
- registration version: `1`
- reservation nonce: `3`
- reservation expiry: `1788599856`
- reservation seconds remaining at snapshot: `83016`
- bond held: `true`
- current `nextReservationNonce`: `3`
- owner next deposit nonce: `2`
- pending bond refund: `0 wei`
- active participant count: `0`

Operator state:

- Pool operator active: `true`
- reviewed operator expiry: `1788517218`
- seconds remaining in that reviewed approval at snapshot: `378`
- classification: `ACTIVE_AND_WITHIN_REVIEWED_WINDOW`
- the successful nonce-`517` operator transaction must never be retried

Deposit authorization boundary:

- the remaining `378`-second operator window was not treated as sufficient margin for a confidential
  deposit
- no deposit amount has been reviewed or authorized
- the visible UI default `25.00 cUSDTMock` is not authoritative and must not be used merely because
  it is prefilled
- consequential activation/deposit-threshold logic must be audited before selecting an amount
- operator status must be read fresh again immediately before any eventual deposit
- if operator permission is no longer active, any later permission must be a new explicit approval
  rather than a retry of nonce `517`

Safety result:

- live readiness probe: **PASS**
- deposit authorized: **no**
- old operator approval retry authorized: **no**
- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- source modified: **no**
- frozen Solidity/SDK/evidence preserved
- production runtime preserved
- commit created: **no**
- push performed: **no**

## F7-B2B2C22D — activation predicate and deposit consequence audit — PASS

A static read-only audit of the frozen Pool, reference model, tests, protocol SDK, and token-profile
evidence established the exact confidential registration-deposit activation predicate and
consequence path.

Frozen Pool identity:

- `VeilpotPool.sol` SHA-256: `bd06e4f9217ffa6d584a518cb93ae0504221c760e4c6f17656d114262a82710e`

Registration envelope:

- `MIN_REGISTRATION_DEPOSIT_BASE_UNITS = 1_000_000`
- `MAX_USER_PRINCIPAL_BASE_UNITS = 1_000_000_000_000`
- frozen cUSDTMock decimals: `6`
- minimum qualifying amount: `1.000000 cUSDTMock`
- maximum qualifying amount: `1,000,000.000000 cUSDTMock`
- both boundaries are inclusive

Authoritative amount semantics:

- the caller encrypts a requested amount
- the Pool performs ERC-7984 `confidentialTransferFrom`
- the returned encrypted `actualTransferred` value is authoritative
- activation does not rely merely on the requested amount
- the exact transferred amount remains confidential

Encrypted activation predicate:

- `meetsMinimum = FHE.ge(actualTransferred, MIN_REGISTRATION_DEPOSIT_BASE_UNITS)`
- `withinMaximum = FHE.le(actualTransferred, MAX_USER_PRINCIPAL_BASE_UNITS)`
- `thresholdSatisfied = FHE.and(meetsMinimum, withinMaximum)`
- only that boolean is made publicly decryptable

Immediate post-deposit state:

- `pendingAmount = actualTransferred`
- `activationStartedAt = block.timestamp`
- `activationDeadline = block.timestamp + 86_400`
- participant enters `PENDING_ACTIVATION`
- `DepositPending` is emitted
- deposit nonce advances
- a second registration deposit is therefore not valid while activation is pending because
  `deposit()` requires `RESERVED`

Threshold settlement consequences:

- settlement requires the participant to still be `PENDING_ACTIVATION`
- registration version and reservation nonce are rebound
- the bound public-decryption proof must validate the encrypted threshold boolean
- proof settlement is accepted through the inclusive activation deadline
- `true` credits the actual pending amount to principal and enters `ACTIVE`
- `true` increments `activeParticipantCount`
- `false` moves the encrypted pending amount into refund accounting and enters `PENDING_REFUND`
- the registration bond is released into pull-based bond-refund accounting during settlement

Liveness/recovery:

- after the strict activation deadline, `expirePendingActivation()` can move the participant to
  `PENDING_REFUND` without revealing the threshold
- refund execution uses the token-returned actual refunded amount
- refund completion is settled separately through a bound public boolean proof

Test/reference evidence:

- the reference model preserves asynchronous `PENDING_ACTIVATION` settlement
- an under-minimum actual transfer is exercised through the false/refund path
- an exact-minimum actual transfer is exercised through the successful path
- inclusive activation-deadline behavior is covered
- stale registration/reservation binding and timeout behavior are covered

Deposit-amount conclusion:

- the UI value `25.00 cUSDTMock` is numerically inside the frozen qualifying envelope
- however no amount is authorized merely because it is prefilled in the UI
- before the next live deposit, Veilpot must perform fresh participant, operator, token-balance,
  nonce, descriptor, and simulation review
- the earlier nonce-`517` operator approval must never be retried

Audit safety:

- audit mode: static read-only
- RPC requests: `0`
- wallet opened: **no**
- deposit amount selected: **no**
- deposit authorized: **no**
- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions requested: `0`
- decryptions requested: `0`
- source modified by audit: **no**
- frozen Solidity/SDK/evidence preserved
- commit created: **no**
- push performed: **no**

# Remaining release validation

The following are not yet recorded as passed:

- F7-B2B — live Autopilot plan discovery and confidential funding
- F7-B2C — Autopilot execute / skip / advance controls
- F7-B2D — pause / resume / revoke / residual-fund withdrawal controls
- explicit private-value reveal flows
- VeilDraw entitlement reveal
- prize claim browser integration
- complete browser transaction E2E
- rejection / error / wrong-network / reconnect E2E
- final mobile/responsive QA
- public website deployment
- deployed-site E2E
- release commit/push
- three-minute real-person demo video
- X thread/article
- final bounty submission

These items must not be described as completed until their corresponding gate has passed and has
been added to this ledger.

## Pool operator approval explicit-review safety repair — STATIC PASS

The frontend Pool operator-approval path was replaced with an explicit two-step review/signing
boundary and statically validated before any new operator transaction.

Pre-repair live read-only state used to define this safety checkpoint:

- Ethereum Sepolia chain ID: `11155111`
- pinned snapshot block: `11632957`
- pinned snapshot hash: `0x17372d78941c3a04f5cc940d3cbac78078bbc2766be8b7c19006614ecda11dfa`
- pinned snapshot time: `2026-09-04T10:45:24.000Z`
- owner: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- confidential token testnet mock: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- participant slot: `1`
- participant state: `RESERVED`
- registration version: `1`
- reservation nonce: `3`
- reservation expiry: `2026-09-05T09:17:36.000Z`
- bond held: `true`
- `nextReservationNonce`: `3`
- owner `nextDepositNonce`: `2`
- owner `pendingBondRefund`: `0`
- `activeParticipantCount`: `0`
- Pool operator active at snapshot: `false`
- owner account nonce latest/pending: `518 / 518`
- confidential token symbol: `cUSDTMock`
- confidential token decimals: `6`
- confidential balance handle existed, but the plaintext balance was **not decrypted**
- deposit amount sufficiency remained unknown by design
- deposit authorization remained **false**

Operator-review repair:

- the old one-click operator path was removed
- the first action is now `Review Pool approval`
- review performs fresh authenticated-wallet, Sepolia, participant, reservation-expiry, and
  `isOperator(holder, Pool)` checks
- an already-active operator causes the new approval path to stop without opening the wallet
- one exact 30-minute `until` value is generated during review and frozen
- `until` is not recomputed by the wallet-opening callback
- exact `setOperator(address,uint48)` calldata is derived with viem
- expected selector is checked as `0xd4febb96`
- the review displays the full holder, confidential-token address, Pool/operator address,
  participant binding, function, selector, Unix expiry, UTC expiry, chain ID, and expected calldata
- a review is invalidated by wallet/network/participant/deployment changes
- a review becomes stale after five minutes and fails closed without silently generating a
  replacement expiry
- `Open wallet review` is a distinct second user action
- all critical invariants are re-read before that second action may invoke the Zama mutation

Submitted-transaction / retry safety:

- installed Zama SDK `3.5.1` emits `setOperator:submitted` after transaction broadcast and before
  receipt waiting
- the frontend captures that submitted event
- once a hash is available, Veilpot preserves the expected public transaction identity: hash,
  holder, confidential token, Pool/operator, frozen expiry, calldata, and chain ID
- unresolved submitted state is persisted so closing/reopening the action sheet or reloading the
  browser cannot silently make the approval retryable
- exact reconciliation verifies transaction sender, target token, calldata, and receipt status
- a transaction hash or reconciliation failure never triggers automatic resubmission
- confirmed inclusion followed by operator-state refresh failure remains represented as an included
  transaction with an explicit warning
- an exact reverted receipt is represented as reverted and is not silently retried

Static validation environment:

- Node.js: `v22.23.2`
- pnpm: `10.18.3`
- Next.js: `16.3.4`

Static validation result:

- Prettier: **PASS**
- focused operator-approval tests: **8/8 PASS**
- TypeScript: **PASS**
- ESLint: **PASS**
- Next.js production build: **PASS**
- `git diff --check`: **PASS**
- old one-click operator-path assertion: **PASS / absent**
- required explicit-review path assertions: **PASS**
- frozen Solidity boundary: **unchanged**
- frozen protocol SDK boundary: **unchanged**
- frozen evidence boundary: **unchanged**

Validated frontend hashes:

- `apps/web/components/action-sheet.tsx`:
  `242e0af71f22aed9768ec884e83877473a5bd98b0363a029f489c6bae9880ee4`
- `apps/web/components/app-shell.tsx`:
  `f41c0050ed4e0252291f6e345c7b800c4e1135885745a91abb6da573b67b973b`
- `apps/web/lib/zama.ts`: `212d50775343b7ddcbcd000139c316843476223b8e118502c235fc40dc1ab0a0`
- `apps/web/app/globals.css`: `8959c0bdd2305e1cf6e1f964d979cb86ff455562b977ddf6e0f8eae61aaa615e`
- `apps/web/lib/operator-approval.ts`:
  `4cf92ede20079e5c1ec88c757ce6e0c445685c0fe375021708c9222227f9fe37`
- `apps/web/lib/operator-approval.test.ts`:
  `e98ff2c11f637a720f0f962b709f85581acb5553b23c253052ac99ad4bbe94f0`

Authorization boundary after this static PASS:

- historical nonce-`517` operator approval must not be retried
- the existing reservation transaction must not be retried
- no new operator transaction has been authorized by this static checkpoint
- no wallet review has been authorized by this static checkpoint
- no operator signature has been authorized by this static checkpoint
- no deposit amount has been selected
- no deposit encryption has been authorized
- no deposit transaction has been authorized
- no threshold/public consequence decryption has been authorized
- a fresh signer-free Sepolia state snapshot is required after this ledger checkpoint and before any
  possible wallet review

Safety result:

- transactions sent by this repair/validation: **0**
- wallet approvals requested: **0**
- encryptions performed: **0**
- decryptions performed: **0**
- deposits performed: **0**
- Solidity modified: **no**
- frozen protocol SDK modified: **no**
- frozen evidence modified: **no**
- commit created: **no**
- push performed: **no**

## Fresh Pool-operator read-only Sepolia revalidation — PASS

A fresh signer-free/read-only Ethereum Sepolia probe was executed after the explicit-review
operator-safety repair and its static validation checkpoint.

Probe mode and execution boundary:

- mode: `READ_ONLY_NO_WALLET_NO_SIGNER_NO_ENCRYPTION_NO_DECRYPTION`
- RPC source: public Sepolia fallback
- wallet opened: **no**
- signer used: **no**
- transaction path: **none**
- encryption: **none**
- decryption: **none**
- confidential plaintext balance revealed: **no**
- repository source modified by the probe: **no**

Pinned Sepolia snapshot:

- chain ID: `11155111`
- block number: `11633273`
- block hash: `0x742c5488da2bf79f12b71c57cef7ea5c3fdc5b8bac7ae93f022119b9f2366bbb`
- block timestamp: `1788522732`
- block timestamp UTC: `2026-09-04T11:52:12.000Z`
- pinned block hash reconfirmed unchanged before accepting the result: **yes**

Deployment identity:

- owner: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- confidential-token testnet mock: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- Pool bytecode present: **yes**
- confidential-token bytecode present: **yes**

Pool-wide participant state:

- maximum participants: `128`
- `FREE`: `126`
- `RESERVED`: `1`
- `TOMBSTONED`: `1`
- live occupied slots: `1`

Connected-owner participant:

- slot: `1`
- state ordinal: `1`
- state: `RESERVED`
- owner: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- registration version: `1`
- reservation nonce: `3`
- reservation expiry: `1788599856`
- reservation expiry UTC: `2026-09-05T09:17:36.000Z`
- reservation seconds remaining at probe: `77122`
- activation started at: `0`
- activation deadline: `0`
- refund-attempt nonce: `0`
- registration bond held: **true**

Public Pool state at the same pinned block:

- `nextReservationNonce`: `3`
- owner `nextDepositNonce`: `2`
- owner `pendingBondRefund`: `0`
- `activeParticipantCount`: `0`

Fresh operator state:

- holder: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- spender / Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- Pool operator active at snapshot: **false**

Confidential-token readiness:

- symbol: `cUSDTMock`
- decimals: `6`
- confidential balance handle present: **yes**
- plaintext confidential balance: **NOT_DECRYPTED**
- amount sufficiency: `UNKNOWN_BY_DESIGN_UNTIL_EXACT_AMOUNT_AND_SEPARATE_AUTHORIZATION`

Account nonce observation:

- account nonce at pinned snapshot: `518`
- pending account nonce immediately after pinned read: `518`
- no pending nonce movement was observed by this gate

Readiness interpretation:

- public blocker list: `POOL_OPERATOR_NOT_ACTIVE`
- operator-review preparation eligible: **true**
- a new operator transaction would be needed if the state remains unchanged: **true**
- public read-only gate as a complete deposit-readiness gate: **false**, because the Pool operator
  is not active
- this result does not infer or authorize any confidential deposit amount

Authorization boundary:

- this read-only checkpoint does **not** authorize opening the wallet
- this read-only checkpoint does **not** authorize an operator signature
- this read-only checkpoint does **not** authorize a confidential deposit
- this read-only checkpoint does **not** authorize encryption
- this read-only checkpoint does **not** authorize threshold/public consequence decryption
- exact deposit amount selected: **no**
- deposit descriptor built for signing: **no**
- deposit simulated: **no**
- wallet review authorized: **no**
- signing authorized: **no**
- threshold decryption authorized: **no**
- the historical nonce-`517` operator approval must not be retried
- the existing reservation transaction must not be retried

Repository preservation after the probe:

- `apps/web/components/action-sheet.tsx`:
  `242e0af71f22aed9768ec884e83877473a5bd98b0363a029f489c6bae9880ee4`
- `apps/web/components/app-shell.tsx`:
  `f41c0050ed4e0252291f6e345c7b800c4e1135885745a91abb6da573b67b973b`
- `apps/web/lib/zama.ts`: `212d50775343b7ddcbcd000139c316843476223b8e118502c235fc40dc1ab0a0`
- `apps/web/app/globals.css`: `8959c0bdd2305e1cf6e1f964d979cb86ff455562b977ddf6e0f8eae61aaa615e`
- `apps/web/lib/operator-approval.ts`:
  `4cf92ede20079e5c1ec88c757ce6e0c445685c0fe375021708c9222227f9fe37`
- `apps/web/lib/operator-approval.test.ts`:
  `e98ff2c11f637a720f0f962b709f85581acb5553b23c253052ac99ad4bbe94f0`
- frozen Solidity boundary: **unchanged**
- frozen protocol SDK boundary: **unchanged**
- frozen evidence boundary: **unchanged**

Next separate gate:

- build/start a fresh production runtime from the exact validated operator-review source
- confirm `/`, `/app`, and `/api/auth/session`
- confirm the exact source hashes survive runtime preparation
- no browser operator control or wallet interaction is authorized until that runtime gate passes

Safety result:

- transactions sent: `0`
- wallet requests: `0`
- signer used: **no**
- encryptions: `0`
- decryptions: `0`
- deposits: `0`
- commit created: **no**
- push performed: **no**

## Operator-review fresh production runtime preparation — PASS

A fresh Next.js production runtime was built and started from the exact statically validated
Pool-operator explicit-review frontend before any browser operator action or wallet interaction.

Exact source / documentation identity:

- branch: `frontend/veilpot-masterpiece-v1`
- HEAD: `470a77cfae2a8915854bec29274225e8807c6494`
- `apps/web/components/action-sheet.tsx`:
  `242e0af71f22aed9768ec884e83877473a5bd98b0363a029f489c6bae9880ee4`
- `apps/web/components/app-shell.tsx`:
  `f41c0050ed4e0252291f6e345c7b800c4e1135885745a91abb6da573b67b973b`
- `apps/web/lib/zama.ts`: `212d50775343b7ddcbcd000139c316843476223b8e118502c235fc40dc1ab0a0`
- `apps/web/app/globals.css`: `8959c0bdd2305e1cf6e1f964d979cb86ff455562b977ddf6e0f8eae61aaa615e`
- `apps/web/lib/operator-approval.ts`:
  `4cf92ede20079e5c1ec88c757ce6e0c445685c0fe375021708c9222227f9fe37`
- `apps/web/lib/operator-approval.test.ts`:
  `e98ff2c11f637a720f0f962b709f85581acb5553b23c253052ac99ad4bbe94f0`
- pre-runtime validation-ledger SHA-256:
  `dbf620a996582fba9b7c18f803ef0670249d21878344a0b6ae132ff63bc4af48`

Runtime toolchain:

- Node.js: `v22.23.2`
- pnpm: `10.18.3`
- Next.js: `16.3.4`

Production build:

- Next.js production build: **PASS**
- source hashes after build: **unchanged**
- `git diff --check`: **PASS**
- frozen Solidity boundary: **unchanged**
- frozen protocol SDK boundary: **unchanged**
- frozen evidence boundary: **unchanged**

Port-3177 replacement safety:

- an existing listener was found on port `3177`
- prior listener PID: `46382`
- prior listener command: `next-server (v16.3.4)`
- prior listener cwd: `/Users/mralbert/Downloads/veilpot/apps/web`
- the prior listener was positively identified as Veilpot's own production runtime before stopping
- exact prior PID `46382` was stopped
- no force-kill was used
- port `3177` was confirmed available before the fresh runtime started

Fresh runtime:

- start PID: `66329`
- listener PID: `66329`
- listener command: `next-server (v16.3.4)`
- listener cwd: `/Users/mralbert/Downloads/veilpot/apps/web`
- production URL: `http://127.0.0.1:3177`
- runtime log: `/tmp/veilpot-operator-review-runtime-20260904-125620.log`

HTTP smoke:

- `/`: **HTTP 200**
- `/app`: **HTTP 200**
- `/api/auth/session`: **HTTP 200**
- cookieless `/api/auth/session` body: `{ "authenticated": false }`
- cookieless session semantics: **PASS**

Session interpretation:

- `authenticated:false` is the expected result for a request without the browser's HttpOnly session
  cookies
- this runtime gate does not determine whether the normal Veilpot browser profile still holds a
  valid authenticated session
- browser cookie/session continuity therefore remains a separate unresolved gate

Execution and authorization boundary:

- browser cookie/session state inspected: **no**
- `Review Pool approval` clicked: **no**
- `Open wallet review` clicked: **no**
- wallet opened: **no**
- wallet review authorized: **no**
- signing authorized: **no**
- transactions sent: `0`
- encryption: `0`
- decryption: `0`
- deposit: `0`
- exact deposit amount selected: **no**
- threshold decryption authorized: **no**
- historical nonce-`517` operator approval remains non-retryable
- the existing reservation transaction remains non-retryable

Repository preservation:

- all six validated operator-review frontend hashes remained byte-identical after build/start
- validation-ledger hash remained byte-identical during the runtime gate
- no new repository path was created by runtime preparation
- frozen Solidity, protocol SDK, and evidence remained untouched

Next separate gate:

- hard-refresh `http://127.0.0.1:3177/app` in the existing normal Veilpot browser profile
- inspect only existing browser/session/network/account continuity
- do not click `Review Pool approval`
- do not click `Open wallet review`
- do not approve/sign any wallet prompt
- do not encrypt, decrypt, or deposit

Safety result:

- production runtime preparation: **PASS**
- transactions sent: `0`
- wallet requests: `0`
- encryptions: `0`
- decryptions: `0`
- deposits: `0`
- source modifications from runtime preparation: `0`
- commit created: **no**
- push performed: **no**

## Operator-review browser authenticated-session continuity — PASS

The existing normal Veilpot browser profile was hard-refreshed on the exact fresh production runtime
before entering any Pool-operator review flow.

Observed browser state:

- application URL: `http://127.0.0.1:3177/app`
- authenticated Veilpot workspace rendered successfully
- the sign-in gate was not displayed
- heading `Your private account is ready.` was visible
- network indicator displayed `Sepolia`
- account chip displayed `0x1f87…5024`, consistent with the expected owner wallet
- no visible session/wallet mismatch warning appeared
- private savings remained hidden
- private-savings card remained marked `Never auto-decrypted`
- no wallet popup was visible in the captured browser state
- no transaction-approval popup was visible
- no encryption or decryption prompt was visible

Deliberately unresolved from this screenshot:

- participant/registration status was not visible in the captured viewport
- no participant state is inferred from presentation data
- the latest authoritative participant state remains the prior pinned read-only Sepolia snapshot
  until a fresh read or explicit live-control inspection establishes otherwise

Operator-review boundary:

- `Review Pool approval` was not clicked
- `Open wallet review` was not clicked
- no operator review object was intentionally prepared by this checkpoint
- no wallet review was opened
- no signature was requested
- no transaction was submitted

Confidentiality boundary:

- no private token amount was revealed
- no confidential balance plaintext was decrypted
- no encryption was initiated
- no threshold/public consequence decryption was initiated
- no deposit amount was selected or authorized

Runtime/source boundary:

- this was a browser-state observation only
- no source file was modified
- no production build was triggered by this checkpoint
- the validated operator-review source remains the active intended runtime source
- frozen Solidity, protocol SDK, and evidence remain unchanged

Next separate gate:

- inspect the Private Deposit action sheet only far enough to expose current participant/operator
  controls and status
- do not click `Review Pool approval`
- do not click `Open wallet review`
- do not approve/sign any wallet prompt
- if any wallet prompt appears unexpectedly, stop immediately

Safety result:

- authenticated browser continuity: **PASS**
- participant UI status captured: **no / unresolved**
- wallet opened: **no**
- transactions sent: `0`
- wallet signatures requested: `0`
- encryptions: `0`
- decryptions: `0`
- deposits: `0`
- commit created: **no**
- push performed: **no**

## Private Deposit operator-control browser inspection — PASS

The authenticated Veilpot browser opened the Private Deposit action sheet on the validated
production runtime without entering the operator review or initiating any wallet action.

Observed browser state:

- application remained at `http://127.0.0.1:3177/app`
- wallet displayed `0x1f87…5024`, consistent with the expected owner
- network displayed `Ethereum Sepolia`
- participant displayed `RESERVED`
- registration card displayed `Registration slot reserved`
- registration slot displayed `1`
- browser-local reservation expiry displayed `05/09/2026, 10:17:36`
- this browser-local display is consistent with the canonical reservation expiry
  `2026-09-05T09:17:36.000Z`

Operator-control state:

- the next protocol step displayed: `2. Allow the Pool to pull this confidential deposit`
- the explanatory copy stated that the permission is explicit and short-lived
- the explanatory copy stated that Veilpot prepares one exact 30-minute approval for inspection
  before any wallet request
- `Review Pool approval` was visibly present and appeared enabled
- `Review Pool approval` was **not clicked**
- `Open wallet review` was not visible because operator review had not yet been entered
- no unresolved-operator-transaction warning was visible in the captured action sheet
- no wallet popup was visible

Deposit control state:

- the amount input visibly contained `25.00`
- token label displayed `cUSDTMock`
- this visible amount is presentation/input state only
- `25.00 cUSDTMock` is **not authorized** as the next deposit amount
- the historical 25.00 test amount must not be reused merely because the UI currently displays it
- the amount field was not edited during this inspection
- `Encrypt & review deposit` was visibly disabled/locked at this stage
- no encryption was initiated
- no deposit descriptor was prepared
- no deposit simulation was performed
- no wallet review was opened
- no deposit signing was authorized

State interpretation boundary:

- the participant browser state is consistent with the latest accepted pinned read-only Sepolia
  snapshot, which found slot `1` in `RESERVED`
- this screenshot does not independently prove the current on-chain Pool-operator boolean
- the presence of the operator-review step must not be substituted for a fresh chain read
- the operator-review callback itself is designed to perform fresh participant and operator reads
  before freezing an exact review

Next separate gate:

- click `Review Pool approval` exactly once
- this first review action is expected to be read-only and must not open a wallet
- do not click `Open wallet review`
- do not approve/sign anything
- do not modify the deposit amount
- if any wallet prompt appears during `Review Pool approval`, stop immediately without interacting

Safety result:

- Private Deposit action-sheet inspection: **PASS**
- participant UI status captured: **RESERVED**
- operator review entered: **no**
- wallet opened: **no**
- wallet signatures requested: `0`
- transactions sent: `0`
- encryptions: `0`
- decryptions: `0`
- deposits: `0`
- commit created: **no**
- push performed: **no**

## Exact Pool operator approval browser review — PASS

The Private Deposit flow explicitly prepared one exact Pool operator approval review in the
authenticated browser without opening the wallet.

Review identity:

- holder: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- confidential-token testnet mock: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- operator / Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- participant state: `RESERVED`
- participant slot: `1`
- registration version: `1`
- reservation nonce: `3`

Exact reviewed call:

- function: `setOperator(address,uint48)`
- expected selector: `0xd4febb96`
- exact frozen `until` Unix timestamp: `1788525670`
- exact frozen `until` UTC: `2026-09-04T12:41:10.000Z`
- duration: `30 minutes`
- network: `Ethereum Sepolia`
- chain ID: `11155111`
- exact expected calldata:
  `0xd4febb960000000000000000000000002029d8b7ae6abe7daa0c2a71e960839171a34601000000000000000000000000000000000000000000000000000000006a9abc66`

Calldata consistency:

- calldata selector matched `0xd4febb96`
- first ABI argument encoded the exact frozen Pool address
- final ABI word encoded `0x6a9abc66`
- `0x6a9abc66` equals decimal `1788525670`
- therefore the calldata expiry matched the displayed frozen `until`

Review UX / safety state:

- review copy stated that opening the wallet re-reads the `RESERVED` registration and operator state
- review copy stated that opening the wallet never replaces the displayed expiry or calldata
- `Open wallet review` was visibly present
- `Open wallet review` was **not clicked**
- no wallet popup was visible
- no unresolved-operator-submission warning was visible

Review freshness boundary:

- the review UI states that a prepared review is usable for five minutes
- that five-minute review-usability limit is distinct from the 30-minute operator permission expiry
- preserving this checkpoint does not extend or refresh the review's five-minute usability window
- this recorded review must not be treated as automatically signable later merely because its
  30-minute `until` remains in the future
- before any wallet action, Veilpot must establish that the review is still fresh or deliberately
  prepare a new exact review through the same explicit read-only review step
- no expiry may be silently recomputed inside the wallet-opening step

Deposit boundary:

- the visible `25.00 cUSDTMock` input from the preceding screen remains **unauthorized**
- no deposit amount is approved by this operator-review checkpoint
- no deposit encryption occurred
- no deposit descriptor was prepared for signing
- no deposit simulation occurred
- no threshold/public consequence decryption occurred

Authorization boundary:

- this checkpoint records an exact review only
- wallet review authorization: **no**
- signing authorization: **no**
- operator transaction submitted: **no**
- the historical nonce-`517` approval remains non-retryable
- the already-mined reservation remains non-retryable

Safety result:

- exact operator review prepared: **yes**
- wallet opened: **no**
- wallet signatures requested: `0`
- transactions sent: `0`
- encryptions: `0`
- decryptions: `0`
- deposits: `0`
- commit created: **no**
- push performed: **no**

## Operator-review five-minute staleness fail-closed runtime validation — PASS

The previously prepared exact Pool operator approval review was left untouched past its separate
five-minute review-usability window and then inspected in the authenticated browser without clicking
any operator or wallet control.

Observed stale-review behavior:

- the previously displayed exact review was no longer actionable
- `Open wallet review` was no longer displayed
- the operator flow returned to `Review Pool approval`
- the browser displayed the explicit warning:
  `The Pool approval review became stale. No replacement expiry was generated; prepare a new review.`
- no replacement `until` value was silently generated
- no replacement calldata was silently generated
- no wallet popup appeared
- no transaction-approval popup appeared

Participant / deposit UI state during the stale inspection:

- wallet displayed `0x1f87…5024`
- network displayed `Ethereum Sepolia`
- participant displayed `RESERVED`
- registration remained shown as `Registration slot reserved`
- slot displayed `1`
- browser-local reservation expiry remained displayed as `05/09/2026, 10:17:36`
- the amount input still visibly contained `25.00 cUSDTMock`
- that visible amount remains presentation/input state only and remains **unauthorized**
- `Encrypt & review deposit` remained unavailable while Pool operator approval was unresolved

Staleness interpretation:

- the previous exact review had frozen `until = 1788525670`
- the 30-minute operator permission expiry and the five-minute review-usability window are distinct
- once the five-minute review window elapsed, Veilpot failed closed
- the frontend did not preserve an actionable wallet-opening control for the stale review
- the frontend did not silently replace the exact reviewed expiry
- the frontend did not silently replace the exact reviewed calldata
- a future approval requires a deliberately prepared new exact review

Authorization boundary:

- `Review Pool approval` was not clicked during this stale-inspection checkpoint
- `Open wallet review` was not clicked
- wallet review authorization: **no**
- signing authorization: **no**
- operator transaction submitted: **no**
- deposit authorization: **no**
- encryption authorization: **no**
- threshold/public consequence decryption authorization: **no**
- historical nonce-`517` operator approval remains non-retryable
- the already-mined reservation remains non-retryable

Safety result:

- stale-review fail-closed behavior: **PASS**
- replacement expiry generated automatically: **no**
- wallet opened: **no**
- wallet signatures requested: `0`
- transactions sent: `0`
- encryptions: `0`
- decryptions: `0`
- deposits: `0`
- commit created: **no**
- push performed: **no**

## Exact Rabby wallet review for fresh Pool operator approval — PASS

The authenticated Veilpot browser opened Rabby Wallet for the deliberately fresh Pool operator
approval review. The wallet prompt was inspected without signing or cancelling.

Veilpot review that opened this wallet prompt:

- holder: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- confidential-token testnet mock: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- operator / Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- function: `setOperator(address,uint48)`
- selector: `0xd4febb96`
- exact frozen `until`: `1788526259`
- exact frozen UTC expiry: `2026-09-04T12:50:59.000Z`
- duration: `30 minutes`
- chain ID: `11155111`
- exact reviewed calldata:
  `0xd4febb960000000000000000000000002029d8b7ae6abe7daa0c2a71e960839171a34601000000000000000000000000000000000000000000000000000000006a9abeb3`

Observed Rabby wallet prompt:

- requesting site: `http://127.0.0.1:3177`
- wallet chain: `Sepolia`
- raw `chainId`: `11155111`
- raw `from`: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- raw `to`: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- raw `nonce`: `0x206`
- decimal nonce interpretation: `518`
- raw `gas`: `0xc97d`
- raw `gasPrice`: `0x4b89e2ac`
- raw transaction `data`:
  `0xd4febb960000000000000000000000002029d8b7ae6abe7daa0c2a71e960839171a34601000000000000000000000000000000000000000000000000000000006a9abeb3`
- Rabby displayed `Simulation Not Supported`
- Rabby displayed `Unknown Signature Type`
- Rabby exposed a `View Raw` control
- Rabby displayed `Sign` and `Cancel`

Exact wallet-review identity checks:

- wallet chain matched the reviewed Ethereum Sepolia chain: **PASS**
- wallet sender matched the authenticated holder: **PASS**
- wallet target matched the exact confidential-token testnet mock: **PASS**
- wallet nonce `0x206` equals decimal `518`, consistent with the latest accepted account nonce:
  **PASS**
- wallet calldata matched the frozen Veilpot review byte-for-byte: **PASS**
- calldata selector remained `0xd4febb96`: **PASS**
- calldata encoded the exact Pool address: **PASS**
- final ABI word remained `0x6a9abeb3`: **PASS**
- `0x6a9abeb3` equals decimal `1788526259`: **PASS**
- therefore the wallet transaction retained the exact reviewed `until`: **PASS**

Rabby interpretation boundary:

- `Simulation Not Supported` is not treated as proof of failure or success
- `Unknown Signature Type` is not treated as an independent decode of the contract call
- the wallet-review safety conclusion is based on exact raw transaction identity
- no claim is made that Rabby independently simulated the state transition

Authorization boundary:

- opening this wallet prompt was separately authorized
- opening the wallet did **not** authorize signing
- `Sign` was **not clicked**
- `Cancel` was **not clicked**
- signing authorization remains **no**
- operator transaction submitted: **no**
- transaction hash: **none**
- historical nonce-`517` approval remains non-retryable
- if this fresh review becomes stale before a separate signing authorization, it must not be signed
- a stale review must be cancelled/closed and deliberately prepared again rather than silently
  replacing expiry/calldata

Deposit/confidentiality boundary:

- visible `25.00 cUSDTMock` remains unauthorized
- no deposit amount was approved
- no encryption occurred
- no decryption occurred
- no deposit transaction was built or submitted
- no threshold/public consequence decryption was authorized

Safety result:

- exact wallet review: **PASS**
- wallet opened: **yes, review only**
- wallet signature produced: **no**
- transactions sent: `0`
- encryptions: `0`
- decryptions: `0`
- deposits: `0`
- commit created: **no**
- push performed: **no**

## Pool operator approval repair — mined, reconciled, and complete

The deliberately fresh Pool operator approval was separately reviewed in Veilpot, opened in Rabby,
explicitly authorized for signing, mined successfully on Ethereum Sepolia, and reconciled by the
frontend against live operator state.

Exact authorized transaction:

- chain: Ethereum Sepolia
- chain ID: `11155111`
- sender / holder: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- confidential-token testnet mock: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- operator / Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- function: `setOperator(address,uint48)`
- selector: `0xd4febb96`
- reviewed nonce: `0x206` / decimal `518`
- exact reviewed `until`: `1788526679`
- exact reviewed UTC expiry: `2026-09-04T12:57:59.000Z`
- exact reviewed calldata:
  `0xd4febb960000000000000000000000002029d8b7ae6abe7daa0c2a71e960839171a34601000000000000000000000000000000000000000000000000000000006a9ac057`

Mined transaction:

- transaction hash: `0x62cc18d7c985ff61f49956f99de8f3fa35e67cf00d16a0db6cad3b9de1582754`
- Etherscan status: `Success`
- block: `11633461`
- Etherscan action: `Set Operator`
- from: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- to: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- value: `0 ETH`

Post-mine frontend reconciliation:

- Veilpot displayed `Pool operator is ready`
- Veilpot displayed `Exact reviewed Pool operator transaction included successfully`
- Veilpot stated that the exact reviewed transaction and live active Pool operator state were
  reconciled
- participant remained displayed as `RESERVED`
- no transaction retry is required or permitted

Retry / authorization boundary:

- nonce `518` was consumed by this successful operator approval transaction
- transaction `0x62cc18d7c985ff61f49956f99de8f3fa35e67cf00d16a0db6cad3b9de1582754` must not be
  retried
- historical nonce-`517` operator approval remains non-retryable
- the existing reservation transaction remains non-retryable
- this operator approval does not authorize any deposit
- the visible `25.00 cUSDTMock` amount remains unauthorized and must not be reused merely because it
  remains visible in the UI
- no deposit encryption has been authorized
- no deposit transaction has been authorized
- no threshold/public consequence decryption has been authorized

Completed operator-approval safety properties:

- explicit `Review Pool approval` step before any wallet request
- exact 30-minute expiry frozen during review
- exact `setOperator(address,uint48)` calldata displayed before wallet opening
- five-minute review-usability window fails closed
- stale reviews do not silently generate replacement expiry/calldata
- wallet-opening step rechecks live participant/operator state
- submitted transaction identity is preserved for reconciliation
- unresolved submitted transactions block silent retries
- exact mined transaction identity is verified before state reconciliation
- successful inclusion plus live operator state is reconciled before declaring the Pool operator
  ready

Repository completion boundary:

- this checkpoint completes the frontend Pool-operator approval safety repair
- frozen Solidity remains unchanged
- frozen protocol SDK remains unchanged
- frozen evidence remains unchanged
- confidential-deposit signing safety remains a separate future task

Safety result:

- operator approval repair: **COMPLETE**
- successful operator tx count in this completion step: `1`
- deposit transactions: `0`
- encryptions: `0`
- decryptions: `0`
