# Veilpot Autopilot Solidity Design Freeze

## Gate status

Gate 2C-B runtime/interface feasibility is complete.

- Parent Gate 2C-A freeze: `492c30c1951eb58bca98404bb3f02f25034bcba7`
- Selected feasibility candidate: Variant M
- Pool runtime: `23,480` bytes
- Reviewed runtime budget: `23,500` bytes
- Reviewed-budget headroom: `20` bytes
- EIP-170 headroom: `1,096` bytes
- Creation bytecode: `24,789` bytes
- EIP-3860 headroom: `24,363` bytes
- Frozen public ABI removals: `0`

This is architecture evidence only. Production safety is not established until implementation, adversarial FHEVM/ACL, regression, runtime, and Sepolia gates pass.

## Selected architecture

Autopilot uses a non-upgradeable confidential pre-funded Vault.

The user's external wallet never grants ERC-7984 operator authority to the Pool or a keeper.

For a valid scheduled execution:

1. Vault derives the encrypted authorized amount from stored plan state.
2. Vault grants only the compiler-immutable Pool operator authority with expiry `uint48(block.timestamp)`.
3. Vault transiently grants the Pool ACL access to the encrypted authorized amount.
4. Pool computes encrypted remaining principal capacity and clamps the request.
5. Pool pulls with the pinned ERC-7984 encrypted-handle `confidentialTransferFrom`.
6. Pool checkpoints TWAB with old principal before principal mutation.
7. Pool credits only the ERC-7984 returned `actualTransferred` amount.
8. Vault revokes Pool operator authority to `0` before final Vault accounting.
9. Vault debits plan funds and lifetime budget by actual transfer only.

Keeper token authority: none.
Keeper decryption authority: none.

## Pool trust boundary

Exactly one new external Pool entry point is permitted:

`pullAutopilotContribution(uint256 slotIndex, uint256 reservationNonce, euint64 authorizedAmount) returns (euint64 actualTransferred)`

Required behavior:

- caller must equal compiler-immutable Autopilot Vault;
- unauthorized caller reuses `OperatorUnauthorized()`;
- participant must be `ACTIVE`; Autopilot inactive case reuses `WithdrawalNotActive()`;
- reservation nonce must match exactly;
- TWAB checkpoint occurs before principal increase;
- encrypted capacity is `MAX_USER_PRINCIPAL_BASE_UNITS - principal`;
- eligible pull is `min(authorizedAmount, encryptedCapacity)`;
- eligible handle is transiently allowed to the confidential token;
- token actual return is the only accounting truth;
- Pool contains no schedule, plan nonce, execution index, pause, resume, revoke, arbitrary-recipient, or keeper logic.

## Pinned ERC-7984 assumptions

The selected design relies on the repository's pinned OpenZeppelin confidential-contracts implementation to enforce:

- caller ACL for encrypted `amount`;
- operator authorization for `from`;
- returned-ciphertext ACL for `from`;
- returned-ciphertext ACL for `to`.

Therefore the Pool does not duplicate the token's input ACL branch and does not add a second Pool-to-Vault grant for `actualTransferred`.

Any dependency change that invalidates these assumptions blocks release until re-review.

## Runtime-preserving refactors

The production candidate may use the measured semantics-preserving helpers:

- `_validateRegistration(...)`;
- `_checkBooleanProof(...)`;
- `_creditPrincipal(...)`;
- `_activeDeregistrationParticipant(...)`;
- reuse one `euint128` conversion of actual transfer;
- reuse existing error selectors where the predicate is unchanged.

No security predicate may be removed to recover bytecode.

## Production release gates

Production implementation must:

1. preserve every frozen pre-Autopilot public ABI entry;
2. keep Pool and Vault addresses compiler-immutable in the opposite contract;
3. keep user wallet and keeper operator-free;
4. keep the Pool runtime at or below `23,500` bytes without raising the guard;
5. pass EIP-170 and EIP-3860 limits;
6. prove missing Pool ACL reverts through pinned ERC-7984;
7. prove missing Vault-to-Pool operator authorization reverts;
8. prove grant -> pull -> revoke ordering and atomic rollback;
9. test full, partial, and zero actual token transfers;
10. prevent zero transfer from creating principal or retrying the same consumed slot;
11. preserve encrypted principal capacity enforcement;
12. preserve old-principal TWAB checkpoint ordering;
13. prevent callback/token reentrancy from double execution or double credit;
14. give keeper no token authority or decryption ACL;
15. map applicable Gate 2C-A invariants to production/integration evidence;
16. pass the complete historical Solidity regression suite;
17. pass new adversarial Autopilot FHEVM/ACL tests;
18. verify exact source/deployed-source parity on a new Sepolia deployment before SDK/frontend targeting.

## Frontend boundary

Frontend remains untouched until the new Autopilot production implementation, adversarial validation, regression, runtime, and Sepolia evidence gates pass.
