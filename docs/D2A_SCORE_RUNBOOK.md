# D2A Score x402 Runbook

This runbook is the production procedure for `/api/d2a/score` and the shared x402 facilitator used by score, briefing, and briefing changes. All timestamps and budget boundaries are UTC. Operational scripts are part of the root TypeScript compilation and are run from the repository root with `npx tsx`.

## Safety rules

- The kill switch is `D2A_SCORE_ENABLED`. Set it to a value other than the literal `true`, then redeploy. Do not remove `X402_RECEIVER_ADDRESS`: the briefing routes treat a missing receiver as free access.
- Never automatically re-sign a new x402 v2 payment when verify or settle returned an error or the result is unknown. Clients must surface the indeterminate payment and wait for operator reconciliation. A retry may reuse a demonstrably unspent authorization only under an explicit client policy; it must not silently create a new authorization.
- Reconciliation records and compensation tombstones are append-only. Application code does not consume resolution records; they are evidence for human operators only.
- Compensation is one item at a time. Batch compensation, scripts that iterate sends, and “retry all” wallet actions are prohibited.
- Any missing record, RPC failure, lost lease, conflicting resolution, failed `SET NX`, or uncertain chain result is fail-closed: stop without sending.

## Required production configuration

Confirm these values in the deployment environment before enabling score:

```text
D2A_SCORE_ENABLED=true
X402_NETWORK=eip155:84532        # Phase 0/1; eip155:8453 only in Phase 2
X402_RECEIVER_ADDRESS=0x...
X402_SCORE_PRICE=$0.02
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
SCORE_DAILY_BUDGET=300
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
ANTHROPIC_API_KEY=...
```

When both CDP keys exist, the server always uses `https://api.cdp.coinbase.com/platform/v2/x402`; `X402_FACILITATOR_URL` is ignored. A partial CDP key pair fails module loading. Base mainnet (`eip155:8453`) without both CDP keys also fails module loading.

In the Upstash Redis console, verify the database eviction policy is `noeviction` before every phase change. Do not proceed with an LRU/LFU policy: evicting the final, claim, pending, runbook lock, or compensation keys invalidates the settlement safety model. Also confirm the database has enough headroom for 90-day journal retention and 14-day metrics.

## Preflight and smoke commands

```bash
npx tsc --noEmit
npx eslint .
npx tsx scripts/cdp-smoke.ts
npx tsx scripts/settle-stats.ts eip155:84532 eip155:8453
```

`cdp-smoke` must report x402 v2 / exact for both `eip155:84532` and `eip155:8453`. Asset support is not inferred from `/supported`; confirm the live 402 `accepts` asset against `DEFAULT_STABLECOINS` and, on mainnet, Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

After deploy, bypass stale intermediaries when checking the descriptor:

```bash
curl -fsS "https://aegis-ai.xyz/api/d2a/info?cb=$(date +%s)"
```

## Settlement verification

The verifier is read-only and uses a public Base RPC unless `--rpc-url` or `BASE_RPC_URL` is supplied:

```bash
npx tsx scripts/verify-settlement.ts \
  --tx 0x... \
  --payer 0x... \
  --pay-to 0x... \
  --amount 20000 \
  --nonce 0x... \
  --valid-before 1750000000 \
  --rpc-url https://...
```

The report has exactly three statuses:

- `settled`: the successful receipt contains matching USDC `AuthorizationUsed(authorizer, nonce)` at log index `i` and the exact payer/payee/value `Transfer` at `i+1`.
- `closed-unpaid`: either a matching authorization cancellation exists with no target transfer, or the authorization is finalized, expired, and unused. Only the latter has `compensationAllowed: true`.
- `needs-review`: every other result, including a missing transaction hash or any RPC/decode error.

Before classifying, the verifier requires the receipt block to be finalized and canonical. It reads the Zeppelinos implementation slot and `implementation()` at the receipt and parent blocks, requires all four values to match, and requires no proxy `Upgraded` event in the receipt block. The report records the block numbers, implementation address, and matching log indices.

## Reconciliation

Start a report-only run first:

```bash
npx tsx scripts/reconcile.ts
```

The script obtains `runbook-lock` with `SET NX EX 900`, increments `runbook-epoch`, and enforces a 600-second write lease. Before every write it checks both wall-clock deadline and `runbook-lock == ownerToken`. It only marks attempts eligible when they have been pending for more than one hour and retain at least seven days of TTL. Items near expiry are report-only.

Every resolution is a new `{hash}:resolution:{resolutionToken}` record written with `SET NX`; attempts are never updated in place. Reports list resolutions in epoch order and label any hash with multiple resolutions, or a resolution whose epoch is older than the current counter, as requiring manual adjudication. No winner is selected by code.

To append a human decision after reviewing the report:

```bash
npx tsx scripts/reconcile.ts \
  --resolve <payload-sha256> \
  --attempt-token <uuid> \
  --outcome needs-manual-review \
  --operator <name> \
  --evidence '{"ticket":"INC-123"}'
```

### Compensation procedure

Perform these steps in order for exactly one attempt:

1. Run report-only reconciliation and confirm the attempt is eligible. Resolve all multiple/stale resolution warnings manually.
2. Immediately re-read the journal using the compensation command. If a final record now exists, stop.
3. Run the on-chain verifier with the exact transaction, payer, payee, amount, nonce, and `validBefore`. Continue only for `closed-unpaid` with `compensationAllowed: true`.
4. Commit the compensation entry to the external accounting ledger and obtain its immutable reference.
5. Run the command below. It repeats the journal read and verification, then writes `{hash}:compensation` with `SET NX` and no TTL. If this fails, do not send.
6. Only after the command prints `authorizedToSendOneTransfer: true`, send one transfer matching the ledger entry. Record its transaction hash in the ledger; do not run another item in the same wallet action.

```bash
npx tsx scripts/reconcile.ts \
  --compensate <payload-sha256> \
  --attempt-token <uuid> \
  --tx 0x... \
  --payer 0x... \
  --pay-to 0x... \
  --amount 20000 \
  --nonce 0x... \
  --valid-before 1750000000 \
  --ledger-ref LEDGER-123
```

The script never transfers funds. It asserts on every run that sampled compensation tombstones have Redis TTL `-1`. A compensation tombstone with any other TTL is an incident.

After Redis restoration, failover, or journal recovery, stop all compensation. Treat the external accounting ledger as authoritative and reconcile every restored final, resolution, and tombstone against it. Do not resume compensation until that comparison is complete and signed off.

## Monitoring and rollback

Run settlement statistics per network:

```bash
npx tsx scripts/settle-stats.ts eip155:84532 eip155:8453
```

The rollback threshold is fewer than 16 successes in the most recent 20 attempts for a network. A window with fewer than 20 attempts is shown as incomplete and does not independently trigger the threshold. Unknown, failure, duplicate-abort, and other non-success outcomes remain attempts in the denominator.

On threshold breach or a confirmed facilitator regression:

1. Set `D2A_SCORE_ENABLED=false` and redeploy immediately. Leave the receiver configured.
2. If the incident began with a network/facilitator environment change, restore the last known-good environment values and redeploy. Environment edits without redeploy are not a rollback.
3. Confirm `/api/d2a/score` returns disabled `503` and verify/settle traffic has stopped.
4. Preserve journal and metrics data; do not delete pending, claims, finals, resolutions, or tombstones.
5. Reconcile unknown attempts before re-enabling.

## Backpressure and budget behavior

The in-progress marker is owner-token based, written with `SET NX EX 150`, and is never explicitly deleted. A concurrent request double-checks cache and otherwise receives `503` with `Retry-After: 10`. The marker intentionally survives a failed attempt until TTL expiry, providing natural per-URL backoff; operators must not delete it to accelerate retries.

The score budget initializes its daily counter with `SET 0 NX EX 86400` before `INCR`. If a request exceeds the budget it attempts `DECR`; a failed `DECR` is conservative leakage that can under-allow future work until the key expires, for at most 24 hours. It never causes over-spend. Do not “repair” the counter downward while requests are active. `Retry-After` is the smaller of Redis TTL and seconds until the next UTC midnight, with UTC midnight as fallback when TTL is unavailable.

## Release phases

### Phase 0 — code present, disabled

Deploy the complete code with Base Sepolia and leave `D2A_SCORE_ENABLED` unset so score returns `503`. Verify typecheck, lint, tests, noeviction, descriptor output, and the disabled path. Run Sepolia smoke and one controlled payment, then set `D2A_SCORE_ENABLED=true` and redeploy.

### Phase 1 — CDP on Sepolia

Add both CDP keys to production while keeping `X402_NETWORK=eip155:84532`. This moves score, briefing, and briefing changes to CDP. Redeploy, run `cdp-smoke`, then complete and verify one real payment through score and one through briefing. Confirm journal final records and settlement metrics.

### Phase 2a — preview mainnet dark validation

In Vercel Preview only, set `X402_NETWORK=eip155:8453`, both CDP keys, the intended receiver, and a small test price. Redeploy preview. Complete one small real payment, require `verify-settlement` to return `settled`, and independently confirm the USDC receipt. Do not change production during this step.

### Phase 2b — production mainnet

Apply the reviewed mainnet environment values to production and redeploy. Run `cdp-smoke`, perform a cache-busted `/api/d2a/info?cb=<timestamp>` smoke, and make one controlled score payment. Verify it on-chain, inspect journal/metrics, and watch the first full 20-attempt window. Roll back on fewer than 16 successes.

