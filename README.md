# Veilpot

Veilpot is a confidential prize-savings protocol built for the Zama Developer Program Mainnet Season
4 challenge.

Users contribute confidential ERC-7984 assets to a shared savings pool while Veilpot keeps
individual deposit amounts, balances, draw weights, and prize entitlements encrypted. Periodic
VeilDraw selection resolves a winner without publishing every participant's confidential state.

## Current status

The protocol, deployment tooling, Sepolia contracts, deployment evidence, reference model, and typed
protocol SDK are implemented and validated.

The browser frontend has **not started yet**. `apps/web` intentionally remains a README-only
placeholder until the frozen protocol integration layer is complete.

| Layer                      | Status                              |
| -------------------------- | ----------------------------------- |
| Confidential pool          | Implemented and deployed on Sepolia |
| Simulated yield adapter    | Implemented and deployed on Sepolia |
| Confidential prize reserve | Implemented and deployed on Sepolia |
| Deployment evidence        | Frozen and public                   |
| Typed protocol SDK         | Implemented and frozen              |
| Browser frontend           | Pending                             |
| Public website             | Pending                             |
| 3-minute real-person demo  | Pending                             |
| X thread/article           | Pending                             |

## Sepolia deployment

Chain: Ethereum Sepolia, chain ID `11155111`.

| Component                    | Address                                      |
| ---------------------------- | -------------------------------------------- |
| VeilpotPool                  | `0x3beB5C46b5982b0029a6fbC39A9313ee8D19eb6B` |
| VeilpotSimulatedYieldAdapter | `0xe1FbD1fBe801c00f13aF44E1D4e3B4271aDF0f56` |
| VeilpotPrizeReserve          | `0xf748bF23C9f1C020Dcf3eb96c955904FCD8b40b0` |
| Confidential USDT Mock       | `0x4E7B06D78965594eB5EF5414c357ca21E1554491` |
| Zama Wrappers Registry       | `0x2f0750Bbb0A246059d80e94c454586a7F27a128e` |

The configured confidential token is Zama's official **testnet mock asset**. It must not be
represented as a production mainnet asset.

Exact deployment transaction hashes, blocks, runtime identities, immutable-reference normalization,
source commit, and recovery commit are recorded in
[`evidence/production-sepolia/deployment.json`](evidence/production-sepolia/deployment.json).

See [`docs/PRODUCTION_STATUS.md`](docs/PRODUCTION_STATUS.md) for the reviewer-facing deployment and
validation record.

## Protocol SDK

[`@veilpot/protocol-sdk`](packages/protocol-sdk) is the framework-independent integration boundary
for the deployed protocol.

It provides:

- the complete frozen Pool, Adapter, and Reserve ABIs;
- exact Sepolia deployment constants;
- production state-enum mirrors;
- the exact eleven-field EIP-712 prize-claim authorization;
- contract-call builders for participant reservation, deposits, withdrawals, funding,
  entitlement-decryption authorization, and prize claims;
- Zama `@zama-fhe/sdk` encryption helpers bound to the exact target contract and user; and
- explicit decryption-intent descriptors.

The SDK does **not** automatically decrypt confidential values and contains no React dependency.

See [`docs/INTEGRATION_GUIDE.md`](docs/INTEGRATION_GUIDE.md).

## Validation checkpoint

The frozen protocol/SDK checkpoint has passed:

- **187** contract tests;
- **77** deterministic reference-model tests;
- **8** protocol-SDK tests;
- root TypeScript typechecking;
- root ESLint;
- Solidity linting;
- protocol-SDK build;
- reference-model build;
- local mock-FHE contract regression; and
- restoration of the exact artifact profile matching the mined Sepolia deployments.

Protocol SDK freeze:

`eb4df55b3a70ac893caa10116ad01740bf9fedc5`

Deployment evidence freeze:

`4b18babce6690ffe57ae5a730edb51ab81bd93bc`

## Privacy and security boundaries

Veilpot is designed around encrypted consequential state.

Among the frozen rules:

- deposit amounts, user balances, weights, and prize entitlements remain confidential;
- encrypted inputs are bound to the intended contract and submitting user;
- winner selection does not publicly expose the full confidential participant state;
- entitlement decryption is opt-in rather than automatic;
- prize claims bind an exact eleven-field EIP-712 authorization;
- claim participant and recipient identity are locked to the historical owner;
- replay-sensitive operations use explicit nonces;
- proof-pending states have explicit recovery/liveness handling; and
- accounting uses actual confidential-token transfer results rather than assumed amounts.

Detailed historical engineering evidence remains in the Gate and VeilDraw documents under
[`docs/`](docs/). Those files intentionally preserve the design and verification state at the time
each gate was authored and should not be interpreted as the current top-level product status.

## Repository map

- `packages/contracts` — confidential protocol contracts, tests, and deployment tooling
- `packages/reference-model` — deterministic protocol/reference-model verification
- `packages/protocol-sdk` — frozen typed client integration layer
- `evidence/production-sepolia` — public deployment evidence
- `docs` — current reviewer status plus historical engineering evidence
- `apps/web` — frontend placeholder; implementation pending

## Reproducible checks

Use Node 22 and the pinned workspace package manager.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @veilpot/reference-model test
pnpm --filter @veilpot/reference-model build
pnpm --filter @veilpot/protocol-sdk build
pnpm --filter @veilpot/protocol-sdk test
```

For the contract suite, compile against the intended execution profile before running tests. Local
mock-FHE tests require the local Hardhat artifact profile; the production evidence records the
separately verified Sepolia artifact/runtime identities.

## Reviewer entry points

1. [Current production status](docs/PRODUCTION_STATUS.md)
2. [Frontend integration guide](docs/INTEGRATION_GUIDE.md)
3. [Frozen deployment evidence](evidence/production-sepolia/deployment.json)
4. [Protocol SDK](packages/protocol-sdk)
5. [Gate 1 architecture](docs/GATE_1_ARCHITECTURE.md)
6. [Gate 1 security model](docs/GATE_1_SECURITY_MODEL.md)
7. [Gate 1 privacy ledger](docs/GATE_1_PRIVACY_LEDGER.md)
8. [Gate 1 test plan](docs/GATE_1_TEST_PLAN.md)
