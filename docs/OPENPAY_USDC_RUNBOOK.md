# OpenPay USDC rail runbook

`/api/d2a/briefing-jpyc` の USDC (Base mainnet) rail は既定で無効です。JPYC rail はこの機能から独立しており、ロールバック時も変更されません。

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

確認後に `OPENPAY_RESOURCE_ID` と `OPENPAY_USDC_RAIL_ENABLED=true` を設定し、通常のレビュー済みデプロイ手順を実行します。

## ロールバック

`OPENPAY_USDC_RAIL_ENABLED` を削除または false にして再デプロイします。OFF のルートは relay、requirements、USDC KV にアクセスせず、従来の JPYC 経路だけを通ります。unknown/pending の KV は調査用に保持してください。

## 既知の限界

- resource URL は EIP-3009 の署名対象外であり、payload 上の照合は best-effort です。資金先、asset、amount は別途固定します。
- settle 成功直後の接続断では、課金済みのままコンテンツが未配信になる可能性があります。1 件の損失上限は設定した最大額です。
- クライアントが 503 を無視して新しい authorization を作ると、二重課金になり得ます。
