# Veilpot web

Production Next.js frontend for the Veilpot confidential prize-savings protocol.

- Live: https://veilpot.vercel.app
- Network: Ethereum Sepolia (`11155111`)
- Protocol integration: `@veilpot/protocol-sdk`
- Zama packages: `@zama-fhe/sdk@3.5.1`, `@zama-fhe/react-sdk@3.5.1`

## Responsibilities

The web app provides:

- public product/trust/privacy surfaces;
- wallet connection and wallet-signature authentication;
- session restoration;
- safe/public protocol-state reads;
- confidential deposit and withdrawal preparation;
- Autopilot creation/funding/lifecycle/recovery controls;
- VeilDraw controls;
- prize/claim controls;
- exact wallet-action review and mined-transaction reconciliation;
- privacy-first encrypted-value rendering; and
- explicit confidential disclosure only where legitimately supported.

## Integration rules

Frontend protocol actions consume `@veilpot/protocol-sdk`. The web layer does not maintain
independent production addresses, ABI definitions, state ordinals, claim authorization structure,
encrypted-input construction, or Autopilot Merkle schedule logic.

## Privacy rules

The browser does not automatically decrypt confidential values on page load, wallet connect, sign
in, session restoration, or background refresh.

Encrypted values that are not legitimately decryptable from the current frontend are rendered as
encrypted/not decrypted rather than as fabricated amounts or non-functional reveal controls.

## Exact wallet-action rules

Reviewed writes bind sender, chain, destination, calldata, native value, account nonce, and review
freshness. Mined transactions are reconciled against the reviewed identity before the UI accepts
them as the exact requested action.

See [`../../docs/FRONTEND_SECURITY_MODEL.md`](../../docs/FRONTEND_SECURITY_MODEL.md).

## Local development

```bash
pnpm --filter @veilpot/web dev
pnpm --filter @veilpot/web typecheck
pnpm --filter @veilpot/web build
```

Run the full repository verification from the workspace root:

```bash
pnpm check
```
