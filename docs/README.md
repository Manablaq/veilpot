# Veilpot documentation

This directory contains the reviewer-facing documentation and the historical engineering record for
Veilpot.

## Start here

| Document                                                           | Purpose                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`PRODUCTION_STATUS.md`](PRODUCTION_STATUS.md)                     | Authoritative current deployment, frontend, CI, evidence, and acceptance status |
| [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md)                     | Implemented browser-to-SDK-to-contract integration boundary                     |
| [`FRONTEND_SECURITY_MODEL.md`](FRONTEND_SECURITY_MODEL.md)         | Browser threat model, wallet-action safety, privacy and decryption rules        |
| [`TESTING_AND_REPRODUCIBILITY.md`](TESTING_AND_REPRODUCIBILITY.md) | Exact supported toolchain, clean-checkout gate, CI and production acceptance    |
| [`AUTOPILOT_SECURITY_MODEL.md`](AUTOPILOT_SECURITY_MODEL.md)       | Autopilot custody, authority, schedule and recovery model                       |
| [`GATE_1_SECURITY_MODEL.md`](GATE_1_SECURITY_MODEL.md)             | Core protocol security model                                                    |
| [`GATE_1_PRIVACY_LEDGER.md`](GATE_1_PRIVACY_LEDGER.md)             | Confidential/public-state classification                                        |
| [`VEILDRAW_PRIVACY.md`](VEILDRAW_PRIVACY.md)                       | VeilDraw privacy properties                                                     |
| [`VEILDRAW_SECURITY.md`](VEILDRAW_SECURITY.md)                     | VeilDraw adversarial/security analysis                                          |
| [`VEILDRAW_MATH.md`](VEILDRAW_MATH.md)                             | Winner-selection mathematics                                                    |
| [`VEILDRAW_PERFORMANCE.md`](VEILDRAW_PERFORMANCE.md)               | Bounded encrypted-computation performance evidence                              |

## Live system

- Production frontend: https://veilpot.vercel.app
- Network: Ethereum Sepolia (`11155111`)
- Current application-code freeze: `9c82463bd56d3c23c0a248c9314ece9d728b76fa`
- Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- Autopilot Vault: `0x7dF64925Af938a0535F30dE9cFBf97BB3ab30487`
- Simulated Yield Adapter: `0xEa9868e982b98B57C52B95853EdE2552dAD74b64`
- Prize Reserve: `0xbEe24d1060d94d435272550fAa5616faD59Ad1a1`

The token is Zama's official Sepolia Confidential USDT Mock and the yield integration is explicitly
simulated for the demo environment.

## Reviewer evidence path

1. Confirm the public application loads and identifies itself as a Sepolia testnet experience.
2. Read [`PRODUCTION_STATUS.md`](PRODUCTION_STATUS.md).
3. Inspect
   [`../evidence/production-sepolia/autopilot-v3/deployment.json`](../evidence/production-sepolia/autopilot-v3/deployment.json).
4. Inspect
   [`../evidence/production-sepolia/autopilot-v3/runtime-smoke.json`](../evidence/production-sepolia/autopilot-v3/runtime-smoke.json).
5. Review frontend consequence/decryption boundaries in
   [`FRONTEND_SECURITY_MODEL.md`](FRONTEND_SECURITY_MODEL.md).
6. Reproduce the clean repository gate with
   [`TESTING_AND_REPRODUCIBILITY.md`](TESTING_AND_REPRODUCIBILITY.md).
7. Use the Gate/VeilDraw documents below for deeper historical design evidence.

## Historical engineering record

Files prefixed with `GATE_` and the detailed VeilDraw/Autopilot design documents preserve earlier
engineering checkpoints. They intentionally retain terminology and status from the stage at which
they were authored. They are evidence of the design/verification process, not the current top-level
product-status source.

`PRODUCTION_STATUS.md` is the authoritative current status document.
