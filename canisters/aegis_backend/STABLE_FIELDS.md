# Canister Stable-Field Registry

The canister is declared as `persistent actor AegisBackend`. In Motoko's
persistent-actor model, **every top-level `let` and `var` field is part of
the on-upgrade state**. Renaming or removing any entry here causes an M0169
deploy failure (dfx treats rename as `old-deleted + new-added`, and deleting
a stable field is forbidden). Add new fields at the end; never mutate or
delete existing entries.

## Mutable stable vars (`var stable*`)

| Field | Type | Added in | Notes |
| --- | --- | --- | --- |
| `stableEvaluations` | `[(Text, ContentEvaluationV1)]` | v1 | superseded by V3; kept for upgrade compat |
| `stableEvaluationsV2` | `[(Text, ContentEvaluationV2)]` | v2 | superseded by V3; kept for upgrade compat |
| `stableEvaluationsV3` | `[(Text, Types.ContentEvaluation)]` | v3 | current schema (adds `validatedAt`) |
| `stableProfiles` | `[(Principal, Types.UserProfile)]` | v1 | |
| `stableSourceConfigs` | `[(Text, Types.SourceConfigEntry)]` | v1 | |
| `stableSignals` | `[(Text, Types.PublishedSignal)]` | v1 | |
| `stableStakes` | `[(Text, Types.StakeRecord)]` | v1 | |
| `stableReputations` | `[(Principal, Types.UserReputation)]` | v1 | |
| `stableD2AMatches` | `[(Text, Types.D2AMatchRecord)]` | v1 | |
| `stableSignalVoters` | `[(Text, [Principal])]` | v1 | |
| `stableOffers` | `[(Text, Types.Offer)]` | A2A | on-chain offer storage |
| `stableReceipts` | `[(Text, Types.Receipt)]` | A2A | on-chain receipt storage |
| `stablePushSubscriptions` | `[(Principal, [Types.PushSubscription])]` | Web Push | |
| `stableBriefings` | `[(Principal, Types.D2ABriefingSnapshot)]` | x402 | |
| `stableUserSettings` | `[(Principal, Types.UserSettings)]` | Nostr/D2A sync | |
| `stableUserPreferences` | `[(Principal, Types.UserPreferences)]` | pref profile sync | |

## Persistent `let` constants (also M0169-protected)

These are actor-scope `let` bindings. Even though their values are fixed at
compile time, their *names* are part of the stable interface. Dropping or
renaming any of them will fail the next upgrade.

| Name | Purpose |
| --- | --- |
| `ICP_LEDGER` | Reference to the ICP ledger canister (`ryjl3-tyaaa-aaaaa-aaaba-cai`) |
| `ICP_FEE` | Standard ICP transfer fee (10_000 e8s) |
| `MIN_STAKE` / `MAX_STAKE` | Validator stake bounds |
| `VALIDATE_THRESHOLD` / `FLAG_THRESHOLD` | Consensus thresholds for signal validation / flagging |
| `DEPOSIT_EXPIRY_NS` | Deposit expiry window |
| `PROTOCOL_WALLET` | Protocol revenue destination principal |
| `CMC` | Cycles-minting canister reference (`rkp4c-7iaaa-aaaaa-aaaca-cai`) |
| `CYCLES_THRESHOLD` | Cycles top-up threshold (2T) — mirrored in `lib/ic/health.ts` |
| `TPUP_MEMO` | Memo blob for cycles top-up transfers |
| `II_ORIGINS_PATH` | Internet Identity alt-origins well-known path |
| `II_ORIGINS_BODY` | Internet Identity alt-origins response body |
| `SELF` | Canister's own principal |

If one of these needs to change semantically, **add a new `let FOO_V2` and
leave the old one in place**. Do not rename.

## Rules

1. **Never remove a field.** Even if unused, the old name must stay; serialize
   an empty array if you want to drop data.
2. **Never rename a field.** dfx treats a rename as `old-deleted + new-added`,
   which triggers M0169 at deploy.
3. **Never change a field's type.** Add a new `stableXxxV2` field, migrate in
   `postupgrade`, and leave the old field intact.
4. **Add new fields at the bottom.** Ordering isn't strictly required by the
   compiler, but keeping chronological order makes audits easier.

## Verification

Before every canister deploy, run:

```bash
dfx start --clean --background
dfx deploy aegis_backend          # fresh install (baseline)
# Make code changes, then:
dfx deploy aegis_backend --mode upgrade   # should succeed
```

If `dfx deploy --mode upgrade` fails with M0169, a stable field was renamed or
removed. Restore the missing field before proceeding.
