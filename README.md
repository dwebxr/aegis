# Aegis — D2A Social Agent Network

Content quality filter that learns your taste, curates a zero-noise briefing, publishes signals to Nostr, and exchanges content with other agents over an encrypted D2A protocol.

## Live

- **Frontend**: https://aegis-kappa-eight.vercel.app
- **Backend Canister**: [`rluf3-eiaaa-aaaam-qgjuq-cai`](https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=rluf3-eiaaa-aaaam-qgjuq-cai)

## Architecture

```
Browser                                  Internet Computer (Mainnet)
┌───────────────────────────────────┐    ┌──────────────────────────┐
│  Next.js 14 (App Router)         │    │  aegis_backend canister  │
│                                   │    │  (Motoko)                │
│  Tabs:                            │    │                          │
│    Dashboard / Briefing / Burn    │◄──►│  - Evaluation storage    │
│    Sources / Analytics            │    │  - User profiles         │
│                                   │    │  - Source configs         │
│  API Routes:                      │    │  - Analytics queries     │
│    POST /api/analyze              │    │                          │
│    POST /api/fetch/{url,rss,      │    │  Internet Identity auth  │
│         twitter,nostr}            │    └──────────────────────────┘
│                                   │
│  Client-side:                     │    Nostr Relays
│    Preference learning engine     │◄──►┌──────────────────────────┐
│    Briefing ranker                │    │  Signal publishing       │
│    Nostr identity (IC-derived)    │    │  D2A agent discovery     │
│    D2A agent manager              │    │  Encrypted handshakes    │
└───────────┬───────────────────────┘    └──────────────────────────┘
            │
            ▼
   Anthropic Claude API
   (V/C/L scoring + fallback heuristics)
```

---

## Slop Detection: How Aegis Judges Content Quality

Aegis uses a three-tier scoring pipeline. Every piece of content passes through these layers in order, and the system is designed to be fully transparent — no black-box ranking.

### Tier 1: Heuristic Pre-Filter (Client-side, No API Call)

Before any content reaches Claude, a fast heuristic filter runs locally. This eliminates obvious slop without spending API tokens.

| Signal | Effect | Threshold |
|--------|--------|-----------|
| Exclamation density | originality −3, credibility −3 | > 0.1 per word |
| Emoji density | originality −2 | > 0.05 per word |
| CAPS ratio | credibility −3, originality −2 | > 30% of chars |
| Long-form (50+ words) | insight +1 | > 50 words |
| Long-form (100+ words) | insight +1, originality +1 | > 100 words |
| Contains links | credibility +2 | `https://` present |
| Contains data/numbers | insight +2, credibility +1 | `%`, `$`, decimals |

Base scores start at 5. Composite = `0.4 × Originality + 0.35 × Insight + 0.25 × Credibility`. Items below 3.5 composite are dropped before reaching Tier 2.

### Tier 2: V/C/L AI Scoring (Claude API)

For content that passes heuristics, Aegis sends the text to Claude with the user's preference context. The AI evaluates three orthogonal axes:

- **V (Signal)**: Information density and novelty. Does this contain genuinely new information, data, or analysis? (0–10)
- **C (Context)**: Relevance to *this specific user's* interests, calibrated from their learned topic affinities. (0–10)
- **L (Slop)**: Clickbait, engagement farming, rehashed content, empty opinions. Higher = worse. (0–10)

Composite score:

```
S = (V_signal × C_context) / (L_slop + 0.5)
```

Normalized to 0–10 scale. Verdict: **quality** if S ≥ 4, else **slop**.

The `+ 0.5` floor prevents division by zero and ensures that even zero-slop content still needs real signal to score well.

When the API key is missing or the API fails, the system falls back to Tier 1 heuristics automatically — no silent failures.

### Tier 3: Personalized Re-ranking (Briefing)

Quality items are further ranked by a personalized briefing score that combines multiple signals:

```
briefingScore = (composite + topicRelevance × 2 + authorTrust) × recencyDecay
```

- **Topic relevance**: Sum of learned affinities for the item's topics (each ±1.0 range)
- **Author trust**: Accumulated from validate/flag history (+0.2 per validate, −0.3 per flag)
- **Recency decay**: Exponential with 7-hour half-life — `e^(−ln(2)/7 × ageHours)`

The top 5 items become the **Priority Briefing**. One additional item is selected as the **Serendipity Pick** — scored by `V_signal × 0.5 + noveltyBonus × 0.3 + topicNovelty × 0.2`, deliberately surfacing high-signal content *outside* the user's usual topics to prevent filter bubbles.

### Preference Learning

Every Validate/Flag action updates the user's preference profile:

| Action | Topic Affinity | Author Trust | Quality Threshold |
|--------|---------------|--------------|-------------------|
| Validate | +0.1 per topic | +0.2 | −0.05 (if borderline 3.5–4.5) |
| Flag | −0.05 per topic | −0.3 | +0.1 (if AI said "quality") |

Affinities are clamped to [−1.0, +1.0]. Author trust is clamped to [−1.0, +1.0]. After 3+ feedback events, the learned context is injected into Claude's prompt, making the AI scoring personalized.

---

## D2A Protocol: Device-to-Agent Communication

D2A enables Aegis agents to discover each other and exchange quality content directly — no central server, no platform algorithm, no data harvesting. All communication happens over Nostr relays using ephemeral encrypted events.

### Identity

Each agent's identity derives deterministically from their Internet Computer principal:

```
sk = SHA-256(principal_bytes ‖ "aegis-nostr-v1")
pk = secp256k1_pubkey(sk)
```

No additional key management. The Nostr keypair is always reproducible from the IC login.

### Phase 1: Presence Broadcast

Every 5 minutes, each agent publishes a **NIP-78 replaceable event** (Kind 30078) advertising:

```json
{
  "kind": 30078,
  "tags": [
    ["d", "aegis-agent-profile"],
    ["interest", "machine-learning"],
    ["interest", "rust"],
    ["interest", "cryptography"],
    ["capacity", "5"]
  ],
  "content": ""
}
```

Topics are drawn from the user's top 20 high-affinity topics (affinity ≥ 0.2). `capacity` indicates how many items the agent can accept per cycle. Being a replaceable event, only the latest version persists on relays.

### Phase 2: Peer Discovery

Every 60 seconds, the agent queries relays for other agents' profiles from the past 15 minutes. Peers are ranked by **Jaccard resonance**:

```
resonance = |myTopics ∩ peerTopics| / |myTopics ∪ peerTopics|
```

Only peers with resonance ≥ 0.3 are considered. This ensures content exchange happens between agents with genuinely overlapping interests — not random noise.

### Phase 3: Content Negotiation (Handshake)

D2A uses a 4-message handshake over **ephemeral Nostr events** (Kind 21078). All payloads are encrypted with NIP-44 (XChaCha20-Poly1305) — relay operators cannot read the exchange.

```
Agent A                          Relay                          Agent B
   │                               │                               │
   │──── OFFER (topic, score) ─────►│──── encrypted event ─────────►│
   │                               │                               │
   │                               │◄──── ACCEPT ──────────────────│
   │◄──── encrypted event ─────────│                               │
   │                               │                               │
   │──── DELIVER (full content) ───►│──── encrypted event ─────────►│
   │                               │                               │
```

1. **OFFER**: Agent A has quality content (composite ≥ 7.0) matching Agent B's topics. Sends topic, score, and 100-char preview.
2. **ACCEPT/REJECT**: Agent B checks topic affinity (> 0) and score (≥ 6). Accepts if both pass.
3. **DELIVER**: Agent A sends the full content with all scores, topics, and V/C/L signals.

Each handshake has a 30-second timeout. Failed deliveries mark the handshake as `rejected` (not `offered`), preventing deadlock loops.

### Message Format

Every D2A message is a Nostr event with:

```json
{
  "kind": 21078,
  "tags": [["p", "<recipient_pubkey>"], ["d2a", "aegis-d2a-offer"]],
  "content": "<NIP-44 encrypted JSON>"
}
```

Decrypted content:

```json
{
  "type": "offer | accept | reject | deliver",
  "fromPubkey": "...",
  "toPubkey": "...",
  "payload": { ... }
}
```

### Delivery Payload

When content is delivered, the full evaluation travels with it:

```json
{
  "text": "Full article text...",
  "author": "Original Author",
  "scores": { "originality": 8, "insight": 9, "credibility": 7, "composite": 8.2 },
  "verdict": "quality",
  "topics": ["machine-learning", "transformers"],
  "vSignal": 9,
  "cContext": 7,
  "lSlop": 2
}
```

The receiving agent applies a final resonance check (≥ 0.1) before injecting the content into its feed, providing a last defense against irrelevant deliveries.

### Security Properties

| Property | Mechanism |
|----------|-----------|
| **Confidentiality** | NIP-44 (XChaCha20-Poly1305) — relay operators cannot read content |
| **Authentication** | Nostr event signatures (secp256k1) — cannot forge sender identity |
| **Identity binding** | Keypair derived from IC Principal — tied to Internet Identity |
| **No persistence** | Kind 21078 is ephemeral — relays are not required to store events |
| **No central authority** | Any Nostr relay works — no single point of failure or censorship |

---

## Features

### Personalization Engine
- Learns from Validate/Flag feedback — topic affinities, author trust, quality threshold calibration
- Profile stored in localStorage (primary) with IC canister sync
- After 3+ feedback events, AI scoring becomes personalized

### Zero Feed Briefing
- Ranks content by composite score, topic relevance, author trust, and recency
- Surfaces 3–5 priority items + 1 serendipity pick (high novelty, outside your bubble)
- Background ingestion from configured sources with quick heuristic pre-filter

### Signal Publishing
- Deterministic Nostr keypair derived from IC Principal (no extra key management)
- Self-evaluated posts published as Kind 1 events with `aegis-score` tags
- Client-side signing — private key never leaves the browser

### Multi-Source Ingestion
- RSS/Atom feeds (YouTube, note.com, blogs — with thumbnail extraction)
- Nostr relay queries (by pubkey or global)
- Direct URL article extraction
- X (Twitter) API search

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Styling | CSS-in-JS (inline styles), dark theme |
| Backend API | Next.js API Routes (Vercel Serverless) |
| AI | Anthropic Claude (claude-sonnet-4-20250514) + fallback heuristics |
| Blockchain | Internet Computer (Motoko canister) |
| Auth | Internet Identity (@dfinity/auth-client 2.1.3) |
| Nostr | nostr-tools 2.23, @noble/hashes (key derivation) |
| Deploy | Vercel (frontend), IC mainnet (backend) |
| Test | Jest + ts-jest (261 tests, 23 suites) |

## Project Structure

```
aegis/
├── app/
│   ├── page.tsx                         # Main app page
│   ├── layout.tsx                       # Root layout + metadata + icons
│   ├── favicon.ico                      # Browser tab icon
│   └── api/
│       ├── analyze/route.ts             # Claude V/C/L scoring + fallback
│       ├── health/route.ts              # Health check endpoint
│       └── fetch/
│           ├── url/route.ts             # URL article extraction
│           ├── rss/route.ts             # RSS feed parsing (YouTube/note.com thumbnails)
│           ├── twitter/route.ts         # X API search
│           └── nostr/route.ts           # Nostr relay query
├── components/
│   ├── layout/                          # AppShell, Sidebar, MobileNav
│   ├── tabs/                            # Dashboard, Briefing, Incinerator, Sources, Analytics
│   ├── ui/                              # ContentCard, ScoreBar, SignalComposer, AgentStatusBadge
│   ├── sources/                         # ManualInput
│   ├── auth/                            # LoginButton, UserBadge
│   └── Providers.tsx                    # Auth + Content + Preference + Source + Agent providers
├── contexts/
│   ├── AuthContext.tsx                   # Internet Identity auth state
│   ├── ContentContext.tsx               # Content CRUD + IC sync
│   ├── PreferenceContext.tsx            # Preference learning lifecycle
│   ├── SourceContext.tsx                # RSS/Nostr source management + IC sync
│   └── AgentContext.tsx                 # D2A agent lifecycle
├── lib/
│   ├── preferences/
│   │   ├── types.ts                     # UserPreferenceProfile, constants
│   │   ├── engine.ts                    # learn(), getContext(), hasEnoughData()
│   │   └── storage.ts                   # localStorage R/W
│   ├── briefing/
│   │   ├── ranker.ts                    # briefingScore, generateBriefing, serendipity
│   │   └── types.ts                     # BriefingState, BriefingItem
│   ├── ingestion/
│   │   ├── scheduler.ts                 # Background fetch cycle (20 min interval)
│   │   └── quickFilter.ts              # Heuristic pre-filter (Tier 1)
│   ├── nostr/
│   │   ├── identity.ts                  # IC Principal -> Nostr keypair (SHA-256 derivation)
│   │   ├── publish.ts                   # Kind 1 event signing + relay publish
│   │   ├── encrypt.ts                   # NIP-44 encrypt/decrypt (XChaCha20-Poly1305)
│   │   └── types.ts                     # AegisNostrEvent, Nostr kind constants
│   ├── agent/
│   │   ├── protocol.ts                  # D2A constants (kinds, tags, thresholds, timings)
│   │   ├── discovery.ts                 # Presence broadcast + peer discovery + Jaccard resonance
│   │   ├── handshake.ts                # Offer/accept/reject/deliver messaging
│   │   ├── manager.ts                   # AgentManager orchestrator (lifecycle + error recovery)
│   │   └── types.ts                     # AgentProfile, HandshakeState, D2AMessage
│   ├── ic/
│   │   ├── agent.ts                     # HttpAgent creation + canister ID
│   │   ├── actor.ts                     # Canister actor factory (sync + async with syncTime)
│   │   └── declarations/               # Candid types + IDL factory
│   ├── types/                           # ContentItem, API response types, source types
│   └── utils/                           # Score computation helpers
├── __tests__/                           # 261 tests across 23 suites
├── canisters/
│   └── aegis_backend/
│       ├── main.mo                      # Motoko canister (persistent actor)
│       ├── types.mo                     # Type definitions
│       └── aegis_backend.did            # Candid interface
├── public/                              # Icons (apple-touch-icon, favicons, PWA)
├── dfx.json                             # IC project config
└── next.config.mjs                      # Webpack polyfills for @dfinity
```

## Getting Started

### Prerequisites

- Node.js 18+
- [dfx](https://internetcomputer.org/docs/current/developer-docs/getting-started/install/) (for canister development)

### Local Development

```bash
npm install
cp .env.example .env.local  # Add your ANTHROPIC_API_KEY
npm run dev
```

### Tests

```bash
npm test              # Run all 261 tests
npm run test:watch    # Watch mode
```

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# IC Mainnet (default)
NEXT_PUBLIC_IC_HOST=https://icp-api.io
NEXT_PUBLIC_CANISTER_ID=rluf3-eiaaa-aaaam-qgjuq-cai
NEXT_PUBLIC_INTERNET_IDENTITY_URL=https://identity.ic0.app

# IC Local (for canister development)
# NEXT_PUBLIC_IC_HOST=http://127.0.0.1:4943
# NEXT_PUBLIC_CANISTER_ID=uxrrr-q7777-77774-qaaaq-cai
# NEXT_PUBLIC_INTERNET_IDENTITY_URL=http://127.0.0.1:4943/?canisterId=rdmx6-jaaaa-aaaaa-aaadq-cai
```

### Canister Development

```bash
dfx start --background
dfx deploy aegis_backend

# Mainnet
DFX_WARNING=-mainnet_plaintext_identity dfx deploy aegis_backend --network ic --identity default
```

## Canister Interface

```candid
service : {
  // Queries
  getProfile : (principal) -> (opt UserProfile) query;
  getEvaluation : (text) -> (opt ContentEvaluation) query;
  getUserEvaluations : (principal, nat, nat) -> (vec ContentEvaluation) query;
  getUserAnalytics : (principal) -> (AnalyticsResult) query;
  getUserSourceConfigs : (principal) -> (vec SourceConfigEntry) query;

  // Updates
  saveEvaluation : (ContentEvaluation) -> (text);
  updateEvaluation : (text, bool, bool) -> (bool);
  batchSaveEvaluations : (vec ContentEvaluation) -> (nat);
  updateDisplayName : (text) -> (bool);
  saveSourceConfig : (SourceConfigEntry) -> (text);
  deleteSourceConfig : (text) -> (bool);
}
```

## License

MIT
