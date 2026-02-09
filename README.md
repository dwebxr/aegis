# Aegis — D2A Social Agent Network

Content quality filter that learns your taste, curates a zero-noise briefing, publishes signals to Nostr, and exchanges content with other agents over an encrypted D2A protocol — with on-chain monetization via ICP staking and D2A match fees.

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
│  API Routes:                      │    │  - PoQ staking/reputation│
│    POST /api/analyze              │    │  - D2A match records     │
│    POST /api/fetch/{url,rss,      │    │  - IC LLM scoring       │
│         twitter,nostr}            │    │  - Engagement index      │
│                                   │    │  Internet Identity auth  │
│  Client-side:                     │    └─────────┬────────────────┘
│    Preference learning engine     │              │
│    Briefing ranker                │    ┌─────────▼────────────────┐
│    Nostr identity (IC-derived)    │    │  ICP Ledger (ICRC-1/2)   │
│    D2A agent manager              │    │  ryjl3-tyaaa-aaaaa-aaaba │
│    ICP Ledger (stake/approve)     │    │  Stake hold / return /   │
│                                   │    │  slash / D2A fee split   │
│                                   │    └──────────────────────────┘
│                                   │
│                                   │    Nostr Relays
│                                   │◄──►┌──────────────────────────┐
│                                   │    │  Signal publishing       │
│                                   │    │  D2A agent discovery     │
│                                   │    │  Encrypted handshakes    │
└───────────┬───────────────────────┘    └──────────────────────────┘
            │
            ▼
   3-Tier Scoring Pipeline:
   1. IC LLM (Llama 3.1 8B, free, on-chain)
   2. Anthropic Claude (premium, V/C/L)
   3. Heuristic fallback (client-side)
```

---

## Slop Detection: How Aegis Judges Content Quality

Aegis uses a three-tier scoring pipeline with automatic fallback. The system tries each tier in order and uses the first successful result — no silent failures.

### Tier 1: IC LLM On-Chain Scoring (Free, Decentralized)

When authenticated, Aegis first calls `analyzeOnChain()` on the canister, which runs **Llama 3.1 8B** via the [IC LLM Canister](https://github.com/nickcen/ic_llm) (`w36hm-eqaaa-aaaal-qr76a-cai`). This provides free, fully on-chain scoring with no API key required. The prompt includes the user's topic affinities for personalized evaluation.

If IC LLM is unavailable (e.g. local dev, not authenticated), the system falls through to Tier 2.

### Tier 2: Claude API Scoring (Premium, High Quality)

For cases where IC LLM fails or for premium-tier scoring, Aegis calls the Anthropic Claude API with the full V/C/L framework and the user's preference context. This provides the highest quality analysis but requires an API key.

If the API key is missing or the call fails, the system falls through to Tier 3.

### Tier 3: Heuristic Pre-Filter (Client-side, No API Call)

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

Base scores start at 5. Composite = `0.4 × Originality + 0.35 × Insight + 0.25 × Credibility`.

### V/C/L Scoring Axes (Used by Tier 1 and Tier 2)

Both IC LLM and Claude evaluate three orthogonal axes:

- **V (Signal)**: Information density and novelty. Does this contain genuinely new information, data, or analysis? (0–10)
- **C (Context)**: Relevance to *this specific user's* interests, calibrated from their learned topic affinities. (0–10)
- **L (Slop)**: Clickbait, engagement farming, rehashed content, empty opinions. Higher = worse. (0–10)

Composite score:

```
S = (V_signal × C_context) / (L_slop + 0.5)
```

Normalized to 0–10 scale. Verdict: **quality** if S ≥ 4, else **slop**.

The `+ 0.5` floor prevents division by zero and ensures that even zero-slop content still needs real signal to score well.

### Personalized Re-ranking (Briefing)

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

## Monetization: Three Revenue Pillars

Aegis implements a sustainable economic model using ICP tokens (ICRC-1/2) with three revenue pillars:

### Pillar 1: Compute & Intelligence Subscription

| Tier | Engine | Cost | Where |
|------|--------|------|-------|
| **Free** | IC LLM (Llama 3.1 8B) | 0 ICP — cycles paid by canister | On-chain (IC) |
| **Premium** | Anthropic Claude | API key required | Off-chain (Vercel) |
| **Fallback** | Heuristic filter | 0 | Client-side |

Free-tier scoring runs entirely on the Internet Computer. Premium Claude API scoring provides higher accuracy for users who supply their own API key.

### Pillar 2: Proof of Quality (PoQ) Staking

When publishing a signal, users can **stake ICP** (0.001–1.0 ICP) to back their content quality claim. Community members vote to validate or flag staked signals:

```
Publisher stakes 0.01 ICP
  → 3 validates → Stake returned + Trust Score ↑ + Quality Signal count ↑
  → 3 flags     → Stake slashed (kept by protocol) + Trust Score ↓ + Slop Signal count ↑
```

**ICRC-2 flow**: Client `icrc2_approve` → Canister `icrc2_transfer_from` (stake hold) → On resolution: `icrc1_transfer` (return) or retained (slash).

**Trust Score**: `T = 5.0 + (qualitySignals / totalSignals) × 5.0` — ranges 0–10. Starts at 5.0 (neutral). A user with 100% quality signals reaches 10.0.

**Engagement Index**: `E = validationRatio × avgComposite` — measures how effectively a user's signals engage the community (0–10 scale).

Double-voting is prevented by tracking voters per signal. Self-voting is blocked. Stake records and voter lists persist across canister upgrades.

### Pillar 3: D2A Precision Match Fee

When content is successfully delivered via the D2A protocol, a micro-fee is collected from the receiver:

```
Content delivered via D2A
  → Receiver pays 0.001 ICP match fee
  → 80% (0.0008 ICP) → Content sender
  → 20% (0.0002 ICP) → Protocol treasury (canister)
```

The receiver pre-approves the canister for a blanket allowance (0.1 ICP ≈ 100 matches) when the agent starts. Fees are collected automatically via `icrc2_transfer_from` and distributed via `icrc1_transfer`.

Fee collection only occurs when both peers include their IC principal in their presence broadcast. Peers without principals can still exchange content — just without the fee mechanism.

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
    ["capacity", "5"],
    ["principal", "rluf3-eiaaa-aaaam-qgjuq-cai"],
    ["interest", "machine-learning"],
    ["interest", "rust"],
    ["interest", "cryptography"]
  ],
  "content": ""
}
```

Topics are drawn from the user's top 20 high-affinity topics (affinity ≥ 0.2). `capacity` indicates how many items the agent can accept per cycle. `principal` is the agent's IC principal (used for D2A fee settlement). Being a replaceable event, only the latest version persists on relays.

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

### 3-Tier AI Scoring Pipeline
- **Tier 1**: IC LLM (Llama 3.1 8B) — free, fully on-chain, no API key
- **Tier 2**: Anthropic Claude — premium V/C/L scoring with user context
- **Tier 3**: Heuristic fallback — local, instant, no network call
- Automatic fallback: each tier falls through to the next on failure

### Proof of Quality (PoQ) Staking
- Stake 0.001–1.0 ICP when publishing signals to back your quality claim
- Community validation: 3 validates → stake returned + trust boost
- Community flagging: 3 flags → stake slashed + trust penalty
- Trust Score gauge (0–10) and Engagement Index in Analytics dashboard
- ICRC-2 approve/transfer_from pattern with pre-debit rollback safety

### D2A Match Fee
- Automatic micro-fee (0.001 ICP) on successful D2A content delivery
- 80/20 split: 80% to content sender, 20% to protocol treasury
- Blanket ICRC-2 pre-approval on agent start (0.1 ICP ≈ 100 matches)
- IC principal included in presence broadcast for on-chain fee settlement

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
- Optional PoQ stake attachment with range slider UI

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
| AI (Free) | IC LLM Canister — Llama 3.1 8B (on-chain, mo:llm 2.1.0) |
| AI (Premium) | Anthropic Claude (claude-sonnet-4-20250514) + fallback heuristics |
| Blockchain | Internet Computer (Motoko canister, dfx 0.30.2) |
| Tokens | ICP Ledger ICRC-1/2 (staking, D2A fees) |
| Auth | Internet Identity (@dfinity/auth-client 2.1.3) |
| Nostr | nostr-tools 2.23, @noble/hashes (key derivation) |
| Packages | mops (mo:llm 2.1.0, mo:json 1.4.0) |
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
│   │   ├── icpLedger.ts                # ICP Ledger actor (ICRC-1/2 balance, approve, allowance)
│   │   └── declarations/               # Candid types + IDL factory
│   ├── types/                           # ContentItem, API response types, source types
│   └── utils/                           # Score computation helpers
├── __tests__/                           # 261 tests across 23 suites
├── canisters/
│   └── aegis_backend/
│       ├── main.mo                      # Motoko canister (persistent actor, staking, D2A, IC LLM)
│       ├── types.mo                     # Type definitions (incl. StakeRecord, UserReputation, D2AMatchRecord)
│       ├── ledger.mo                    # ICRC-1/2 ICP Ledger interface module
│       └── aegis_backend.did            # Candid interface
├── public/                              # Icons (apple-touch-icon, favicons, PWA)
├── mops.toml                            # Motoko package manager (mo:llm, mo:json)
├── dfx.json                             # IC project config (packtool: mops sources)
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
  getUserReputation : (principal) -> (UserReputation) query;
  getSignalStake : (text) -> (opt StakeRecord) query;
  getUserD2AMatches : (principal, nat, nat) -> (vec D2AMatchRecord) query;
  getEngagementIndex : (principal) -> (float64) query;

  // Updates
  saveEvaluation : (ContentEvaluation) -> (text);
  updateEvaluation : (text, bool, bool) -> (bool);
  batchSaveEvaluations : (vec ContentEvaluation) -> (nat);
  updateDisplayName : (text) -> (bool);
  saveSourceConfig : (SourceConfigEntry) -> (text);
  deleteSourceConfig : (text) -> (bool);
  saveSignal : (PublishedSignal) -> (text);
  publishWithStake : (PublishedSignal, nat) -> (Result);
  validateSignal : (text) -> (Result);
  flagSignal : (text) -> (Result);
  recordD2AMatch : (text, principal, text, nat) -> (Result);
  analyzeOnChain : (text, vec text) -> (Result);
}
```

## License

MIT
