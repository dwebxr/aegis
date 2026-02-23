/** Static mock data for E2E tests */

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
