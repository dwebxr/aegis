/** Static mock data for E2E tests */
import type { ContentItem } from "../../lib/types/content";

export const MOCK_ANALYZE_QUALITY = {
  originality: 7,
  insight: 8,
  credibility: 7,
  composite: 7.3,
  verdict: "quality" as const,
  reason: "Well-sourced analysis with original data points",
  vSignal: 7.5,
  cContext: 6.8,
  lSlop: 1.5,
  topics: ["technology", "AI"],
  scoredByAI: true,
  scoringEngine: "heuristic",
  tier: "heuristic" as const,
};

export const MOCK_ANALYZE_SLOP = {
  originality: 2,
  insight: 3,
  credibility: 3,
  composite: 2.5,
  verdict: "slop" as const,
  reason: "Shallow aggregation with no original analysis",
  vSignal: 2.0,
  cContext: 3.0,
  lSlop: 7.5,
  topics: ["general"],
  scoredByAI: true,
  scoringEngine: "heuristic",
  tier: "heuristic" as const,
};

export const MOCK_RSS_RESPONSE = {
  feedTitle: "Mock Tech Feed",
  items: [
    {
      title: "Advances in Transformer Architecture for Edge Devices",
      content:
        "Researchers have developed a novel approach to running large language models on edge devices with minimal memory footprint. The technique uses dynamic quantization and pruning to reduce model size by 90% while maintaining 95% of the original accuracy. This breakthrough enables real-time AI inference on smartphones and IoT devices without cloud connectivity.",
      link: "https://example.com/transformers-edge",
      author: "Dr. Sarah Chen",
      publishedDate: "2025-01-15",
    },
    {
      title: "10 AMAZING AI Tools You MUST Try!!!",
      content: "Check out these cool AI tools!",
      link: "https://example.com/clickbait",
      author: "Content Mill",
      publishedDate: "2025-01-14",
    },
    {
      title: "Zero-Knowledge Proofs for Supply Chain Verification",
      content:
        "A new protocol uses ZK-SNARKs to verify supply chain provenance without revealing proprietary manufacturing data. The system has been piloted with three Fortune 500 companies, reducing audit costs by 60% while improving compliance rates. The open-source implementation is available on GitHub.",
      link: "https://example.com/zk-supply-chain",
      author: "Alex Rivera",
      publishedDate: "2025-01-13",
    },
  ],
};

export const MOCK_URL_RESPONSE = {
  title: "Test Article",
  content: "This is a detailed test article about technology and AI advancements in 2025.",
  author: "Test Author",
  url: "https://example.com/test-article",
};

export const MOCK_HEALTH_RESPONSE = {
  status: "ok",
  timestamp: new Date().toISOString(),
  version: "test-sha",
  region: "test",
  checks: {
    anthropicKey: "configured",
    icCanister: "reachable",
  },
};

export const QUALITY_TEXT =
  "Researchers at MIT have published a groundbreaking study on federated learning that achieves state-of-the-art results while preserving differential privacy guarantees. The paper introduces a novel aggregation protocol that reduces communication overhead by 75% compared to existing approaches, making it practical for deployment across thousands of edge devices. The technique has been validated on medical imaging datasets across 12 hospitals.";

export const SLOP_TEXT = "WOW check this out!!!";

/** Pre-scored content items for dashboard content card tests. */
export const MOCK_CONTENT_ITEMS: ContentItem[] = [
  {
    id: "e2e-quality-1",
    owner: "e2e-test",
    author: "Dr. Sarah Chen",
    avatar: "",
    text: "Researchers have developed a novel approach to running large language models on edge devices.",
    source: "rss" as const,
    sourceUrl: "https://example.com/transformers-edge",
    scores: { originality: 8, insight: 7, credibility: 8, composite: 7.7 },
    verdict: "quality" as const,
    reason: "Well-sourced research with novel approach and measurable results",
    createdAt: Date.now() - 60_000,
    validated: false,
    flagged: false,
    timestamp: new Date().toISOString(),
    topics: ["AI", "edge computing"],
    vSignal: 7.5,
    cContext: 6.8,
    lSlop: 1.5,
    scoredByAI: true,
    scoringEngine: "heuristic",
  },
  {
    id: "e2e-slop-1",
    owner: "e2e-test",
    author: "Content Mill",
    avatar: "",
    text: "10 AMAZING AI Tools You MUST Try!!!",
    source: "rss" as const,
    sourceUrl: "https://example.com/clickbait",
    scores: { originality: 2, insight: 1, credibility: 2, composite: 1.7 },
    verdict: "slop" as const,
    reason: "Clickbait title with no substantive analysis",
    createdAt: Date.now() - 120_000,
    validated: false,
    flagged: false,
    timestamp: new Date().toISOString(),
    topics: ["general"],
    vSignal: 2.0,
    cContext: 3.0,
    lSlop: 8.0,
    scoredByAI: true,
    scoringEngine: "heuristic",
  },
];

/**
 * A mediocre-but-not-slop item that lands in the Briefing's "Filtered Out" list.
 *
 * The Briefing only sees items that survive the filter pipeline
 * (lib/filtering/pipeline.ts burns anything with composite < qualityThreshold, 4.0 by
 * default — so `e2e-slop-1` at 1.7 never reaches BriefingTab). Surviving items are
 * re-weighted by WoT trust (composite x 0.75 with no graph), and generateBriefing applies
 * the same 4.0 threshold to the weighted score. 4.6 passes the burn (4.6 >= 4.0) but
 * weights to 3.45 < 4.0, so it is excluded from the priority list and shows up only
 * behind the "Filtered Out" toggle.
 */
export const MOCK_FILTERED_ITEM: ContentItem = {
  id: "e2e-filtered-1",
  owner: "e2e-test",
  author: "Jordan Lee",
  avatar: "",
  text: "A quick roundup of this week's AI model releases, with links to the announcement posts.",
  source: "rss" as const,
  sourceUrl: "https://example.com/weekly-ai-roundup",
  scores: { originality: 5, insight: 4, credibility: 5, composite: 4.6 },
  verdict: "quality" as const,
  reason: "Useful aggregation but little original analysis",
  createdAt: Date.now() - 180_000,
  validated: false,
  flagged: false,
  timestamp: new Date().toISOString(),
  topics: ["AI"],
  vSignal: 4.5,
  cContext: 4.0,
  lSlop: 4.0,
  scoredByAI: true,
  scoringEngine: "heuristic",
};

/** Seed for the authenticated Briefing: one priority item, one burned slop item, one filtered-out item. */
export const MOCK_BRIEFING_CONTENT_ITEMS: ContentItem[] = [...MOCK_CONTENT_ITEMS, MOCK_FILTERED_ITEM];
