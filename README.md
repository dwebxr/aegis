# Aegis

> AI content quality filter. Turn an infinite feed into a clean, ranked briefing.

Aegis ingests content from RSS, Nostr, and public web pages, scores each item with an AI quality model (Value / Context / Slop), and surfaces only the signal — not the noise. It runs as a Next.js app backed by an Internet Computer canister.

**Status:** experimental open-source project. Code is public and runs in production at the URL below, but APIs and on-chain schemas are still moving.

- **Demo:** <https://aegis-ai.xyz>
- **Canister (IC mainnet):** `rluf3-eiaaa-aaaam-qgjuq-cai`
- **License:** MIT

---

## Key features

- **AI-scored briefing.** Each item gets three scores — Value (signal), Context (depth), Slop (low-quality marker) — plus a composite. Briefings show the top items by score, not by recency.
- **Multi-source ingestion.** RSS / Atom, Nostr relays, single URLs (article extraction), OPML import.
- **Multi-backend scoring.** Anthropic Claude (server, BYOK), Ollama (local), WebLLM / MediaPipe (in-browser via WebGPU), or a deterministic heuristic fallback.
- **Cleaner briefing, not infinite scroll.** A small set of high-score items per cycle plus an optional serendipity pick.
- **Translation (optional).** Per-item translation across 10 languages using the same cascade (Ollama → local LLM → Claude → IC LLM).
- **Internet Identity auth.** Per-user evaluations, source configs, and reputation persisted on the IC canister.
- **Nostr publishing.** Push your "this is quality" / "this is slop" signals to Nostr relays with NIP-44 encryption for private fields.
- **D2A agent-to-agent exchange (experimental).** Encrypted agent-to-agent content swap with on-chain receipts. Protocol is in flux; expect breaking changes.
- **x402 payment gateway (experimental).** Optional micropayment paywall for premium briefing endpoints.

---

## How it works

```
sources ──► ingestion ──► quick filter ──► AI scoring cascade ──► briefing ranker ──► UI
 (RSS/Nostr/URL)            (dedup,         (Ollama → WebLLM →     (V/C/L composite,
                             heuristics)    Claude → IC LLM)        serendipity)
                                                                          │
                                                                          ▼
                                                                   Internet Computer
                                                                   (per-user evals,
                                                                    sources, reputation)
```

1. Sources are pulled on a schedule (RSS feeds, Nostr filters, manual URLs).
2. Items pass a cheap pre-filter (duplicates, length, obvious junk).
3. A scoring cascade tries local engines first, then falls back to Claude or the IC LLM canister.
4. Items are ranked by composite score; the briefing shows the top N plus one serendipity pick.
5. Validations / flags persist to the IC canister and (optionally) Nostr.

---

## Tech stack

- **Frontend / API:** Next.js 15 (App Router), React 18, TypeScript
- **Backend canister:** Motoko on Internet Computer (`dfx` 0.30.2+)
- **AI:** Anthropic Claude (server), WebLLM / MediaPipe / Ollama (local), `mo:llm` (IC)
- **Auth:** Internet Identity (`@dfinity/auth-client` v3)
- **Decentralized messaging:** Nostr (`nostr-tools`)
- **PWA:** Serwist (service worker)
- **Hosting:** Vercel (Next.js) + IC mainnet (canister)
- **Observability:** Sentry (optional via DSN)

---

## Getting started

### Prerequisites

- Node.js **≥ 20**
- npm (other package managers untested; only `npm` is used in scripts)
- (Optional) [`dfx`](https://internetcomputer.org/docs/current/developer-docs/setup/install/) **0.30.2+** if you plan to modify the Motoko canister

### Install

```bash
git clone https://github.com/dwebxr/aegis.git
cd aegis
npm install
```

### Configure

Copy the template and fill in what you need. The dev build talks to the production IC canister by default, so most variables are optional.

```bash
cp .env.example .env.local
```

Minimum to enable AI scoring (everything else falls back to local / heuristic):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Full list of supported variables lives in [`.env.example`](.env.example). Highlights:

| Variable | Required? | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | recommended | Server-side AI scoring via Claude |
| `NEXT_PUBLIC_CANISTER_ID` | optional | Override the default IC canister |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | optional | Web Push notifications |
| `PUSH_SERVER_PRIVATE_KEY` | optional | Push-token canister authz (Ed25519 base64, register as canister controller) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | optional | Distributed rate limiting |
| `NEXT_PUBLIC_SENTRY_DSN` | optional | Error tracking |
| `X402_*` | optional | Micropayment paywall |

### Run

```bash
npm run dev          # http://localhost:3000
```

### Build

```bash
npm run build
npm start
```

---

## Basic usage

1. Open the app. Sign in with **Internet Identity** to enable per-user persistence (or run anonymously for a local-only session).
2. Add sources: paste an RSS / Atom URL, import an OPML file, add a Nostr pubkey, or paste a single article URL.
3. Wait for the next ingestion cycle (a few minutes), or trigger a refresh.
4. Open the **Briefing** tab. Items are ranked by composite Value / Context / Slop score.
5. Mark items as **quality** or **slop** — these update your reputation and feed back into ranking.

Optional:

- Translate any item from the item menu (requires a translation backend; see `.env.example`).
- Generate an audio briefing (uses the Web Speech API; works fully offline).
- Enable D2A in **Settings** to share briefings with other agents (experimental).

---

## Project structure

```
.
├─ app/                          # Next.js App Router
│  ├─ api/                       # Route handlers (analyze, briefing, fetch, push, ...)
│  ├─ page.tsx                   # Main app shell
│  └─ sw.ts                      # Service worker source (serwist)
├─ canisters/
│  └─ aegis_backend/             # Motoko canister (evaluations, sources, D2A, push subs)
├─ components/                   # React components (tabs, UI primitives)
├─ contexts/                     # React contexts (auth, content, sources, agent)
├─ lib/
│  ├─ scoring/                   # V/C/L scoring cascade + cache
│  ├─ briefing/                  # Briefing ranker + serendipity
│  ├─ ingestion/                 # Scheduler, fetchers, quick filter
│  ├─ nostr/                     # Identity, publish, NIP-44 encrypt
│  ├─ agent/                     # D2A protocol (manager, handshake, discovery)
│  ├─ ic/                        # Canister actor, server identity, IC LLM
│  ├─ translation/               # Multi-backend translation
│  ├─ preferences/               # User preference learning
│  └─ utils/                     # URL/SSRF helpers, errors, scores, ...
├─ packages/
│  └─ d2a-client/                # Standalone D2A SDK
├─ scripts/                      # Backup, rollback, smoke tests, deploy helpers
└─ __tests__/                    # Jest + Playwright tests
```

---

## Development

### Tests

```bash
npm test                 # Jest (unit + integration)
npm run test:watch
npm run test:coverage
npm run test:e2e         # Playwright — requires `npm run dev` running
npm run lint
```

### Canister

If you edit `canisters/aegis_backend/main.mo`, start a local replica:

```bash
dfx start --background
dfx deploy aegis_backend --network local
```

Pre-deploy safety:

```bash
npm run canister:backup          # snapshot live wasm + status
npm run canister:rollback        # restore from snapshot
scripts/canister-smoke-test.sh   # real assertions against a local replica
```

### D2A SDK

The agent-to-agent client lives in [`packages/d2a-client`](packages/d2a-client):

```bash
npm run sdk:install
npm run sdk:build
npm run sdk:test
```

### Operational docs

- [`PRE_DEPLOY.md`](PRE_DEPLOY.md) — pre-deploy checklist
- [`ROLLBACK.md`](ROLLBACK.md) — rollback procedure
- [`SECURITY.md`](SECURITY.md) — vulnerability disclosure

---

## Roadmap

Items below describe direction, not commitments. Some prototypes already exist in the repo behind feature flags.

- **Stable D2A protocol v1.** Lock the encrypted agent-to-agent message format and SDK surface.
- **Cross-agent reputation graph.** Use Nostr Web-of-Trust + on-chain validations to weight items from agents you trust.
- **Decentralised scoring market.** Let third-party agents offer scoring services; users pick the model they trust.
- **Mobile-first UX.** Background ingestion in the service worker, native share-target intent handling.
- **Local-only mode.** Run the full briefing pipeline without contacting any server (Ollama / MediaPipe / WebLLM only).
- **Public D2A testnet.** A non-production canister so external agents can experiment without affecting mainnet state.

---

## Contributing

Pull requests are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full setup, test, and review workflow. Issues and discussions live on GitHub.

For security issues, **do not** open a public issue. Use [GitHub private vulnerability reporting](https://github.com/dwebxr/aegis/security/advisories/new) — details in [`SECURITY.md`](SECURITY.md).

---

## License

[MIT](LICENSE) © 2026 dwebxr and Aegis contributors.

---

## Disclaimer

This protocol's source code is publicly available. The operator does not exercise the authority to modify or manipulate the automatic distribution logic defined by the smart contract without individual user consent under normal operations.

本プロトコルのソースコードは公開されており、運営者はスマートコントラクトによって定義された自動分配ロジックを、ユーザーの個別の同意なく変更・操作する権限を（通常運用において）行使しません。
