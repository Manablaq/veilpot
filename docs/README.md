# Veilpot documentation

This directory contains the reviewer-facing documentation and the historical engineering record for
Veilpot.

## Start here

| Document                                                           | Purpose                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`PRODUCTION_STATUS.md`](PRODUCTION_STATUS.md)                     | Authoritative current corrected V2.x production and release status           |
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
- Current application checkpoint: `af7d7a5049df4798c393124494eda84b6d98dca4`
- PoolV2: `0x0482DfAeCB4b3B76b9Efd4dEF261445D7bcCFcDA`
- VeilDrawEngineV2: `0x2df32104fadF449dd9Ec50E86008beE85698fb4b`
- Autopilot Vault: `0x12fa9F3d421aec3710Ba8dee9cFb946839fE885A`
- Simulated Yield Adapter V2: `0xAFb21BdD1Ca0f8e8DD4Cb71076e381A1B839582e`
- Prize Reserve: `0x553542D5b47b64973D99C04D83991F4AE2b307b2`

The production browser uses the corrected V2.x deployment. Historical V1 and predecessor-V2
documents remain preserved only as engineering provenance.

The configured token is Zama's Sepolia Confidential USDT Mock and yield is simulated for the testnet
demonstration.

## Reviewer evidence path

1. Confirm the public application loads and identifies itself as a Sepolia testnet experience.
2. Read [`PRODUCTION_STATUS.md`](PRODUCTION_STATUS.md).
3. Read [`VEILDRAW_V2_SEPOLIA_STATUS.md`](VEILDRAW_V2_SEPOLIA_STATUS.md).
4. Inspect
   [`../evidence/production-sepolia/veildraw-v2x/deployment.json`](../evidence/production-sepolia/veildraw-v2x/deployment.json).
5. Read [`LIVE_V2X_E2E.md`](LIVE_V2X_E2E.md).
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
