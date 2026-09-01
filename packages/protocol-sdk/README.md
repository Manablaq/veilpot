# Veilpot protocol SDK

Framework-independent typed integration layer for the frozen Veilpot Sepolia deployment.

## Frozen production deployment

- Chain: Sepolia (11155111)
- Pool: `0x3beB5C46b5982b0029a6fbC39A9313ee8D19eb6B`
- Yield adapter: `0xe1FbD1fBe801c00f13aF44E1D4e3B4271aDF0f56`
- Prize reserve: `0xf748bF23C9f1C020Dcf3eb96c955904FCD8b40b0`
- Confidential token: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`
- Deployment evidence commit: `4b18babce6690ffe57ae5a730edb51ab81bd93bc`

## Design boundaries

The SDK mirrors the exact frozen production ABIs and state ordinals.

The exact eleven-field EIP-712 claim authorization is built centrally. Chain ID, reserve, pool,
participant, and recipient identity are not caller-configurable in the claim builder.

Custom FHE inputs use the current `@zama-fhe/sdk` core encryption path and bind ciphertext
generation to the exact target contract and user.

No React dependency exists in this package.

No decryption operation runs automatically. Decryption helpers in this package create explicit
user-intent descriptors only. The frontend must require an explicit user action before invoking Zama
decryption.

The SDK does not contain deployment keys, RPC credentials, relayer API keys, or browser UI code.
