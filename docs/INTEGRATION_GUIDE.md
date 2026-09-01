# Veilpot frontend integration guide

This guide defines the frozen protocol boundary that the future Veilpot browser application must
consume.

It does not start or authorize frontend implementation by itself.

## Integration source of truth

Frontend code should consume `@veilpot/protocol-sdk` rather than duplicating contract addresses,
ABIs, state ordinals, EIP-712 fields, or encrypted-input construction.

The SDK freeze is:

`eb4df55b3a70ac893caa10116ad01740bf9fedc5`

The deployment evidence freeze is:

`4b18babce6690ffe57ae5a730edb51ab81bd93bc`

## Network identity

The current demo deployment is on Ethereum Sepolia:

- chain ID: `11155111`;
- Pool: `0x3beB5C46b5982b0029a6fbC39A9313ee8D19eb6B`;
- Adapter: `0xe1FbD1fBe801c00f13aF44E1D4e3B4271aDF0f56`;
- Reserve: `0xf748bF23C9f1C020Dcf3eb96c955904FCD8b40b0`;
- confidential token: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`; and
- wrappers registry: `0x2f0750Bbb0A246059d80e94c454586a7F27a128e`.

The token is a Zama Sepolia mock asset.

## SDK boundary

The protocol SDK exports:

- `VEILPOT_SEPOLIA_DEPLOYMENT`;
- `VEILPOT_POOL_ABI`;
- `VEILPOT_ADAPTER_ABI`;
- `VEILPOT_RESERVE_ABI`;
- participant/draw/yield/prize state maps;
- claim EIP-712 types and domain;
- claim authorization builders;
- encrypted `euint64` input helpers;
- participant reservation/deposit/withdrawal call builders;
- yield/sponsor funding call builders;
- entitlement-decryption authorization call builder; and
- prize-claim call builder.

The frontend should not maintain independent copies of these values.

## Zama SDK

The protocol SDK currently pins:

`@zama-fhe/sdk@3.5.1`

Encrypted custom-contract inputs use the current core SDK path:

`sdk.encrypt(...)`

The Veilpot helper binds encryption to both:

1. the exact target Veilpot contract; and
2. the submitting user address.

A ciphertext prepared for a different Veilpot contract or different user must not be silently
reused.

## Decryption policy

Veilpot does not automatically decrypt confidential state.

The protocol SDK intentionally exposes decryption **intent descriptors**, not automatic page-load
decryption.

The browser application must require an intentional user action before requesting confidential
decryption.

Examples include:

- viewing the user's own confidential token balance; or
- viewing an entitlement only after the contract has authorized that historical owner for
  decryption.

The frontend must not add:

- automatic decryption on mount;
- automatic decryption on wallet connect;
- background prize-entitlement reveal;
- public decryption of beneficiary-specific amounts; or
- caching that converts an encrypted value into durable public application state.

## Claim authorization

Prize claims use the exact EIP-712 domain:

- name: `VeilpotPrizeReserve`;
- version: `1`;
- chain ID: `11155111`; and
- verifying contract: the frozen Reserve address.

The exact message field order is:

1. `chainId`
2. `reserve`
3. `pool`
4. `drawId`
5. `slotIndex`
6. `participant`
7. `recipient`
8. `registrationVersion`
9. `reservationNonce`
10. `nonce`
11. `expiry`

The frontend must use the SDK builder rather than constructing this message manually.

The builder intentionally fixes:

- chain ID;
- Reserve address;
- Pool address;
- participant; and
- recipient

to the frozen protocol/historical-owner rules where applicable.

## Transaction preparation

The current SDK prepares contract-call descriptors but does not send browser wallet transactions.

The future browser layer is responsible for:

1. confirming the connected chain;
2. confirming the connected account;
3. obtaining any required confidential input through the Zama SDK;
4. asking the protocol SDK to build the exact call;
5. presenting the action to the user;
6. sending only after explicit wallet approval;
7. tracking the submitted transaction; and
8. reconciling the resulting protocol state.

The frontend must not bypass SDK validation by manually changing call arguments after preparation.

## Confidential deposit flow

At a high level:

1. reserve a participant slot using the required registration bond;
2. read the resulting reservation identity/nonces from protocol state;
3. create the confidential deposit amount for the Pool and submitting user;
4. build the deposit call through the SDK;
5. submit through the user's wallet;
6. track activation/proof state; and
7. present only protocol-approved public state.

The UI must distinguish submitted, proof-pending, active, refund-pending, and terminal states rather
than treating transaction inclusion as final confidential settlement.

## Withdrawal flow

A withdrawal uses a Pool-bound encrypted amount and the caller's current registration/replay
identity.

The frontend must not assume the requested encrypted amount is the amount that ultimately moved.
Contract accounting is based on actual confidential-token transfer results.

## Prize and claim flow

The browser should treat draw finalization, entitlement assignment, claimability, decryption, and
payout as distinct phases.

Winning does not authorize automatic entitlement disclosure.

A user who chooses to inspect an entitlement should first perform the required on-chain entitlement
decryption authorization and then explicitly request decryption.

Claim signing and claim submission remain separate user actions.

## State rendering

Use SDK state ordinals as the source of truth.

Do not invent simplified frontend state that merges proof-pending states with their terminal
outcomes.

In particular, pending confidential proofs should be visible as pending rather than presented as
success or failure before the protocol resolves them.

## Error handling

The browser should decode and present contract errors when possible, but must not convert a failed
transaction or failed proof into an assumed protocol result.

Retry UI should follow the protocol's explicit liveness/retry paths.

## Security requirements for the frontend

The frontend must never contain:

- deployment private keys;
- mnemonics;
- server-only secrets;
- privileged RPC credentials;
- hard-coded user signatures;
- hidden auto-sign flows; or
- a bypass around the exact SDK claim/encryption builders.

Public Sepolia addresses and public deployment evidence are safe to ship.

## Submission completion boundary

The protocol/deployment/SDK layers are ready for browser integration.

The Season 4 project is not submission-complete until the browser application is implemented,
deployed as a working website, validated end-to-end against the frozen Sepolia deployment, and the
required submission media are complete.
