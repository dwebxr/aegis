# Translation Output Noise + Validator Interaction — Fix Plan

**Status**: Draft for review (no code written yet)
**Date**: 2026-04-12
**Reported**: User after 6 consecutive hotfixes, "翻訳されないです"
**Author**: Pre-implementation investigation

---

## 1. The bug as user experiences it

> 翻訳されないです。なぜですか？

After Hotfix 6 (isReady gate), the user reports translations still aren't appearing. No specific error message mentioned this time — possibly because the gating is preventing the cascade from running but auto-translate is silently doing nothing for some items.

---

## 2. Root cause from empirical investigation

I just ran 8 different typical RSS-style article translation prompts directly against the production Aegis canister `translateOnChain` and observed:

| # | Input (English) | IC LLM Output | Validator verdict |
|---|---|---|---|
| 1 | "Apple announced a new MacBook with the M5 chip today." | "アップルは、M5チップ搭載の新型MacBookを発表しました。" | ✅ pass |
| 2 | "Bitcoin price surged 5 percent on positive ETF news from BlackRock." | "ビットコインの価格は5パーセント急騰し、ブラックロックからの…" | ✅ pass |
| 3 | "Researchers at MIT have developed a new technique…" | "ＭＩＴの研究者群が、大量言語モデルにデータが少ない状況でも…" | ✅ pass (full-width latin slightly weird) |
| 4 | "OpenAI unveiled GPT-5 with improved reasoning…" | "オープンエーアイは、パワーある推論能力と…" | ✅ pass |
| 5 | "The European Union proposed new AI regulations…" | "ヨーロッパ連合(EU)は新たなAI規制を発表予定で…" | ✅ pass |
| 6 | "Tesla recalls 50000 vehicles…" | "テスラはオートパイロットシステムに影響を及ぼす…" | ✅ pass |
| 7 | "Quantum computing breakthrough: IBM announces 1000 qubit processor." | **"IBMは、カオス量子コンピュータを発表しました。**\n\n**(Note: I used the polite form "です" to match the tone…)\n\nHere is the breakdown:\n\n* Quantum -> カオス量子\n* computing -> (no translation needed…)\n…"** (~600 chars) | ❌ **REJECTED — ratio 9.2 > MAX_RATIO 5.0** |
| 8 | "GitHub Copilot now supports voice commands for code completion." | "GitHub Copilotはコード補完に声指令をサポートしています。" | ✅ pass |

**Key finding**: 1 in 8 items (12.5%) hits this failure mode in production. For a power user with a briefing of 50+ items, that's ~6 items per page load failing IC LLM validation. The cascade then falls to claude-server, where:

- For most items, claude-server succeeds → translation visible
- For some items (URLs, code-only), claude-server returns no-kana → smart-model skip (with hotfix 5 gate, only fires when IC LLM was tried, which is now true)
- For some items, claude-server hits transient errors

The exact failure pattern in news7:
- Output starts with valid Japanese: "IBMは、カオス量子コンピュータを発表しました。"
- Followed by `\n\n(Note: I used the polite form…)`
- Followed by `\n\nHere is the breakdown:`
- Followed by a bullet list of word-by-word "translations"

The validator's checks:
1. Empty? No ✓
2. Meta-commentary prefix? **No — the OUTPUT starts with Japanese, the meta is in the MIDDLE/END**, so `META_PREFIXES` doesn't fire and `stripLeadingMeta` doesn't strip
3. Kana check? **Yes, has Japanese kana** → passes
4. **Length ratio: 600 chars / 65 chars = 9.2 → exceeds MAX_RATIO=5.0** → REJECTED with reason "output too long (ratio 9.23 > 5)"

The validator is correct to reject — the output has way more content than the input, indicating noise. But the FIRST PARAGRAPH is a perfectly good translation. We're throwing away a working translation because of trailing junk.

---

## 3. Why the previous hotfixes didn't catch this

| Hotfix | What it fixed | Why it doesn't catch news7 |
|---|---|---|
| 1: IC LLM transient retry | DFINITY queue saturation errors | Retry doesn't help; the response is "successful" — it just has noise |
| 2: Meta-prefix strip | LEADING `"Here is the translation:"` patterns | News7 has CLEAN Japanese FIRST, then noise — no leading prefix |
| 3: mergePageIntoContent translation persistence | Reload-time translation loss | Unrelated |
| 3.5: Diagnostic backend errors | Generic "no backend" message | Unrelated to root cause |
| 4: actor-ready retry + rate limit + smart-model skip | Cold-start race + rate-limit + URL items | Doesn't address output noise |
| 5: Gated smart-model skip | Cold-start silent skip | Doesn't address output noise |
| 6: isReady gate | Cold-start cascade race entirely | Doesn't address output noise |

**All 6 hotfixes addressed RACE / TIMING / DELIVERY issues. None of them addressed the ACTUAL CONTENT of the LLM output.**

---

## 4. Goals

### Primary
- **Recover the valid Japanese translation from a noisy IC LLM output** instead of rejecting the whole thing
- Specifically: when Llama 3.1 8B prepends valid Japanese followed by `\n\n` followed by English meta-commentary or word-by-word breakdown, take only the Japanese paragraph and discard the rest

### Secondary
- **Prevent the meta-commentary in the first place** by tightening the prompt
- **Make the prompt give the model less room to add commentary**

### Out of scope
- Phase 2 (Qwen3_32B) — that's the long-term solution but requires canister upgrade
- Validator threshold tuning (ratio bounds) — wider bounds would accept noise as "translation"
- Per-language validators

---

## 5. Constraints

### Hard constraints
- **No canister change** — the prompt is built frontend-side, the model itself is the issue
- **Don't accept clearly broken output** as a translation — meta-commentary in the translated text would be visible to users
- **Don't lose valid translations** — the FIRST paragraph is correct, we should preserve it
- **Don't break other languages** — the cleanup logic should be safe for all 10 supported languages
- **Don't break edge cases** — single-line outputs, multi-paragraph valid translations, code blocks in the original

### Soft constraints
- **Must be deterministic** — no LLM-on-LLM cleanup
- **Must be cheap** — runs synchronously in `parseTranslationResponse`, no extra LLM calls
- **Backward compatible** — existing valid outputs should still parse identically

### Edge cases I have to handle

1. **Clean output, no noise**: pass through unchanged
2. **Output with leading meta-prefix**: stripped by hotfix 2, then split-on-double-newline trimming wouldn't fire (no `\n\n`)
3. **Output with trailing English commentary**: take everything before the first `\n\n` followed by ASCII paragraph
4. **Output with trailing list "* word -> 翻訳"**: take everything before the first `\n\n*`
5. **Multi-paragraph valid Japanese translation**: KEEP all paragraphs — the heuristic must distinguish "Japanese followed by Japanese" from "Japanese followed by English commentary"
6. **Code blocks in the original article that the LLM preserved**: don't accidentally split inside a code block
7. **URLs in the translation that the LLM kept unchanged**: don't accidentally treat them as commentary
8. **JSON-format response (with reason)**: the JSON `text` field should also be cleaned
9. **All-katakana proper noun output**: still passes the kana check (already handled)
10. **Output with the bullet list as the WHOLE output**: no leading Japanese — validator would correctly reject

---

## 6. Dependencies

### Code
- `lib/translation/prompt.ts` — `parseTranslationResponse` is the cleanup site
- `lib/translation/validate.ts` — validator stays as-is
- `lib/translation/engine.ts` — no change needed
- `__tests__/lib/translation/prompt.test.ts` — add new fixtures from real Llama outputs
- `__tests__/lib/translation/validate.test.ts` — verify cleaned outputs pass validation

### External
- Real Llama 3.1 8B output samples to drive the test fixtures (have 8 samples already)

---

## 7. Architectural options

### Option A: Trailing-noise heuristic in `parseTranslationResponse`
**Approach**: After parsing the response, look for a `\n\n` followed by either:
- `(Note:`, `Note:`
- `Here is the`, `Let me know`
- `* `, `- ` (markdown bullet starts)
- A line that's >50% ASCII letters (indicates English commentary)

If found, take only the part before that marker.

**Pros**: Targeted, deterministic, cheap, fixes exactly the observed pattern
**Cons**: Heuristic — might mis-classify a legitimate multi-paragraph Japanese translation if the second paragraph happens to start with a Japanese word that resembles meta

### Option B: First-paragraph-only enforcement
**Approach**: After all stripping, if the output contains `\n\n`, take only the first non-empty block.

**Pros**: Very simple
**Cons**: **Loses valid multi-paragraph translations**. Article descriptions in news feeds can be multi-paragraph; the second paragraph is real content, not noise. This option would silently truncate.

### Option C: Language-content gate per paragraph
**Approach**: Split on `\n\n`, classify each paragraph as "majority kana" or "majority ASCII", keep paragraphs that are majority kana, drop the rest, rejoin.

**Pros**: Most accurate — directly mirrors what the user perceives ("this paragraph is translated, this one is meta")
**Cons**: Slightly more complex; for ja target only (other languages need different language-detection logic)

### Option D: Tighten the prompt
**Approach**: Add stronger prompt instructions like "Do NOT include any commentary, breakdown, notes, or explanations after the translation. Output ONLY the translated paragraph."

**Pros**: Prevents the issue at the source. Smaller code change.
**Cons**: Llama 3.1 8B is unreliable at following negative instructions. The current prompt already says "Provide ONLY the translated text — no explanations, notes, or labels" and Llama still added them. Won't fully solve.

### Option E: Hybrid — Tighten prompt + Option C cleanup
**Best of both**. Prompt reduces frequency, paragraph filter catches what slips through.

---

## 8. Recommended approach

**Hybrid (Option E) — implemented as two layered fixes**:

### Layer 1: Prompt tightening
- Add an extra rule near the end: "Do not append any breakdown, notes, parenthetical explanations, or word-by-word translations. Stop immediately after the translated paragraph(s)."
- Strengthen the "Now translate:" trailing instruction
- Frontend-only change in `prompt.ts`

### Layer 2: Per-paragraph language-gate cleanup
- New helper in `prompt.ts`: `stripTrailingNoise(text, targetLanguage)`
- For ja target: split on `\n\n`, keep only paragraphs that contain at least one kana character OR start with markdown that looks like translated structure (e.g., `**...**`), drop paragraphs that are pure ASCII or start with `(Note:`, `*`, `-`, `Here is`, etc.
- Apply BEFORE the validator runs, AFTER `stripLeadingMeta`
- For non-ja targets: skip this step (no kana to detect on; non-ja outputs are typically clean from Claude server anyway)

### Layer 3 (defensive): Loosen the validator's MAX_RATIO for SHORT inputs
- For input < 200 chars, MAX_RATIO is currently 5.0. Llama tends to be verbose on short inputs. Bump to 8.0 for short inputs.
- Long inputs (where noise is less proportionally significant) keep 5.0.

---

## 9. Data flow after fix

```
Aegis canister translateOnChain → raw Llama 3.1 8B output
  │
  ▼
parseTranslationResponse(raw)
  │
  ├─ ALREADY_IN_TARGET? → return null
  │
  ├─ JSON match? → try parse, recursively cleanup text + reason
  │
  ▼
stripLeadingMeta(text)  ← existing (hotfix 2)
  │
  ▼
stripTrailingNoise(text, "ja")  ← NEW (this fix)
  │  for each paragraph:
  │   if has kana: keep
  │   if starts with (Note: / Here is / * / - / "Translation": ASCII-only: drop
  │   else if mostly ASCII: drop
  │  rejoin survivors with \n\n
  ▼
return { text: cleaned, reason: cleaned }
  │
  ▼
validateTranslation(cleaned, "ja", originalText)
  │
  ├─ length ratio NOW within bounds because trailing noise is gone ✓
  ├─ kana present ✓
  ├─ meta-commentary prefix? no ✓
  ▼
ACCEPT → cache → patchItem
```

---

## 10. Tests to add

In `__tests__/lib/translation/prompt.test.ts`:

```ts
describe("parseTranslationResponse — trailing noise (Llama 3.1 8B real outputs)", () => {
  it("strips trailing (Note: ...) commentary after a Japanese paragraph", () => {
    const raw = `アップルは新製品を発表しました。

(Note: I used the polite form です to match the news article tone)`;
    const result = parseTranslationResponse(raw);
    expect(result?.text).toBe("アップルは新製品を発表しました。");
  });

  it("strips trailing 'Here is the breakdown:' bullet list (real news7 case)", () => {
    const raw = `IBMは、カオス量子コンピュータを発表しました。

(Note: I used the polite form "です" to match the tone of a news article)

Here is the breakdown:

* Quantum -> カオス量子
* computing -> (no translation needed, as it's not a proper noun)
* breakthrough -> ANNOUNCEMENT
* IBM -> IBM
* announces -> 発表します
* 1000 -> 一千
* qubit -> キュビット
* processor -> プロセッサ`;
    const result = parseTranslationResponse(raw);
    expect(result?.text).toBe("IBMは、カオス量子コンピュータを発表しました。");
  });

  it("preserves a multi-paragraph Japanese translation (no false-positive trim)", () => {
    const raw = `アップルは新製品を発表しました。

新型MacBookはM5チップを搭載し、バッテリー寿命が向上しています。`;
    const result = parseTranslationResponse(raw);
    expect(result?.text).toContain("新製品を発表しました");
    expect(result?.text).toContain("バッテリー寿命");
  });

  it("strips trailing English commentary even without parenthetical marker", () => {
    const raw = `アップルは新製品を発表しました。

I translated this from English. The original was about Apple's MacBook.`;
    const result = parseTranslationResponse(raw);
    expect(result?.text).toBe("アップルは新製品を発表しました。");
  });

  it("does NOT strip non-ja-target outputs (no language-detection for those)", () => {
    // For en target the input is Japanese. The English output is the translation.
    // No paragraph cleanup needed.
    const raw = "Apple announced a new product today.";
    const result = parseTranslationResponse(raw);
    expect(result?.text).toBe("Apple announced a new product today.");
  });

  it("handles output with only ascii commentary (validator will reject the empty result)", () => {
    const raw = `(Note: I cannot translate this)

Sorry.`;
    const result = parseTranslationResponse(raw);
    // After stripping all paragraphs, we either return empty text or pass
    // through as-is. The validator catches the failure.
    // (Implementation choice: return the whole text if nothing survives,
    // so the validator's empty/no-kana check fires with the right reason.)
    expect(result).not.toBeNull();
  });
});

describe("parseTranslationResponse — trailing noise inside JSON text field", () => {
  it("strips trailing noise from {text: ..., reason: ...}", () => {
    const raw = `{"text":"アップルは発表しました。\\n\\n(Note: 敬体を使用)","reason":"高品質"}`;
    const result = parseTranslationResponse(raw);
    expect(result?.text).toBe("アップルは発表しました。");
    expect(result?.reason).toBe("高品質");
  });
});
```

In `__tests__/lib/translation/validate.test.ts`:

```ts
it("accepts what used to be the news7 trimmed output", () => {
  const trimmed = "IBMは、カオス量子コンピュータを発表しました。";
  const original = "Quantum computing breakthrough: IBM announces 1000 qubit processor.";
  const result = validateTranslation(trimmed, "ja", original);
  expect(result.valid).toBe(true);
});
```

---

## 11. Unknowns + risks

### Unknowns
1. **What % of items in the user's actual briefing hit news7-style noise?** I observed 12.5% in 8 random samples. With this fix, the success rate should approach 100% for items where Llama produces ANY valid leading Japanese.
2. **Are there REAL multi-paragraph translations in Aegis content?** RSS feed descriptions are sometimes a few sentences but rarely multi-paragraph. Need to confirm via test data.
3. **Does the strip interact poorly with `parseTranslationResponse`'s JSON path?** The JSON `text` field can also contain `\n\n` and noise. Need to apply the same cleanup to JSON-parsed text.

### Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Cleanup drops a legitimate second paragraph that just happens to look like commentary | MEDIUM | Use kana-presence as the primary signal, not "starts with (Note:" alone |
| R2 | Cleanup leaves the output empty for items where the leading text is already noise | LOW | If cleanup result is empty, pass through original — validator catches it |
| R3 | The prompt tightening changes behavior for OTHER languages (en → fr, etc.) | LOW | The added rule applies to all languages but Claude server is reliable enough that the extra "no commentary" rule is harmless |
| R4 | A future Llama upgrade changes output format and the heuristic stops working | LOW | Tests document the EXACT patterns we strip, regression-detectable |
| R5 | The validator's ratio check still rejects something we should accept | LOW | After cleanup, ratio should be much smaller; fixed test will verify |

---

## 12. Implementation steps (proposed order)

1. Add new fixtures from the 8 real IC LLM outputs to `prompt.test.ts` (red — current parser doesn't strip)
2. Implement `stripTrailingNoise()` helper in `prompt.ts`
3. Wire it into `parseTranslationResponse` after `stripLeadingMeta`
4. Apply to both plain-text and JSON paths
5. Tighten prompt template (add "no breakdown/notes" rule)
6. Run full suite + lint + build
7. Commit + push + deploy
8. Ask user to retest

**Estimated effort**: 1-2 hours including tests.

**This will not require canister changes, will not affect explicit backend modes, and will not interact with the cold-start race fixes.**

---

## 13. What this fix DOES NOT solve

This fix addresses the LLM-output-noise side of the problem. There are still other reasons a translation might fail that this doesn't help with:

- IC LLM transient downtime (covered by hotfix 1 retry)
- claude-server rate limit beyond 60/60s (would need KV)
- Items where Llama refuses to translate (returns "I cannot translate this") — validator correctly rejects
- Items in a language Claude doesn't recognise — validator correctly rejects
- Unauthenticated users with no IC LLM available

---

## 14. Open questions for user

Before implementing:
1. **Are you in `auto` cascade mode or explicit `ic-llm` mode for backend?** (Auto is the default.)
2. **What's your translation policy: `manual`, `high_quality`, or `all`?** Manual means you have to click Translate per item. The default is "manual" — if you're expecting auto-translate, you need to change this in Settings → Translation.
3. **Are you on the most recent reload (after `393fc87`)?** Hotfix 6 is now live; if you reloaded BEFORE that deploy, the old code is still in your tab.
4. **Approximately how many items are in your briefing?** This tells me whether the rate limit could be a factor.
5. **Is this happening on Mac, iPhone, or both?** The cascade has different attempts based on what's loaded per-device.

If you can answer these, I can confirm the diagnosis and proceed with the layered fix above. Otherwise I'll proceed assuming auto cascade + auto-translate policy + recent reload.

---

## 15. Awaiting approval

**No code is written yet.** I need user OK on:
- The fix scope (paragraph-level cleanup heuristic + prompt tightening)
- Whether to also bump MAX_RATIO for short inputs
- The 5 questions above (or at minimum, "proceed with assumed defaults")
