# Veilpot production status

This document is the authoritative reviewer-facing status for the current Veilpot repository.

Historical Gate, VeilDraw, and Autopilot design documents preserve earlier engineering checkpoints.
They remain evidence, but this document is the source of truth for current implementation and
submission readiness.

## Current production integration

Veilpot's live browser application is integrated with the corrected V2.x Sepolia deployment.

- Live application: https://veilpot.vercel.app
- Network: Ethereum Sepolia (`11155111`)
- Current application checkpoint: `af7d7a5049df4798c393124494eda84b6d98dca4`
- Corrected deployment evidence:
  [`../evidence/production-sepolia/veildraw-v2x/deployment.json`](../evidence/production-sepolia/veildraw-v2x/deployment.json)
- Live recovery validation: [`LIVE_V2X_E2E.md`](LIVE_V2X_E2E.md)

The former V1 production binding and predecessor V2 deployment are superseded for current frontend
integration but remain available in Git history and historical evidence.

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
- Application-code checkpoint: `af7d7a5049df4798c393124494eda84b6d98dca4`
- Production deployment: `https://veilpot-4llt84a8v-mr-albert-s-projects.vercel.app`
- Push CI run: `33994178317` — success
- Pull-request CI baseline: `33941688451` — success on the preceding integration checkpoint
- Final browser acceptance completed: `2026-09-05`

A later repository head may contain documentation-only closeout changes. The application-code freeze
above identifies the exact validated frontend/protocol integration state.

## Sepolia contracts

Network: Ethereum Sepolia

Chain ID: `11155111`

| Component                      | Address                                      |        Block |
| ------------------------------ | -------------------------------------------- | -----------: |
| VeilpotPoolV2                  | `0x0482DfAeCB4b3B76b9Efd4dEF261445D7bcCFcDA` |   `11640451` |
| VeilDrawEngineV2               | `0x2df32104fadF449dd9Ec50E86008beE85698fb4b` | Pool-created |
| VeilpotAutopilotVault          | `0x12fa9F3d421aec3710Ba8dee9cFb946839fE885A` |   `11640452` |
| VeilpotSimulatedYieldAdapterV2 | `0xAFb21BdD1Ca0f8e8DD4Cb71076e381A1B839582e` |   `11640454` |
| VeilpotPrizeReserve            | `0x553542D5b47b64973D99C04D83991F4AE2b307b2` |   `11640455` |

The active deployment is independently bound in `@veilpot/protocol-sdk`.

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

Canonical corrected V2.x deployment evidence:

[`../evidence/production-sepolia/veildraw-v2x/deployment.json`](../evidence/production-sepolia/veildraw-v2x/deployment.json)

Live production-browser validation:

[`LIVE_V2X_E2E.md`](LIVE_V2X_E2E.md)

The live E2E reconciles the confidential deposit, threshold settlement, refund-completion
settlement, final FREE participant state, registration-bond credit, successful bond withdrawal, and
the later stale-display duplicate that correctly reverted with `InvalidBond`.

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
| Contract tests                      | 268 passing |
| Deterministic reference-model tests | 114 passing |
| Protocol-SDK tests                  | 31 passing  |
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
