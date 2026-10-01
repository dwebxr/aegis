# OpenPay USDC rail runbook

`/api/d2a/briefing-jpyc` の USDC (Base mainnet) rail は既定で無効です。`OPENPAY_RESOURCE_ID` と `OPENPAY_MERCHANT_ADDRESS` は JPYC / USDC 共通の必須設定です。ID 未設定・不正時は paid request が 503 になります（`X402_FREE_TIER_ENABLED` が有効なら free-tier の preview は継続）。

## 状態と KV

状態機械は `none → pending → settled | rejected | unknown` です。`rejected` は「何も broadcast されていない」確定状態なので、同じ authorization の再試行で `rejected → pending` に戻れます (settle 直前に deadline を超えた場合も `rejected` になります)。`pending` が 150 秒以上経過した場合は orphan と扱い、自動 settle や自動再試行はしません。

- 状態: `aegis:openpay:<id>:state`（90 日 TTL）
- 排他ロック: `aegis:openpay:<id>:lock`（150 秒 TTL）

応答の意味は次のとおりです。

- 402: 支払い要求、payload/requirements 不一致、または broadcast 前の確定拒否。`PAYMENT-REQUIRED` がある場合はその値が USDC 要件の正本です。
- 409 `payment_already_used`: 同じ authorization は settlement 済みです。
- 503 `payment_in_progress`: 処理中または KV が利用不能です。`Retry-After` に従います。
- 503 `verification_unavailable`: verify の結果を確定できません。`Retry-After` に従います。
- 503 `settlement_unknown`: 送金の有無を確定できないため手動照合が必要です。新しい authorization を作らせないでください。
- 503 `settlement_deadline_exceeded`: 安全な実行時間内に settle を開始できませんでした。`Retry-After` 後に同じ header で再試行できます。

## 有効化ゲート

フラグを有効にする前に、次をすべて完了してください。

1. relay の契約テストで、正しい署名を使っても payTo、asset、amount、network、resource のいずれかが listing と異なる要求を verify/settle が拒否することを確認する。
2. allowlist の各 reason が「broadcast 前の確定失敗」であることを OpenPay 運営者と確認する。nonce/already/duplicate/receipt/confirm/transaction を含む reason は追加しない。
3. unknown/orphan pending の照合手段を用意する。同一署名を OpenPay の状態照会へ渡し、settled なら「返金またはコンテンツ提供」を運営判断し、rejected なら state を削除して同一 authorization の再試行を許可できる。結果が不明な間は state を削除しない。
4. 少額 1 件を実決済し、asset、amount、payTo、transaction、payer、`PAYMENT-RESPONSE` の内容を照合する。同じ header の再送が 409 になることも確認する。

5. KV (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) が本番に設定されていることを確認する。USDC rail は状態読取を fail-closed にしているため、KV が無いと全支払いが settle 前に 503 になります。`usdcRailConfig()` は KV 未設定なら rail を広告しません (`/api/d2a/info` の `rails.usdc.reason` = `kv not configured`)。

確認後に共通設定の `OPENPAY_RESOURCE_ID` が自分の listing UUID であることを確認し、`OPENPAY_USDC_RAIL_ENABLED=true` を設定して通常のレビュー済みデプロイ手順を実行します。

## ロールバック

USDC のロールバックは `OPENPAY_USDC_RAIL_ENABLED` を削除または false にするだけで再デプロイします。`OPENPAY_RESOURCE_ID` は JPYC でも必須なので削除しないでください。OFF のルートは relay、requirements、USDC KV にアクセスせず、seller pins を検証する JPYC 経路だけを通ります。unknown/pending の KV は調査用に保持してください。

## Seller pins と拒否時の対応

JPYC discovery は `GET /api/discovery/<OPENPAY_RESOURCE_ID>` のみを参照し、一覧の URL 検索にはフォールバックしません。`OPENPAY_RESOURCE_ID` は前後の空白を除去し、小文字に正規化して JPYC / USDC 共通で使用します。応答の `id` と `resource` は設定値との完全一致が必要です。`OPENPAY_RESOURCE_URL` は正規化後の canonical URL と完全一致させてください（末尾 `/`、query、fragment、明示的な default port、host の大文字は不可）。

全 accept の `extra.openpay.merchant` を `OPENPAY_MERCHANT_ADDRESS` に固定し、`mode = forwarder-split`、有効な `forwarder`、`payTo = forwarder` を検証します。アドレスの checksum casing は許容します。一つでも pin に違反すれば listing 全体を拒否します。forwarder 自体は固定アドレスではなく、listing 内の整合性を検証するため、上流の fee / forwarder 更新は引き続き反映されます。JPYC が拒否されても USDC face が正常なら、未払い challenge は USDC のみの 402 を返します。

discovery の結果は、検証を通ったものだけを取得開始時刻つきでキャッシュします。支払いヘッダ (`X-PAYMENT` / `PAYMENT-SIGNATURE`) がある request は 5 分以内、無い request (402 を返すだけ) は 30 分以内のものを使います。失敗はキャッシュしませんが、最後に成功したエントリも消しません。そのため discovery が落ちている間、30 分以内なら未払い request には古い条件の 402 が返り、支払い request だけが 503 になり得ます。価格や手数料の変更は 402 に最大 30 分遅れて反映されます。古い条件で支払った request は 5 分以内の listing で verify され、失敗して新しい条件の 402 が返ります (送金は発生しません)。

デプロイ後に JPYC が 503 になったら、live の `/api/discovery/<id>` 応答を設定値と照合して原因を分けてください。

- **上流の不一致**: live 応答の id / resource / merchant / mode / forwarder / payTo が pins に違反する場合は、ロールバックせず拒否を維持し、OpenPay と調査します。ロールバックすると脆弱な URL-match gate を再び有効にしてしまいます。
- **実装バグ**: live 応答がすべての pins を満たすのに gate が拒否する場合は、暫定措置として `vercel rollback` で直前の production deployment に戻せます。ただし前の deployment は URL-match gate を使用し、OpenPay のサーバー側 duplicate-URL 拒否だけが残る保護です。原因を修正して seller pins を再デプロイしてください。

## 既知の限界

- resource URL は EIP-3009 の署名対象外であり、payload 上の照合は best-effort です。資金先、asset、amount は別途固定します。
- settle 成功直後の接続断では、課金済みのままコンテンツが未配信になる可能性があります。1 件の損失上限は設定した最大額です。
- クライアントが 503 を無視して新しい authorization を作ると、二重課金になり得ます。
