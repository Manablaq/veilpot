# Veilpot frontend security model

This document defines the security and privacy boundary of the production Veilpot web application.

It complements the contract-level models in [`GATE_1_SECURITY_MODEL.md`](GATE_1_SECURITY_MODEL.md)
and [`AUTOPILOT_SECURITY_MODEL.md`](AUTOPILOT_SECURITY_MODEL.md).

## Security objective

The browser must make consequential actions understandable and exact without weakening protocol
privacy. A compromised assumption in the UI must not silently become a different transaction,
automatic disclosure, or fabricated account state.

## Trust boundaries

### User wallet

The wallet is the signing authority for authentication messages, on-chain transactions, and explicit
confidential-disclosure flows where supported.

The frontend never possesses the wallet private key.

### Browser application

The browser prepares calls, displays reviewed consequences, performs safe/public reads, tracks
submitted transactions, and requests explicit decryption only when authorized.

It is not trusted to override contract invariants.

### Protocol SDK

`@veilpot/protocol-sdk` is the authoritative browser integration boundary for deployment addresses,
ABIs, state ordinals, encrypted-input construction, claim authorization, and Autopilot schedule/call
construction.

### RPC and chain data

RPC responses are external inputs. Consequential write review binds to current account/network state
and submitted transactions are reconciled against chain data.

## Wallet authentication

Connection and authentication are separate.

Authentication uses a wallet signature over the application sign-in flow. It does not authorize an
Ethereum transaction and is not reused as protocol authorization.

Session restoration is bounded by timeout/failure handling so a slow or unavailable RPC does not
leave `/app` indefinitely blocked.

## Exact-action transaction safety

Consequential wallet writes use a frozen review record containing:

- action key/label/consequence;
- sender;
- destination;
- exact calldata;
- native value;
- chain ID;
- account transaction nonce; and
- preparation timestamp.

A review is invalidated if the wallet, network, nonce, destination, calldata, native value, or
freshness window changes.

After a transaction hash is available, the browser verifies the mined sender, destination, calldata,
nonce, and native value.

A generic wallet/RPC error without a transaction hash is not treated as evidence that the exact
transaction was mined.

## Confidential-input safety

Custom confidential inputs are created through the protocol SDK and bound to the intended contract
and submitting user.

Autopilot period amount and lifetime cap use one shared proof bound to the Vault/owner pair.

The frontend does not hand-edit encrypted call arguments after the SDK has prepared the exact
descriptor.

## Decryption policy

Confidential values remain encrypted unless a legitimate protocol/SDK path authorizes disclosure and
the user explicitly requests it.

The production browser does not automatically decrypt on initial render, wallet connect, wallet
authentication, session restore, background polling, or navigation.

Where a value is encrypted but no legitimate frontend decryption path is available, the UI says so
instead of showing a non-functional "Reveal" control.

## Data provenance

The account/dashboard surface may render public-safe live protocol state, transaction lifecycle, and
locally derived presentation state.

It must not present fabricated balances, savings totals, contribution values, runway values, draw
amounts, or prize amounts as live wallet state.

Illustrative landing-page content is explicitly labeled as product preview and not connected-wallet
state.

## Autopilot authority

Permissionless Autopilot execution does not grant the caller:

- custody of the user's wallet;
- standing token-operator authority over the user's wallet;
- permission to withdraw Pool principal;
- permission to claim prizes;
- permission to select an arbitrary recipient; or
- confidential decryption authority.

Schedules and lifetime authorization remain bounded by the committed plan.

## Proof-pending and recovery states

The frontend does not collapse transaction inclusion, proof pending, and terminal settlement into
one success state.

It exposes protocol-defined recovery/liveness paths for reservation expiry, threshold settlement,
refund completion, missed Autopilot windows, revocation/residual recovery, prize-status evidence,
and claim-completion evidence.

## Replay/stale-state defense

The browser consumes protocol identities/nonces rather than inventing local replacements.

Consequential preparation is invalidated when account nonce or relevant live state moves. Previously
successful mined transactions are not automatically retried.

## Privacy Shield

Privacy presentation is a UI control, not a cryptographic substitute. It may hide already rendered
information, but it must not imply that an encrypted value has been decrypted merely because the
presentation changed.

## Secrets

The production frontend repository must never contain deployment private keys, wallet mnemonics,
hard-coded user signatures, secret RPC credentials, hidden auto-signing credentials, or decryption
material that bypasses the supported Zama/user authorization flow.

## Failure behavior

The frontend fails closed when consequential transaction identity cannot be proven.

User-facing errors may be simplified for clarity, but application state must not be advanced based
solely on a guessed outcome.

## Production acceptance

The final browser acceptance pass verified:

- landing page and responsive layout;
- light/dark/system appearance;
- wallet chooser readability;
- authentication/session restoration;
- no session hang;
- no misleading private-value Reveal control;
- no automatic decryption;
- Privacy Shield behavior;
- core navigation;
- Deposit, Withdraw, Autopilot, VeilDraw, and Prize control surfaces;
- absence of fake/demo monetary values on connected-wallet surfaces; and
- final refresh/session restoration.

No additional on-chain transaction was required for this acceptance pass.
