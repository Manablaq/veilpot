# Veilpot production status

This document is the authoritative reviewer-facing status for the current Veilpot repository.

Historical Gate and VeilDraw documents preserve earlier design and verification checkpoints. They
remain engineering evidence but are not the source of truth for the current implementation status.

## Current checkpoint

- Autopilot deployment source: `ad437e0edf1f4809a53d045879da28da87c10b78`
- Autopilot deployment/runtime evidence freeze: `fb417f62db1ba7936b80c7cfb68b0a42c2fd4972`
- Autopilot-v3 protocol SDK freeze: `de16e473739c28dbd00c731c6a7535ab3400ad0f`
- Deployment evidence SHA-256: `939127735c3ea54763992b8238b09a37a4474d66f6774c0eab5f619328ffcd98`
- Runtime journal SHA-256: `cb9fa6873acbfb04c58be61c643f2a9413aae75aea6afa3143298eac98a5c3ff`
- Runtime evidence SHA-256: `147c83636f21ac13b8e26174cce1abe1a02d18f496d42d00aa53a7e8d0b8729a`

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

These classifications are deliberate. Veilpot must not present the Sepolia mock token or simulated
yield adapter as a real production-mainnet asset/yield integration.

## Deployment evidence

The canonical current deployment record is:

[`evidence/production-sepolia/autopilot-v3/deployment.json`](../evidence/production-sepolia/autopilot-v3/deployment.json)

Evidence SHA-256:

`939127735c3ea54763992b8238b09a37a4474d66f6774c0eab5f619328ffcd98`

The record binds:

- deployment source commit;
- deployer address and starting nonce;
- deterministic four-contract CREATE order;
- exact Pool/Vault/Adapter/Reserve addresses;
- exact mined transaction hashes and blocks;
- confidential token and wrappers-registry identities;
- exact Pool-to-Vault and Vault-to-Pool immutable bindings;
- compiler-declared immutable ranges; and
- local/deployed normalized runtime identities.

The historical pre-Autopilot deployment record remains under
`evidence/production-sepolia/deployment.json` for provenance and is not the current integration
target.

## Live runtime lifecycle evidence

The canonical current runtime lifecycle record is:

[`evidence/production-sepolia/autopilot-v3/runtime-smoke.json`](../evidence/production-sepolia/autopilot-v3/runtime-smoke.json)

Runtime evidence SHA-256:

`147c83636f21ac13b8e26174cce1abe1a02d18f496d42d00aa53a7e8d0b8729a`

The corresponding immutable runtime journal SHA-256 is:

`cb9fa6873acbfb04c58be61c643f2a9413aae75aea6afa3143298eac98a5c3ff`

The live evidence validates the production lifecycle across the current four-contract deployment,
including:

- registration and threshold-proof settlement;
- registration-bond recovery;
- confidential Autopilot plan creation;
- ERC-7984 `confidentialTransferAndCall` plan funding;
- scheduled permissionless Autopilot execution;
- exact transient operator grant/pull/revoke behavior;
- replay rejection after consumed execution;
- full principal withdrawal and TWAB checkpointing;
- KMS-backed deregistration proof settlement;
- terminal participant tombstoning;
- historical beneficiary and weight binding after tombstoning; and
- absence of residual wallet/Vault operator edges after completion.

The frozen live plan used plan ID
`0x2c9d9797c99c7b48856127e0cfc47ac3dea70c2091aa49d1f0fd7c8acac4c534` and schedule root
`0xd3dfac053b783e1dfbe0e0df5f070e25b2b9b670ca4c9cc8a226ea95333b093a`.

## Runtime and source identity

The current deployed Pool, Vault, Adapter, and Reserve normalized runtime identities match the
frozen compiled artifacts recorded by the deployment/runtime evidence.

| Component | Normalized runtime SHA-256                                         |
| --------- | ------------------------------------------------------------------ |
| Pool      | `d1ad1d24c304558f29f62a0ae89584d4f7b3382ee7198f0f8015ed5c816d076f` |
| Vault     | `a79e7a5fd69729be992e09deaf74534fbbf31c9a1b954bde67ee9280e0b6521d` |
| Adapter   | `b62902dd43d2ff5ef3187efc10d4d4b22b7e20c9a1d0df88c3a77635ee33590f` |
| Reserve   | `7bf278b467b358666e73a12f2856c93385504b74a7567eb27caf0b5b1e11559f` |

Frozen Solidity source SHA-256 values:

| Component | Source SHA-256                                                     |
| --------- | ------------------------------------------------------------------ |
| Pool      | `bd06e4f9217ffa6d584a518cb93ae0504221c760e4c6f17656d114262a82710e` |
| Vault     | `d003c095c3260ce34ff2c4bd8559b306b092c6655c6ac030c5a9059a87c1d384` |
| Adapter   | `3bb7593778e0d0a5b4b9c9b24745a28d7d97bbff85e63185046cda36212165fc` |
| Reserve   | `b325862cd9bdb542ffd2b3580c3d80a63efcc8ef50c4cfbd5ffa847ca0ca6dd0` |

## Validation status

The current protocol/SDK checkpoint has passed:

| Validation                          | Result      |
| ----------------------------------- | ----------- |
| Contract tests                      | 212 passing |
| Deterministic reference-model tests | 102 passing |
| Protocol-SDK tests                  | 16 passing  |
| Reference-model build               | Pass        |
| Protocol-SDK build                  | Pass        |
| Root TypeScript typecheck           | Pass        |
| Root ESLint                         | Pass        |
| Solidity lint                       | Pass        |
| Four-contract SDK ABI parity        | Pass        |
| Autopilot deployment evidence audit | Pass        |
| Live runtime lifecycle evidence     | Pass        |
| Local mock-FHE regression           | Pass        |

The local contract test environment and Sepolia compilation environment use different FHEVM address
profiles. Local FHEVM tests must therefore be compiled for the local mock profile before execution.
The production evidence separately freezes the mined Sepolia runtime/source identities.

This is an artifact-profile distinction, not a Solidity source difference.

## Protocol SDK status

The framework-independent protocol SDK is implemented and frozen at
[`packages/protocol-sdk`](../packages/protocol-sdk).

The current SDK includes:

- exact Pool, Vault, Adapter, and Reserve ABIs;
- exact Autopilot-v3 Sepolia addresses and evidence hashes;
- exact production state ordinals;
- exact claim EIP-712 authorization construction;
- exact Autopilot plan-ID and schedule-leaf builders;
- Standard Merkle schedule construction;
- shared-proof two-`euint64` Autopilot plan encryption;
- ERC-7984 confidential transfer-and-call funding;
- permissionless execute and missed-window advancement;
- owner skip/pause/resume/revoke/residual-fund withdrawal builders;
- explicit plan metadata/amount read builders; and
- explicit, user-initiated decryption descriptors.

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

## Formatting/provenance boundary

The repository's root Prettier check excludes a small exact set of archival/provenance anchors whose
bytes are intentionally preserved:

- historical Gate documents authored under earlier formatting baselines;
- the frozen Autopilot runtime journal; and
- the deployed/frozen Pool and Autopilot Vault source files.

Those exclusions do not relax protocol validation. Current reviewer-facing documents and current SDK
changes remain Prettier-checked, while frozen evidence/source identity is enforced by SHA-256 and
Git blob boundaries.

## Integration status

The browser frontend has not yet been implemented. No current document should claim the Season 4
dApp submission is complete until the backend reviewer-readiness audit is complete, frontend
implementation is explicitly authorized, the browser application is implemented and deployed, live
browser E2E passes against this frozen Sepolia deployment, and the required submission media are
complete.

See [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md) for the current browser-integration boundary.
