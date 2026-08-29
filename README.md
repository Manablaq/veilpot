# Veilpot

This is the clean-room engineering repository for Veilpot. Its present scope is only **Gate 0:
VeilDraw feasibility**—mathematical exactness, FHEVM compatibility, privacy, security, liveness, and
cost evidence.

No production pool, yield integration, SDK, or frontend is implemented here.

## Reproducible checks

Use Node 22 and Corepack, then run:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm gate0` regenerates deterministic reference evidence and runs the local mock-FHE Gate 0
verification. Live Sepolia checks are intentionally excluded because they require credentials and
network state.
