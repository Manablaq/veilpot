# Veilpot documentation

This directory contains the reviewer-facing documentation and the historical engineering record for
Veilpot.

## Start here

| Document                                                           | Purpose                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`PRODUCTION_STATUS.md`](PRODUCTION_STATUS.md)                     | Authoritative production/frontend status and V1/V2 boundary                  |
| [`VEILDRAW_V2_SEPOLIA_STATUS.md`](VEILDRAW_V2_SEPOLIA_STATUS.md)   | Deployed V2 protocol, evidence, verification, and live-lifecycle boundary    |
| [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md)                     | Implemented browser-to-SDK-to-contract integration boundary                  |
| [`FRONTEND_SECURITY_MODEL.md`](FRONTEND_SECURITY_MODEL.md)         | Browser threat model, wallet-action safety, privacy and decryption rules     |
| [`TESTING_AND_REPRODUCIBILITY.md`](TESTING_AND_REPRODUCIBILITY.md) | Exact supported toolchain, clean-checkout gate, CI and production acceptance |
| [`AUTOPILOT_SECURITY_MODEL.md`](AUTOPILOT_SECURITY_MODEL.md)       | Autopilot custody, authority, schedule and recovery model                    |
| [`GATE_1_SECURITY_MODEL.md`](GATE_1_SECURITY_MODEL.md)             | Core protocol security model                                                 |
| [`GATE_1_PRIVACY_LEDGER.md`](GATE_1_PRIVACY_LEDGER.md)             | Confidential/public-state classification                                     |
| [`VEILDRAW_PRIVACY.md`](VEILDRAW_PRIVACY.md)                       | VeilDraw privacy properties                                                  |
| [`VEILDRAW_SECURITY.md`](VEILDRAW_SECURITY.md)                     | VeilDraw adversarial/security analysis                                       |
| [`VEILDRAW_MATH.md`](VEILDRAW_MATH.md)                             | Winner-selection mathematics                                                 |
| [`VEILDRAW_PERFORMANCE.md`](VEILDRAW_PERFORMANCE.md)               | Bounded encrypted-computation performance evidence                           |

## Live system

- Production frontend: https://veilpot.vercel.app
- Network: Ethereum Sepolia (`11155111`)
- Current application-code freeze: `9c82463bd56d3c23c0a248c9314ece9d728b76fa`
- Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`
- Autopilot Vault: `0x7dF64925Af938a0535F30dE9cFBf97BB3ab30487`
- Simulated Yield Adapter: `0xEa9868e982b98B57C52B95853EdE2552dAD74b64`
- Prize Reserve: `0xbEe24d1060d94d435272550fAa5616faD59Ad1a1`

The addresses above are the frozen V1 production frontend target.

The separately deployed V2 protocol is documented in
[`VEILDRAW_V2_SEPOLIA_STATUS.md`](VEILDRAW_V2_SEPOLIA_STATUS.md). The V2 deployment is not silently
substituted into the live frontend.

The token is Zama's official Sepolia Confidential USDT Mock and the yield integration is explicitly
simulated for the demo environment.

## Reviewer evidence path

1. Confirm the public application loads and identifies itself as a Sepolia testnet experience.
2. Read [`PRODUCTION_STATUS.md`](PRODUCTION_STATUS.md).
3. Read [`VEILDRAW_V2_SEPOLIA_STATUS.md`](VEILDRAW_V2_SEPOLIA_STATUS.md).
4. Inspect
   [`../evidence/production-sepolia/autopilot-v3/deployment.json`](../evidence/production-sepolia/autopilot-v3/deployment.json).
5. Inspect
   [`../evidence/production-sepolia/autopilot-v3/runtime-smoke.json`](../evidence/production-sepolia/autopilot-v3/runtime-smoke.json).
6. Review frontend consequence/decryption boundaries in
   [`FRONTEND_SECURITY_MODEL.md`](FRONTEND_SECURITY_MODEL.md).
7. Reproduce the clean repository gate with
   [`TESTING_AND_REPRODUCIBILITY.md`](TESTING_AND_REPRODUCIBILITY.md).
8. Use the Gate/VeilDraw documents below for deeper historical design evidence.

## Historical engineering record

Files prefixed with `GATE_` and the detailed VeilDraw/Autopilot design documents preserve earlier
engineering checkpoints. They intentionally retain terminology and status from the stage at which
they were authored. They are evidence of the design/verification process, not the current top-level
product-status source.

`PRODUCTION_STATUS.md` is the authoritative current status document.
