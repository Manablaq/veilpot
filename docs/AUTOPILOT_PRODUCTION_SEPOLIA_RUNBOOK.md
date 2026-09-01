# Veilpot Autopilot Production Sepolia Deployment Runbook

## Scope

This runbook applies to the production Autopilot deployment composed of:

1. `VeilpotPool`
2. `VeilpotAutopilotVault`
3. `VeilpotSimulatedYieldAdapter`
4. `VeilpotPrizeReserve`

The deterministic CREATE order is:

- `N` — `VeilpotPool`
- `N + 1` — `VeilpotAutopilotVault`
- `N + 2` — `VeilpotSimulatedYieldAdapter`
- `N + 3` — `VeilpotPrizeReserve`

Do not use this runbook for the historical three-contract Sepolia deployment recorded at
`evidence/production-sepolia/deployment.json`.

## Hard safety rules

- Deploy only from `gate2c/autopilot-production-solidity`.
- The local deployment commit and `origin/gate2c/autopilot-production-solidity` must be identical
  before any Sepolia RPC access.
- The Git worktree/index must be clean before deployment.
- `evidence/production-sepolia/autopilot-v3/deployment.json` must not already exist.
- `evidence/production-sepolia/autopilot-v3/deployment-journal.json` must not already exist.
- Never bypass the exact broadcast approval string.
- Never feed a raw private key to the runner. The runner uses the Hardhat-configured signer.
- Never insert another CREATE transaction between the four planned deployments.
- Never rerun the production deployment command blindly after an interruption.
- Never delete or edit a deployment journal to force a redeployment.
- The historical schema-v2 evidence file must remain unchanged.

## Local pre-broadcast freeze

From the repository root:

```bash
git status -sb
git rev-parse HEAD
git ls-remote --heads origin gate2c/autopilot-production-solidity
```

The worktree must be clean and the local/remote commit SHA must be identical.

Use the pinned Node runtime:

```bash
export PATH="$PWD/.tooling/node-v22.23.2-darwin-arm64/bin:$PATH"
node --version
```

Expected:

```text
v22.23.2
```

Run the local quality gates:

```bash
corepack pnpm typecheck
corepack pnpm lint

cd packages/contracts
corepack pnpm test:production-sepolia-offline
corepack pnpm test
cd ../..
```

The current reviewed baseline is:

- production offline guards: `14 passing`
- complete Hardhat regression: `212 passing`
- Pool runtime: `23480` bytes
- Pool creation: `24789` bytes
- Vault runtime: `6792` bytes
- Vault creation: `7613` bytes

Do not broadcast if any count, bytecode size, production source identity, or reviewer guard fails.

## Broadcast authorization

The runner is fail-closed until this exact value is supplied:

```text
I_AUTHORIZE_VEILPOT_PRODUCTION_SEPOLIA_DEPLOYMENT
```

Immediately before the authorized live run, confirm again:

```bash
git status -sb
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git ls-remote --heads origin gate2c/autopilot-production-solidity | awk '{print $1}')"

test -n "$REMOTE_HEAD"
test "$LOCAL_HEAD" = "$REMOTE_HEAD"
test ! -e evidence/production-sepolia/autopilot-v3/deployment.json
test ! -e evidence/production-sepolia/autopilot-v3/deployment-journal.json
```

Only after those checks pass:

```bash
export VEILPOT_PRODUCTION_SEPOLIA_BROADCAST=I_AUTHORIZE_VEILPOT_PRODUCTION_SEPOLIA_DEPLOYMENT

cd packages/contracts
corepack pnpm production:sepolia
cd ../..

unset VEILPOT_PRODUCTION_SEPOLIA_BROADCAST
```

Do not run that command merely to test connectivity. It is the real four-contract broadcast path.

## Journal lifecycle

The runner writes the public journal at:

`evidence/production-sepolia/autopilot-v3/deployment-journal.json`

States are monotonic:

1. `PLANNED`
2. `POOL_CONFIRMED`
3. `VAULT_CONFIRMED`
4. `ADAPTER_CONFIRMED`
5. `RESERVE_CONFIRMED`
6. `EVIDENCE_PUBLISHED`

The journal intentionally makes the repository dirty after deployment starts. That is recovery
evidence, not a reason to delete the file.

## Interruption recovery

### If no journal exists

No production CREATE transaction has been journaled by this runner. Stop and investigate before
deciding whether a live run should be authorized.

### If the journal state is `PLANNED`, `POOL_CONFIRMED`, `VAULT_CONFIRMED`, or `ADAPTER_CONFIRMED`

Do **not** rerun `production:sepolia`.

Do **not** delete or modify the journal.

This is a partial deployment. Reconcile the recorded addresses, deployer nonce, transaction state,
and on-chain receipts before any next action.

The automatic evidence recovery command intentionally refuses incomplete journals.

### If the journal state is `RESERVE_CONFIRMED` and v3 evidence is absent

All four deployment receipts were journaled, but final evidence publication did not complete.

The broadcast approval variable must be absent:

```bash
unset VEILPOT_PRODUCTION_SEPOLIA_BROADCAST
```

The current Git HEAD must equal the `sourceCommit` in the journal.

Run only the no-broadcast recovery:

```bash
cd packages/contracts
corepack pnpm production:sepolia:recover-autopilot-evidence
cd ../..
```

The recovery path:

- sends no deployment transaction;
- re-derives the `N` through `N + 3` address plan;
- re-verifies all four deployment transactions and receipts;
- re-verifies the Pool private Vault constructor input;
- re-verifies public Pool/Vault/Adapter/Reserve bindings;
- re-verifies all four runtime identities;
- publishes only the v3 evidence file.

### If the journal state is `EVIDENCE_PUBLISHED`

Do not rerun deployment or recovery. Review and preserve the generated evidence.

## Reviewer evidence

Historical schema-v2 deployment:

`evidence/production-sepolia/deployment.json`

Autopilot schema-v3 deployment:

`evidence/production-sepolia/autopilot-v3/deployment.json`

Autopilot deployment journal:

`evidence/production-sepolia/autopilot-v3/deployment-journal.json`

The v3 evidence records:

- exact source commit;
- deployer and starting nonce;
- four deterministic CREATE deployments;
- token and wrappers-registry profile;
- Pool private `_autopilotVault` constructor proof;
- explicit verified binding manifest;
- normalized runtime identity for Pool, Vault, Adapter, and Reserve;
- the exact deployment broadcast approval value.

## Post-deployment repository rule

After a successful deployment or successful evidence recovery:

1. inspect the generated journal and v3 evidence;
2. verify they contain no secret-bearing key or RPC URL;
3. verify the historical schema-v2 evidence did not change;
4. commit the generated public evidence in a separate evidence commit;
5. push that evidence commit non-force;
6. verify remote parity again before frontend/SDK integration uses the deployed addresses.

Do not rewrite the deployment source commit after broadcast. The evidence must continue to identify
the exact source commit that created the contracts.
