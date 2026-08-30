# Dependency baseline

Classification: **VERIFIED FACT**, except where explicitly stated otherwise. Registry metadata and
official sources were checked on 2026-08-29. Exact installed pins are generated in
[`evidence/gate0/dependency-snapshot.json`](../evidence/gate0/dependency-snapshot.json).

| Package                                | Exact version | Verified source                                                                                                         | Reason selected                                                                   | Compatibility notes                                                                            |
| -------------------------------------- | ------------: | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Hardhat                                |        2.28.6 | [Official FHEVM Hardhat template](https://github.com/zama-ai/fhevm-hardhat-template/blob/main/package.json)             | Current official-template Hardhat 2 baseline                                      | Plugin 0.4.2 accepts Hardhat 2; Hardhat 3 was not mixed into this stack                        |
| `@fhevm/solidity`                      |        0.11.1 | [Official template package](https://github.com/zama-ai/fhevm-hardhat-template/blob/main/package.json), installed source | Version shared by the plugin peer range and OpenZeppelin's exact peer requirement | Registry latest was 0.13.3, but using it would violate the selected OpenZeppelin peer contract |
| `@fhevm/hardhat-plugin`                |         0.4.2 | [Official template](https://github.com/zama-ai/fhevm-hardhat-template), npm metadata, installed source                  | Mock FHE execution, encryption/decryption helpers, and receipt HCU analysis       | Peer requires mock-utils 0.4.2, relayer SDK 0.4.1, ethers 6.16, and Hardhat 2                  |
| `@fhevm/mock-utils`                    |         0.4.2 | npm metadata and installed package source                                                                               | Exact peer of the Hardhat plugin                                                  | Local execution tracks clear values; it is not real FHE cryptography                           |
| `@openzeppelin/confidential-contracts` |         0.5.3 | [Official releases](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts/releases), npm metadata         | Current registry release recorded for later protocol work                         | Exact peer on `@fhevm/solidity` 0.11.1; installed but not imported by the minimal probe        |
| ethers                                 |        6.16.0 | Official Zama template and npm metadata                                                                                 | Official plugin peer and test client                                              | Exact pin                                                                                      |
| TypeScript                             |         5.9.3 | Official Zama template and npm metadata                                                                                 | Current compatible strict compiler in the template generation                     | TypeScript 7 was not introduced into the Hardhat 2/ts-node stack                               |
| Mocha                                  |        11.7.5 | Official Zama template and npm metadata                                                                                 | Test runner                                                                       | Chai 4.5.0 is pinned because the Hardhat matcher stack uses Chai 4                             |
| `@zama-fhe/relayer-sdk`                |         0.4.1 | Official template and plugin peer metadata                                                                              | Development/test public-decryption interface                                      | This is not the selected future frontend architecture                                          |

## Future frontend SDK direction

**VERIFIED FACT:** the current official frontend family is `@zama-fhe/sdk` 3.5.1 and
`@zama-fhe/react-sdk` 3.5.1, both requiring Node 22 or newer. The packages are recorded, not
installed, because Gate 0 must not build a frontend. A future frontend should use this v3 family,
not inherit the older relayer SDK solely because the Hardhat plugin uses it for development.

## Runtime and compiler

- **DESIGN DECISION:** Node is constrained to `>=22 <23`, `.nvmrc` contains `22`, pnpm is pinned to
  10.18.3, Solidity is pinned to 0.8.27, EVM output targets Cancun, optimizer is enabled with 800
  runs, and Solidity metadata uses `bytecodeHash = "none"`.
- **MEASURED RESULT:** the plugin substitutes a Sepolia-specific KMS verifier address in
  `ZamaConfig.sol`; with default IPFS metadata this changed only the deployed metadata trailer, not
  executable code. The chosen `bytecodeHash = "none"` policy makes clean default and Sepolia
  compilation produce the same full runtime hash. See
  [`bytecode-reproducibility.json`](../evidence/gate0/bytecode-reproducibility.json).
- **MEASURED RESULT:** final local Gate 0 commands ran with Node 22.23.2 from the official Node.js
  macOS arm64 archive, unpacked into ignored `.tooling/`. The host's preinstalled Node 24.15.0 is
  not used for the recorded final verification.
- **VERIFIED FACT:** the official template declares Node 20 or newer; the future SDK family raises
  the useful project baseline to Node 22.

All protocol-critical direct dependencies use exact versions. Transitive resolution is frozen by
`pnpm-lock.yaml`.
