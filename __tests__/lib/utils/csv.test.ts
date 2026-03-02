import { csvEscape, contentToCSV } from "@/lib/utils/csv";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "csv-1",
    owner: "owner-1",
    author: "Author Name",
    avatar: "",
    text: "Test content",
    source: "rss",
    sourceUrl: "https://example.com",
    timestamp: "2h ago",
    scores: { originality: 7, insight: 8, credibility: 6, composite: 7.5 },
    verdict: "quality",
    reason: "Good analysis",
    createdAt: 1704067200000,
    validated: true,
    flagged: false,
    topics: ["tech", "ai"],
    vSignal: 8.0,
    cContext: 6.5,
    lSlop: 1.2,
    ...overrides,
  };
}

describe("csvEscape", () => {
  it("returns plain string unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("wraps string with commas in quotes", () => {
    expect(csvEscape("hello, world")).toBe('"hello, world"');
  });

  it("wraps string with newlines in quotes", () => {
    expect(csvEscape("hello\nworld")).toBe('"hello\nworld"');
  });

  it("wraps string with carriage return in quotes", () => {
    expect(csvEscape("hello\rworld")).toBe('"hello\rworld"');
  });

  it("escapes double quotes by doubling them", () => {
    expect(csvEscape('say "hello"')).toBe('"say ""hello"""');
  });

  it("handles string with both commas and quotes", () => {
    expect(csvEscape('value "A", value "B"')).toBe('"value ""A"", value ""B"""');
  });

  it("returns empty string unchanged", () => {
    expect(csvEscape("")).toBe("");
  });

  it("returns string without special chars unchanged", () => {
    expect(csvEscape("simple text 123")).toBe("simple text 123");
  });

  it("handles string with only quotes", () => {
    expect(csvEscape('"')).toBe('""""');
  });

  it("handles string with multiple newlines", () => {
    expect(csvEscape("a\nb\nc")).toBe('"a\nb\nc"');
  });
});

describe("contentToCSV", () => {
  it("returns header row for empty array", () => {
    const csv = contentToCSV([]);
    expect(csv.split("\n")).toHaveLength(1);
    expect(csv).toContain("id,author");
    expect(csv).toContain("composite");
    expect(csv).toContain("vSignal");
  });

  it("includes correct header columns", () => {
    const csv = contentToCSV([]);
    const header = csv.split("\n")[0];
    const cols = header.split(",");
    expect(cols).toContain("id");
    expect(cols).toContain("author");
    expect(cols).toContain("source");
    expect(cols).toContain("verdict");
    expect(cols).toContain("composite");
    expect(cols).toContain("originality");
    expect(cols).toContain("insight");
    expect(cols).toContain("credibility");
    expect(cols).toContain("vSignal");
    expect(cols).toContain("cContext");
    expect(cols).toContain("lSlop");
    expect(cols).toContain("topics");
    expect(cols).toContain("text");
    expect(cols).toContain("reason");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("sourceUrl");
  });

  it("generates one data row per item", () => {
    const items = [makeItem(), makeItem({ id: "csv-2" })];
    const csv = contentToCSV(items);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it("includes item ID in first column", () => {
    const csv = contentToCSV([makeItem({ id: "test-id-123" })]);
    const row = csv.split("\n")[1];
    expect(row.startsWith("test-id-123,")).toBe(true);
  });

  it("includes scores in correct order", () => {
    const item = makeItem({
      scores: { originality: 1, insight: 2, credibility: 3, composite: 4 },
      vSignal: 5,
      cContext: 6,
      lSlop: 7,
    });
    const csv = contentToCSV([item]);
    const row = csv.split("\n")[1];
    // composite,originality,insight,credibility,vSignal,cContext,lSlop
    expect(row).toContain("4,1,2,3,5,6,7");
  });

  it("uses empty string for undefined V/C/L", () => {
    const item = makeItem({ vSignal: undefined, cContext: undefined, lSlop: undefined });
    const csv = contentToCSV([item]);
    const row = csv.split("\n")[1];
    // After credibility score, should have ,,, for empty vSignal/cContext/lSlop
    expect(row).toContain(",,,");
  });

  it("joins topics with semicolons", () => {
    const item = makeItem({ topics: ["tech", "ai", "crypto"] });
    const csv = contentToCSV([item]);
    const row = csv.split("\n")[1];
    expect(row).toContain("tech;ai;crypto");
  });

  it("handles empty topics array", () => {
    const item = makeItem({ topics: [] });
    const csv = contentToCSV([item]);
    const row = csv.split("\n")[1];
    // Empty topics → empty field (no semicolons), row still valid CSV
    expect(row).toBeDefined();
    expect(row.split(",").length).toBeGreaterThanOrEqual(5);
    // Should not contain any topic content
    expect(row).not.toContain("tech;");
  });

  it("handles undefined topics", () => {
    const item = makeItem({ topics: undefined });
    const csv = contentToCSV([item]);
    const row = csv.split("\n")[1];
    // Undefined topics → empty field, row still valid CSV
    expect(row).toBeDefined();
    expect(row.split(",").length).toBeGreaterThanOrEqual(5);
  });

  it("escapes text with commas", () => {
    const item = makeItem({ text: "Hello, world" });
    const csv = contentToCSV([item]);
    const row = csv.split("\n")[1];
    expect(row).toContain('"Hello, world"');
  });

  it("escapes author with special characters", () => {
    const item = makeItem({ author: 'John "JD" Doe' });
    const csv = contentToCSV([item]);
    const row = csv.split("\n")[1];
    expect(row).toContain('"John ""JD"" Doe"');
  });

  it("formats createdAt as ISO string", () => {
    const item = makeItem({ createdAt: 1704067200000 });
    const csv = contentToCSV([item]);
    const row = csv.split("\n")[1];
    expect(row).toContain("2024-01-01T");
  });

  it("handles empty text and reason", () => {
    const item = makeItem({ text: "", reason: "" });
    const csv = contentToCSV([item]);
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("handles missing sourceUrl", () => {
    const item = makeItem({ sourceUrl: undefined });
    const csv = contentToCSV([item]);
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("produces parseable CSV format", () => {
    const items = [
      makeItem({ id: "a", text: "Simple text", author: "Alice" }),
      makeItem({ id: "b", text: "Text with, comma", author: "Bob" }),
    ];
    const csv = contentToCSV(items);
    const lines = csv.split("\n");
    // All rows should have same number of commas (accounting for quoted fields)
    expect(lines.length).toBe(3);
  });
});
