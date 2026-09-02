# Veilpot frontend integration guide

This guide defines the frozen protocol boundary that the future Veilpot browser application must
consume.

It does not start or authorize frontend implementation by itself. Frontend work remains locked until
the backend reviewer-readiness audit is complete and explicit authorization is given.

## Integration source of truth

Frontend code must consume `@veilpot/protocol-sdk` rather than duplicating contract addresses, ABIs,
state ordinals, EIP-712 fields, Merkle schedule construction, or encrypted-input construction.

Current SDK freeze:

`de16e473739c28dbd00c731c6a7535ab3400ad0f`

Current deployment/runtime evidence freeze:

`fb417f62db1ba7936b80c7cfb68b0a42c2fd4972`

Deployment evidence SHA-256:

`939127735c3ea54763992b8238b09a37a4474d66f6774c0eab5f619328ffcd98`

Runtime evidence SHA-256:

`147c83636f21ac13b8e26174cce1abe1a02d18f496d42d00aa53a7e8d0b8729a`

## Network identity

The current integration target is Ethereum Sepolia:

- chain ID: `11155111`;
- Pool: `0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601`;
- Autopilot Vault: `0x7dF64925Af938a0535F30dE9cFBf97BB3ab30487`;
- Adapter: `0xEa9868e982b98B57C52B95853EdE2552dAD74b64`;
- Reserve: `0xbEe24d1060d94d435272550fAa5616faD59Ad1a1`;
- confidential token: `0x4E7B06D78965594eB5EF5414c357ca21E1554491`; and
- wrappers registry: `0x2f0750Bbb0A246059d80e94c454586a7F27a128e`.

The token is Zama's official Sepolia mock asset. The yield adapter is simulated for the Sepolia
demo. Neither should be represented as a production-mainnet asset/yield integration.

## SDK boundary

The protocol SDK exports:

- `VEILPOT_SEPOLIA_DEPLOYMENT`;
- `VEILPOT_POOL_ABI`;
- `VEILPOT_AUTOPILOT_VAULT_ABI`;
- `VEILPOT_ADAPTER_ABI`;
- `VEILPOT_RESERVE_ABI`;
- participant/draw/yield/prize/Autopilot state maps;
- claim EIP-712 types and domain;
- claim authorization builders;
- participant reservation/deposit/withdrawal/funding builders;
- entitlement-decryption authorization and prize-claim builders;
- Autopilot plan-ID and schedule-leaf builders;
- deterministic Standard Merkle schedule construction;
- Autopilot create/fund/execute/advance/skip/pause/resume/revoke/residual-withdrawal builders;
- Autopilot plan metadata/amount read builders;
- Pool/Vault/token-bound Zama encryption helpers; and
- explicit decryption-intent descriptors.

The frontend must not maintain independent copies of these values.

## Zama SDK

The protocol SDK pins:

`@zama-fhe/sdk@3.5.1`

Encrypted custom-contract inputs use the SDK encryption boundary exposed through
`@veilpot/protocol-sdk`.

For normal Veilpot inputs, the SDK binds encryption to both:

1. the exact target Veilpot contract; and
2. the submitting user address.

A ciphertext prepared for a different contract or user must not be silently reused.

### Autopilot plan encryption

Autopilot plan creation encrypts:

1. period amount; and
2. lifetime cap

as two `euint64` values under **one shared input proof** bound to:

- the immutable Autopilot Vault; and
- the plan owner.

The frontend must not encrypt those values independently or combine proofs manually.

### Autopilot funding encryption

Autopilot funding encrypts one `euint64` amount bound to:

- the confidential token contract; and
- the funding user.

The resulting confidential token call uses ERC-7984 `confidentialTransferAndCall` to the immutable
Autopilot Vault. The frontend must use the SDK builder and must not replace it with a manual token
transfer.

## Autopilot schedule construction

Autopilot schedules are deterministic Standard Merkle commitments.

The frontend must use the SDK schedule builder rather than implementing its own leaf encoding, tree
construction, root ordering, or proof generation.

For every schedule:

- `planId` must be the exact SDK/contract-derived plan ID;
- windows must be valid `uint64` ranges;
- windows must be strictly ordered without overlap;
- execution count must remain within the protocol hard cap; and
- the root/proof must come from the same deterministic schedule commitment.

## Autopilot lifecycle

The browser may expose the following protocol actions through SDK-built calls:

1. create a plan;
2. fund the plan through confidential transfer-and-call;
3. execute an eligible window;
4. advance a missed window;
5. owner skip;
6. owner pause;
7. owner resume;
8. owner revoke; and
9. owner residual-fund withdrawal.

`execute` and missed-window advancement are permissionless protocol actions. A caller performing
them does not receive standing user-wallet token authority or confidential decryption authority.

The frontend must not invent a privileged "keeper wallet" model that requires custody of user keys,
standing ERC-7984 operator authority, or beneficiary decryption rights.

## Decryption policy

Veilpot does not automatically decrypt confidential state.

The protocol SDK intentionally exposes decryption **intent descriptors**, not automatic page-load
decryption.

The browser application must require intentional user action before requesting confidential
decryption.

Examples include:

- viewing the user's own confidential token balance;
- inspecting owner-authorized Autopilot plan amounts; or
- viewing an entitlement only after the contract has authorized that historical owner for
  decryption.

The frontend must not add:

- automatic decryption on mount;
- automatic decryption on wallet connect;
- background prize-entitlement reveal;
- background Autopilot amount reveal;
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

The builder intentionally fixes the chain ID, Reserve, Pool, participant, and recipient to the
frozen protocol/historical-owner rules where applicable.

## Transaction preparation

The SDK prepares call descriptors but does not send browser-wallet transactions.

The browser layer is responsible for:

1. confirming the connected chain;
2. confirming the connected account;
3. obtaining required confidential input through the SDK boundary;
4. asking the protocol SDK to build the exact call;
5. presenting the action to the user;
6. sending only after explicit wallet approval;
7. tracking the submitted transaction; and
8. reconciling the resulting protocol state.

The frontend must not bypass SDK validation by manually changing call arguments after preparation.

## Confidential deposit flow

At a high level:

1. reserve a participant slot using the required registration bond;
2. read the resulting reservation identity/nonces;
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

Do not invent simplified frontend state that merges proof-pending states with terminal outcomes.
Pending confidential proofs should remain visibly pending until the protocol resolves them.

For Autopilot, the browser must separately represent plan lifecycle state, execution index, schedule
window status, pause/revoke state, and confidential amount visibility rather than deriving
consequential state from UI assumptions.

## Error handling

The browser should decode and present contract errors when possible, but must not convert a failed
transaction or failed proof into an assumed protocol result.

Retry UI must follow explicit protocol liveness/recovery paths.

## Evidence and integration verification

The current browser target is bound to:

- [`deployment.json`](../evidence/production-sepolia/autopilot-v3/deployment.json); and
- [`runtime-smoke.json`](../evidence/production-sepolia/autopilot-v3/runtime-smoke.json).

The frontend must not silently target the historical pre-Autopilot deployment.

Before browser E2E is accepted, the connected addresses must match `VEILPOT_SEPOLIA_DEPLOYMENT`, and
SDK call builders must remain byte/ABI compatible with the frozen four-contract artifacts.

## Security requirements for the frontend

The frontend must never contain:

- deployment private keys;
- mnemonics;
- server-only secrets;
- privileged RPC credentials;
- hard-coded user signatures;
- hidden auto-sign flows;
- standing user-wallet token-operator authority for a keeper;
- hidden background decryption; or
- a bypass around the exact SDK claim/encryption/Autopilot builders.

Public Sepolia addresses and public deployment evidence are safe to ship.

## Submission completion boundary

The protocol, deployment, runtime evidence, and SDK layers are ready for browser integration from a
technical perspective.

Frontend implementation is still intentionally locked pending the final backend reviewer-readiness
audit and explicit authorization.

The Season 4 project is not submission-complete until the browser application is implemented,
deployed as a working website, validated end-to-end against this frozen Sepolia deployment, and the
required submission media are complete.
