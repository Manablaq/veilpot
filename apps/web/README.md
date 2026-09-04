# Veilpot web

Frontend implementation begins from the frozen backend reviewer boundary:

`1afbc79cd6e13a4fb5b9372230c21a5646f95abc`

F0 establishes the visual/product foundation only. It sends no Ethereum transaction and performs no
automatic decryption. Dashboard values are deliberately labeled interface-preview data.

All later protocol interactions must consume `@veilpot/protocol-sdk`; frontend code must not
duplicate frozen addresses, ABIs, state ordinals, claim authorization, encrypted-input construction,
or Autopilot Merkle schedule logic.

## Local

```bash
pnpm --filter @veilpot/web dev
pnpm --filter @veilpot/web typecheck
pnpm --filter @veilpot/web build
```
