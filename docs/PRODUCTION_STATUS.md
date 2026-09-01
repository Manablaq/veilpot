# Veilpot production status

This document is the authoritative reviewer-facing status for the current Veilpot repository.

Historical Gate and VeilDraw documents preserve earlier design and verification checkpoints. They
remain useful engineering evidence but are not the source of truth for the current implementation
status.

## Current checkpoint

- Protocol SDK freeze: `eb4df55b3a70ac893caa10116ad01740bf9fedc5`
- Deployment evidence freeze: `4b18babce6690ffe57ae5a730edb51ab81bd93bc`
- Runtime-identity recovery freeze: `d7b96c9391060b6f7b3b7bd4305f3cc71ddaa68e`
- Original Sepolia deployment-runner freeze: `c0fb1a9dba5d384a1745c5e7c5f9f1348f4d89d3`
- Final confidential claim-settlement contract freeze: `3b84c4029deba704910cca3d6591e730d78f7b91`

## Sepolia contracts

Network: Ethereum Sepolia

Chain ID: `11155111`

Deployer:

`0x1f87Ae197af539253978d435aD45cCf28Fb95024`

| Component                    | Address                                      | Deployment nonce |    Block |
| ---------------------------- | -------------------------------------------- | ---------------: | -------: |
| VeilpotPool                  | `0x3beB5C46b5982b0029a6fbC39A9313ee8D19eb6B` |              487 | 11609481 |
| VeilpotSimulatedYieldAdapter | `0xe1FbD1fBe801c00f13aF44E1D4e3B4271aDF0f56` |              488 | 11609482 |
| VeilpotPrizeReserve          | `0xf748bF23C9f1C020Dcf3eb96c955904FCD8b40b0` |              489 | 11609484 |

Deployment transactions:

- Pool: `0x14ba134d6b220e9f572ed78ae1e6063c938045e4bef542fdc5122eefe1b492c1`
- Adapter: `0x51f872938b4929e1c918d3c8388f5408a4337cd750bbdd31313cc9899c73bf2d`
- Reserve: `0x6f00e4c30a4c6725758eea86ad6e6d5e9bb137c043176b6c1afca5746ba29a27`

## Zama testnet dependencies

Confidential token:

`0x4E7B06D78965594eB5EF5414c357ca21E1554491`

Wrappers Registry:

`0x2f0750Bbb0A246059d80e94c454586a7F27a128e`

The configured token is Zama's official Sepolia **Confidential USDT Mock** and is classified in the
deployment evidence as `OFFICIAL_ZAMA_TESTNET_MOCK_ASSET`. The current yield integration is
explicitly a `SIMULATED_YIELD_FOR_SEPOLIA_DEMO`.

These classifications are deliberate. Veilpot must not present the Sepolia mock token or simulated
yield adapter as a real production-mainnet asset/yield integration.

## Deployment evidence

The canonical machine-readable record is:

[`evidence/production-sepolia/deployment.json`](../evidence/production-sepolia/deployment.json)

Evidence SHA-256:

`ba6f9d5b35dc7373382b9e49bcb9e6ff4628d0cad106236a4bedd97b7ab64109`

The record binds:

- original deployment source commit;
- evidence-recovery commit;
- deployer address;
- starting nonce;
- deterministic CREATE order;
- deployed contract addresses;
- exact mined deployment transaction hashes and blocks;
- Zama token and registry identities;
- raw deployed runtime hashes;
- compiler-declared immutable-reference ranges; and
- immutable-normalized runtime identities.

The evidence contains no private key, mnemonic, RPC URL, seed phrase, or secret-bearing field.

## Runtime and creation-code identity

The deployed Pool, Adapter, and Reserve runtime identities were independently checked against the
frozen compiled artifacts.

Because Solidity constructor immutables patch runtime locations after deployment, raw runtime
templates cannot be compared directly without accounting for compiler-declared immutable references.
Veilpot therefore verifies byte-for-byte equality outside those exact immutable ranges and compares
normalized runtime hashes.

Frozen normalized runtime hashes:

| Component | Normalized runtime SHA-256                                         |
| --------- | ------------------------------------------------------------------ |
| Pool      | `ab0c10bd6c3643a0619b1c0dfb67a2626c59ed959ee3295a36f6c6a8b42a75c3` |
| Adapter   | `b62902dd43d2ff5ef3187efc10d4d4b22b7e20c9a1d0df88c3a77635ee33590f` |
| Reserve   | `7bf278b467b358666e73a12f2856c93385504b74a7567eb27caf0b5b1e11559f` |

The Sepolia-profile creation bytecode was also compared directly with the creation-code prefix in
each mined deployment transaction.

| Component | Mined Sepolia creation SHA-256                                     |
| --------- | ------------------------------------------------------------------ |
| Pool      | `a040b2ffaad82b2bffaee0fae7aca6d40ad73139991f962f60234ec9e0bae5f8` |
| Adapter   | `2194c7561888707c55b2d285db10675e4106bc42b2e64f9152894fa7e6fa9e8d` |
| Reserve   | `2b291c37f42c07a9ae7f51c6b6637b3dd7392936ac7d4d16b310361dd9492b2f` |

The fully reconstructed constructor initcode matched the mined transaction data for all three
deployments.

## Validation status

The current frozen protocol/SDK checkpoint has passed:

| Validation                           | Result      |
| ------------------------------------ | ----------- |
| Contract tests                       | 187 passing |
| Deterministic reference-model tests  | 77 passing  |
| Protocol-SDK tests                   | 8 passing   |
| Reference-model build                | Pass        |
| Protocol-SDK build                   | Pass        |
| Root TypeScript typecheck            | Pass        |
| Root ESLint                          | Pass        |
| Solidity lint                        | Pass        |
| Deployment evidence audit            | Pass        |
| Local mock-FHE regression            | Pass        |
| Sepolia artifact-profile restoration | Pass        |

The local contract test environment and the Sepolia compilation environment use different FHEVM
address profiles. Local FHEVM tests must therefore be compiled for the local mock profile before
execution. After local regression, the exact mined-Sepolia artifact profile was restored and
reverified.

This is an artifact-profile distinction, not a Solidity source difference.

## Privacy/security status

The frozen implementation includes:

- confidential participant balances and draw weights;
- bounded confidential winner-selection work;
- confidential prize entitlement;
- no automatic beneficiary decryption;
- explicit owner-authorized entitlement decryption;
- exact claim authorization binding;
- participant-global replay nonce;
- EOA and ERC-1271 authorization support;
- transfer-result-driven accounting;
- deadline/retry handling for proof-pending settlement states; and
- exact contract/user binding for SDK-produced encrypted inputs.

## Integration status

The framework-independent protocol SDK is implemented at
[`packages/protocol-sdk`](../packages/protocol-sdk).

The browser frontend has not yet been implemented. No current document should claim the Season 4
dApp submission is complete until the frontend, hosted demo, required real-person pitch video, and
required X thread/article are complete.

See [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md) for the frozen browser-integration boundary.
