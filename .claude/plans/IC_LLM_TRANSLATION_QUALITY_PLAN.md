# IC LLM Translation Quality Improvement — Plan

**Status**: Draft for review (no code written)
**Date**: 2026-04-11
**Author**: pre-implementation investigation

---

## 1. Goals

### Primary
- **日本語翻訳をモバイルでも実用品質にする**。現状 WebLLM (デスクトップのみ実用) と MediaPipe (モバイル、品質不安定) しか on-device 経路がない。Anthropic Claude (BYOK) は API key 持ち層しか使えない。残るは IC LLM (`translateOnChain`)、これは **認証済みユーザに無料で提供されPWA / モバイルでも動作** する唯一の経路。

### Why this matters
- ユーザの主要 use case (日本語ニュース briefing) で最も価値がある言語
- 既存 backend cascade では IC LLM が server-Claude より前にあるが、品質が低い (Llama 3.1 8B + 汎用プロンプト)
- ChatGPT subscription 経路は法的グレーで断念済み (このセッションで決定)

### Out of scope
- 新規 backend 追加 (OpenAI, DeepL, etc.)
- 認証無し ユーザへの IC LLM 解放
- 翻訳以外 (`analyzeOnChain`) の品質改善 — 別タスク

### Success criteria
- 日本語翻訳の出力が「英語混入」「空文字」「JSON parse 失敗」のいずれでもないこと、かつ出力長が入力長の 0.5〜2.0 倍の範囲に収まる確率 ≥ 90%
- 日本語の基本動作 (敬体保持、固有名詞のカナ表記、コードブロック保護) が一定品質で機能する
- 既存 6809 テストに回帰なし
- canister cycle 消費が 2 倍以下に収まる (より大きいモデル起用時)

---

## 2. Current state (verified by reading source)

### Canister side
- File: `canisters/aegis_backend/main.mo:1620-1652`
- Method: `translateOnChain(prompt : Text) : async Result.Result<Text, Text>`
- 認証: `requireAuthenticated(caller)` — anonymous principal 拒否
- 入力上限: 8000 chars (L1629-1638で truncate)
- LLM呼び出し: `LLM.prompt(#Llama3_1_8B, cappedPrompt)` (L1641)
- 失敗時: `Debug.print` + `#err("IC LLM translation failed")` を返す
- 空応答時: `#err("IC LLM returned empty response")`

### `mo:llm` 2.1.0 capability (確認済み)
- File: `.mops/llm@2.1.0/src/{lib.mo,chat.mo}`
- Backing canister: `w36hm-eqaaa-aaaal-qr76a-cai` (DFINITY managed)
- **対応モデル**:
  - `#Llama3_1_8B` → `"llama3.1:8b"` (現在使用中、最弱)
  - `#Qwen3_32B` → `"qwen3:32b"` (4倍大、多言語強い)
  - `#Llama4Scout` → `"llama4-scout"` (詳細不明、新世代)
- API 形態:
  - `LLM.prompt(model, text)` — 単発プロンプト (現在使用中)
  - `LLM.chat(model).withMessages([...]).send()` — マルチターン、`#system_` メッセージ可
- 制約: 全てのモデルで 1リクエスト = 1 cycleコスト (DFINITY mainnet 経由、料金未公開だが現状でも動いている)

### Frontend cascade
- File: `lib/translation/engine.ts`
- `translateContent({ backend: "auto" | "ic" | ... })` — ユーザ選択 backend に振り分け
- `auto` mode の現在の優先順位 (L125-145):
  1. Ollama (有効時)
  2. MediaPipe (mobile 有効 + ロード済) **OR** WebLLM (desktop 有効 + ロード済)
  3. **IC LLM** (authenticated + actorRef あり)
  4. Claude BYOK (key あり)
  5. Server Claude (最終)
- IC LLM 経路の timeout: auto cascade では 5秒、明示 `backend: "ic"` 指定時は 30秒
- 5秒は厳しい — 32Bモデルなら確実に超える

### Prompt 構造
- File: `lib/translation/prompt.ts`
- `buildTranslationPrompt(text, targetLanguage, reason?, maxLength=3000)`
- 構造: 単一ユーザメッセージ、英語の Rules 列挙、`{ja|fr|de|...}` を `Japanese|French|German|...` に展開
- 言語別 specialization なし — すべての言語で同じプロンプト
- `ALREADY_IN_TARGET` センチネルで「既に目標言語」を検出
- reason 付きの場合は JSON 出力を要求
- **問題点**:
  - 日本語特有の指示なし (敬体/常体、固有名詞のカナ表記、改行保持の強調)
  - few-shot example なし
  - system message 未使用 (mo:llm 2.1 は `chat()` で対応可能だが現状 `prompt()` のみ使用)
  - 8B モデルだと汎用指示だけでは指示追従が弱い

### Output parsing
- `parseTranslationResponse(raw)`:
  - `ALREADY_IN_TARGET` → `null` (skip)
  - JSON マッチ → `{text, reason?}` 抽出
  - JSON 失敗 → plain text fallback
- **検証なし**: 出力に日本語文字が含まれているかチェックしていない、長さ比チェックなし

### Tests
- `__tests__/lib/translation/prompt.test.ts` (98 lines, 13 tests) — buildPrompt + parseResponse をカバー
- `__tests__/lib/translation/engine.test.ts` (537 lines) — 全 backend 経路をカバー
- IC LLM 経路: モック `actorRef` 経由でテスト済、品質検証なし

### Other notes
- Candid file `canisters/aegis_backend/aegis_backend.did` には `translateOnChain`/`analyzeOnChain` が **記載されていない** (123行のみ、新規メソッド未反映)。TS declarations (`lib/ic/declarations/aegis_backend.did.d.ts`) には存在 (手動更新?). dfx generate 動作を要確認
- `lib/ingestion/langDetect.ts` がすでにある — 日本語検出 (kana ベース) 利用可能、出力検証に流用できる

---

## 3. Constraints

### Hard constraints
- **mo:llm 2.1.0 で利用可能なモデルは 3 つのみ**: 8B / 32B / Llama4Scout。これ以上の選択肢なし
- **canister upgrade が必要**: モデル変更 + プロンプト変更とも canister メソッド内に書かれているので、デプロイサイクル必要 (テスト → mainnet upgrade)
- **既存 stable var 構造を壊せない**: M0169 — `let`/`var` フィールド削除/rename はカナリア破壊
- **prompt は IC ingress message 上限 (~2MB) に収まる必要**: 現在 8000 char cap で十分余裕
- **認証必須**: anonymous principal 拒否、unauthenticated ユーザは server-Claude にしか到達できない (cascade で fallback)

### Soft constraints
- **Cycle コスト**: 32B モデルは 8B より明らかに高いはず (公式料金不明、実測必要)
- **応答時間**: 32B は 8B より遅い。auto cascade の 5秒 timeout を再考
- **canister upgrade のリスク**: 再デプロイ毎に短時間 down time、本番ユーザに影響
- **後方互換性**: API シグネチャ `translateOnChain(prompt: Text)` は変更不可 (declarations 同期コスト大)

### Edge cases I have to handle
1. **混在テキスト** (英語と日本語が混じる): 日本語部分が既に翻訳済みでも、英語部分があれば全体翻訳すべき (現状 `ALREADY_IN_TARGET` は単一言語前提)
2. **コードブロック付き記事**: ` ```python ` のようなブロックを翻訳対象外にする必要
3. **URL/技術用語**: `Internet Computer`, `Motoko`, `WebGPU` のような技術用語は原文維持が望ましい
4. **超短文**: 1〜2語の見出しは context が無く誤訳しやすい
5. **超長文**: 8000 char 超は現在切り捨て — チャンク化が必要 (将来)
6. **出力中のmodel自己言及**: "Here is the translation:" のような前置きを LLM が付けがち、 8B モデルは特に
7. **JSON モード未指定で JSON 強制**: 8B モデルは Markdown フェンスで包んだ JSON を返すことがある (parseResponse はそれを正規表現で剥がしている、機能している)
8. **`reason` フィールドが英語混入**: 主 text は翻訳されているが reason だけ英語のまま、というパターン

---

## 4. Dependencies

### Code dependencies
- `canisters/aegis_backend/main.mo` — `translateOnChain` メソッド本体
- `mops.toml` — `llm = "2.1.0"` (別 version への移行は範囲外)
- `lib/translation/prompt.ts` — frontend 側の `buildTranslationPrompt`
- `lib/translation/engine.ts` — cascade、timeout、出力検証追加先
- `lib/ingestion/langDetect.ts` — 出力検証に流用可能 (kana detection)
- `__tests__/lib/translation/{prompt,engine}.test.ts` — テスト追加先

### Build/deploy dependencies
- `dfx 0.30.2` (CLAUDE.md 確認済) — canister build/deploy
- mainnet canister `rluf3-eiaaa-aaaam-qgjuq-cai` への upgrade 権限 (controller key 保持者)
- Vercel deploy (frontend 変更時)

### External dependencies
- DFINITY managed LLM canister `w36hm-eqaaa-aaaal-qr76a-cai` の継続稼働
- mainnet IC の cycles 残高 (canister の cycles balance — 確認必要)

---

## 5. Architectural options (proposed, not committed)

**3つの直交した改善ベクトル** を区別する:

### A. プロンプト品質改善 (canister変更必要、frontend prompt 変更で代替可)
**A1. Frontend-only**: `lib/translation/prompt.ts` に日本語向け few-shot example を追加。canister 変更不要。
- **利点**: canister upgrade 不要、即時 rollback 可能、テストが unit test レベルで完結
- **欠点**: 8B モデルが指示追従できないと無駄、prompt 長膨張で 8000 char cap 食う

**A2. Canister system message 追加**: `LLM.prompt()` から `LLM.chat().withMessages([#system_, #user])` に変更。system role で「あなたは日英翻訳の専門家」役割を固定。
- **利点**: モデルが指示を strict に追う、特に Qwen3 系で効果大
- **欠点**: canister upgrade 必要、回帰テストの範囲広がる

### B. モデル変更 (canister変更必要)
**B1. Qwen3_32B に切り替え**: 32B は多言語性能が 8B より圧倒的に高く、特に CJK 言語で差が大きい。
- **利点**: 同じプロンプトでも品質大幅向上、Aegis の主要言語ターゲット (日本語) と相性◎
- **欠点**: cycle コスト不明 (実測必要)、応答時間増加 (5秒 cascade timeout 見直し必須)、Hallucination 傾向の差を観測必要

**B2. Llama4Scout に切り替え**: 詳細不明 (`mo:llm` README に説明なし) — 評価不能
- **アクション**: DFINITY ドキュメント確認

**B3. 言語別モデル選択**: 日本語ターゲット時のみ 32B、それ以外 8B
- **利点**: cost 抑制
- **欠点**: ロジック分岐増、API シグネチャ変更必要 (`translateOnChain(prompt, lang)`) — 既存 declarations 全更新

### C. 出力検証 + retry (frontend変更のみ)
**C1. 言語検証**: `detectLanguage(parsed.text)` で kana 含有を確認。日本語ターゲットなのに kana 0% なら failed 扱い。
- **利点**: frontend のみ、canister 不変、即実装可能
- **欠点**: 検証ロジックの誤判定リスク (短文で kana 無しは正常な場合あり — 全カタカナの固有名詞のみ等)

**C2. 長さ比率検証**: `parsed.text.length / input.length` が [0.3, 3.0] の範囲外なら failed 扱い (空応答 / model自己説明 / 元テキスト echo を弾く)
- **利点**: model 自己説明 ("Here is the translation: ...") を捕捉
- **欠点**: 言語間の文字数比は揺れる (英→日は 1.0〜1.5x、日→英は 0.7〜1.0x)

**C3. Retry with degraded prompt**: 検証失敗時にプロンプトを単純化して 1 回再試行。
- **利点**: 8B モデルの不安定性を吸収
- **欠点**: latency 倍、cycle 消費倍

---

## 6. Recommended approach (still requires user OK)

**段階的に**、低リスク → 高リスク の順序で:

### Phase 1: Frontend-only (canister 不変、低リスク、即実装可能)
1. **A1**: 日本語向け prompt specialization (few-shot example 追加、敬体指示)
2. **C1 + C2**: 出力検証 (kana detection + 長さ比) を `parseTranslationResponse` の後段に追加
3. テスト: prompt.test.ts と engine.test.ts に新ケース追加 (日本語入出力で実 raw 文字列を assert)
4. デプロイ: Vercel のみ (canister 変更なし)
5. **計測**: 1 週間運用して failure rate (cascade fallback rate) を本番ログで観測

**Phase 1 のみで十分な品質に到達するか、Phase 2 が必要かを Phase 1 の実測データで判断する。**

### Phase 2: Canister upgrade (必要と判断した場合のみ)
1. **A2**: `LLM.chat().withMessages([#system_, #user])` への移行 (canister method 変更)
2. **B1**: `#Llama3_1_8B` → `#Qwen3_32B` への切り替え
3. local replica で dry-run (`dfx start --clean` → `dfx deploy aegis_backend`)
4. cycles 消費の差分を local で観測
5. mainnet upgrade — staging window (低トラフィック時間帯) 推奨
6. ROLLBACK.md の手順に従い、品質 / cost / latency 退化が観測されたら即 rollback

### Phase 3 (将来、範囲外):
- B3: 言語別モデル選択 (API シグネチャ変更が必要なため、declarations 同期コストが大)
- チャンク化 (8000 char 超対応)
- streaming response (mo:llm が対応していれば)

---

## 7. Data flow (after Phase 1)

```
ContentItem.text (Japanese article)
  │
  ▼
useTranslation hook (auto policy)
  │
  ▼
translateContent({backend: "auto", targetLanguage: "ja", text, reason})
  │
  ├─ lookupTranslation(text, "ja") → cache hit? → return cached
  │
  ▼
buildTranslationPrompt(text, "ja", reason)   ← Phase 1: ja-specialized
  │  (few-shot, 敬体指示, 固有名詞ルール)
  ▼
attempts cascade [Ollama, MediaPipe/WebLLM, IC LLM, BYOK, Server-Claude]
  │
  ▼
translateWithIC(prompt, actorRef)
  │
  ▼
canister.translateOnChain(prompt)              ← Phase 1: 不変
  │
  ▼
LLM.prompt(#Llama3_1_8B, cappedPrompt)         ← Phase 1: 不変
  │
  ▼
raw response (Text)
  │
  ▼
parseTranslationResponse(raw)
  │  → null (ALREADY_IN_TARGET) → "skip"
  │  → {text, reason?}
  ▼
Phase 1 NEW: validateTranslation(parsed, targetLang, inputLength)
  │  → kana check (target=ja)
  │  → length ratio check
  │  → fail → 次の cascade attempt へ
  ▼
TranslationResult { translatedText, translatedReason, targetLanguage, backend, generatedAt }
  │
  ▼
storeTranslation(text, result) → IDB cache
  │
  ▼
patchItem(id, { translation: result })
```

---

## 8. Unknowns + risks (要確認)

### Unknowns (調査で解消すべき)
1. **`#Llama4Scout` の特性**: model size, language coverage, cost — DFINITY ドキュメント確認必要
2. **Cycle cost 差**: 8B vs 32B の実 cycles 消費比率 — local replica で計測する
3. **本番 canister の cycles balance**: 32B 移行で枯渇する可能性 — `dfx canister status` で確認必要
4. **`mo:llm` の system message サポート**: `chat.mo` を読んだ限り `#system_` variant は定義されているが、DFINITY LLM canister 側が system role を実際に解釈するかは未検証
5. **dfx generate と did file の不整合**: `aegis_backend.did` に `translateOnChain` がない理由 — 手動編集 vs auto-gen の運用ルール確認
6. **Phase 1 の実効性**: prompt 改善だけで 8B モデルが日本語をまともに出すか — 実測が必要

### Risks
| # | リスク | Phase | 影響 | 緩和策 |
|---|---|---|---|---|
| R1 | Phase 1 のプロンプト変更で他言語の品質劣化 | 1 | 中 | 英語/フランス語含む全 10 言語のテストを追加 |
| R2 | 出力検証 (C1, C2) の誤判定で正常な翻訳を捨てる | 1 | 中 | 検証は cascade 内の選別のみ、最終 fallback (server-Claude) では検証無効 |
| R3 | 32B モデル切替でリクエスト時間が cascade 5s timeout を超過 | 2 | 高 | timeout を 15-30s に延長、user-visible loading state 強化 |
| R4 | 32B モデル切替で cycles 急増、canister balance 枯渇 | 2 | 高 | local 計測 → 本番 cycles top-up → 段階的展開 |
| R5 | canister upgrade で `analyzeOnChain` (同じ LLM 使用) も巻き込み品質変化 | 2 | 中 | `analyzeOnChain` は専用テストあり、回帰検出可能 |
| R6 | DFINITY managed LLM canister 側で 32B が deprecate される | 2 | 高 (発生時) | `mo:llm` の version 監視、deprecate 時は 8B fallback |
| R7 | `chat.mo` の system message が無視されると Phase 2 A2 が無効 | 2 | 低 | local replica でテスト確認、無効なら user message 内に system role embed で代替 |
| R8 | did file と TS declarations の不整合放置で次回 dfx generate が破壊的 | 全 | 中 | 計画外だが Phase 2 着手前に did 再生成して整合性確認 |

---

## 9. 実装前の確認事項 (ユーザに尋ねたいこと)

1. **Phase 1 + Phase 2 を一気にやるか、Phase 1 で計測してから判断するか?**
   - 推奨は段階実施 (Phase 1 → 1週間運用 → Phase 2 判定)
   - 即急ぎなら Phase 1 + Phase 2 を同時実装し、staging で品質検証 → mainnet
2. **本番 canister の controller key にアクセスできますか?** Phase 2 で必要
3. **言語スコープ**: 日本語特化で構いませんか? それとも CJK 全般 (中国語, 韓国語) も含みますか?
4. **テスト戦略**: 翻訳品質の評価をどう自動化しますか?
   - (a) raw output を正規表現で assert (脆い、模型変更で破綻)
   - (b) 言語検出 (kana%) と長さ比のみ (現実的)
   - (c) 別 LLM で翻訳品質を採点 (heavy、CI 不向き)
   - 推奨は (b)
5. **Phase 1 のプロンプト変更は frontend のみ — 本当に canister 経由する必要ありますか?** Frontend のプロンプトは server-Claude / Ollama / WebLLM / MediaPipe でも使われるため、すべての backend に影響します (副作用あり、回帰テスト必要)
6. **計測方法**: 本番での品質劣化/改善をどう検出しますか? Sentry にカスタムイベント (translation success/failure rate) を追加するか? — 現在 Sentry DSN 未設定なので計測不可

---

## 10. 概算工数 (ユーザ判断材料)

| Phase | 内容 | 工数 | 備考 |
|---|---|---|---|
| 1 | A1 (prompt改善) + C1+C2 (出力検証) + テスト | 4-6 時間 | frontend のみ、deploy 1 回 |
| 2 | A2 (chat API 移行) + B1 (Qwen3_32B 切替) + local 計測 + mainnet upgrade | 6-10 時間 | canister deploy、ロールバック準備 |
| 3 | B3 (言語別 model)、チャンク化 | 8-15 時間 | 範囲外、別計画 |

合計 (Phase 1+2): **10-16 時間**。Phase 1 のみなら **半日**。

---

## 11. レビュー後の次ステップ

このドキュメントへの user フィードバックを受けて:
1. 不明点 (§9) への回答取得
2. リスク (§8) の許容範囲確認
3. Phase 範囲確定
4. 実装計画を `IC_LLM_TRANSLATION_QUALITY_IMPL.md` として確定 (具体的な diff / テストケースを記述)
5. コード着手

**現時点で 1 行のコードも書いていません。** Approval 待ちです。
