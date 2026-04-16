/**
 * Tests for getRawGlobalBriefings in briefingProvider.
 * Covers: sinceMs filtering, malformed JSON, timestamp conversion, edge cases.
 */
import { Principal } from "@dfinity/principal";

const mockGetGlobalBriefingSummaries = jest.fn();
const mockCreateActor = jest.fn().mockReturnValue({
  getLatestBriefing: jest.fn(),
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

import { getRawGlobalBriefings } from "@/lib/d2a/briefingProvider";

function makePrincipal(text: string) {
  return { toText: () => text } as unknown as Principal;
}

function makeValidJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: "1.0",
    generatedAt: "2026-03-20T12:00:00Z",
    source: "aegis",
    sourceUrl: "https://aegis.dwebxr.xyz",
    summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
    items: [
      { title: "Test", content: "Content", source: "rss", sourceUrl: "https://example.com", scores: { composite: 7 }, verdict: "quality", reason: "g", topics: ["AI"], briefingScore: 80 },
    ],
    serendipityPick: null,
    meta: { scoringModel: "vcl-v1", nostrPubkey: null, topics: ["AI"] },
    ...overrides,
  });
}

beforeEach(() => {
  mockGetGlobalBriefingSummaries.mockReset();
});

describe("getRawGlobalBriefings", () => {
  it("returns entries newer than sinceMs", async () => {
    const newTs = BigInt(1711000000000) * BigInt(1_000_000); // ~2024-03-21
    const oldTs = BigInt(1610000000000) * BigInt(1_000_000); // ~2021-01-07
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [
        [makePrincipal("new-user"), makeValidJson(), newTs],
        [makePrincipal("old-user"), makeValidJson(), oldTs],
      ],
      total: BigInt(2),
    });

    const entries = await getRawGlobalBriefings(1700000000000); // ~2023-11-15
    expect(entries).toHaveLength(1);
    expect(entries[0].generatedAtMs).toBe(1711000000000);
  });

  it("returns empty array when all entries are older than sinceMs", async () => {
    const oldTs = BigInt(1610000000000) * BigInt(1_000_000);
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[makePrincipal("u1"), makeValidJson(), oldTs]],
      total: BigInt(1),
    });
    const entries = await getRawGlobalBriefings(1700000000000);
    expect(entries).toHaveLength(0);
  });

  it("returns empty array when no items exist", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({ items: [], total: BigInt(0) });
    const entries = await getRawGlobalBriefings(0);
    expect(entries).toHaveLength(0);
  });

  it("skips entries with malformed JSON", async () => {
    const ts = BigInt(1711000000000) * BigInt(1_000_000);
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [
        [makePrincipal("good"), makeValidJson(), ts],
        [makePrincipal("bad"), "{{{invalid", ts],
      ],
      total: BigInt(2),
    });
    const entries = await getRawGlobalBriefings(0);
    expect(entries).toHaveLength(1);
    expect(entries[0].briefing.items).toHaveLength(1);
  });

  it("skips entries with non-array items field", async () => {
    const ts = BigInt(1711000000000) * BigInt(1_000_000);
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [
        [makePrincipal("bad"), JSON.stringify({ items: "not-array" }), ts],
      ],
      total: BigInt(1),
    });
    const entries = await getRawGlobalBriefings(0);
    expect(entries).toHaveLength(0);
  });

  it("skips entries where parsed is null", async () => {
    const ts = BigInt(1711000000000) * BigInt(1_000_000);
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [
        [makePrincipal("null"), "null", ts],
      ],
      total: BigInt(1),
    });
    const entries = await getRawGlobalBriefings(0);
    expect(entries).toHaveLength(0);
  });

  it("converts bigint nanosecond timestamp to milliseconds", async () => {
    const tsNs = BigInt(1711000000000) * BigInt(1_000_000); // ns
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[makePrincipal("u1"), makeValidJson(), tsNs]],
      total: BigInt(1),
    });
    const entries = await getRawGlobalBriefings(0);
    expect(entries[0].generatedAtMs).toBe(1711000000000);
  });

  it("falls back to parsed.generatedAt when bigint timestamp is 0", async () => {
    const generatedAt = "2026-03-20T12:00:00Z";
    const generatedAtMs = new Date(generatedAt).getTime();
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[
        makePrincipal("u1"),
        makeValidJson({ generatedAt }),
        BigInt(0),
      ]],
      total: BigInt(1),
    });
    // sinceMs before the parsed generatedAt — entry should be included via fallback
    const entries = await getRawGlobalBriefings(generatedAtMs - 1000);
    expect(entries).toHaveLength(1);
    expect(entries[0].generatedAtMs).toBe(generatedAtMs);
  });

  it("handles non-bigint timestamp type by falling back to parsed.generatedAt", async () => {
    const generatedAt = "2026-03-20T12:00:00Z";
    const generatedAtMs = new Date(generatedAt).getTime();
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[
        makePrincipal("u1"),
        makeValidJson({ generatedAt }),
        "not-bigint" as unknown as bigint,
      ]],
      total: BigInt(1),
    });
    // Falls back to parsed.generatedAt, then filters against sinceMs
    const entries = await getRawGlobalBriefings(generatedAtMs - 1000);
    expect(entries).toHaveLength(1);
    expect(entries[0].generatedAtMs).toBe(generatedAtMs);
  });

  it("requests up to 100 entries from canister", async () => {
    mockGetGlobalBriefingSummaries.mockResolvedValue({ items: [], total: BigInt(0) });
    await getRawGlobalBriefings(0);
    expect(mockGetGlobalBriefingSummaries).toHaveBeenCalledWith(BigInt(0), BigInt(100));
  });

  it("preserves full briefing data in entries", async () => {
    const tsNs = BigInt(1711000000000) * BigInt(1_000_000);
    const json = makeValidJson({ meta: { scoringModel: "test-model", nostrPubkey: "abc", topics: ["X"] } });
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[makePrincipal("u1"), json, tsNs]],
      total: BigInt(1),
    });
    const entries = await getRawGlobalBriefings(0);
    expect(entries[0].briefing.meta.scoringModel).toBe("test-model");
    expect(entries[0].briefing.items[0].title).toBe("Test");
  });

  it("filters at exact boundary: generatedAtMs == sinceMs is excluded", async () => {
    const exactMs = 1711000000000;
    const tsNs = BigInt(exactMs) * BigInt(1_000_000);
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[makePrincipal("u1"), makeValidJson(), tsNs]],
      total: BigInt(1),
    });
    const entries = await getRawGlobalBriefings(exactMs);
    expect(entries).toHaveLength(0); // <= means equal is excluded
  });

  it("includes entry 1ms after sinceMs", async () => {
    const sinceMs = 1711000000000;
    const tsNs = BigInt(sinceMs + 1) * BigInt(1_000_000);
    mockGetGlobalBriefingSummaries.mockResolvedValue({
      items: [[makePrincipal("u1"), makeValidJson(), tsNs]],
      total: BigInt(1),
    });
    const entries = await getRawGlobalBriefings(sinceMs);
    expect(entries).toHaveLength(1);
  });
});
