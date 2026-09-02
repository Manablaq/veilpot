# Dependency baseline

Classification: **VERIFIED FACT**, except where explicitly stated otherwise. Official package,
template, and registry sources were re-checked on 2026-09-02.

Gate 0's original dependency snapshot remains frozen at
[`evidence/gate0/dependency-snapshot.json`](../evidence/gate0/dependency-snapshot.json). Current
workspace pins, including post-Gate-0 protocol-SDK dependencies, are enforced by the package
manifests and `pnpm-lock.yaml`.

| Package                                | Exact version | Verified source                                                                                             | Reason selected                                                                    | Compatibility notes                                                                                          |
| -------------------------------------- | ------------: | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Hardhat                                |        2.28.6 | [Official FHEVM Hardhat template](https://github.com/zama-ai/fhevm-hardhat-template/blob/main/package.json) | Current official-template Hardhat 2 baseline                                       | Plugin 0.4.2 accepts Hardhat 2; Hardhat 3 is not mixed into this stack                                       |
| `@fhevm/solidity`                      |        0.11.1 | [Official FHEVM Hardhat template](https://github.com/zama-ai/fhevm-hardhat-template/blob/main/package.json) | Version shared by the selected plugin and OpenZeppelin confidential-contract stack | Exact frozen production dependency                                                                           |
| `@fhevm/hardhat-plugin`                |         0.4.2 | [Official FHEVM Hardhat template](https://github.com/zama-ai/fhevm-hardhat-template)                        | Local mock FHE execution, encryption/decryption helpers, and receipt HCU analysis  | Current official-template family                                                                             |
| `@fhevm/mock-utils`                    |         0.4.2 | Official FHEVM Hardhat template                                                                             | Exact local mock-FHE support family                                                | Local execution tracks clear values; it is not real FHE cryptography                                         |
| `@openzeppelin/confidential-contracts` |         0.5.3 | [OpenZeppelin confidential contracts](https://www.npmjs.com/package/@openzeppelin/confidential-contracts)   | Current confidential-contract/ERC-7984 library                                     | Current stable package as re-checked on 2026-09-02                                                           |
| `@zama-fhe/relayer-sdk`                |         0.4.1 | Official FHEVM Hardhat template and plugin peer metadata                                                    | Development/test interface required by the Hardhat plugin                          | Legacy low-level SDK; retained only for the selected development stack, not application integration          |
| `@zama-fhe/sdk`                        |         3.5.1 | [Official Zama SDK](https://github.com/zama-ai/sdk)                                                         | High-level SDK for Veilpot custom FHE input encryption and future browser wiring   | Current stable high-level Zama SDK; installed in `@veilpot/protocol-sdk`; requires Node 22+                  |
| `@openzeppelin/merkle-tree`            |         1.0.8 | [OpenZeppelin Merkle Tree](https://www.npmjs.com/package/@openzeppelin/merkle-tree)                         | Deterministic Standard Merkle Autopilot schedule commitments                       | Matches OpenZeppelin Standard Merkle double-hashed ABI-encoded leaf semantics used by the Vault verification |
| ethers                                 |        6.16.0 | Official FHEVM Hardhat template                                                                             | Official plugin peer and test/deployment client                                    | Exact pin                                                                                                    |
| TypeScript                             |         5.9.3 | Official FHEVM Hardhat template                                                                             | Strict workspace compiler                                                          | Node 22 project baseline                                                                                     |
| Mocha                                  |        11.7.5 | Official FHEVM Hardhat template                                                                             | Test runner                                                                        | Chai 4.5.0 remains pinned for the Hardhat matcher stack                                                      |

## Application SDK direction

**VERIFIED FACT:** the current official high-level application family is `@zama-fhe/sdk` `3.5.1` and
`@zama-fhe/react-sdk` `3.5.1`, both requiring Node 22 or newer.

`@zama-fhe/sdk@3.5.1` is now installed in `@veilpot/protocol-sdk` and is the production client-side
encryption boundary for Veilpot custom confidential-contract inputs.

`@zama-fhe/react-sdk` remains intentionally uninstalled because browser frontend implementation has
not been authorized yet. When frontend work begins, the current official React SDK must be
re-checked again rather than blindly inheriting this dated pin.

The development-only `@zama-fhe/relayer-sdk` dependency exists because the current official FHEVM
Hardhat template/plugin family still uses it. It is not Veilpot's application/frontend SDK.

## Runtime and compiler

- **DESIGN DECISION:** Node is constrained to `>=22 <23`, `.nvmrc` contains `22`, pnpm is pinned to
  `10.18.3`, Solidity is pinned to `0.8.27`, EVM output targets Cancun, optimizer is enabled with
  `800` runs, and Solidity metadata uses `bytecodeHash = "none"`.
- **MEASURED RESULT:** the plugin substitutes a Sepolia-specific KMS verifier address in
  `ZamaConfig.sol`; with default IPFS metadata this changed only the deployed metadata trailer, not
  executable code. The chosen `bytecodeHash = "none"` policy makes clean default and Sepolia
  compilation produce the same full runtime hash. See
  [`bytecode-reproducibility.json`](../evidence/gate0/bytecode-reproducibility.json).
- **MEASURED RESULT:** final local verification runs use Node `22.23.2`.
- **VERIFIED FACT:** the current official FHEVM Hardhat template remains on the Hardhat 2 /
  `@fhevm/hardhat-plugin` `0.4.2` / `@fhevm/solidity` `0.11.1` family.
- **VERIFIED FACT:** `@zama-fhe/sdk@3.5.1` requires Node 22 or newer.

All protocol-critical direct dependencies use exact versions. Transitive resolution is frozen by
`pnpm-lock.yaml`.
