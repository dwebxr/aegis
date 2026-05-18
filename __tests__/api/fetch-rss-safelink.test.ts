/**
 * RSS link sanitisation — codex finding #12. Malicious feeds can return
 * `<link>javascript:alert(1)</link>` which, rendered as `<a href={link}>`,
 * executes script on click. The route normalises to "" for any non-http(s)
 * scheme so the UI can fall back to a non-anchor render.
 *
 * Tested directly via the exported helper to exercise real parsing logic
 * instead of mocking through the whole RSS pipeline.
 */
import { safeRssLink } from "@/app/api/fetch/rss/safeRssLink";

describe("safeRssLink — accepts safe http(s) links", () => {
  it.each([
    "http://example.com/post",
    "https://news.ycombinator.com/item?id=1",
    "https://example.com/path?q=日本語",
    "https://example.com/p#frag",
    "HTTPS://EXAMPLE.COM/upper", // URL normalises scheme to lowercase
  ])("accepts %s", (link) => {
    expect(safeRssLink(link)).toBe(link);
  });
});

describe("safeRssLink — rejects unsafe protocols", () => {
  it.each([
    "javascript:alert(1)",
    "javascript:void(0)",
    "JAVASCRIPT:alert(1)", // case-insensitive scheme bypass
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "mailto:victim@example.com",
    "about:blank",
    "blob:https://example.com/abc",
  ])("rejects %s", (link) => {
    expect(safeRssLink(link)).toBe("");
  });
});

describe("safeRssLink — invalid inputs", () => {
  it.each([
    ["empty string", ""],
    ["whitespace-only", "   "],
    ["relative path", "/relative/path"],
    ["scheme-relative", "//example.com/path"],
    ["not a URL", "just some text"],
  ])("rejects %s", (_label, input) => {
    expect(safeRssLink(input)).toBe("");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["object", { url: "https://example.com" }],
    ["array", ["https://example.com"]],
    ["boolean", true],
  ])("rejects non-string %s", (_label, input) => {
    expect(safeRssLink(input)).toBe("");
  });
});

describe("safeRssLink — defense against scheme smuggling", () => {
  it("rejects javascript: with leading whitespace (URL parser tolerates it)", () => {
    // The URL constructor trims leading/trailing C0 whitespace before parsing
    // the scheme, so " javascript:..." parses as javascript: — must still reject.
    expect(safeRssLink(" javascript:alert(1)")).toBe("");
    expect(safeRssLink("\tjavascript:alert(1)")).toBe("");
    expect(safeRssLink("\njavascript:alert(1)")).toBe("");
  });

  it("rejects mixed-case scheme variants", () => {
    expect(safeRssLink("JaVaScRiPt:alert(1)")).toBe("");
  });

  it("rejects URLs with non-http(s) scheme even if host part looks normal", () => {
    expect(safeRssLink("javascript://example.com/%0Aalert(1)")).toBe("");
  });
});
