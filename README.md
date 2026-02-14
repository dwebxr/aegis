# Aegis — D2A Social Agent Protocol

Content quality filter that learns your taste, curates a zero-noise briefing, publishes signals to Nostr, and exchanges content with other agents over an encrypted D2A protocol — with on-chain quality assurance deposits and D2A content provision fees.

## Live

- **Frontend**: https://aegis.dwebxr.xyz
- **Backend Canister**: [`rluf3-eiaaa-aaaam-qgjuq-cai`](https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=rluf3-eiaaa-aaaam-qgjuq-cai)

## Quick Start — No Deposit Required

Aegis is **free to use** for content filtering. No wallet, no deposit, no setup required.

### Getting Started

1. **Open** https://aegis.dwebxr.xyz — Demo mode starts immediately with preset feeds
2. **Browse** the Dashboard — 3 preset RSS feeds (Hacker News, CoinDesk, The Verge) are auto-fetched and scored
3. **Login** with Internet Identity — unlocks custom sources, Pro mode, and publishing
4. **Add Sources** in the Sources tab — RSS feeds, Nostr pubkeys, URLs, or Twitter searches
5. **(Optional)** Link your Nostr npub in Settings — enables WoT trust graph and free D2A with trusted peers

### Three Modes: Demo → Lite → Pro

Aegis has two independent axes: **authentication state** (Demo vs Logged-in) and **filter mode** (Lite vs Pro).

| Mode | Authentication | Sources | Scoring | WoT + Serendipity | Cost |
|------|---------------|---------|---------|:--:|------|
| **Demo** | Not logged in | 3 preset feeds (read-only) | Heuristic (Lite) | No | Free |
| **Lite** | Logged in | Custom (add/edit/remove) | Heuristic only | No | Free |
| **Pro** | Logged in | Custom (add/edit/remove) | AI pipeline + heuristic fallback | Yes | Free during alpha |

- **Demo**: Open the app without logging in. You get 3 preset RSS feeds scored with heuristic filters. Source management is disabled. Great for trying Aegis without commitment. Pro mode selector is locked.
- **Lite**: Login and select "Lite" in the filter mode selector. Full source management with heuristic-only scoring. No API calls, $0 cost. WoT and serendipity disabled.
- **Pro**: Login and select "Pro" in the filter mode selector. Full AI scoring pipeline (WebLLM → BYOK Claude → IC LLM → Server Claude → heuristic fallback) + WoT social graph filtering + serendipity discovery. Free during alpha.

Users switch between Lite and Pro via the FilterModeSelector in the Dashboard. Demo mode is automatic when not logged in — logging in clears demo content and enables full source management.

### AI Scoring Engines

| Engine | Tier | Where | Cost | When used |
|--------|------|-------|------|-----------|
| WebLLM (Llama 3.1 8B q4f16) | 1st\* | Browser-local (WebGPU) | Free | **Opt-in** — enable in Settings; tried first when active |
| Anthropic Claude (BYOK) | 2nd | Off-chain (Vercel) | User's API key | When user sets own API key in Settings |
| IC LLM (Llama 3.1 8B) | 3rd | On-chain (IC canister) | Free | Default for authenticated users |
| Anthropic Claude (server key) | 3.5th | Off-chain (Vercel) | Free during alpha | Non-BYOK users when IC LLM fails (future Pro subscription) |
| Heuristic filter | 4th | Client-side | Free | Fallback when all LLM tiers fail |

\*WebLLM is **off by default**. When not enabled, the chain starts at Tier 2 (BYOK) or Tier 3 (IC LLM).

BYOK users: WebLLM\* → BYOK Claude → IC LLM → Heuristic. Non-BYOK users: WebLLM\* → IC LLM → Server Claude → Heuristic.

### Publishing & D2A

| What you want to do | Cost | Prerequisites |
|---------------------|------|---------------|
| Publish quality signals to Nostr | Free while in good standing | Login (Internet Identity) |
| D2A exchange (trusted peers) | Free | Link Nostr npub in Settings |
| D2A exchange (known peers) | 0.001 ICP / item | ICRC-2 pre-approval (0.1 ICP) |
| D2A exchange (unknown peers) | 0.002 ICP / item | ICRC-2 pre-approval (0.1 ICP) |

\*Deposit required only if your published signals are repeatedly flagged as low-quality (anti-spam measure). New users and users in good standing publish for free.

**Trusted peers** are users in the follow graph of the Nostr account you link in Settings. D2A exchanges between trusted peers are free — no ICP needed. The agent starts in **trusted-only mode** when the wallet has insufficient funds.

**How does Publish Signal reputation work?** Every publisher starts with a neutral reputation. Signals validated by the community improve your standing; signals flagged as slop degrade it. If your reputation drops below the threshold, an ICP deposit (0.001–1.0 ICP) is required as a quality assurance bond. Reputation naturally recovers over time (+1 per week of inactivity).

### Settings Persistence

| Setting | Storage | Synced across devices? |
|---------|---------|:---:|
| Nostr Account (npub) | IC canister + localStorage cache | Yes |
| D2A Agent toggle | IC canister + localStorage cache | Yes |
| API Key (BYOK) | localStorage only | No (secret) |
| Push Notifications | IC canister + browser | No (browser-specific) |
| Browser AI (WebLLM) | localStorage only | No (browser-specific) |

## Architecture

```
Browser                                  Internet Computer (Mainnet)
┌───────────────────────────────────┐    ┌──────────────────────────┐
│  Next.js 14 (App Router)          │    │  aegis_backend canister  │
│                                   │    │  (Motoko)                │
│  Tabs:                            │    │                          │
│    Dashboard / Briefing / Burn    │◄──►│  - Evaluation storage    │
│    Sources / Analytics            │    │  - User profiles         │
│                                   │    │  - Source configs        │
│  API Routes:                      │    │  - Quality deposits/rep  │
│    POST /api/analyze              │    │  - D2A match records     │
│    POST /api/fetch/{url,rss,      │    │  - IC LLM scoring        │
│      twitter,nostr,discover-feed} │    │  - Engagement index      │
│                                   │    │  Internet Identity auth  │
│  Client-side:                     │    └─────────┬────────────────┘
│    WoT filter pipeline            │              │
│    Preference learning engine     │    ┌─────────▼────────────────┐
│    Briefing ranker                │    │  ICP Ledger (ICRC-1/2)   │
│    Nostr identity (IC-derived)    │    │  ryjl3-tyaaa-aaaaa-aaaba │
│    D2A agent manager              │    │  Deposit hold / return / │
│    ICP Ledger (deposit/approve)   │    │  forfeit / D2A fee split │
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
   Scoring Pipeline (fallback chain):
   1.  IC LLM (Llama 3.1 8B, free, on-chain)
   1.5 WebLLM (browser-local via WebGPU, if enabled)
   2.  Anthropic Claude (premium, V/C/L) or BYOK
   3.  Heuristic fallback (client-side)
   + Per-IP API rate limiting (5-60 req/min per route)
   + Per-instance daily API budget (500 calls/day)

   WoT Filter Pipeline (Pro mode):
   Content → Quality threshold → WoT scoring (Nostr social graph)
     → Weighted composite → Serendipity detection → Ranked output
   Filter Modes: Lite (heuristic only) | Pro (WoT + AI scoring)
```

---

## Slop Detection: How Aegis Judges Content Quality

Aegis uses a multi-tier scoring pipeline with automatic fallback. The system tries each tier in order and uses the first successful result — no silent failures.

### Tier 1: WebLLM Browser-Local Scoring (Free, Privacy-First)

When enabled in Settings, **WebLLM** (Llama 3.1 8B q4f16 via WebGPU) is tried **first** — before any network call. It runs entirely in the browser: no API calls, no data leaves the device. The model downloads once on first use (~4 GB) and scores locally thereafter. Requires a WebGPU-capable browser.

If WebLLM is not enabled or fails, the system falls through to Tier 2.

### Tier 2: Claude API BYOK (User's Own Key)

When the user has set their own Anthropic API key in Settings, Aegis calls the Claude API with the full V/C/L framework and the user's preference context. This provides the highest quality analysis. The key is sent via `X-User-API-Key` header to the `/api/analyze` endpoint.

If the BYOK call fails or no user key is set, the system falls through to Tier 3.

### Tier 3: IC LLM On-Chain Scoring (Free, Decentralized)

When authenticated, Aegis calls `analyzeOnChain()` on the canister, which runs **Llama 3.1 8B** via the [IC LLM Canister](https://github.com/nickcen/ic_llm) (`w36hm-eqaaa-aaaal-qr76a-cai`). This provides free, fully on-chain scoring with no API key required. The prompt includes the user's topic affinities for personalized evaluation.

If IC LLM is unavailable (e.g. local dev, not authenticated), the system falls through to Tier 3.5.

### Tier 3.5: Claude API Server Key (Provisional — Future Pro Subscription)

For non-BYOK users when IC LLM also fails, Aegis calls the Claude API using the server-side key. This is free during alpha. In the future, this tier will be gated behind a Pro subscription plan.

If the server key is missing, budget exceeded, or the call fails, the system falls through to Tier 4.

### Tier 4: Heuristic Fallback (Client-side, No API Call)

When all LLM tiers are unavailable, a fast heuristic filter scores content locally using text signals. This provides instant scoring with no network calls.

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

### V/C/L Scoring Axes (Used by Tier 1, 2, 3, and 3.5)

WebLLM, Claude, and IC LLM all evaluate three orthogonal axes:

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

## WoT Filter Pipeline

Aegis implements a Web of Trust (WoT) filter that uses the user's Nostr social graph to weight content quality scores. The pipeline runs client-side and supports two modes.

### Filter Modes

| Mode | Scoring Engine | WoT Filtering | Serendipity | Login Required |
|------|---------------|:---:|:---:|:---:|
| **Demo** | Heuristic only (Lite locked) | No | No | No |
| **Lite** | Heuristic only (client-side) | No | No | Yes |
| **Pro** | WebLLM → BYOK → IC LLM → heuristic | Yes | Yes | Yes |

- **Demo**: Unauthenticated state. 3 preset RSS feeds, heuristic scoring, Pro selector locked. Source management disabled.
- **Lite**: Authenticated, heuristic-only scoring. Full source management but no API calls, no WoT, no serendipity. $0 cost.
- **Pro**: Authenticated, full AI scoring pipeline + WoT social graph filtering + serendipity discovery (up to 5 per cycle). Free during alpha; alternatively bring your own Claude API key in Settings.

Users switch between Lite and Pro via the FilterModeSelector in the Dashboard. Demo mode is automatic when not logged in.

### Nostr Account Linking

By default, Aegis derives a Nostr keypair from the user's Internet Computer principal. Since this derived key has zero followers on the Nostr network, the WoT graph starts empty.

Users can link an existing Nostr account (npub) in Settings to use its follow graph as the WoT root:

1. Enter an npub (bech32) or 64-char hex pubkey in **Settings > Nostr Account**
2. Aegis fetches the account's profile (Kind 0) and follow list (Kind 3) from relays
3. The linked pubkey replaces the IC-derived key as the WoT graph root
4. All WoT scores, D2A trust tiers, and content filtering automatically reflect the linked account's social graph

The IC-derived keypair continues to be used for signing and publishing — only the graph root changes. Unlinking reverts to the IC-derived key and rebuilds the graph. The linked account and D2A agent toggle are synced to the IC canister, so they persist across browsers and devices.

### WoT Graph Construction

When the user authenticates via Internet Identity and has a Nostr identity (or linked account), Aegis builds a social graph from Nostr relay data:

1. Fetch the root user's follow list (Kind 3 event)
2. Fetch each followee's follow list (2-hop expansion; capped at 1 hop for >500 follows)
3. Count mutual follows (bidirectional connections)
4. Cache the graph in localStorage with configurable TTL

### Trust Scoring

Each content author is scored based on their position in the user's social graph:

```
trustScore = (1/hopDistance) × 0.6 + (mutualFollows/maxMutual) × 0.3 + 0.1
```

- **Hop proximity (60%)**: Direct follows (hop 1) score highest. Inverse distance decay.
- **Social proof (30%)**: Mutual (bidirectional) follows indicate network-verified trust.
- **Base presence (10%)**: Being in the graph at all provides a minimum signal.

Authors not in the graph receive `trustScore = 0, isInGraph = false`.

### Weighted Composite

The final content ranking combines AI quality score with WoT trust:

```
weightedComposite = composite × 0.7 + trustScore × composite × 0.3
```

This means WoT can boost high-quality content from trusted authors, but cannot elevate low-quality content regardless of trust.

### Serendipity Detection

Items with low trust but high quality are flagged as **WoT Serendipity** — valuable content from outside the user's social bubble:

```
isWoTSerendipity = trustScore < 0.3 AND composite > 7.0
```

In Pro mode, up to 5 serendipity items are surfaced in the Briefing tab with type-specific badges:

| Type | Badge | Condition |
|------|-------|-----------|
| Out of Network | `OUT OF NETWORK` | Author not in graph or hop ≥ 3 |
| Cross-Language | `CROSS-LANGUAGE` | Content has > 30% non-ASCII characters |
| Emerging Topic | `EMERGING TOPIC` | Default (high quality, unknown author) |

### Cost Tracking

Daily cost records are stored in localStorage (90-day rolling window). The Analytics tab shows:

- Monthly usage summary (articles evaluated, AI-scored, discoveries found)
- Estimated API cost in USD
- Time saved vs manual curation (3 min/article baseline)
- Lite vs Pro feature comparison
- Competitor cost comparison (Twitter Blue, news subscriptions, manual curation)

---

## Monetization: Three Revenue Pillars

Aegis implements a sustainable economic model using ICP tokens (ICRC-1/2) with three revenue pillars:

### Pillar 1: Compute & Intelligence

| Tier | Engine | Cost | Where |
|------|--------|------|-------|
| **1st (Free)** | WebLLM (Llama 3.1 8B q4f16) | 0 — browser-local via WebGPU | Client-side |
| **2nd (BYOK)** | Anthropic Claude (claude-sonnet-4-20250514) | User's API key | Off-chain (Vercel) |
| **3rd (Free)** | IC LLM (Llama 3.1 8B) | 0 ICP — cycles paid by canister | On-chain (IC) |
| **3.5th (Alpha)** | Anthropic Claude (server key) | Free during alpha | Off-chain (Vercel) |
| **4th (Fallback)** | Heuristic filter | 0 | Client-side |

When WebLLM is enabled, it is tried first — browser-local AI via WebGPU with no API calls. BYOK users get Claude API next (highest quality). IC LLM on-chain scoring provides free decentralized fallback. The server-side Claude key (Tier 3.5) is free during alpha and will move to a Pro subscription plan.

### Pillar 2: Quality Assurance Deposits (Non-Custodial)

> Deposits are **not required** to publish signals. New users and users in good standing publish for free. A deposit is only required when your published signals are **repeatedly flagged as low-quality** by the community — as an anti-spam measure.

When a deposit is required (reputation below threshold), users attach ICP (0.001–1.0 ICP) as a quality assurance bond. Community members vote to validate or flag signals through objective peer review:

```
Publisher with low reputation deposits ICP as quality bond
  → 3 validates (community consensus) → Deposit returned + Trust Score improved
  → 3 flags (community consensus)     → Deposit forfeited as quality assurance cost
  → 30 days with no verdict           → Deposit auto-returned (no issue found)
```

**Quality determination process**: Content is first scored by AI (IC LLM or Claude) using objective metrics (originality, insight, credibility). Community peer review then requires a minimum of 3 independent votes to reach consensus. This two-layer process (AI scoring + community consensus) ensures objectivity.

**Non-custodial design**: The canister operator has no withdrawal capability. Protocol revenue (forfeited deposits) is automatically distributed to a hardcoded protocol wallet or converted to cycles for canister operation. The canister only holds active deposits pending resolution. All code is [open source on GitHub](https://github.com/dwebxr/aegis).

**ICRC-2 flow**: Client `icrc2_approve` → Canister `icrc2_transfer_from` (deposit hold) → On resolution: `icrc1_transfer` (return to depositor or auto-distribute).

**Trust Score**: `T = 5.0 + (qualitySignals / totalSignals) × 5.0` — ranges 0–10. Starts at 5.0 (neutral).

**Engagement Index**: `E = validationRatio × avgComposite` — measures how effectively a user's signals engage the community (0–10 scale).

**Auto-return**: Deposits that receive no community verdict within 30 days are automatically returned to the depositor. "No verdict = no issue found." This is processed by a recurring on-chain timer, ensuring no funds are permanently locked.

Double-voting is prevented by tracking voters per signal. Self-voting is blocked. Deposit records and voter lists persist across canister upgrades.

### Pillar 3: D2A Content Provision Fee (Trust-Tiered)

When content is successfully delivered via the D2A protocol, a trust-based fee is collected from the receiver. The fee scales with the sender's trustworthiness — combining WoT social graph position and local behavioral reputation:

```
Content delivered via D2A
  → Effective trust = WoT score × 0.6 + behavioral reputation × 0.4
  → Trust tier determines fee:
      Trusted (≥0.8): Free    — WoT-backed peers exchange for free
      Known   (≥0.4): 0.001  ICP — peers with some track record
      Unknown (≥0.0): 0.002  ICP — new peers (default)
      Restricted (<0): rejected — blocked peers, no delivery
  → Fee split (paid tiers): 80% → Content provider, 20% → auto-distributed (cycles or protocol wallet)
```

**Behavioral reputation** is tracked locally (localStorage). Each Validate on D2A-received content improves the sender's reputation; each Flag degrades it. Peers automatically upgrade from Unknown → Known → Trusted as the user validates their content. Peers scoring below −5 are auto-blocked.

**Non-custodial**: The 20% protocol share is immediately distributed — either converted to cycles (if canister cycles are below threshold) or sent to the hardcoded protocol wallet. No funds accumulate in the canister beyond active deposits.

When the D2A agent starts, it attempts to pre-approve the canister for a 0.1 ICP allowance via ICRC-2. If the wallet has insufficient funds, the agent starts in **trusted-only mode** — free exchanges with WoT-backed peers still work. Fees for paid tiers are collected automatically via `icrc2_transfer_from` and distributed via `icrc1_transfer`.

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
  "content": "{\"entries\":[{\"hash\":\"a1b2c3...\",\"topic\":\"ml\",\"score\":8.5},...],\"generatedAt\":1700000000000}"
}
```

Topics are drawn from the user's top 20 high-affinity topics (affinity ≥ 0.2). `capacity` indicates how many items the agent can accept per cycle. `principal` is the agent's IC principal (used for D2A fee settlement). The `content` field carries a JSON manifest of the agent's top 50 quality items (SHA-256 truncated hashes), enabling peers to diff and offer only novel content. Being a replaceable event, only the latest version persists on relays.

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

1. **OFFER**: Agent A diffs its content against Agent B's manifest, selects a novel quality item (composite ≥ 7.0) matching Agent B's topics. Sends topic, score, and 100-char preview.
2. **ACCEPT/REJECT**: Agent B checks topic affinity (> 0), score (≥ 6), and sender reputation (not blocked). Accepts if all pass.
3. **DELIVER**: Agent A sends the full content with all scores, topics, and V/C/L signals. A trust-tiered fee is charged to the receiver.

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

The receiving agent rejects deliveries from undiscovered peers (not in the known peers map) and applies a resonance check (≥ 0.1) before injecting the content into its feed, providing a two-layer defense against irrelevant or unsolicited deliveries.

### Security Properties

| Property | Mechanism |
|----------|-----------|
| **Confidentiality** | NIP-44 (XChaCha20-Poly1305) — relay operators cannot read content |
| **Authentication** | Nostr event signatures (secp256k1) — cannot forge sender identity |
| **Identity binding** | Keypair derived from IC Principal — tied to Internet Identity |
| **No persistence** | Kind 21078 is ephemeral — relays are not required to store events |
| **No central authority** | Any Nostr relay works — no single point of failure or censorship |
| **Sybil resistance** | Trust-tiered D2A fees — trusted peers (WoT-backed) exchange free, unknown peers pay ICP |
| **Reputation isolation** | Behavioral reputation is local — peers cannot manipulate their own score |

---

## x402 D2A Briefing API

Aegis exposes a paid API for AI agents (like [Coo](https://github.com/AegisOnChain/coo-icp)) to purchase curated briefings using the [x402 protocol](https://x402.org) — HTTP-native micropayments with USDC on Base.

### Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/d2a/briefing` | x402 ($0.01 USDC) | Curated briefing with V/C/L scored items |
| `GET /api/d2a/info` | None | Service metadata, pricing, scoring model |
| `GET /api/d2a/health` | None | Health check (IC canister + x402 config) |

### Payment Flow

```
AI Agent                        Aegis                        x402 Facilitator
   │                              │                              │
   │── GET /api/d2a/briefing ────►│                              │
   │◄── 402 + PAYMENT-REQUIRED ──│                              │
   │                              │                              │
   │ [sign EIP-3009 USDC auth]   │                              │
   │                              │                              │
   │── GET + PAYMENT-SIGNATURE ──►│── POST /verify ─────────────►│
   │                              │◄── valid ────────────────────│
   │                              │                              │
   │◄── 200 + briefing JSON ─────│── POST /settle ─────────────►│
   │                              │◄── tx hash ─────────────────│
```

### Response Format

```json
{
  "version": "1.0",
  "generatedAt": "2025-01-15T12:00:00Z",
  "source": "aegis",
  "summary": { "totalEvaluated": 42, "totalBurned": 15, "qualityRate": 0.64 },
  "items": [{
    "title": "...",
    "content": "...",
    "scores": { "originality": 8, "insight": 9, "credibility": 7, "composite": 8.2, "vSignal": 9, "cContext": 7, "lSlop": 2 },
    "verdict": "quality",
    "topics": ["machine-learning"],
    "briefingScore": 7.5
  }],
  "serendipityPick": { ... },
  "meta": { "scoringModel": "aegis-vcl-v1", "nostrPubkey": "...", "topics": [...] }
}
```

### Configuration

```bash
X402_RECEIVER_ADDRESS=0x...    # EVM address to receive USDC payments
X402_NETWORK=eip155:84532      # Base Sepolia (testnet) or eip155:8453 (mainnet)
X402_PRICE=$0.01               # Price per briefing in USD
X402_FACILITATOR_URL=https://x402.org/facilitator
```

When `X402_RECEIVER_ADDRESS` is not set, the briefing endpoint serves ungated (free) — useful for development.

---

## Features

### Multi-Tier AI Scoring Pipeline
- **Tier 1**: WebLLM (Llama 3.1 8B q4f16) — free, browser-local via WebGPU, no data leaves device (when enabled)
- **Tier 2**: Claude API BYOK — premium V/C/L scoring with user's own API key
- **Tier 3**: IC LLM (Llama 3.1 8B) — free, fully on-chain, no API key
- **Tier 3.5**: Claude API server key — free during alpha (future Pro subscription)
- **Tier 4**: Heuristic fallback — local, instant, no network call
- Automatic fallback: BYOK users (1→2→3→4), non-BYOK users (1→3→3.5→4)

### WoT Filter Pipeline
- **Demo mode**: Preset feeds, heuristic scoring, Pro locked (no login)
- **Lite mode**: Heuristic scoring only (free, no API calls, login required)
- **Pro mode**: WoT social graph + AI scoring with serendipity detection
- Trust scoring from Nostr follow graph (2-hop, mutual follows, hop proximity)
- Weighted composite: quality × 0.7 + trust × quality × 0.3
- Serendipity detection: low-trust + high-quality items surfaced with type badges
- Nostr account linking: use your existing npub's follow graph as WoT root
- WoT graph cached in localStorage with configurable TTL
- Cost tracking with daily records, monthly analytics, and competitor comparison

### Quality Assurance Deposits
- Publish signals free while in good standing; deposit 0.001–1.0 ICP required only when reputation drops (anti-spam)
- Community validation: 3 validates (consensus) → deposit returned + trust score updated
- Community flagging: 3 flags (consensus) → deposit forfeited as quality assurance cost
- Auto-return: 30 days with no verdict → deposit returned automatically
- Trust Score gauge (0–10) and Engagement Index in Analytics dashboard
- Non-custodial: forfeited deposits auto-distributed, no operator withdrawal
- ICRC-2 approve/transfer_from pattern with pre-debit rollback safety

### D2A Content Provision Fee (Trust-Tiered)
- Dynamic trust-based fees: Free (trusted) / 0.001 ICP (known) / 0.002 ICP (unknown)
- Effective trust = WoT score × 0.6 + local behavioral reputation × 0.4
- Validate/Flag on D2A content adjusts sender's local reputation → tier upgrades/downgrades
- Auto-block at reputation score ≤ −5 (restricted tier, deliveries rejected)
- 80/20 split: 80% to content provider, 20% auto-distributed (cycles or protocol wallet)
- ICRC-2 pre-approval on agent start (0.1 ICP) — optional; agent starts in trusted-only mode without ICP

### Content Manifest Diff Streaming
- Presence events carry SHA-256 content manifests (top 50 quality items, 32-char truncated hashes)
- Before offering content, agents diff their items against the peer's manifest
- Only novel content (not already in peer's manifest) is offered — eliminates redundant delivery
- Backward-compatible: peers without manifests fall back to topic-matching

### Personalization Engine
- Learns from Validate/Flag feedback — topic affinities, author trust, quality threshold calibration
- Profile stored in localStorage (primary) with IC canister sync
- After 3+ feedback events, AI scoring becomes personalized

### Zero Feed Briefing
- Ranks content by composite score, topic relevance, author trust, and recency
- Surfaces 3–5 priority items + 1 serendipity pick (high novelty, outside your bubble)
- Shareable briefings via Nostr NIP-23 long-form events with `/b/[naddr]` public pages
- Background ingestion from configured sources with quick heuristic pre-filter

### Signal Publishing
- Deterministic Nostr keypair derived from IC Principal (no extra key management)
- Self-evaluated posts published as Kind 1 events with `aegis-score` tags
- Image attachment via nostr.build (NIP-92 imeta tag, JPEG/PNG/GIF/WebP, max 5MB)
- Client-side signing — private key never leaves the browser
- Optional PoQ stake attachment with range slider UI

### Onboarding & UX
- Landing hero for new visitors with feature overview and "Explore Demo" / "Login" CTAs
- Terminology tooltips on hover for domain-specific terms (V-Signal, C-Context, L-Slop, WoT, D2A, Serendipity, etc.)
- Centralized glossary of 12 terms — importable from `lib/glossary.ts`
- Actionable empty states: Dashboard and Briefing link to Sources / Incinerator when no content exists
- Sidebar navigation descriptions updated for clarity; active state with stronger visual indicator
- Mobile touch targets meet 48px accessibility minimum
- Settings gear icon visible in collapsed sidebar mode

### Multi-Source Ingestion
- RSS/Atom feeds (YouTube, note.com, blogs — with thumbnail extraction, ETag conditional fetch)
- Feed auto-discovery from any blog/site URL
- Nostr relay queries (by pubkey or global)
- Direct URL article extraction
- X (Twitter) API search
- Article-level dedup (URL + content fingerprint SHA-256) to avoid redundant API calls
- Adaptive fetch intervals (scales with source activity, exponential backoff on errors)
- Auto-disable after 5 consecutive failures with user notification
- CSV export with RFC-compliant escaping (handles commas, quotes, newlines in all fields)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Styling | CSS-in-JS (inline styles), dark theme |
| Backend API | Next.js API Routes (Vercel Serverless) |
| AI (Free) | IC LLM Canister — Llama 3.1 8B (on-chain, mo:llm 2.1.0) |
| AI (Premium) | Anthropic Claude (claude-sonnet-4-20250514) + BYOK + fallback heuristics |
| AI (Local) | WebLLM (@mlc-ai/web-llm, Llama 3.1 8B q4f16 via WebGPU, optional) |
| Blockchain | Internet Computer (Motoko canister, dfx 0.30.2) |
| Payments | x402 protocol (@x402/next 2.3.0, USDC on Base) |
| Tokens | ICP Ledger ICRC-1/2 (staking, D2A fees) |
| Auth | Internet Identity (@dfinity/auth-client 2.1.3) |
| Nostr | nostr-tools 2.23, @noble/hashes (key derivation) |
| Packages | mops (mo:llm 2.1.0, mo:json 1.4.0) |
| Deploy | Vercel (frontend), IC mainnet (backend) |
| CI/CD | GitHub Actions (lint → test → build → security audit on push/PR) |
| Monitoring | Sentry (@sentry/nextjs, beforeSend scrubbing, conditional on DSN) |
| Test | Jest + ts-jest (1920 tests, 133 suites) |

## Project Structure

```
aegis/
├── app/
│   ├── page.tsx                         # Main app page
│   ├── layout.tsx                       # Root layout + metadata + icons
│   ├── b/[naddr]/page.tsx               # Shared briefing viewer (Nostr NIP-23)
│   ├── offline/page.tsx                 # PWA offline fallback
│   ├── favicon.ico                      # Browser tab icon
│   └── api/
│       ├── analyze/route.ts             # Claude V/C/L scoring + fallback
│       ├── health/route.ts              # Health check + IC canister connectivity
│       ├── upload/image/route.ts        # Image upload proxy (nostr.build)
│       ├── push/send/route.ts           # Web Push notification sender
│       ├── d2a/
│       │   ├── briefing/route.ts        # x402-gated briefing API ($0.01 USDC)
│       │   ├── info/route.ts            # Free metadata (pricing, scoring model)
│       │   └── health/route.ts          # D2A service health check
│       └── fetch/
│           ├── url/route.ts             # URL article extraction
│           ├── rss/route.ts             # RSS feed parsing (ETag/Last-Modified conditional)
│           ├── twitter/route.ts         # X API search
│           ├── nostr/route.ts           # Nostr relay query
│           ├── briefing/route.ts       # Shared briefing fetch (Nostr NIP-23)
│           └── discover-feed/route.ts   # RSS feed auto-discovery from any URL
├── components/
│   ├── layout/                          # AppShell, Sidebar, MobileNav
│   ├── tabs/                            # Dashboard, Briefing, Incinerator, Sources, Analytics
│   ├── ui/                              # ContentCard, ScoreBar, SignalComposer, LandingHero, Tooltip, NostrAccountLink, WoTPromptBanner
│   ├── shared/                          # SharedBriefingView (public /b/[naddr] page)
│   ├── filtering/                       # CostInsights, FilterModeSelector, SerendipityBadge
│   ├── sources/                         # ManualInput
│   ├── auth/                            # LoginButton, UserBadge
│   └── Providers.tsx                    # Notification + Auth + Content + Preference + Source + FilterMode + Agent
├── contexts/
│   ├── NotificationContext.tsx          # Global notification system (toast) for all providers
│   ├── AuthContext.tsx                   # Internet Identity auth state
│   ├── ContentContext.tsx               # Content CRUD + IC sync + error notifications
│   ├── PreferenceContext.tsx            # Preference learning lifecycle
│   ├── SourceContext.tsx                # RSS/Nostr source management + IC sync
│   ├── AgentContext.tsx                 # D2A agent lifecycle + error notifications
│   ├── FilterModeContext.tsx            # Lite/Pro filter mode (persisted to localStorage)
│   └── DemoContext.tsx                  # Demo mode for unauthenticated users
├── lib/
│   ├── preferences/
│   │   ├── types.ts                     # UserPreferenceProfile, constants
│   │   ├── engine.ts                    # learn(), getContext(), hasEnoughData()
│   │   └── storage.ts                   # localStorage R/W
│   ├── briefing/
│   │   ├── ranker.ts                    # briefingScore, generateBriefing, serendipity
│   │   ├── sync.ts                      # Sync briefing snapshot to IC canister
│   │   └── types.ts                     # BriefingState, BriefingItem
│   ├── d2a/
│   │   ├── manifest.ts                  # Content manifest + SHA-256 hashing + diff logic
│   │   ├── reputation.ts               # Local peer reputation tracker (behavioral trust)
│   │   ├── types.ts                     # D2ABriefingResponse, D2ABriefingItem
│   │   ├── cors.ts                      # CORS headers for external AI agent access
│   │   ├── x402Server.ts               # x402 resource server config (ExactEvmScheme)
│   │   └── briefingProvider.ts          # Briefing data provider (IC canister fetch)
│   ├── wot/
│   │   ├── graph.ts                     # WoT graph builder (2-hop Nostr follow expansion)
│   │   ├── scorer.ts                    # Trust scoring (hop proximity + mutual follows)
│   │   ├── cache.ts                     # localStorage cache with TTL
│   │   └── types.ts                     # WoTGraph, WoTNode, WoTScore, WoTCacheEntry
│   ├── filtering/
│   │   ├── pipeline.ts                  # Filter pipeline (quality gate → WoT → weighted composite)
│   │   ├── serendipity.ts              # Serendipity detection (low trust + high quality)
│   │   ├── costTracker.ts              # Daily cost records (localStorage, 90-day window)
│   │   └── types.ts                     # FilterConfig, FilteredItem, FilterPipelineResult
│   ├── ingestion/
│   │   ├── scheduler.ts                 # Background fetch cycle (adaptive intervals, enrichment)
│   │   ├── quickFilter.ts              # Heuristic pre-filter (Tier 4 fallback)
│   │   ├── dedup.ts                     # Article-level dedup (URL + SHA-256 fingerprint)
│   │   └── sourceState.ts              # Source runtime state (backoff, health, adaptive timing)
│   ├── nostr/
│   │   ├── identity.ts                  # IC Principal -> Nostr keypair (SHA-256 derivation)
│   │   ├── linkAccount.ts              # npub import, localStorage CRUD, relay profile fetch
│   │   ├── publish.ts                   # Event signing + relay publish + publishAndPartition
│   │   ├── encrypt.ts                   # NIP-44 encrypt/decrypt (XChaCha20-Poly1305)
│   │   └── types.ts                     # Nostr kind constants + mergeRelays utility
│   ├── agent/
│   │   ├── protocol.ts                  # D2A constants (kinds, tags, thresholds, timings)
│   │   ├── discovery.ts                 # Presence broadcast + peer discovery + Jaccard resonance
│   │   ├── handshake.ts                # Offer/accept/reject/deliver messaging
│   │   ├── manager.ts                   # AgentManager orchestrator (lifecycle + error recovery)
│   │   └── types.ts                     # AgentProfile, HandshakeState, D2AMessage
│   ├── ic/
│   │   ├── config.ts                    # IC config getters (canister ID, host, derivation origin)
│   │   ├── agent.ts                     # HttpAgent creation (re-exports config)
│   │   ├── actor.ts                     # Canister actor factory (sync + async with syncTime)
│   │   ├── icpLedger.ts                # ICP Ledger actor (ICRC-1/2 balance, approve, allowance)
│   │   └── declarations/               # Candid types + IDL factory
│   ├── api/
│   │   ├── rateLimit.ts                 # Per-IP rate limiter for API routes (5-60 req/min per route)
│   │   └── dailyBudget.ts              # Per-instance daily API budget (500 calls/day)
│   ├── webllm/
│   │   ├── engine.ts                    # Browser-local AI scoring (WebGPU, Llama 3.1 8B)
│   │   └── types.ts                     # WebLLMStatus type
│   ├── reputation/
│   │   └── publishGate.ts               # Publish Signal reputation gating (localStorage)
│   ├── glossary.ts                        # Domain term definitions (V-Signal, WoT, D2A, etc.)
│   ├── apiKey/
│   │   └── storage.ts                   # BYOK API key storage (localStorage, never sent to server)
│   ├── types/                           # ContentItem, API response types, source types
│   └── utils/
│       ├── scores.ts                    # Score computation + relativeTime
│       ├── errors.ts                    # errMsg() shared error formatter
│       ├── url.ts                       # SSRF protection (blockPrivateUrl/blockPrivateRelay)
│       ├── csv.ts                       # CSV export (RFC-compliant escaping)
│       └── timeout.ts                   # withTimeout() — Promise.race with timer cleanup
├── __tests__/                           # 1920 tests across 133 suites
├── canisters/
│   └── aegis_backend/
│       ├── main.mo                      # Motoko canister (persistent actor, staking, D2A, IC LLM)
│       ├── types.mo                     # Type definitions (incl. StakeRecord, UserReputation, D2AMatchRecord)
│       ├── ledger.mo                    # ICRC-1/2 ICP Ledger + CMC interface module
│       └── aegis_backend.did            # Candid interface
├── .github/workflows/ci.yml             # GitHub Actions CI (lint → test → build → security audit)
├── sentry.client.config.ts              # Sentry client-side init (breadcrumb URL scrubbing)
├── sentry.server.config.ts              # Sentry server-side init (auth header/cookie scrubbing)
├── sentry.edge.config.ts                # Sentry edge runtime init (auth header/cookie scrubbing)
├── instrumentation.ts                   # Next.js instrumentation hook (Sentry)
├── public/                              # Icons (apple-touch-icon, favicons, PWA)
├── mops.toml                            # Motoko package manager (mo:llm, mo:json)
├── dfx.json                             # IC project config (packtool: mops sources)
└── next.config.mjs                      # Webpack polyfills + Serwist PWA + Sentry
```

## Getting Started

### Prerequisites

- Node.js 20+
- [dfx](https://internetcomputer.org/docs/current/developer-docs/getting-started/install/) (for canister development)

### Local Development

```bash
npm install
cp .env.example .env.local  # Add your ANTHROPIC_API_KEY
npm run dev
```

### Tests

```bash
npm test              # Run all 1920 tests
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

# Push Notifications (optional)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...      # VAPID public key
VAPID_PRIVATE_KEY=...                 # VAPID private key
VAPID_SUBJECT=mailto:admin@example.com

# x402 D2A Payment Gateway (optional)
X402_RECEIVER_ADDRESS=0x...           # EVM address for USDC payments
X402_NETWORK=eip155:84532             # Base Sepolia (or eip155:8453 for mainnet)
X402_PRICE=$0.01                      # Per-briefing price
X402_FACILITATOR_URL=https://x402.org/facilitator

# Sentry Error Tracking (optional — no-op if DSN not set)
NEXT_PUBLIC_SENTRY_DSN=...            # Sentry DSN for error tracking
SENTRY_ORG=...                        # Sentry org slug (for source map upload)
SENTRY_PROJECT=...                    # Sentry project slug
SENTRY_AUTH_TOKEN=...                 # Sentry auth token
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

  // D2A Briefing Snapshots
  saveLatestBriefing : (text) -> (bool);              // Save serialized briefing JSON
  getLatestBriefing : (principal) -> (opt text) query; // Retrieve latest briefing

  // User Settings (Nostr link + D2A toggle — synced across devices)
  saveUserSettings : (UserSettings) -> (bool);
  getUserSettings : (principal) -> (opt UserSettings) query;

  // Push Notifications
  registerPushSubscription : (text, text, text) -> (bool);
  unregisterPushSubscription : (text) -> (bool);
  getPushSubscriptions : (principal) -> (vec PushSubscription) query;
  removePushSubscriptions : (principal, vec text) -> (bool);
  getPushSubscriptionCount : () -> (nat) query;

  // Treasury (non-custodial — no operator withdrawal)
  getTreasuryBalance : () -> (nat);                  // Transparency: anyone can check
  sweepProtocolFees : () -> (Result);                // Anyone can trigger surplus distribution
  topUpCycles : () -> (Result);                      // Anyone can trigger cycles top-up
}
```

## Non-Custodial Design

Aegis follows a non-custodial architecture for all on-chain fund management:

- **No operator withdrawal**: The `withdrawTreasury` function has been removed. The canister controller cannot withdraw user funds.
- **Hardcoded distribution**: Protocol revenue is automatically sent to a hardcoded wallet address or converted to cycles. No configurable destinations.
- **Active deposits only**: The canister only holds ICP for deposits pending community review. Once resolved (validated or flagged), funds are immediately distributed.
- **Self-sustaining cycles**: When the canister's cycles balance drops below threshold, protocol revenue is automatically converted to cycles via the Cycles Minting Canister (CMC), with a 30-day recurring timer as fallback.
- **Public sweep functions**: `sweepProtocolFees()` and `topUpCycles()` can be called by anyone — not restricted to the controller.
- **Open source**: All canister code is publicly auditable on [GitHub](https://github.com/dwebxr/aegis).

**Auto-return**: Deposits pending for 30+ days without community verdict are automatically returned. "No verdict = no issue found." A recurring on-chain timer processes expired deposits monthly.

### Progressive Decentralization

Aegis follows a staged decentralization roadmap to balance security with trustlessness:

| Phase | Status | Controller | Description |
|-------|--------|------------|-------------|
| **Phase 1** | Current | Developer-held | Code is open source on GitHub. On-chain logic enforces non-custodial fund management. Controller retained for critical bug fixes. |
| **Phase 2** | Planned | Blackhole canister or SNS DAO | Once the protocol is stable, controller will be transferred to a blackhole canister (immutable) or an SNS (Service Nervous System) DAO for community governance. |

**Why not renounce immediately?** Premature controller renunciation risks permanent fund lockup if a critical bug is discovered. The current phase prioritizes code transparency and on-chain enforcement while retaining the ability to patch vulnerabilities.

> **Disclaimer**: This protocol's source code is publicly available. The operator does not exercise the authority to modify or manipulate the automatic distribution logic defined by the smart contract without individual user consent under normal operations. (本プロトコルのソースコードは公開されており、運営者はスマートコントラクトによって定義された自動分配ロジックを、ユーザーの個別の同意なく変更・操作する権限を（通常運用において）行使しません。)

---

## FAQ

### Do I need cryptocurrency to use Aegis?

**No.** Content filtering (both Lite and Pro modes) works without any crypto, wallet, or deposit. D2A exchanges between trusted peers (Nostr follow graph) are also free. You only need ICP for publishing quality signals or D2A exchanges with unknown peers.

### Is Aegis expensive to run?

**Lite mode costs nothing** — it runs entirely client-side with heuristic scoring (no API calls).

Pro mode uses the multi-tier AI scoring pipeline. WebLLM (Tier 1, when enabled) and IC LLM (Tier 3) are both free. BYOK users (Tier 2) pay their own Claude API costs (~$0.01/day, ~50 articles/day). The server-side Claude key (Tier 3.5) is free during alpha; after alpha, it will move to a Pro subscription plan. You can also bring your own API key (Settings > AI Scoring) — roughly $2/month for typical usage.

### Why not just use a P2P small-world network?

You can — that's exactly what **Lite mode** does. Nostr's Web of Trust is a small-world network, and Lite mode filters content purely through trust-graph proximity. No AI, no API calls, no cost.

**Pro mode adds** what P2P alone cannot do:
- Discover quality content *outside* your follow graph (serendipity detection)
- Evaluate content across languages
- Detect quality degradation trends
- Break out of echo chambers with scored recommendations

### What happens to my deposit if I publish bad signals?

If your published signals are consistently rated as low-quality by the community (3+ flags reach consensus), your deposit is forfeited. This creates a direct economic incentive to only publish genuine quality signals. Deposits that receive no community verdict within 30 days are automatically returned — no verdict means no issue found.

### Do I need a deposit to publish signals?

**Not initially.** New users can publish signals freely. A deposit is only required if your signals are repeatedly rated as low-quality by the network. Think of it as a spam prevention measure — good publishers never need to deposit. Reputation recovers naturally over time (+1 per week of inactivity).

### Do I need to deposit ICP before I can use Aegis?

**No.** You can browse, filter, score, curate content, and publish signals indefinitely without any deposit. Deposits are only triggered as an anti-spam measure for publishers whose signals are consistently flagged.

## License

MIT
