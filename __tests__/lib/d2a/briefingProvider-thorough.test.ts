/**
 * Thorough tests for briefingProvider — covers getLatestBriefing validation,
 * getGlobalBriefingSummaries aggregation, malformed JSON, and edge cases.
 */

import { Principal } from "@dfinity/principal";

// Mock IC agent/actor
const mockGetLatestBriefing = jest.fn();
const mockGetGlobalBriefingSummaries = jest.fn();
const mockCreateActor = jest.fn().mockReturnValue({
  getLatestBriefing: mockGetLatestBriefing,
  getGlobalBriefingSummaries: mockGetGlobalBriefingSummaries,
});

jest.mock("@dfinity/agent", () => ({
  HttpAgent: { create: jest.fn().mockResolvedValue({}) },
  Actor: { createActor: () => mockCreateActor() },
}));
jest.mock("@/lib/ic/declarations/idlFactory", () => ({ idlFactory: {} }));
jest.mock("@/lib/ic/agent", () => ({
  getCanisterId: () => "rrkah-fqaaa-aaaaa-aaaaq-cai",
  getHost: () => "https://icp-api.io",
}));

import { getLatestBriefing, getGlobalBriefingSummaries } from "@/lib/d2a/briefingProvider";

beforeEach(() => {
  mockGetLatestBriefing.mockReset();
  mockGetGlobalBriefingSummaries.mockReset();
  jest.spyOn(console, "warn").mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getLatestBriefing", () => {
  it("returns null for empty principalText", async () => {
    expect(await getLatestBriefing()).toBeNull();
    expect(await getLatestBriefing("")).toBeNull();
  });

  it("returns null when canister returns empty array", async () => {
    mockGetLatestBriefing.mockResolvedValue([]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });

  it("parses valid briefing JSON", async () => {
    const briefing = {
      generatedAt: "2024-01-01T00:00:00Z",
      summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
      items: [{ title: "Test", topics: ["ai"], briefingScore: 8, verdict: "quality" }],
      meta: { topics: ["ai"] },
    };
    mockGetLatestBriefing.mockResolvedValue([JSON.stringify(briefing)]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).not.toBeNull();
    expect(result!.summary.totalEvaluated).toBe(10);
    expect(result!.items).toHaveLength(1);
  });

  it("returns null for malformed JSON string", async () => {
    mockGetLatestBriefing.mockResolvedValue(["{{{invalid"]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });

  it("returns null for JSON missing generatedAt", async () => {
    const briefing = {
      summary: { totalEvaluated: 10 },
      items: [],
      meta: { topics: [] },
    };
    mockGetLatestBriefing.mockResolvedValue([JSON.stringify(briefing)]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });

  it("returns null for JSON missing summary.totalEvaluated", async () => {
    const briefing = {
      generatedAt: "2024-01-01",
      summary: {},
      items: [],
      meta: { topics: [] },
    };
    mockGetLatestBriefing.mockResolvedValue([JSON.stringify(briefing)]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });

  it("returns null for JSON with non-array items", async () => {
    const briefing = {
      generatedAt: "2024-01-01",
      summary: { totalEvaluated: 5 },
      items: "not-array",
      meta: { topics: [] },
    };
    mockGetLatestBriefing.mockResolvedValue([JSON.stringify(briefing)]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });

  it("returns null for JSON with non-array meta.topics", async () => {
    const briefing = {
      generatedAt: "2024-01-01",
      summary: { totalEvaluated: 5 },
      items: [],
      meta: { topics: "not-array" },
    };
    mockGetLatestBriefing.mockResolvedValue([JSON.stringify(briefing)]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });

  it("returns null for null JSON value", async () => {
    mockGetLatestBriefing.mockResolvedValue([JSON.stringify(null)]);
    const result = await getLatestBriefing("aaaaa-aa");
    expect(result).toBeNull();
  });
});

describe("getGlobalBriefingSummaries", () => {
  function makePrincipal(text: string) {
    return { toText: () => text } as unknown as Principal;
  }

  function makeValidBriefing(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      generatedAt: "2024-01-01T00:00:00Z",
      summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
      items: [
        { title: "Article A", topics: ["ai", "ml"], briefingScore: 8, verdict: "quality" },
        { title: "Article B", topics: ["crypto"], briefingScore: 6, verdict: "quality" },
      ],
      meta: { topics: ["ai", "ml", "crypto"] },
      ...overrides,
    });
  }

  it("returns null when no items and total is 0", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({ items: [], total: BigInt(0) });
    const result = await getGlobalBriefingSummaries();
    expect(result).toBeNull();
  });

  it("returns global response with correct structure", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [
        [makePrincipal("user-1"), makeValidBriefing(), BigInt(1700000000000000)],
      ],
      total: BigInt(1),
    });
    const result = await getGlobalBriefingSummaries();
    expect(result).not.toBeNull();
    expect(result!.version).toBe("1.0");
    expect(result!.type).toBe("global");
    expect(result!.contributors).toHaveLength(1);
    expect(result!.pagination).toEqual({ offset: 0, limit: 5, total: 1, hasMore: false });
  });

  it("aggregates topics across multiple contributors", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [
        [makePrincipal("user-1"), makeValidBriefing(), BigInt(0)],
        [
          makePrincipal("user-2"),
          JSON.stringify({
            summary: { totalEvaluated: 5, totalBurned: 1 },
            items: [{ title: "X", topics: ["defi", "ai"], briefingScore: 7, verdict: "quality" }],
            meta: { topics: ["defi"] },
          }),
          BigInt(0),
        ],
      ],
      total: BigInt(2),
    });
    const result = await getGlobalBriefingSummaries();
    expect(result!.aggregatedTopics).toContain("ai");
    expect(result!.aggregatedTopics).toContain("defi");
    // Topics sorted by frequency — ai appears in both contributors
    expect(result!.aggregatedTopics[0]).toBe("ai");
  });

  it("computes totalEvaluated and totalQualityRate across contributors", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [
        [makePrincipal("u1"), makeValidBriefing(), BigInt(0)],  // 10 evaluated, 2 burned → 8 quality
        [
          makePrincipal("u2"),
          JSON.stringify({
            summary: { totalEvaluated: 20, totalBurned: 10 },
            items: [],
            meta: { topics: [] },
          }),
          BigInt(0),
        ],  // 20 evaluated, 10 burned → 10 quality
      ],
      total: BigInt(2),
    });
    const result = await getGlobalBriefingSummaries();
    expect(result!.totalEvaluated).toBe(30);
    // Quality = (8 + 10) / 30 = 0.6
    expect(result!.totalQualityRate).toBe(0.6);
  });

  it("limits topItems to MAX_TOP_ITEMS (3)", async () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      title: `Item ${i}`, topics: ["t"], briefingScore: i, verdict: "quality" as const,
    }));
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [
        [makePrincipal("u1"), JSON.stringify({
          summary: { totalEvaluated: 10 },
          items: manyItems,
          meta: { topics: [] },
        }), BigInt(0)],
      ],
      total: BigInt(1),
    });
    const result = await getGlobalBriefingSummaries();
    expect(result!.contributors[0].topItems).toHaveLength(3);
  });

  it("skips malformed briefings and logs warning", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [
        [makePrincipal("good"), makeValidBriefing(), BigInt(0)],
        [makePrincipal("bad"), "{{{invalid", BigInt(0)],
        [makePrincipal("missing-summary"), JSON.stringify({ items: [] }), BigInt(0)],
      ],
      total: BigInt(3),
    });
    const result = await getGlobalBriefingSummaries();
    expect(result!.contributors).toHaveLength(1);
    expect(result!.contributors[0].principal).toBe("good");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to parse global briefing"));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipped malformed briefing"),
      expect.any(String),
    );
  });

  it("uses bigint generatedAt converted to ISO string", async () => {
    // 1700000000 seconds = Nov 2023 → in nanoseconds for IC
    const tsNs = BigInt(1700000000) * BigInt(1_000_000_000);
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[makePrincipal("u1"), makeValidBriefing(), tsNs]],
      total: BigInt(1),
    });
    const result = await getGlobalBriefingSummaries();
    const date = new Date(result!.contributors[0].generatedAt);
    expect(date.getFullYear()).toBe(2023);
  });

  it("falls back to parsed.generatedAt for non-bigint timestamp", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[makePrincipal("u1"), makeValidBriefing(), "not-bigint"]],
      total: BigInt(1),
    });
    const result = await getGlobalBriefingSummaries();
    expect(result!.contributors[0].generatedAt).toBe("2024-01-01T00:00:00Z");
  });

  it("handles items with missing topics gracefully", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[
        makePrincipal("u1"),
        JSON.stringify({
          summary: { totalEvaluated: 5 },
          items: [
            { title: "No topics", briefingScore: 5, verdict: "quality" },
            { title: "With topics", topics: ["ai"], briefingScore: 7, verdict: "quality" },
          ],
          meta: { topics: [] },
        }),
        BigInt(0),
      ]],
      total: BigInt(1),
    });
    const result = await getGlobalBriefingSummaries();
    expect(result!.aggregatedTopics).toContain("ai");
    expect(result!.contributors[0].topItems).toHaveLength(2);
  });

  it("respects offset and limit parameters", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({ items: [], total: BigInt(10) });
    await getGlobalBriefingSummaries(5, 3);
    expect(mockGetGlobalBriefingSummaries).toHaveBeenCalledWith(BigInt(5), BigInt(3));
  });

  it("handles totalBurned being undefined (missing field)", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[
        makePrincipal("u1"),
        JSON.stringify({
          summary: { totalEvaluated: 10 },
          items: [],
          meta: { topics: [] },
        }),
        BigInt(0),
      ]],
      total: BigInt(1),
    });
    const result = await getGlobalBriefingSummaries();
    // totalBurned undefined → treated as 0 → all quality
    expect(result!.totalQualityRate).toBe(1);
  });

  it("aggregatedTopics limited to 20", async () => {
    const topics = Array.from({ length: 30 }, (_, i) => `topic-${i}`);
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[
        makePrincipal("u1"),
        JSON.stringify({
          summary: { totalEvaluated: 5 },
          items: [],
          meta: { topics },
        }),
        BigInt(0),
      ]],
      total: BigInt(1),
    });
    const result = await getGlobalBriefingSummaries();
    expect(result!.aggregatedTopics.length).toBeLessThanOrEqual(20);
  });
});
