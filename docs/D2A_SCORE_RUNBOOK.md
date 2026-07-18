# D2A Score x402 Runbook

This runbook is the production procedure for `/api/d2a/score` and the shared x402 facilitator used by score, briefing, and briefing changes. All timestamps and budget boundaries are UTC. Operational scripts are part of the root TypeScript compilation and are run from the repository root with `npx tsx`.

## Safety rules

- The shared payment kill switch is `D2A_PAYMENTS_DISABLED=true`. Set it and redeploy to stop briefing, briefing changes, and score together. `D2A_SCORE_ENABLED` remains the score-only enable flag. Never remove `X402_RECEIVER_ADDRESS`: the briefing routes treat a missing receiver as free access.
- Never automatically re-sign a new x402 v2 payment when verify or settle returned an error or the result is unknown. Clients must surface the indeterminate payment and wait for operator reconciliation. A durable final means the payment settled, while a durable claim means a prior attempt was admitted for settlement and now requires adjudication or reconciliation. Neither state permits a new score execution with that authorization.
- Reconciliation records and compensation tombstones are append-only. Application code does not consume resolution records; they are evidence for human operators only.
- Compensation is one item at a time. Batch compensation, scripts that iterate sends, and “retry all” wallet actions are prohibited.
- Any missing record, RPC failure, lost lease, conflicting resolution, failed `SET NX`, or uncertain chain result is fail-closed: stop without sending.

## Required production configuration

Confirm these values in the deployment environment before enabling score:

```text
D2A_SCORE_ENABLED=true
D2A_PAYMENTS_DISABLED=false
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
  --network eip155:8453 \
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
- `needs-review`: every other result, including a missing transaction hash unless the finalized authorization is provably expired and unused, or any RPC/decode error.

`--network` accepts `eip155:8453` (the default) or `eip155:84532`. It selects Base or Base Sepolia, the corresponding public RPC default, USDC proxy, and pinned implementation. `--rpc-url` overrides the RPC. The current pins are `0x2Ce6311ddAE708829bc0784C967b7d77D19FD779` on mainnet and `0xd74Cc5d436923b8bA2c179b4bcA2841D8A52C5B5` on Sepolia.

Before classifying receipt evidence, the verifier requires the receipt block to be finalized and canonical. It reads the Zeppelinos implementation storage slot at the receipt and parent blocks, requires both values to match the selected network's pin, and requires no proxy `Upgraded` event in the receipt block. Before reading `authorizationState` for compensation, it independently applies the same slot, parent-block, expected-pin, and no-in-block-upgrade checks at the finalized block used for that state read. This finalized-block pin is mandatory even when no receipt is available and the expired/unused state is the only compensation evidence. The plan originally also called `implementation()`, but FiatTokenProxy protects that getter with `ifAdmin`; non-admin RPC callers fall through to the implementation and revert. The storage slot is therefore the sole read-only implementation source. The report records the receipt and finalized block numbers, both applicable implementation pins and parent blocks, and matching log indices.

After an authorized USDC proxy upgrade, first set `D2A_PAYMENTS_DISABLED=true` and redeploy. Independently verify the new implementation from the ZOS slot at finalized receipt and parent blocks and confirm the absence of an in-block `Upgraded` event. Then test the candidate without changing code by passing `--expected-impl 0x...`. Only after that report and the upstream upgrade are reviewed should the relevant network pin constant in `scripts/verify-settlement.ts` be updated, deployed, and the shared kill switch cleared.

## Reconciliation

Start a report-only run first:

```bash
npx tsx scripts/reconcile.ts
```

The script obtains `runbook-lock` with `SET NX EX 900`, increments `runbook-epoch`, and enforces a 600-second write lease. Before every write it checks both wall-clock deadline and `runbook-lock == ownerToken`. It only marks durable `pending` or `unknown` attempts eligible when they are more than one hour old and retain at least seven days of TTL. Dangling `settled` or `rejected` index entries are report-only and carry a ZSET cleanup warning. Each report also removes pending-index members older than the 90-day journal retention window only when an MGET confirms that the corresponding record no longer exists; `prunedPendingCount` reports the number removed.

Every resolution is a new `{hash}:resolution:{resolutionToken}` record written with `SET NX`; attempts are never updated in place. Reports list resolutions in epoch order and label any hash with multiple resolutions, or a resolution whose epoch is older than the current counter, as requiring manual adjudication. No winner is selected by code.

When a caller claims that a payment already settled, ask them to present the payer address and authorization nonce. Do not ask for or match the raw `PAYMENT-SIGNATURE`. Locate the journal identity `sha256(network + ":" + payer.toLowerCase() + ":" + nonce.toLowerCase())` using the endpoint's payment network, then confirm the attempt's stored authorization and on-chain evidence.

To append a human decision after reviewing the report:

```bash
npx tsx scripts/reconcile.ts \
  --resolve <payment-identity> \
  --attempt-token <uuid> \
  --outcome needs-manual-review \
  --operator <name> \
  --evidence '{"ticket":"INC-123"}'
```

### Compensation procedure

Perform these steps in order for exactly one attempt:

1. Run report-only reconciliation and confirm the attempt is eligible. Resolve all multiple/stale resolution warnings manually.
2. Immediately re-read the journal using the compensation command. If a final record now exists, stop.
3. Run the on-chain verifier against the authorization stored in the journal attempt. The journal supplies payer, payee, amount, nonce, validity window, network, and asset; the network selects the chain, RPC default, USDC proxy, and implementation pin. Continue only for `closed-unpaid` with `compensationAllowed: true`; an unknown network or mismatched asset is `needs-review`.
4. Commit the compensation entry to the external accounting ledger and obtain its immutable reference.
5. Run the command below. It repeats the journal read and verification, then writes `{hash}:compensation` with `SET NX` and no TTL. If this fails, do not send.
6. Only after the command prints `authorizedToSendOneTransfer: true`, send one transfer matching the ledger entry. Record its transaction hash in the ledger; do not run another item in the same wallet action.

```bash
npx tsx scripts/reconcile.ts \
  --compensate <payment-identity> \
  --attempt-token <uuid> \
  --tx 0x... \
  --payer 0x... \
  --nonce 0x... \
  --ledger-ref LEDGER-123
```

`--payer` and `--nonce` are operator-presented assertions for matching the paid claim; they never override the journal. Optional `--pay-to`, `--amount`, `--valid-after`, `--valid-before`, `--network`, and `--asset` values are also assertions and are rejected if they differ from the journal authorization. The script never transfers funds. It asserts on every run that sampled compensation tombstones have Redis TTL `-1`. A compensation tombstone with any other TTL is an incident.

After Redis restoration, failover, or journal recovery, stop all compensation. Treat the external accounting ledger as authoritative and reconcile every restored final, resolution, and tombstone against it. Do not resume compensation until that comparison is complete and signed off.

## Monitoring and rollback

Run settlement statistics per network:

```bash
npx tsx scripts/settle-stats.ts eip155:84532 eip155:8453
```

The rollback threshold is fewer than 16 successes in the most recent 20 attempts for a network. A window with fewer than 20 attempts is shown as incomplete and does not independently trigger the threshold. Unknown, failure, duplicate-abort, and other non-success outcomes remain attempts in the denominator.

On threshold breach or a confirmed facilitator regression:

1. Set `D2A_PAYMENTS_DISABLED=true` and redeploy immediately. This is the stop mechanism for all three payment routes. Leave the receiver configured; removing it is prohibited because briefing would become free.
2. If the incident began with a network/facilitator environment change, restore the last known-good environment values and redeploy. Environment edits without redeploy are not a rollback.
3. Confirm briefing, briefing changes, and score return `payments_disabled` `503`, and verify/settle traffic has stopped.
4. Preserve journal and metrics data; do not delete pending, claims, finals, resolutions, or tombstones.
5. Reconcile unknown attempts before re-enabling.

## Backpressure and budget behavior

Paid score requests decode `PAYMENT-SIGNATURE` and derive the canonical EIP-3009 identity `sha256(network + ":" + payer.toLowerCase() + ":" + nonce.toLowerCase())`. After URL validation and before reserving work, one MGET checks `{identity}:final` and `{identity}:claim`. A final means settlement completed; a claim means an earlier attempt was admitted for settlement and must be adjudicated or reconciled. Either state is ineligible for a new score execution and returns `payment_already_used` `409` before extraction, budget reservation, or Claude. If neither exists, the handler reserves `{identity}:work` with `SET NX EX 150`. Equivalent JSON whitespace, key ordering, base64 padding, or address/nonce casing therefore cannot create another work key. The marker is shared across URLs, so one authorization can run at most one paid handler during its lifetime. A work-marker loser receives `payment_in_progress` `503` with `Retry-After: 10`. Free requests without the header skip these payment guards. The work marker is never explicitly deleted.

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
