# Corrected V2.x live Sepolia E2E

This document records the reconciled production-browser recovery validation for the active corrected
V2.x deployment.

## Scope

- Application: https://veilpot.vercel.app
- Network: Ethereum Sepolia
- PoolV2: `0x0482DfAeCB4b3B76b9Efd4dEF261445D7bcCFcDA`
- Wallet: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- Current frontend checkpoint: `af7d7a5049df4798c393124494eda84b6d98dca4`

## Reconciled transaction record

| Purpose                | Transaction                                                          |      Block | Result                 |
| ---------------------- | -------------------------------------------------------------------- | ---------: | ---------------------- |
| Confidential deposit   | `0xe003e5d6c45f88aea20f3f0b98bc1b445b3aafd902f99b0a7bb750f6cef9c706` | `11642726` | Success                |
| Threshold settlement   | `0xa6cfe7e4562600be189e62117d42e9a710f3411ec60ae95d2850e43a82376d15` | `11642743` | Success / FALSE        |
| Refund completion      | `0xffd4bfd3230352a012184282a8672abc7f5d88eb1396edbb5c711ecb0625e666` | `11642858` | Success / TRUE         |
| Bond withdrawal        | `0x3ff3c5001fcc3b0c3666433accb617865351f10d1a2b397bda8f41f96bbae92f` | `11643001` | Success                |
| Duplicate bond attempt | `0x52d6aa0cfa471c0126acf75d43ac1457c2bf00a9a5383e40a76a39ea9c9647b4` | `11643002` | Reverted / InvalidBond |

## Final state

The refund-completion transaction decoded to `settleRefundCompletion` with `clearComplete = true`.

An authoritative later read returned:

`participantState(0) = 0`

which is `FREE`.

The registration bond was credited as:

`1000000000000000 wei = 0.001 ETH`

and was successfully withdrawn at block `11643001`.

After withdrawal:

`pendingBondRefund(wallet) = 0`

The later duplicate attempt correctly reverted with `InvalidBond`.

## Frontend hardening

The stale displayed bond credit that permitted the duplicate attempt was fixed in:

`af7d7a5049df4798c393124494eda84b6d98dca4`

The production frontend now uses a dedicated Sepolia safety read for bond credit, independently
simulates the withdrawal before wallet opening, and immediately consumes the displayed credit after
successful inclusion.

No contract, protocol-SDK source, deployment evidence, or on-chain deployment identity changed in
that frontend fix.

## Final recovery conclusion

- participant slot: `FREE`;
- confidential refund lifecycle: complete;
- registration-bond credit: `0`;
- registration bond: withdrawn;
- further refund decryption: not required;
- further refund settlement: not required; and
- further bond withdrawal: not required.
