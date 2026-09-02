# Veilpot protocol SDK

Framework-independent typed integration layer for the frozen Veilpot Autopilot-v3 Sepolia
deployment.

## Frozen production deployment

- Chain: Ethereum Sepolia (`11155111`)
- Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- Autopilot Vault: `0x7dF64925Af938a0535F30dE9cFBf97BB3ab30487`
- Yield adapter: `0xEa9868e982b98B57C52B95853EdE2552dAD74b64`
- Prize reserve: `0xbEe24d1060d94d435272550fAa5616faD59Ad1a1`
- Confidential token: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- Wrappers registry: `0x2f0750Bbb0A246059d80e94c454586a7F27a128e`
- Deployment source commit: `ad437e0edf1f4809a53d045879da28da87c10b78`
- Deployment evidence commit: `dd3b53311b98a8af03f154a31cade7e4b354cf45`
- Runtime evidence commit: `fb417f62db1ba7936b80c7cfb68b0a42c2fd4972`
- Protocol-SDK freeze: `de16e473739c28dbd00c731c6a7535ab3400ad0f`

The configured confidential token is Zama's official Sepolia Confidential USDT Mock. The yield
adapter is a simulated Sepolia-demo integration; neither is represented as a production-mainnet
asset/yield source.

## Zama integration

The SDK pins `@zama-fhe/sdk@3.5.1`, the current high-level Zama Protocol SDK used by Veilpot for
custom confidential-contract input encryption.

Custom FHE inputs use `ZamaSDK.encrypt` and bind ciphertext generation to:

1. the exact target contract; and
2. the submitting user.

Autopilot plan creation encrypts period amount and lifetime cap as two `euint64` values under one
shared input proof bound to the immutable Autopilot Vault and plan owner.

Autopilot funding encrypts the amount against the confidential token and owner, then prepares the
exact ERC-7984 `confidentialTransferAndCall` callback transfer required by the immutable Vault
funding interface. This callback overload is a protocol-specific surface rather than a substitute
for the high-level SDK's ordinary `Token.confidentialTransfer` flow.

## Design boundaries

The SDK mirrors the exact frozen Pool, Vault, Adapter, and Reserve ABIs and state ordinals.

It provides centralized builders for:

- participant reservation, confidential deposit, withdrawal, and funding;
- the exact eleven-field historical-owner EIP-712 prize-claim authorization;
- opt-in entitlement-decryption authorization;
- Autopilot plan IDs and Standard Merkle schedule commitments;
- Autopilot plan creation and ERC-7984 callback funding;
- permissionless execution and missed-window advancement;
- owner skip, pause, resume, revoke, and residual-fund withdrawal; and
- production read calls for Autopilot plan metadata and encrypted amount handles.

Chain ID, Reserve, Pool, participant, and recipient identity are not caller-configurable in the
frozen claim builder.

No React dependency exists in this package.

No decryption operation runs automatically. Decryption helpers create explicit user-intent
descriptors only. A future frontend must require explicit user action before invoking Zama
decryption.

The SDK does not contain deployment keys, RPC credentials, relayer API keys, browser UI code, or
transaction-sending side effects.

## Validation

The frozen current checkpoint is:

- `16 passing / 0 failing` protocol-SDK tests;
- exact Pool/Vault/Adapter/Reserve ABI parity with frozen production artifacts;
- exact reconstruction of the live Autopilot schedule root;
- root typecheck/lint/format validation; and
- runtime/deployment evidence binding through the exported deployment constants.

See:

- [`../../docs/INTEGRATION_GUIDE.md`](../../docs/INTEGRATION_GUIDE.md)
- [`../../docs/PRODUCTION_STATUS.md`](../../docs/PRODUCTION_STATUS.md)
- [`../../evidence/production-sepolia/autopilot-v3/deployment.json`](../../evidence/production-sepolia/autopilot-v3/deployment.json)
- [`../../evidence/production-sepolia/autopilot-v3/runtime-smoke.json`](../../evidence/production-sepolia/autopilot-v3/runtime-smoke.json)
