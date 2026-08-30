# Gate 1A — Privacy Leakage Ledger

This ledger is a design contract. “Encrypted” means an FHE handle that is not publicly decryptable
by default; it does not hide addresses, timing, calldata length, events, or eventual clear
settlement.

| Value                               | Encrypted?                                   | Who may decrypt?                         | Publicly decryptable?                | When                      | Chain leakage                             | Frontend leakage                 |
| ----------------------------------- | -------------------------------------------- | ---------------------------------------- | ------------------------------------ | ------------------------- | ----------------------------------------- | -------------------------------- |
| Deposit amount (ERC-7984)           | Yes                                          | Pool; depositor only on explicit request | No                                   | Never by default          | Sender, recipient, timing, token metadata | Only after explicit reveal       |
| User balance                        | Yes                                          | Pool; owner through explicit user flow   | No                                   | User request              | Address/activity timing                   | Never on render                  |
| TWAB/raw draw weight                | Yes                                          | Pool/draw logic                          | No                                   | Draw lifetime             | Checkpoint timing and membership          | None                             |
| Aggregate raw total `T`             | Yes                                          | Pool/draw logic                          | No                                   | Draw lifetime             | Bucket interval and status                | None                             |
| Bucket `B`                          | Derived public value                         | Everyone                                 | Yes                                  | Bucket proof              | `B/2 < T ≤ B` interval                    | May display interval             |
| Candidate `X_i` / target `R`        | Yes                                          | Controlled claimant flow only            | No                                   | Draw/claim lifetime       | Handles/events only                       | Never by default                 |
| Batch success boolean               | No after proof                               | Everyone                                 | Yes                                  | Batch proof               | Success/failure timing                    | Status indicator                 |
| Winner identity                     | Public registry address; encrypted predicate | Fixed participant                        | No winner plaintext                  | Settlement                | Claim recipient/timing                    | Address already public           |
| Prize entitlement (`euint64`)       | Yes                                          | Reserve and authorized participant       | No by default                        | Until transfer            | Final token transfer may reveal amount    | Explicit claim action only       |
| Claim status                        | No                                           | Everyone                                 | Yes                                  | Claim lifecycle           | State and transaction metadata            | Public status                    |
| Withdrawal amount (ERC-7984)        | Yes                                          | Pool/user flow                           | No                                   | Withdrawal execution      | Address/timing; encrypted token metadata  | Explicit action                  |
| Withdrawal amount (ordinary ERC-20) | No                                           | Everyone observing transfer              | Yes                                  | Transfer                  | Calldata/events/balance delta             | Clear amount                     |
| User address                        | No                                           | Everyone                                 | Yes                                  | Registration/transactions | Linkability and timing                    | Wallet address                   |
| Participant count                   | No                                           | Everyone                                 | Yes                                  | Registry/snapshot         | Anonymity-set size                        | Optional display                 |
| Registration / bond reservation     | No                                           | Everyone                                 | Yes                                  | Slot reservation          | Address, index, timing                    | Public participation status      |
| Pending threshold predicate         | Yes (`ebool`)                                | Pool/KMS; boolean disclosed after proof  | Yes, boolean only                    | Activation/refund         | Proof timing                              | Status only                      |
| Threshold-satisfied registration    | Encrypted predicate; boolean disclosed       | Everyone after proof                     | Yes                                  | Activation                | Only `actualReceived >= 1 token`          | Status only                      |
| Activation deadline                 | No                                           | Everyone                                 | Yes                                  | After pull                | Timeout schedule                          | Countdown/status                 |
| Activation timed-out status         | No                                           | Everyone                                 | Yes                                  | Timeout transition        | Liveness event                            | Status only                      |
| Refund-complete predicate           | Yes (`ebool`)                                | Pool/KMS; boolean disclosed after proof  | Yes, boolean only                    | Refund settlement         | Proof timing                              | Status only                      |
| Refund state / proof timing         | No                                           | Everyone                                 | Yes                                  | Refund lifecycle          | Retry/settlement metadata                 | Status only                      |
| Deregistration / zero-balance proof | Boolean disclosed                            | Everyone                                 | Yes                                  | Tombstone                 | Exit timing and index reuse               | Status only                      |
| Draw timestamps/window              | No                                           | Everyone                                 | Yes                                  | Draw lifecycle            | Scheduling/MEV surface                    | Schedule                         |
| Adapter assets/yield                | Policy-dependent                             | Adapter/reserve observers                | Policy-dependent                     | Accounting updates        | Strategy/yield timing                     | Must say simulated or production |
| Principal backing                   | Internal accounting                          | Pool/reserve                             | No clear aggregate reveal by default | Solvency checks           | Token/adapter events                      | None                             |

## Explicit leakage rules

1. Bucket disclosure is interval leakage, not a total reveal.
2. Public success/failure booleans can leak statistical information about `T`.
3. Public addresses and timestamps permit activity/linkability analysis.
4. Ordinary ERC-20 settlement reveals its clear amount.
5. KMS proofs and handles are metadata, not plaintext.
6. Frontend rendering must never trigger private decryption or signatures.
7. Refund completion uses `PERMISSIONLESS_RETRY_SAME_HANDLE`: while proof is pending, the same
   immutable encrypted handle and binding metadata may be requested again; no second refund transfer
   occurs and no slot is released without a valid completion proof.

## Winner and claim decision

Use encrypted fixed-recipient entitlements with participant authorization. A relayer submits
`claimFor(drawId, participant, authorization)`, where an EIP-712-style authorization binds chain ID,
reserve, draw ID, participant, immutable recipient, claim nonce, and expiry. The relayer cannot
probe arbitrary indices or substitute a recipient. `euint64` residual amounts remain encrypted; a
public `fullTransfer` boolean is optional and, if used, is settlement-time leakage after
authorization.

## Privacy acceptance tests

- Unauthorized wallets cannot decrypt balances, TWABs, weights, totals, candidates, targets, or
  entitlements.
- Public decryption is limited to bucket/status values explicitly listed above.
- Wrong draw, participant, recipient, nonce, or ciphertext invalidates authorization.
- Zero/partial payout preserves encrypted residual entitlement.
- No frontend render path requests a reveal or signature.
