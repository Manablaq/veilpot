# Veilpot frontend integration guide

This document describes the current production integration between the Veilpot web application,
`@veilpot/protocol-sdk`, the corrected V2.x Sepolia deployment, and Zama confidential-token/FHE
surfaces.

The live application is deployed at https://veilpot.vercel.app.

Current application checkpoint:

`af7d7a5049df4798c393124494eda84b6d98dca4`

## Integration source of truth

Consequential frontend interactions consume `@veilpot/protocol-sdk`.

The active deployment export is:

`VEILPOT_SEPOLIA_V2X_DEPLOYMENT`

Canonical deployment evidence:

[`../evidence/production-sepolia/veildraw-v2x/deployment.json`](../evidence/production-sepolia/veildraw-v2x/deployment.json)

## Network identity

- chain ID: `11155111`;
- PoolV2: `0x0482DfAeCB4b3B76b9Efd4dEF261445D7bcCFcDA`;
- VeilDrawEngineV2: `0x2df32104fadF449dd9Ec50E86008beE85698fb4b`;
- Autopilot Vault: `0x12fa9F3d421aec3710Ba8dee9cFb946839fE885A`;
- Yield Adapter V2: `0xAFb21BdD1Ca0f8e8DD4Cb71076e381A1B839582e`;
- Prize Reserve: `0x553542D5b47b64973D99C04D83991F4AE2b307b2`;
- confidential token: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`; and
- wrappers registry: `0x2f0750Bbb0A246059d80e94c454586a7F27a128e`.

The token is a Zama Sepolia mock asset and the current yield integration is simulated.

## Browser architecture

The frontend separates four different capabilities:

1. **Connection** — which wallet/account is connected.
2. **Authentication** — wallet-signature proof used for the application session.
3. **Transaction authorization** — explicit wallet approval for one exact on-chain action.
4. **Confidential disclosure** — explicit, legitimate user-authorized decryption where supported.

These states are intentionally not collapsed into a single "connected" condition.

## SDK boundary

The protocol SDK exports the frozen deployment identity, Pool/Vault/Adapter/Reserve ABIs, lifecycle
state maps, claim EIP-712 types/domain, exact protocol call builders, deterministic Autopilot
schedule construction, and Zama encryption helpers.

The web application uses that boundary for consequential protocol construction.

## Zama input encryption

The SDK pins `@zama-fhe/sdk@3.5.1`.

Custom FHE inputs bind ciphertext generation to:

1. the exact target contract; and
2. the submitting user address.

### Autopilot plan encryption

Period amount and lifetime cap are encrypted as two `euint64` values under one shared input proof
bound to the immutable Autopilot Vault and plan owner.

### Autopilot funding encryption

Funding encrypts one `euint64` amount for the confidential token contract and funding user, then
uses ERC-7984 `confidentialTransferAndCall` to the immutable Vault.

## Autopilot schedule construction

Schedules use deterministic OpenZeppelin Standard Merkle commitments. The browser consumes the SDK
schedule builder so leaf encoding, tree ordering, root construction, and proof generation remain
identical to the contract/reference model.

Every plan is bound to:

- exact owner and plan nonce;
- exact schedule root;
- strictly ordered non-overlapping windows;
- the protocol execution-count cap; and
- a bounded lifetime authorization.

## Transaction preparation and exact-action review

Before consequential wallet actions are sent, the browser prepares the exact protocol call and
creates a review record containing:

- sender;
- destination;
- chain ID;
- exact calldata;
- native value;
- current wallet transaction nonce;
- action identity/consequence; and
- preparation timestamp.

If any consequential field changes or the review becomes stale, submission is blocked.

When a transaction hash is obtained, reconciliation verifies the mined sender, destination,
calldata, nonce, and value before accepting the transaction as the reviewed action.

## Deposit integration

The production deposit flow separates:

1. participant-slot reservation;
2. current registration identity/nonces;
3. confidential deposit input construction;
4. exact Pool call preparation;
5. wallet submission;
6. threshold/proof-pending lifecycle; and
7. public-safe lifecycle rendering.

Transaction inclusion is not treated as equivalent to confidential activation finality.

## Withdrawal integration

Withdrawal uses a Pool-bound encrypted amount and the caller's current registration/replay identity.
The frontend does not assume the requested amount equals the actual confidential-token result.

## Autopilot integration

The web application exposes plan creation, funding, execution-state inspection, missed-window
advance, owner skip, pause/resume, revoke, and residual recovery through the SDK boundary.

Permissionless execution does not imply wallet custody or disclosure rights.

## VeilDraw integration

The browser renders public-safe draw/snapshot/finality lifecycle information while encrypted winner
predicates and confidential weights remain outside public UI state.

## Prize and claim integration

Draw finalization, entitlement assignment, claimability, optional entitlement disclosure, claim
authorization, payout, and completion evidence are represented as distinct phases.

Winning does not trigger automatic entitlement decryption.

Prize claims use the exact frozen EIP-712 domain and eleven-field authorization shape exported by
the SDK. The participant and recipient identity remain bound to the historical-owner rules.

## Decryption policy

Veilpot does not automatically decrypt confidential state.

The browser must have an explicit supported decryption path and user action before requesting
confidential disclosure. Where no legitimate decryption path exists, the production UI renders the
value as encrypted/not decrypted rather than inventing a reveal control or a numeric placeholder.

The browser does not:

- decrypt on page mount;
- decrypt on wallet connect;
- decrypt on session restoration;
- background-reveal prize entitlements;
- background-reveal Autopilot amounts; or
- transform an encrypted value into durable public application state.

## Authentication and session integration

The `/app` surface uses wallet-signature authentication with nonce/session endpoints under
`/api/auth/*`.

Session verification is bounded so an unavailable RPC cannot leave the user indefinitely stuck on
"Checking your secure session". Authentication signatures are not interpreted as transaction
approval.

## State rendering and provenance

The dashboard distinguishes public-safe live protocol state from confidential state.

It does not present hard-coded demo monetary values as connected-wallet balances. Illustrative
content is confined to explicitly labeled public product-preview surfaces.

## Error and recovery handling

The browser does not convert a failed transaction, rejected wallet request, RPC failure, or
proof-pending state into an assumed protocol success.

Retry/recovery controls follow protocol-defined liveness paths.

## Evidence binding

The integration target is bound to:

- [`../evidence/production-sepolia/veildraw-v2x/deployment.json`](../evidence/production-sepolia/veildraw-v2x/deployment.json);
- [`LIVE_V2X_E2E.md`](LIVE_V2X_E2E.md); and
- `VEILPOT_SEPOLIA_V2X_DEPLOYMENT` from `@veilpot/protocol-sdk`.

See [`FRONTEND_SECURITY_MODEL.md`](FRONTEND_SECURITY_MODEL.md) for the browser threat model and
[`TESTING_AND_REPRODUCIBILITY.md`](TESTING_AND_REPRODUCIBILITY.md) for exact verification steps.
