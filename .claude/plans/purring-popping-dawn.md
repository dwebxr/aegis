# Plan: コード品質リファクタリング

## Context

コードベース全体の品質監査を実施。3つの並行エージェントが contexts/lib/components/api を網羅的にレビューし、計61件の問題を検出。本プランでは**高インパクト・低リスク**の改善に集中し、動作変更なしで品質を向上させる。

大規模リファクタリング（DashboardTab 分割、スタイル抽出など）は変更量とリスクが大きいため今回は対象外とする。

---

## R1: スコアリングキャッシュ — 二重パースと二重ハッシュ計算を解消

### 問題
- `lookupScoringCache()` と `storeScoringCache()` が毎回 `loadCache()` → `JSON.parse()` を呼ぶ
- `ContentContext.tsx` が `computeProfileHash()` を呼んだ後、`computeScoringCacheKey()` 内で同じハッシュを再計算

### 修正
- `lib/scoring/cache.ts`: モジュールレベルの `_cache` 変数でインメモリキャッシュ層を追加。localStorage パースは初回のみ
- `lib/scoring/cache.ts`: `computeScoringCacheKey()` にオプション引数 `profileHash?` を追加して再計算を回避
- `contexts/ContentContext.tsx`: `computeProfileHash` → `computeScoringCacheKey(text, userContext, profileHash)` に統合

### ファイル
| ファイル | 変更 |
|----------|------|
| `lib/scoring/cache.ts` | インメモリキャッシュ層追加、API 調整 |
| `contexts/ContentContext.tsx` | cache 呼び出し簡素化 |

---

## R2: デッドコード削除

### 問題
- `RecentTopic.weight` フィールド: 常に `1` が設定され、どこからも読まれない
- `discovery.ts`: `normalizeDomain()`, `extractDomain()` が不要に export されている
- `DemoContext.tsx`: sessionStorage 明示的削除は冗長（sessionStorage はタブ単位で自動クリア）
- `scheduler.ts`: `consecutiveEmpty` カウンタが蓄積されるだけで参照されない

### 修正
| ファイル | 変更 |
|----------|------|
| `lib/preferences/types.ts` | `weight` フィールド削除 |
| `lib/preferences/engine.ts` | `weight: 1` 代入を削除 |
| `lib/sources/discovery.ts` | `normalizeDomain`, `extractDomain` の `export` を削除 |
| `contexts/DemoContext.tsx` | sessionStorage 削除コードを除去 |
| `lib/ingestion/scheduler.ts` | `consecutiveEmpty` フィールドと更新ロジックを削除 |

---

## R3: 型の重複統一

### 問題
- `D2ADeliverPayload` の `scores` がインライン定義 — `ScoreBreakdown` と同一構造
- `D2ADeliverPayload.verdict` がインライン文字列リテラル — `Verdict` 型と同一

### 修正
| ファイル | 変更 |
|----------|------|
| `lib/agent/types.ts` | `ScoreBreakdown`, `Verdict` を `@/lib/types/content` からインポートして使用 |

---

## R4: マジックナンバーに名前付き定数を付与

### 問題
- `PreferenceContext.tsx:99`: IC 同期デバウンス `3000` ms
- `engine.ts:23-28`: `THRESHOLD_LOWER` の名前が方向を示さない
- `scheduler.ts:63`: `conditionalHeaders` の命名が不明確

### 修正
| ファイル | 変更 |
|----------|------|
| `contexts/PreferenceContext.tsx` | `IC_SYNC_DEBOUNCE_MS = 3000` 定数追加 |
| `lib/preferences/engine.ts` | `THRESHOLD_LOWER` → `THRESHOLD_LOWER_STEP`、`THRESHOLD_RAISE` → `THRESHOLD_RAISE_STEP` にリネーム |
| `lib/ingestion/scheduler.ts` | `conditionalHeaders` → `httpCacheHeaders` にリネーム |

---

## R5: discovery.ts の重複ドメイン抽出を統一

### 問題
`getSuggestions()` 内でドメイン抽出ロジックが `extractDomain()` と別に書かれている

### 修正
| ファイル | 変更 |
|----------|------|
| `lib/sources/discovery.ts` | `getSuggestions()` 内の手動 `new URL().hostname` を `extractDomain()` に統一 |

---

## R6: InfoTooltip キーボードアクセシビリティ

### 問題
`tabIndex={0}` と `role="button"` があるが、Enter/Space キーハンドラがない

### 修正
| ファイル | 変更 |
|----------|------|
| `components/ui/InfoTooltip.tsx` | `onKeyDown` ハンドラ追加（Enter/Space でトグル） |

---

## R7: OnboardingFlow の CTA を step 定義に統合

### 問題
`ctaLabel` と `ctaAction` が別々の switch 文で同じ step.id を2重にマッチ

### 修正
| ファイル | 変更 |
|----------|------|
| `components/onboarding/OnboardingFlow.tsx` | step 定義に `cta` プロパティを追加、switch 文を削除 |
| `lib/onboarding/state.ts` | `OnboardingStep` 型に `ctaLabel?` と `ctaTab?` フィールド追加 |

---

## R8: AnalyticsTab の NaN フォールバック統一

### 問題
content.length === 0 のとき、accuracy は `"0.0"` だが falsePositiveRate は `"--"` — 不統一

### 修正
| ファイル | 変更 |
|----------|------|
| `components/tabs/AnalyticsTab.tsx` | 全メトリクスで `content.length === 0` → `"--"` に統一 |

---

## R9: DemoContext の useMemo 依存最適化

### 問題
`dismissBanner` は空 deps の useCallback で安定参照だが、useMemo の依存に含まれている

### 修正
| ファイル | 変更 |
|----------|------|
| `contexts/DemoContext.tsx` | useMemo deps から `dismissBanner` を削除 |

---

## 変更ファイル総覧

| ファイル | R |
|----------|---|
| `lib/scoring/cache.ts` | R1 |
| `contexts/ContentContext.tsx` | R1 |
| `lib/preferences/types.ts` | R2 |
| `lib/preferences/engine.ts` | R2, R4 |
| `lib/sources/discovery.ts` | R2, R5 |
| `contexts/DemoContext.tsx` | R2, R9 |
| `lib/ingestion/scheduler.ts` | R2, R4 |
| `lib/agent/types.ts` | R3 |
| `contexts/PreferenceContext.tsx` | R4 |
| `components/ui/InfoTooltip.tsx` | R6 |
| `components/onboarding/OnboardingFlow.tsx` | R7 |
| `lib/onboarding/state.ts` | R7 |
| `components/tabs/AnalyticsTab.tsx` | R8 |

## Verification

1. `npm run lint` — ESLint クリーン
2. `npm run build` — ビルド成功
3. `npx jest --ci --forceExit` — 全テスト通過（既存テストのアサーション変更不要なことを確認）
4. `vercel --prod` でデプロイ
