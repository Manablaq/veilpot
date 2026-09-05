# Veilpot testing and reproducibility

This guide defines the supported deterministic verification path for the current Veilpot repository.

## Supported toolchain

- Node.js: `>=22 <23`
- Verified final-audit runtime: `v22.23.2`
- pnpm: `10.18.3`

The root package manager and engine constraints are intentionally pinned.

## Clean checkout

```bash
corepack enable
pnpm install --frozen-lockfile
```

No deployment private key is required for the ordinary local verification gate.

## Complete repository gate

```bash
pnpm check
```

The root gate executes:

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm compile`
5. `pnpm test`
6. `pnpm gate0`

The lint command builds both the reference model and protocol SDK before type-aware ESLint. This is
required because `@veilpot/protocol-sdk` publishes its type entry point from ignored generated
`dist` output.

## Clean generated-state proof

To reproduce the clean-checkout dependency boundary:

```bash
rm -rf packages/protocol-sdk/dist
rm -rf packages/reference-model/dist
rm -rf packages/contracts/artifacts
rm -rf packages/contracts/cache
rm -rf packages/contracts/typechain-types
rm -rf apps/web/.next

find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete

pnpm lint
pnpm typecheck
pnpm compile
pnpm test
pnpm gate0
pnpm --filter @veilpot/web build
```

`pnpm lint` must recreate `packages/protocol-sdk/dist/src/index.d.ts` by itself.

## Current deterministic results

Final audit results:

- reference model: **114 passing**;
- contracts: **268 passing**;
- protocol SDK: **31 passing**;
- Solidity compile: **pass**;
- Gate 0 reference-model suite: **114 passing**;
- Gate 0 VeilDrawProbe suite: **35 passing**;
- production Next.js build: **pass**.

## CI

GitHub Actions uses Node 22 and pnpm 10.18.3 with frozen-lockfile installation.

The final code freeze passed both:

- push run `33941687165`; and
- pull-request run `33941688451`.

Each completed checkout/setup, frozen install, format check, lint, typecheck, contract compile, full
tests, and Gate 0.

The additive VeilDraw V2 deployment-evidence checkpoint also passed the complete push CI pipeline:

- V2 evidence checkpoint: `b24ce24fa8dcc5fb9eecbbc209e4ce5d9f7bd9f1`;
- Gate 0 CI run: `33954119837`;
- result: **success**.

The V2 checkpoint includes **114** reference-model tests, **267** contract tests, and **16**
protocol-SDK tests.

## Clean-checkout lint incident and fix

During final submission audit, local lint initially passed while GitHub CI failed with 1,452
type-aware ESLint errors.

The failure was reproduced deterministically by deleting only `packages/protocol-sdk/dist`.
Rebuilding `@veilpot/protocol-sdk` recreated the declaration entry point and the same lint
invocation passed without changing application code.

The root cause was therefore build ordering, not 1,452 independent code defects.

The root `lint` script now builds `@veilpot/protocol-sdk` before ESLint, making the lint gate
self-contained on a fresh checkout.

## Web production build

```bash
pnpm --filter @veilpot/web build
```

The final audit production build compiled successfully, completed TypeScript, generated all static
pages, and produced the public/auth application routes.

## Production deployment acceptance

Current validated application checkpoint:

`af7d7a5049df4798c393124494eda84b6d98dca4`

Current push CI:

`33994178317` — **success**

Production deployment:

`https://veilpot-4llt84a8v-mr-albert-s-projects.vercel.app`

Production alias:

https://veilpot.vercel.app

Release verification confirmed:

- local and remote branch heads matched the application checkpoint;
- release worktree was clean;
- `/` returned HTTP 200;
- `/app` returned HTTP 200;
- contracts were unchanged;
- protocol-SDK source was unchanged;
- deployment evidence was unchanged; and
- the stale-bond retry guard was deployed successfully.

The documentation-only closeout that follows this application checkpoint does not require another
on-chain lifecycle test.

## Browser acceptance

The final user-visible production regression passed the public landing page, themes, responsive
layout, wallet chooser, authentication, session restoration, Home/Profile privacy placeholders,
Privacy Shield, navigation, Deposit, Withdraw, Autopilot, VeilDraw, Prize, fake/demo-value sweep,
and final authenticated refresh.

The browser acceptance did not require a new deposit, withdrawal, Autopilot execution, draw,
decryption, settlement, or prize claim.

## Live protocol evidence

Historical live network operations are preserved separately under
[`../evidence/production-sepolia`](../evidence/production-sepolia).

The final repository verification gate must not be confused with an instruction to replay already
completed lifecycle transactions.

## Artifact profiles

Local mock-FHE tests and Sepolia production evidence may use different FHEVM address/compiler
profiles while preserving the reviewed Solidity source.

Production evidence separately freezes mined runtime/source identity.
