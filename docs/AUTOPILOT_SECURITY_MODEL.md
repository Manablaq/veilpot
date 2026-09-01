# Veilpot Gate 2C — Autopilot security model

## Status

This document defines the security architecture that must be proven before Veilpot recurring savings
may be deployed or exposed in the frontend.

Gate 2C-A is an independent reference-model gate. Passing the model is **not** by itself sufficient
to claim the Solidity implementation secure. Contract-level FHEVM, ACL, ERC-7984, reentrancy,
accounting, runtime-budget, Sepolia, and end-to-end tests remain mandatory.

## Zama-only confidentiality boundary

Autopilot uses the same Zama confidentiality stack as the rest of Veilpot:

- Zama FHEVM encrypted types and operations;
- ERC-7984 confidential tokens;
- the official Zama Sepolia confidential wrapper profile;
- FHE ACL;
- transient ACL for same-transaction cross-contract handles wherever possible;
- confidential token actual-return accounting; and
- no server-side plaintext balance, contribution, or prize database.

Standard non-confidential infrastructure may schedule transactions, but it receives no token,
decryption, withdrawal, or prize-claim authority.

## Why Autopilot does not use a user-wallet operator approval

ERC-7984 operators are time-limited but amount-unlimited: while approved, an operator may move any
amount on behalf of the holder.

That is intentionally rejected as the Veilpot Autopilot authorization boundary.

The Autopilot keeper, scheduler, backend, and Autopilot Vault never become ERC-7984 operators for
the user's external wallet.

Instead, the holder explicitly transfers only the confidential funds they wish to place under
automation into a non-upgradeable Veilpot Autopilot Vault using the canonical ERC-7984
transfer-and-callback path.

The callback records only the token-returned actual encrypted amount.

## Custody topology

The intended topology is:

```text
user confidential wallet
        |
        | direct ERC-7984 confidentialTransferAndCall
        v
VeilpotAutopilotVault
        |
        | only when an exact committed schedule slot is due
        | amount = encrypted min(period amount, remaining budget, plan funds, pool capacity)
        v
VeilpotPool V2
        |
        +--> participant principal / TWAB
```

The only permitted token destinations from accounted Autopilot plan funds are:

1. the immutable Veilpot Pool for a valid scheduled contribution; or
2. the plan owner for an owner-authorized residual withdrawal.

There is no administrator sweep destination, keeper destination, arbitrary recipient, delegatecall,
generic call target, or upgrade authority.

## Plan authorization

A plan binds at minimum:

- chain ID;
- Autopilot Vault address;
- Pool address;
- confidential-token address;
- owner;
- registration version;
- reservation nonce;
- plan nonce;
- schedule commitment;
- encrypted period contribution amount;
- encrypted lifetime authorization budget; and
- bounded maximum execution count.

Security-critical plan changes do not mutate the old authorization in place. A material edit creates
a new plan nonce/version and retires the old policy.

## Exact schedules

Veilpot must support exact daily, weekly, biweekly, calendar-monthly, and custom schedules without
pretending that every month is thirty days.

The production plan therefore commits to exact bounded execution windows.

The intended Solidity implementation uses an OpenZeppelin Merkle proof over leaves containing the
plan domain, execution index, `notBefore`, and `notAfter`.

The committed windows must:

- start at index zero;
- be bounded by a fixed maximum execution count;
- never overlap;
- execute sequentially;
- execute at most once;
- reject execution before `notBefore`;
- reject execution after `notAfter`; and
- allow an expired missed slot to be advanced without moving tokens.

This makes schedule correctness independent of keeper honesty.

## Permissionless execution

Anyone may trigger a valid due contribution.

The executor does not choose:

- token;
- owner;
- destination;
- period amount;
- lifetime cap;
- registration identity;
- plan identity; or
- schedule window.

The executor only supplies the committed schedule proof and pays or sponsors transaction gas.

A compromised keeper therefore has liveness influence only. It does not gain asset authority.

## Confidential amount authorization

The period amount and remaining lifetime budget are Zama encrypted values.

The Autopilot Vault stores contract ACL on those handles and must not grant keeper decryption ACL.

Before a transfer, the authorized encrypted request is bounded by:

```text
min(
  encrypted period amount,
  encrypted remaining lifetime budget,
  encrypted accounted plan funds,
  encrypted remaining Pool principal capacity
)
```

Cross-contract amount handles should use `FHE.allowTransient` for the exact transaction rather than
permanent third-party ACL wherever the production call graph permits it.

## Prefunding hard limit

The user's external confidential wallet is outside Autopilot custody.

Even before encrypted policy limits are considered, Autopilot cannot operate on more than the
confidential funds the user explicitly placed into the Vault.

This creates a hard custody boundary independent of keeper behavior.

## Actual-transfer truth

Requested amount is never treated as proof that assets moved.

All Vault and Pool accounting must use the ERC-7984 token's actual returned encrypted transfer
amount.

A zero or partial confidential transfer therefore produces zero or partial accounting only.

The protocol must never fabricate principal because a scheduled request was attempted.

## Zero-transfer replay rule

A schedule slot is single-attempt.

Once a valid due execution reaches the token-transfer stage, its schedule index is consumed even if
the token's actual confidential transfer is zero.

This prevents a keeper from repeatedly retrying the same period and later draining newly arriving
Vault funds under an old authorization.

Catch-up saving is an explicit owner action or a distinct future authorized schedule slot.

## Pool/TWAB semantics

Autopilot is not a parallel savings ledger.

A successful scheduled contribution becomes the same participant principal used by the canonical
Pool.

Before principal increases, the Pool must checkpoint the participant's old principal through the
same TWAB machinery used by withdrawals.

Only the actual transferred confidential amount may increase:

- participant principal;
- aggregate principal;
- canonical received accounting; and
- future TWAB accrual.

No scheduled contribution may retroactively alter a closed draw epoch.

## Pause, skip, revoke, and expiry

Only the plan owner may:

- pause;
- resume;
- skip the exact next slot;
- replace a plan; or
- revoke it.

Revocation is terminal for that plan nonce.

Revoking a plan must not lock its remaining confidential Vault funds. Residual funds remain
withdrawable by the owner.

No keeper, administrator, or backend may reactivate a revoked plan.

## Emergency safety

The frontend will expose an immediate Autopilot emergency stop.

The on-chain security property is stronger than a UI flag: once the revocation transaction is
finalized, the revoked plan has no valid future execution path.

The emergency path never depends on a Veilpot administrator or support service.

## Direct donations

Plain confidential transfers sent to the Vault without the canonical accounting callback are not
plan funding.

They must never silently become another user's plan balance or scheduled authorization.

As with the existing Pool donation invariant, unsupported direct sends remain outside protocol
accounting.

## Required drain-resistance invariants

Gate 2C is not complete until production tests demonstrate all of the following:

1. No keeper/user-service address receives ERC-7984 operator authority over a user's wallet.
2. The Vault cannot transfer accounted plan funds to an arbitrary recipient.
3. A keeper cannot change the encrypted contribution amount.
4. A keeper cannot change the encrypted lifetime cap.
5. A keeper cannot mutate a schedule window.
6. A schedule index executes at most once.
7. Cross-plan replay fails.
8. Cross-user replay fails.
9. Cross-Pool replay fails.
10. Cross-Vault replay fails.
11. Cross-token replay fails.
12. Cross-chain/domain replay fails.
13. Registration-version replay fails.
14. Reservation-nonce replay fails.
15. Plan-nonce replay fails.
16. Pause blocks execution.
17. Revocation permanently blocks execution.
18. Expired windows cannot transfer.
19. Missed-window advancement moves no value.
20. Insufficient Vault balance cannot create principal.
21. Partial token transfer accounts only the actual result.
22. Zero transfer cannot be retried under the same schedule index.
23. Pool capacity cannot be exceeded.
24. TWAB is checkpointed before principal mutation.
25. A scheduled contribution cannot rewrite historical draw weight.
26. Vault residual withdrawal is owner-only.
27. Vault residual withdrawal cannot reduce Pool principal.
28. Keeper execution cannot call Pool withdrawal.
29. Keeper execution cannot claim a prize.
30. Keeper receives no beneficiary decryption ACL.
31. Keeper receives no plan-amount decryption ACL.
32. Token callback caller is the immutable confidential token.
33. Plan funding source is the exact plan owner.
34. Unsupported direct donations do not enter plan accounting.
35. Token callback/reentrancy cannot execute a second schedule slot.
36. Pool/Vault callback reentrancy cannot double-credit principal.
37. No admin sweep exists.
38. No upgrade path can introduce a generic spender.
39. Production source and deployed source must match exactly.
40. The final Sepolia deployment must be verified before the frontend targets it.

## Current gate sequence

1. Gate 2C-A — independent authorization/accounting reference model.
2. Gate 2C-B — Solidity/Vault/Pool interface design and runtime feasibility.
3. Gate 2C-C — Zama Solidity implementation.
4. Gate 2C-D — adversarial local FHEVM and ACL tests.
5. Gate 2C-E — full historical regression plus runtime/HCU review.
6. Gate 2C-F — Sepolia deployment and exact evidence.
7. Gate 2D — protocol SDK integration.
8. Reviewer-status refresh.
9. Frontend implementation.

The existing production deployment remains frozen historical evidence and is never rewritten in
place.
