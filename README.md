# Veilpot

Veilpot is a confidential prize-savings protocol built for the Zama Developer Program Mainnet Season
4 challenge.

Users contribute confidential ERC-7984 assets to a shared savings pool while Veilpot keeps
individual deposit amounts, balances, draw weights, Autopilot plan amounts, and prize entitlements
encrypted. Periodic VeilDraw selection resolves a winner without publishing every participant's
confidential state.

## Current status

The protocol, Autopilot Vault, Sepolia deployment, live runtime lifecycle evidence, reference model,
and typed protocol SDK are implemented and validated.

The browser frontend has **not started yet**. `apps/web` intentionally remains a README-only
placeholder until the backend reviewer-readiness audit is complete and frontend implementation is
explicitly authorized.

| Layer                      | Status                              |
| -------------------------- | ----------------------------------- |
| Confidential pool          | Implemented and deployed on Sepolia |
| Confidential Autopilot     | Implemented and deployed on Sepolia |
| Simulated yield adapter    | Implemented and deployed on Sepolia |
| Confidential prize reserve | Implemented and deployed on Sepolia |
| Deployment evidence        | Frozen and public                   |
| Runtime lifecycle evidence | Frozen and public                   |
| Typed protocol SDK         | Implemented and frozen              |
| Browser frontend           | Pending                             |
| Public website             | Pending                             |
| 3-minute real-person demo  | Pending                             |
| X thread/article           | Pending                             |

## Sepolia deployment

Chain: Ethereum Sepolia, chain ID `11155111`.

| Component                    | Address                                      |
| ---------------------------- | -------------------------------------------- |
| VeilpotPool                  | `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601` |
| VeilpotAutopilotVault        | `0x7dF64925Af938a0535F30dE9cFBf97BB3ab30487` |
| VeilpotSimulatedYieldAdapter | `0xEa9868e982b98B57C52B95853EdE2552dAD74b64` |
| VeilpotPrizeReserve          | `0xbEe24d1060d94d435272550fAa5616faD59Ad1a1` |
| Confidential USDT Mock       | `0x4E7B06D78965594eB5EF5414c357ca21E1554491` |
| Zama Wrappers Registry       | `0x2f0750Bbb0A246059d80e94c454586a7F27a128e` |

The configured confidential token is Zama's official **testnet mock asset**. It must not be
represented as a production mainnet asset. The yield adapter remains explicitly a simulated
Sepolia-demo integration.

The current Autopilot-v3 deployment record is
[`evidence/production-sepolia/autopilot-v3/deployment.json`](evidence/production-sepolia/autopilot-v3/deployment.json).
The independently frozen live lifecycle record is
[`evidence/production-sepolia/autopilot-v3/runtime-smoke.json`](evidence/production-sepolia/autopilot-v3/runtime-smoke.json).

See [`docs/PRODUCTION_STATUS.md`](docs/PRODUCTION_STATUS.md) for the reviewer-facing deployment,
runtime, SDK, and validation record.

## Protocol SDK

[`@veilpot/protocol-sdk`](packages/protocol-sdk) is the framework-independent integration boundary
for the deployed protocol.

It provides:

- complete frozen Pool, Autopilot Vault, Adapter, and Reserve ABIs;
- exact Autopilot-v3 Sepolia deployment constants;
- production state-enum mirrors;
- the exact eleven-field EIP-712 prize-claim authorization;
- participant reservation, deposit, withdrawal, funding, decryption-authorization, and claim call
  builders;
- exact Autopilot plan-ID and schedule-leaf construction;
- deterministic OpenZeppelin Standard Merkle schedule commitments;
- Autopilot create/fund/execute/advance/skip/pause/resume/revoke/residual-withdrawal/read builders;
- Zama `@zama-fhe/sdk` encryption helpers bound to the exact target contract and submitting user;
- shared-proof encryption of Autopilot period amount and lifetime cap as two `euint64` values; and
- explicit decryption-intent descriptors.

Autopilot plan creation binds both encrypted plan amounts to the Vault and owner under one input
proof. Autopilot funding binds the encrypted amount to the confidential token and owner, then uses
ERC-7984 `confidentialTransferAndCall` to fund the immutable Vault.

The SDK does **not** automatically decrypt confidential values, send transactions, or depend on
React.

See [`docs/INTEGRATION_GUIDE.md`](docs/INTEGRATION_GUIDE.md).

## Validation checkpoint

The current protocol/SDK checkpoint has passed:

- **212** contract tests;
- **102** deterministic reference-model tests;
- **16** protocol-SDK tests;
- exact Pool/Vault/Adapter/Reserve SDK ABI parity with frozen compiled artifacts;
- root TypeScript typechecking;
- root ESLint and Solidity linting;
- protocol-SDK build;
- reference-model build;
- local mock-FHE contract regression; and
- live Autopilot-v3 Sepolia deployment/runtime evidence verification.

Current freezes:

- Autopilot deployment source: `ad437e0edf1f4809a53d045879da28da87c10b78`
- Autopilot deployment/runtime evidence commit: `fb417f62db1ba7936b80c7cfb68b0a42c2fd4972`
- Autopilot-v3 protocol SDK: `de16e473739c28dbd00c731c6a7535ab3400ad0f`
- Deployment evidence SHA-256: `939127735c3ea54763992b8238b09a37a4474d66f6774c0eab5f619328ffcd98`
- Runtime journal SHA-256: `cb9fa6873acbfb04c58be61c643f2a9413aae75aea6afa3143298eac98a5c3ff`
- Runtime evidence SHA-256: `147c83636f21ac13b8e26174cce1abe1a02d18f496d42d00aa53a7e8d0b8729a`

## Privacy and security boundaries

Veilpot is designed around encrypted consequential state.

Among the current frozen rules:

- deposit amounts, user balances, weights, Autopilot plan amounts, and prize entitlements remain
  confidential;
- encrypted inputs are bound to the intended contract and submitting user;
- Autopilot plan amount and lifetime cap use two encrypted `euint64` inputs under one shared proof;
- the user's wallet and permissionless executor receive no standing token-operator authority;
- Autopilot execution uses the immutable Vault-to-Pool path and accounts from actual confidential
  token transfer results;
- deterministic schedules commit to exact execution windows through a Standard Merkle root;
- winner selection does not publicly expose the full confidential participant state;
- entitlement decryption is opt-in rather than automatic;
- prize claims bind an exact eleven-field EIP-712 authorization;
- claim participant and recipient identity are locked to the historical owner;
- replay-sensitive operations use explicit nonces;
- proof-pending states have explicit recovery/liveness handling; and
- historical beneficiary/weight bindings remain available after terminal participant tombstoning.

Detailed historical engineering evidence remains under [`docs/`](docs/). Historical Gate documents
preserve the design and verification state at the time they were authored and are not the current
top-level product-status source of truth.

## Repository map

- `packages/contracts` — confidential protocol contracts, tests, and deployment tooling
- `packages/reference-model` — deterministic protocol/reference-model verification
- `packages/protocol-sdk` — frozen typed client integration layer
- `evidence/production-sepolia/autopilot-v3` — current Autopilot deployment/runtime evidence
- `evidence/production-sepolia` — current plus historical public deployment evidence
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
3. [Autopilot-v3 deployment evidence](evidence/production-sepolia/autopilot-v3/deployment.json)
4. [Autopilot-v3 runtime lifecycle evidence](evidence/production-sepolia/autopilot-v3/runtime-smoke.json)
5. [Protocol SDK](packages/protocol-sdk)
6. [Gate 1 architecture](docs/GATE_1_ARCHITECTURE.md)
7. [Gate 1 security model](docs/GATE_1_SECURITY_MODEL.md)
8. [Gate 1 privacy ledger](docs/GATE_1_PRIVACY_LEDGER.md)
9. [Gate 1 test plan](docs/GATE_1_TEST_PLAN.md)
