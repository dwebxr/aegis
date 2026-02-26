import { csvEscape, contentToCSV } from "@/lib/utils/csv";
import type { ContentItem } from "@/lib/types/content";

describe("csvEscape", () => {
  it("returns plain string as-is", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("wraps string containing comma in quotes", () => {
    expect(csvEscape("hello, world")).toBe('"hello, world"');
  });

  it("wraps string containing double quote and escapes it", () => {
    expect(csvEscape('say "hello"')).toBe('"say ""hello"""');
  });

  it("wraps string containing newline", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps string containing carriage return", () => {
    expect(csvEscape("line1\rline2")).toBe('"line1\rline2"');
  });

  it("handles string with all special chars (comma, quote, newline)", () => {
    expect(csvEscape('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  it("handles empty string", () => {
    expect(csvEscape("")).toBe("");
  });

  it("handles string with only a quote", () => {
    expect(csvEscape('"')).toBe('""""');
  });

  it("handles string with only a comma", () => {
    expect(csvEscape(",")).toBe('","');
  });

  it("handles unicode characters without wrapping", () => {
    expect(csvEscape("日本語テスト")).toBe("日本語テスト");
  });

  it("handles emoji without wrapping", () => {
    expect(csvEscape("Hello 🤖")).toBe("Hello 🤖");
  });

  it("handles very long string efficiently", () => {
    const long = "a".repeat(10000);
    expect(csvEscape(long)).toBe(long);
  });

  it("handles very long string with comma", () => {
    const long = "a".repeat(5000) + "," + "b".repeat(5000);
    const result = csvEscape(long);
    expect(result.startsWith('"')).toBe(true);
    expect(result.endsWith('"')).toBe(true);
  });
});

describe("contentToCSV", () => {
  const makeItem = (overrides: Partial<ContentItem> = {}): ContentItem => ({
    id: "item-1",
    owner: "",
    author: "Test Author",
    avatar: "",
    source: "manual",
    verdict: "quality",
    scores: { composite: 8.0, originality: 7, insight: 8, credibility: 9 },
    text: "Test content",
    reason: "Good quality",
    createdAt: 1700000000000,
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  });

  it("generates valid CSV header", () => {
    const csv = contentToCSV([]);
    expect(csv).toBe("id,author,source,verdict,composite,originality,insight,credibility,vSignal,cContext,lSlop,topics,text,reason,createdAt,validatedAt,sourceUrl");
  });

  it("generates one row per item", () => {
    const csv = contentToCSV([makeItem(), makeItem({ id: "item-2" })]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it("includes all score fields", () => {
    const csv = contentToCSV([makeItem({ scores: { composite: 8.5, originality: 7, insight: 9, credibility: 6 } })]);
    const row = csv.split("\n")[1];
    expect(row).toContain("8.5");
    expect(row).toContain(",7,");
    expect(row).toContain(",9,");
    expect(row).toContain(",6,");
  });

  it("includes V/C/L scores when present", () => {
    const csv = contentToCSV([makeItem({ vSignal: 8, cContext: 7, lSlop: 2 })]);
    const row = csv.split("\n")[1];
    expect(row).toContain(",8,7,2,");
  });

  it("leaves V/C/L empty when absent", () => {
    const csv = contentToCSV([makeItem()]);
    const row = csv.split("\n")[1];
    // After credibility (9), three empty fields (,,,,)
    expect(row).toContain(",9,,,,");
  });

  it("joins topics with semicolons", () => {
    const csv = contentToCSV([makeItem({ topics: ["ai", "ml", "web3"] })]);
    const row = csv.split("\n")[1];
    expect(row).toContain("ai;ml;web3");
  });

  it("escapes author names with commas", () => {
    const csv = contentToCSV([makeItem({ author: "Smith, John" })]);
    const row = csv.split("\n")[1];
    expect(row).toContain('"Smith, John"');
  });

  it("escapes text with newlines", () => {
    const csv = contentToCSV([makeItem({ text: "Line 1\nLine 2" })]);
    // The CSV output contains the escaped field with a literal newline inside quotes.
    // We can't use split("\n") to get the row since the newline is inside the field.
    expect(csv).toContain('"Line 1\nLine 2"');
    expect(csv.startsWith("id,author,source,")).toBe(true);
  });

  it("escapes reason with quotes", () => {
    const csv = contentToCSV([makeItem({ reason: 'Contains "air quotes"' })]);
    const row = csv.split("\n")[1];
    expect(row).toContain('""air quotes""');
  });

  it("handles empty text and reason", () => {
    const csv = contentToCSV([makeItem({ text: "", reason: "" })]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
  });

  it("formats createdAt as ISO date", () => {
    const csv = contentToCSV([makeItem({ createdAt: 1700000000000 })]);
    const row = csv.split("\n")[1];
    expect(row).toContain("2023-11-14T");
  });

  it("includes sourceUrl when present", () => {
    const csv = contentToCSV([makeItem({ sourceUrl: "https://example.com/article" })]);
    const row = csv.split("\n")[1];
    expect(row).toContain("https://example.com/article");
  });

  it("leaves sourceUrl empty when absent", () => {
    const csv = contentToCSV([makeItem()]);
    const row = csv.split("\n")[1];
    // sourceUrl is the last field; validatedAt (empty) comes before it
    expect(row).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z,,$/);
  });

  it("escapes sourceUrl containing commas", () => {
    const csv = contentToCSV([makeItem({ sourceUrl: "https://example.com/a,b?c=1,2" })]);
    const row = csv.split("\n")[1];
    expect(row).toContain('"https://example.com/a,b?c=1,2"');
  });

  it("each row has exactly 17 fields (matching header) even with commas in URL", () => {
    const csv = contentToCSV([makeItem({ topics: ["a", "b"], vSignal: 5, cContext: 6, lSlop: 1, sourceUrl: "https://example.com/a,b" })]);
    const header = csv.split("\n")[0];
    const headerFields = header.split(",").length;
    expect(headerFields).toBe(17);
    // Parse row properly: count commas outside quoted fields
    const row = csv.split("\n")[1];
    let inQuote = false;
    let fieldCount = 1;
    for (const ch of row) {
      if (ch === '"') inQuote = !inQuote;
      else if (ch === ',' && !inQuote) fieldCount++;
    }
    expect(fieldCount).toBe(17);
  });
});
