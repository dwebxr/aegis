# Dead/Legacy Code Evaluation — 2026-04-15

Worktree: `/Users/masia02/aegis/.claude/worktrees/agent-aee82d44` (branch `worktree-agent-aee82d44`)

## Methodology

Searched for: `deprecated`, `legacy`, `old`, `TODO remove`, `TEMP HACK`, `backward compat`,
`v1`/`v2` duplicate endpoints, commented-out code, unused feature flags, orphan files,
stale `.vercelignore` entries, dead Motoko migration branches.

Cross-referenced git log (project has 445 commits; most recent ~2 weeks are translation
hotfixes and audio fixes — those are NOT candidates).

## Inventory

| File / Symbol | What | Confidence | Decision |
|---|---|---|---|
| `aegis_app.jsx` (root, 546 lines, 43 KB) | Self-contained React prototype with inline `SAMPLE_CONTENT`/`STAKING_HISTORY` mock arrays. `useState`/`useEffect` hooks only, zero imports of project code, and **zero references to it anywhere** (no import, no build ref, no test). Pre-dates the Next.js app in `/app/`. Originally committed in `44d2124 "Aegis v3: D2A Social Agent Platform — complete implementation"` as leftover from the original sketch. | **HIGH** | DELETE |
| `.vercelignore` line `dashboard-sections-update.tsx` | File does not exist in the tree. | **HIGH** | DELETE entry |
| `.vercelignore` line `update_dashboard.py` | File does not exist in the tree. | **HIGH** | DELETE entry |
| `canisters/aegis_backend/main.mo` V1/V2 migration branches | Comment at line 195 already confirms V1/V2 branches removed; types + stable vars kept per Motoko persistent actor layout rule (M0169). | **MED** | KEEP — MEMORY.md rule: cannot rename/remove persistent `let`/stable vars. |
| `lib/storage/migrate.ts` localStorage → IDB migration | Flag `aegis-idb-migrated-v1`. Migration code still relevant for existing users. No evidence of version-past-the-wild. | **LOW** | KEEP |
| `lib/types/content.ts:66` "legacy items" comment | Refers to items stored without the `scoredByAI` field; test files exercise legacy path with passing assertions. CURRENT serialization format keeps both branches. | **LOW** | KEEP |
| `lib/scoring/prompt.ts:22` "Also score the legacy axes" | OIC (originality/insight/credibility) + VCL are BOTH part of the current scoring schema (see `/app/api/d2a/info/route.ts` exposes both). Not dead. | **LOW** | KEEP |
| `app/api/analyze/route.ts:127` "Single mode (backward compatible)" | Single vs batch mode — both current; just clarifying comment. | **LOW** | KEEP |
| `app/api/fetch/{ogimage,url}/route.ts` same pattern | Same: batch + single, both current. | **LOW** | KEEP |
| `lib/ingestion/quickFilter.ts` / `heuristics/common.ts` "legacy" | Refers to preserving byte-for-byte English scoring during multi-language refactor. Currently in use; not dead. | **LOW** | KEEP |
| `lib/translation/prompt.ts:249` "legacy maxLength param" | Parameter still honoured by current callers & tests; not dead. | **LOW** | KEEP |
| `TODO-LARP-AUDIT.md`, `TODO-LARP-AUDIT-2.md`, `TODO-LARP-AUDIT-3.md` | Historical audit trackers (all items marked done). | **MED** | KEEP (user-maintained docs; not code; out of scope for this pass) |
| Scoring cascade in `contexts/content/scoring.ts` | Ollama→WebLLM→BYOK→IC→Server→Heuristic — **CURRENT architecture feature** per instructions. | — | KEEP |
| `contexts/AuthContext.tsx` `__AEGIS_MOCK_AUTH` | Guarded by `NODE_ENV !== "production"`; used by e2e fixtures. | **LOW** | KEEP |

## Removal Plan (HIGH only)

1. **Delete `aegis_app.jsx`**
   - Rationale: orphan prototype, zero references, 43 KB of dead code in repo root.
   - Verify: `grep aegis_app` returns no hits; file is `.jsx` not included in `tsconfig`; not imported from any entrypoint.
   - Risk: none.

2. **Clean `.vercelignore`**
   - Remove references to non-existent `dashboard-sections-update.tsx` and `update_dashboard.py`.
   - Risk: none — ignore entries for missing files are no-ops but confusing; cleaner signal.

## Non-removals (reasoning)

- Motoko V1/V2 types: persistent actor layout must be preserved (MEMORY.md — M0169).
- `TODO-LARP-*.md`: documentation, not code; user may want historical record.
- `legacy` comments in scoring/heuristics/translation: describe current multi-path behaviour
  accurately; tests pin both sides.
