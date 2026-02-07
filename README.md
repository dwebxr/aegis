# Aegis - AI Content Quality Filter

AI-powered content quality filtering and evaluation platform built on Next.js and Internet Computer.

## Live

- **Frontend**: https://aegis-kappa-eight.vercel.app
- **Backend Canister**: [`rluf3-eiaaa-aaaam-qgjuq-cai`](https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=rluf3-eiaaa-aaaam-qgjuq-cai)

## Architecture

```
Frontend (Next.js / Vercel)          Internet Computer (Mainnet)
┌──────────────────────────┐         ┌──────────────────────────┐
│  Dashboard / Feed / Burn │         │  aegis_backend canister  │
│  Sources / Analytics     │◄───────►│  (Motoko)                │
│                          │         │                          │
│  API Routes:             │         │  - Evaluation storage    │
│  POST /api/analyze       │         │  - User profiles         │
│  POST /api/fetch/url     │         │  - Source configs        │
│  POST /api/fetch/rss     │         │  - Analytics queries     │
│  POST /api/fetch/twitter │         │                          │
│  POST /api/fetch/nostr   │         │  Internet Identity auth  │
└───────────┬──────────────┘         └──────────────────────────┘
            │
            ▼
   Anthropic Claude API
   (Content analysis)
```

## Features

- **AI Content Analysis** - Evaluates content quality using Claude with fallback heuristics
- **Multi-source Ingestion** - Manual input, RSS feeds, URL extraction, X (Twitter), Nostr
- **Quality Scoring** - Originality, Insight, Credibility breakdown with composite score (0-10)
- **Verdict System** - Binary quality/slop classification with detailed reasoning
- **Decentralized Storage** - Evaluations persisted on Internet Computer canisters
- **Internet Identity Auth** - Passwordless authentication via ICP

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Styling | CSS-in-JS (inline styles), dark theme |
| Backend API | Next.js API Routes (Vercel Serverless) |
| AI | Anthropic Claude (claude-sonnet-4-20250514) |
| Blockchain | Internet Computer (Motoko canister) |
| Auth | Internet Identity (@dfinity/auth-client 2.1.3) |
| Deploy | Vercel (frontend), IC mainnet (backend) |

## Project Structure

```
aegis/
├── app/
│   ├── page.tsx                     # Main app page
│   ├── layout.tsx                   # Root layout + providers
│   └── api/
│       ├── analyze/route.ts         # Anthropic Claude evaluation
│       └── fetch/
│           ├── url/route.ts         # URL article extraction
│           ├── rss/route.ts         # RSS feed parsing
│           ├── twitter/route.ts     # X API search
│           └── nostr/route.ts       # Nostr relay query
├── components/
│   ├── layout/                      # AppShell, Sidebar, MobileNav
│   ├── ui/                          # ScoreBar, ScoreRing, StatCard, etc.
│   ├── tabs/                        # Dashboard, Feed, Incinerator, Sources, Analytics
│   ├── sources/                     # ManualInput, URLExtractor, RSS/Twitter/Nostr configs
│   ├── auth/                        # LoginButton, UserBadge
│   └── Providers.tsx                # AuthProvider + ContentProvider wrapper
├── contexts/
│   ├── AuthContext.tsx               # Internet Identity auth state
│   └── ContentContext.tsx            # Content CRUD + IC canister sync
├── lib/
│   ├── ic/
│   │   ├── agent.ts                 # HttpAgent creation
│   │   ├── actor.ts                 # Canister actor factory
│   │   └── declarations/            # Candid types + IDL factory
│   ├── types/                       # TypeScript type definitions
│   └── utils/                       # Score computation, constants
├── canisters/
│   └── aegis_backend/
│       ├── main.mo                  # Motoko canister (persistent actor)
│       ├── types.mo                 # Type definitions
│       └── aegis_backend.did        # Candid interface
├── dfx.json                         # IC project config
└── next.config.js                   # Webpack polyfills for @dfinity
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
# Start local replica
dfx start --background

# Deploy canister locally
dfx deploy aegis_backend

# Deploy to IC mainnet
DFX_WARNING=-mainnet_plaintext_identity dfx deploy aegis_backend --network ic --identity default
```

## Canister Interface

```candid
service : {
  // Queries (free, ~200-500ms)
  getProfile : (principal) -> (opt UserProfile) query;
  getEvaluation : (text) -> (opt ContentEvaluation) query;
  getUserEvaluations : (principal, nat, nat) -> (vec ContentEvaluation) query;
  getUserAnalytics : (principal) -> (AnalyticsResult) query;
  getUserSourceConfigs : (principal) -> (vec SourceConfigEntry) query;

  // Updates (cycles cost, ~2s)
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
