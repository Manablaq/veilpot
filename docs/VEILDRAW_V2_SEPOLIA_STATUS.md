# VeilDraw V2 Sepolia status

This document is the reviewer-facing status for Veilpot's additive VeilDraw V2 protocol deployment.

It does **not** replace the frozen V1 production frontend deployment. The public application at
https://veilpot.vercel.app remains bound to the already validated V1 production stack.

VeilDraw V2 is maintained on the isolated `feature/veildraw-v2-private-multiprize` branch and is
deployed independently on Ethereum Sepolia.

## Status summary

| Surface                              | Status           |
| ------------------------------------ | ---------------- |
| V2 protocol implementation           | Complete         |
| Private sharded draw engine          | Complete         |
| Three child prizes per snapshot      | Complete         |
| PoolV2 integration                   | Complete         |
| Frozen Autopilot integration         | Complete         |
| Frozen Prize Reserve integration     | Complete         |
| Conserved three-prize yield adapter  | Complete         |
| Reference-model verification         | Pass             |
| Contract verification                | Pass             |
| Clean-checkout reviewer audit        | Pass             |
| Sepolia deterministic deployment     | Complete         |
| Runtime identity verification        | Pass             |
| Circular binding verification        | Pass             |
| Deployment evidence                  | Published        |
| Evidence-checkpoint CI               | Pass             |
| Post-deployment pristine-state audit | Pass             |
| Production frontend switched to V2   | No               |
| Full live V2 three-prize lifecycle   | Not yet executed |

## Frozen checkpoints

Audited V2 protocol source:

`1fd76c6542af8e84aaf8630d285653ac43cd564a`

Sepolia deployment-evidence checkpoint:

`b24ce24fa8dcc5fb9eecbbc209e4ce5d9f7bd9f1`

Frozen deployment-plan SHA-256:

`f58be73b6dc50ec09ae88e2e3ba5416967e71260182a9da4c14c498b0a1296d6`

Evidence-checkpoint GitHub Actions run:

`33954119837` — success

## Sepolia deployment

Network: Ethereum Sepolia

Chain ID: `11155111`

Deployer:

`0x1f87Ae197af539253978d435aD45cCf28Fb95024`

| Component                      | Address                                      |
| ------------------------------ | -------------------------------------------- |
| VeilpotPoolV2                  | `0x6F74fCadDc359159D0799fc9054642aB1f357161` |
| VeilDrawEngineV2               | `0x6cfb163fC9483D0131e2b79c8c8DEFca7A17C232` |
| VeilpotAutopilotVault          | `0xF724E327b94cCf09936cbd84990A71A40b99ad85` |
| VeilpotSimulatedYieldAdapterV2 | `0x40DC00dDB52a1cD7864322e8E938e73f5D494D35` |
| VeilpotPrizeReserve            | `0xCFfA037b25c151FBba0A909d2435D00522CdB00B` |
| Confidential USDT Mock         | `0x4E7B06D78965594eB5EF5414c357ca21E1554491` |
| Zama Wrappers Registry         | `0x2f0750Bbb0A246059d80e94c454586a7F27a128e` |

The Pool created `VeilDrawEngineV2` internally. The remaining three external contracts were deployed
from the same EOA using the frozen deterministic nonce sequence.

## Deployment transactions

| Contract                       | EOA nonce |    Block | Transaction                                                          |
| ------------------------------ | --------: | -------: | -------------------------------------------------------------------- |
| VeilpotPoolV2                  |       528 | 11639048 | `0xf7325e7f2842dbdadf6599872c833ecef0fb3e0b6a7d20ac8d6e2d43e58451e0` |
| VeilpotAutopilotVault          |       529 | 11639049 | `0x06642bab620d14f29772d4c402332fd136a6ebbb77240478f32c6350e5d6ce4f` |
| VeilpotSimulatedYieldAdapterV2 |       530 | 11639050 | `0xc3d2cf2cd51b08801c0bc089f21d18d6ec5842c4d5f1091d17776450e455a715` |
| VeilpotPrizeReserve            |       531 | 11639051 | `0xdb6d2814d952a10bcbd6e2f58b6fd0fa9364f9b2eb47d7a74bbdc3d82c989f57` |

Final confirmed and pending deployer nonce after deployment:

`532`

## Runtime identity

The deployed runtimes were independently compared against the audited local artifacts with
compiler-declared immutable regions normalized.

| Contract                       | Runtime bytes |
| ------------------------------ | ------------: |
| VeilpotPoolV2                  |        23,243 |
| VeilDrawEngineV2               |        13,682 |
| VeilpotAutopilotVault          |         6,792 |
| VeilpotSimulatedYieldAdapterV2 |         8,210 |
| VeilpotPrizeReserve            |        12,741 |

Runtime identity outside immutable regions passed for all five contracts.

The Pool, Engine, Vault, Adapter, and Reserve public bindings were also re-read from Sepolia and
matched the frozen deployment topology.

## V2 architecture

VeilDraw V2 adds an external non-custodial draw engine while keeping custody and principal
accounting inside the Pool.

Key properties:

- maximum 128 participant slots;
- 16 confidential shards of 8 slots each;
- three independent child draws per snapshot;
- encrypted shard selection;
- encrypted winner predicates;
- no public selected-shard index;
- no public winner index;
- exact rejection sampling instead of multiply-high target selection;
- Pool-to-Engine ciphertext transfer through transaction-scoped FHE ACL;
- no token custody or arbitrary-recipient authority in the Engine;
- unchanged historical-beneficiary claim binding;
- unchanged Prize Reserve contract;
- unchanged Autopilot Vault contract;
- conserved three-way simulated-yield partitioning; and
- `FINALIZED == 8` compatibility preserved for the frozen Reserve boundary.

## Verification

The V2 repository checkpoint has passed:

- **114** deterministic reference-model tests;
- **267** contract tests;
- **16** protocol-SDK tests;
- root format validation;
- root TypeScript typecheck;
- root ESLint;
- strict Solidity lint;
- Solidity compilation;
- Gate 0;
- clean-checkout reviewer audit;
- exact production-source hashing;
- deterministic deployment-plan verification;
- Sepolia runtime identity verification;
- circular topology verification; and
- GitHub Actions on the deployment-evidence checkpoint.

The V2 additions are additive. The previously validated V1 production frontend and contracts were
not modified or redeployed as part of the V2 Sepolia deployment.

## Deployment evidence

Canonical V2 deployment evidence:

[`../evidence/production-sepolia/veildraw-v2/deployment.json`](../evidence/production-sepolia/veildraw-v2/deployment.json)

Deployment evidence SHA-256:

`536923d9a87d5238ade2837d72135c44738e6c55ab5e9a98f9c63bd6af866971`

Deployment journal:

[`../evidence/production-sepolia/veildraw-v2/deployment-journal.json`](../evidence/production-sepolia/veildraw-v2/deployment-journal.json)

Deployment journal SHA-256:

`fbc324dfc39e72da7856ebfa7fb5affcf4b86efe48437011d9520466b13bbe69`

## Post-deployment state

A read-only post-deployment audit confirmed the V2 deployment remained pristine after deployment:

- confirmed deployer nonce: `532`;
- pending deployer nonce: `532`;
- active participants: `0`;
- reservation nonce: `0`;
- snapshots: `0`;
- draws: `0`;
- deployer Autopilot plan nonce: `0`;
- deployer yield-funding nonce: `0`;
- deployer sponsor-funding nonce: `0`;
- deployer claim nonce: `0`;
- Pool registration-bond ETH balance: `0`;
- application event logs after deployment: none;
- confidential values decrypted by the audit: `0`; and
- transactions sent by the audit: `0`.

## Live-lifecycle boundary

The V2 Pool starts with a 30-day epoch.

The deployed epoch began at:

`2026-09-05 07:56:12 UTC`

The first epoch boundary is:

`2026-10-05 07:56:12 UTC`

`startSnapshot()` cannot execute before the configured epoch end. Therefore the deployment does not
claim that a complete live V2 three-prize draw was executed on Sepolia before the Season 4
submission deadline.

The three-prize path is covered by the deterministic reference model, local FHEVM contract tests,
PoolV2 integration tests, Reserve integration tests, yield integration tests, and the deployed V2
runtime/evidence boundary.

## Frontend boundary

The public application at https://veilpot.vercel.app remains the frozen, browser-accepted V1
production application.

The V2 deployment has **not** been silently substituted into the production frontend.

This separation is intentional:

1. the validated V1 submission remains stable;
2. the V2 protocol deployment and evidence remain independently reviewable; and
3. a future V2 frontend migration requires its own SDK/config integration, browser E2E validation,
   and explicit production-deployment authorization.

No reviewer should interpret the current public frontend as having executed the V2 three-prize
Sepolia lifecycle.
