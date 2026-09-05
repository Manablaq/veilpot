# Veilpot production status

This document is the authoritative reviewer-facing status for the current Veilpot repository.

Historical Gate, VeilDraw, and Autopilot design documents preserve earlier engineering checkpoints.
They remain evidence, but this document is the source of truth for current implementation and
submission readiness.

## V1 production / V2 protocol boundary

Veilpot currently has two deliberately separate verified tracks:

- **V1 production application** — the browser-accepted application at https://veilpot.vercel.app
  remains bound to the previously frozen V1 Sepolia deployment.
- **VeilDraw V2 protocol deployment** — the additive private-sharded three-prize protocol is
  independently deployed on Sepolia on `feature/veildraw-v2-private-multiprize`, with
  deployment/runtime evidence committed and CI-green.

The V2 deployment has not been silently substituted into the production frontend.

V2 audited source checkpoint:

`1fd76c6542af8e84aaf8630d285653ac43cd564a`

V2 deployment-evidence checkpoint:

`b24ce24fa8dcc5fb9eecbbc209e4ce5d9f7bd9f1`

V2 evidence-checkpoint CI run:

`33954119837` — success

See [`VEILDRAW_V2_SEPOLIA_STATUS.md`](VEILDRAW_V2_SEPOLIA_STATUS.md) for the exact V2 addresses,
transaction hashes, runtime identity, deterministic deployment plan, pristine post-deployment state,
and live-epoch boundary.

## Current checkpoint

| Surface                       | Status                               |
| ----------------------------- | ------------------------------------ |
| Confidential Pool             | Implemented and deployed             |
| Confidential Autopilot Vault  | Implemented and deployed             |
| Simulated Yield Adapter       | Implemented and deployed             |
| Confidential Prize Reserve    | Implemented and deployed             |
| Protocol SDK                  | Implemented and production-bound     |
| Browser frontend              | Implemented                          |
| Public website                | Live                                 |
| Wallet authentication         | Implemented and production-validated |
| Privacy-first value rendering | Implemented                          |
| Exact wallet-action review    | Implemented and tested               |
| Production browser acceptance | Passed                               |
| Push CI                       | Passed                               |
| Pull-request CI               | Passed                               |
| Submission media              | External publication pending         |

- Live application: https://veilpot.vercel.app
- Application-code freeze: `9c82463bd56d3c23c0a248c9314ece9d728b76fa`
- Production deployment validated for that code freeze: `dpl_2avvhvKmog4vLyAaotkc11XNUUBK`
- Push CI run: `33941687165`
- Pull-request CI run: `33941688451`
- Final browser acceptance completed: `2026-09-05`

A later repository head may contain documentation-only closeout changes. The application-code freeze
above identifies the exact validated frontend/protocol integration state.

## Sepolia contracts

Network: Ethereum Sepolia

Chain ID: `11155111`

Deployer:

`0x1f87Ae197af539253978d435aD45cCf28Fb95024`

| Component                    | Address                                      | Deployment nonce |    Block |
| ---------------------------- | -------------------------------------------- | ---------------: | -------: |
| VeilpotPool                  | `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601` |              490 | 11614331 |
| VeilpotAutopilotVault        | `0x7dF64925Af938a0535F30dE9cFBf97BB3ab30487` |              491 | 11614332 |
| VeilpotSimulatedYieldAdapter | `0xEa9868e982b98B57C52B95853EdE2552dAD74b64` |              492 | 11614333 |
| VeilpotPrizeReserve          | `0xbEe24d1060d94d435272550fAa5616faD59Ad1a1` |              493 | 11614334 |

Deployment transactions:

- Pool: `0xe4eebc4ddede885450523b93b289e85f240dfefe0b1781d7b53f387437ad4ea0`
- Vault: `0x5f96f76ced42c123cbcd0fb2090e3bf79159d371183e5751602b98aface3fe96`
- Adapter: `0xf748b2dd137ec2f61f0b9b85311e001f378019a412672bcdb78eebcae7c04810`
- Reserve: `0x67d27897e2d2a52497b6679504215a72868bfdc0153ae1181e85642e796f1fef`

## Zama testnet dependencies

Confidential token:

`0x4E7B06D78965594eB5EF5414c357ca21E1554491`

Wrappers Registry:

`0x2f0750Bbb0A246059d80e94c454586a7F27a128e`

The configured token is Zama's official Sepolia **Confidential USDT Mock** and is classified in the
deployment evidence as `OFFICIAL_ZAMA_TESTNET_MOCK_ASSET`. The current yield integration is
explicitly `SIMULATED_YIELD_FOR_SEPOLIA_DEMO`.

These classifications are deliberate. Veilpot does not present the Sepolia mock token or simulated
yield adapter as a production-mainnet asset or production yield source.

## Deployment and runtime evidence

The canonical current deployment record is:

[`../evidence/production-sepolia/autopilot-v3/deployment.json`](../evidence/production-sepolia/autopilot-v3/deployment.json)

Deployment evidence SHA-256:

`939127735c3ea54763992b8238b09a37a4474d66f6774c0eab5f619328ffcd98`

The canonical current runtime lifecycle record is:

[`../evidence/production-sepolia/autopilot-v3/runtime-smoke.json`](../evidence/production-sepolia/autopilot-v3/runtime-smoke.json)

Runtime evidence SHA-256:

`147c83636f21ac13b8e26174cce1abe1a02d18f496d42d00aa53a7e8d0b8729a`

Immutable runtime journal SHA-256:

`cb9fa6873acbfb04c58be61c643f2a9413aae75aea6afa3143298eac98a5c3ff`

The live evidence covers:

- registration and threshold-proof settlement;
- registration-bond recovery;
- confidential Autopilot plan creation;
- ERC-7984 `confidentialTransferAndCall` plan funding;
- scheduled permissionless Autopilot execution;
- transient operator grant/pull/revoke behavior;
- replay rejection after consumed execution;
- principal withdrawal and TWAB checkpointing;
- KMS-backed deregistration proof settlement;
- terminal participant tombstoning;
- historical beneficiary/weight binding after tombstoning; and
- absence of residual wallet/Vault operator edges after completion.

## Browser frontend status

The production browser application is implemented in [`../apps/web`](../apps/web) and deployed at
https://veilpot.vercel.app.

It includes:

- public landing/trust/privacy surfaces;
- light, dark, and system appearance modes;
- wallet connection and wallet-signature authentication;
- session restoration with bounded RPC verification behavior;
- safe/public live account-state reads;
- confidential deposit preparation;
- withdrawal preparation;
- Autopilot plan, funding, lifecycle, and recovery controls;
- VeilDraw lifecycle controls;
- prize/claim controls;
- Privacy Shield presentation;
- mobile/responsive navigation; and
- explicit encrypted/not-decrypted placeholders where the browser does not possess legitimate
  decryption authority.

The frontend intentionally does not convert encrypted values into fake account numbers. Illustrative
public landing-page preview content is labeled as illustrative and not connected-wallet state.

## Frontend security status

The current browser implementation includes:

- exact reviewed transaction identity bound to sender, chain, destination, calldata, native value,
  account nonce, and review age;
- post-submission reconciliation of mined sender, destination, calldata, nonce, and native value;
- fail-closed handling for changed wallet/network/nonce/calldata/value;
- protocol-SDK-only frozen deployment/ABI/state/call construction;
- encrypted input binding to the exact target contract and submitting user;
- no automatic confidential-value decryption on page mount, wallet connect, or session restore;
- no standing keeper custody or beneficiary decryption authority;
- explicit user action before wallet signatures, transactions, and legitimate decryption flows;
- safe/public provenance for dashboard lifecycle state; and
- separation of transaction inclusion from confidential proof finality.

See [`FRONTEND_SECURITY_MODEL.md`](FRONTEND_SECURITY_MODEL.md).

## Validation status

The current repository checkpoint has passed:

| Validation                          | Result      |
| ----------------------------------- | ----------- |
| Contract tests                      | 267 passing |
| Deterministic reference-model tests | 114 passing |
| Protocol-SDK tests                  | 16 passing  |
| Reference-model build               | Pass        |
| Protocol-SDK clean build            | Pass        |
| Root TypeScript typecheck           | Pass        |
| Root ESLint                         | Pass        |
| Solidity lint                       | Pass        |
| Contract compile                    | Pass        |
| Gate 0                              | Pass        |
| Production web build                | Pass        |
| Push CI                             | Pass        |
| Pull-request CI                     | Pass        |
| Live deployment/runtime evidence    | Pass        |
| Production browser acceptance       | Pass        |

The clean-checkout CI failure discovered during final audit was caused by type-aware ESLint
executing before `@veilpot/protocol-sdk` had generated its ignored `dist` declarations. The root
`lint` script now builds the SDK before ESLint. The exact clean-checkout failure was reproduced
locally, the dependency-order fix was proven under Node 22, and both push and pull-request CI passed
after the fix.

See [`TESTING_AND_REPRODUCIBILITY.md`](TESTING_AND_REPRODUCIBILITY.md).

## Privacy/security status

The frozen implementation includes:

- confidential participant balances and draw weights;
- confidential Autopilot plan period/lifetime/fund amounts;
- bounded confidential winner-selection work;
- confidential prize entitlement;
- no automatic beneficiary decryption;
- exact contract/user binding for SDK-produced encrypted inputs;
- no standing user-wallet or permissionless-executor token authority;
- exact historical-owner claim authorization binding;
- participant-global replay nonce;
- EOA and ERC-1271 authorization support;
- transfer-result-driven accounting;
- deadline/retry handling for proof-pending settlement states; and
- historical beneficiary/weight preservation after terminal participant tombstoning.

## Formatting and provenance boundary

The root Prettier check excludes a small exact set of archival/provenance anchors whose bytes are
intentionally preserved. Those exclusions do not relax protocol validation.

Current reviewer-facing documents remain Prettier-checked. Frozen evidence/source identity remains
protected by hash and Git history boundaries.

## Submission boundary

The engineering and production acceptance work is complete at the application-code freeze above. The
required real-person demo video and X thread/article are external submission media and remain
separate from the codebase until published.

No additional deposit, withdrawal, Autopilot execution, threshold decryption, draw, prize claim, or
other on-chain lifecycle transaction is required for repository closeout.
