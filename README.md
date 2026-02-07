# Aegis — D2A Social Agent Platform

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

## Features

### Personalization Engine
- Learns from Validate/Flag feedback — topic affinities, author trust, quality threshold calibration
- Scoring: `S = (V_signal * C_context) / (L_slop + 0.5)` with per-user context
- Profile stored in localStorage (primary) with IC canister sync

### Zero Feed Briefing
- Ranks content by composite score, topic relevance, author trust, and recency
- Surfaces 3-5 priority items + 1 serendipity pick (high novelty, outside your bubble)
- Background ingestion from configured sources with quick heuristic pre-filter

### Signal Publishing
- Deterministic Nostr keypair derived from IC Principal (no extra key management)
- Self-evaluated posts published as Kind 1 events with `aegis-score` tags
- Client-side signing — private key never leaves the browser

### D2A Agent Communication
- Agents broadcast topic interests via NIP-78 replaceable events
- Peer discovery with Jaccard resonance matching
- Content negotiation over ephemeral Nostr events (Kind 21078)
- NIP-44 encrypted delivery — relay operators cannot read exchanges

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
| Test | Jest + ts-jest (164 tests, 12 suites) |

## Project Structure

```
aegis/
├── app/
│   ├── page.tsx                         # Main app page
│   ├── layout.tsx                       # Root layout + providers
│   └── api/
│       ├── analyze/route.ts             # Claude V/C/L scoring + fallback
│       └── fetch/
│           ├── url/route.ts             # URL article extraction
│           ├── rss/route.ts             # RSS feed parsing
│           ├── twitter/route.ts         # X API search
│           └── nostr/route.ts           # Nostr relay query
├── components/
│   ├── layout/                          # AppShell, Sidebar, MobileNav
│   ├── tabs/                            # Dashboard, Briefing, Incinerator, Sources, Analytics
│   ├── ui/                              # ContentCard, ScoreRing, SignalComposer, AgentStatusBadge
│   ├── sources/                         # ManualInput
│   ├── auth/                            # LoginButton, UserBadge
│   └── Providers.tsx                    # Auth + Content + Preference + Agent providers
├── contexts/
│   ├── AuthContext.tsx                   # Internet Identity auth state
│   ├── ContentContext.tsx               # Content CRUD + IC sync
│   ├── PreferenceContext.tsx            # Preference learning lifecycle
│   └── AgentContext.tsx                 # D2A agent lifecycle
├── lib/
│   ├── preferences/
│   │   ├── types.ts                     # UserPreferenceProfile
│   │   ├── engine.ts                    # learn(), getContext(), hasEnoughData()
│   │   └── storage.ts                   # localStorage R/W
│   ├── briefing/
│   │   ├── ranker.ts                    # briefingScore, generateBriefing, serendipity
│   │   └── types.ts                     # BriefingResult, BriefingItem
│   ├── ingestion/
│   │   ├── scheduler.ts                 # Background fetch cycle
│   │   └── quickFilter.ts              # Heuristic pre-filter
│   ├── nostr/
│   │   ├── identity.ts                  # IC Principal -> Nostr keypair
│   │   ├── publish.ts                   # Kind 1 event signing + relay publish
│   │   ├── encrypt.ts                   # NIP-44 encrypt/decrypt
│   │   └── types.ts                     # AegisNostrEvent
│   ├── agent/
│   │   ├── protocol.ts                  # D2A constants (kinds, tags, thresholds)
│   │   ├── discovery.ts                 # Presence broadcast + peer discovery
│   │   ├── handshake.ts                # Offer/accept/reject/deliver messaging
│   │   ├── manager.ts                   # AgentManager orchestrator
│   │   └── types.ts                     # AgentProfile, HandshakeState, D2AMessage
│   ├── ic/
│   │   ├── agent.ts                     # HttpAgent creation
│   │   ├── actor.ts                     # Canister actor factory
│   │   └── declarations/               # Candid types + IDL factory
│   ├── types/                           # ContentItem, API response types
│   └── utils/                           # Score computation, constants
├── __tests__/                           # 164 tests across 12 suites
├── canisters/
│   └── aegis_backend/
│       ├── main.mo                      # Motoko canister (persistent actor)
│       ├── types.mo                     # Type definitions
│       └── aegis_backend.did            # Candid interface
├── dfx.json                             # IC project config
└── next.config.js                       # Webpack polyfills for @dfinity
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
npm test              # Run all 164 tests
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
