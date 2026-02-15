import { buildScoringPrompt } from "@/lib/scoring/prompt";

describe("buildScoringPrompt", () => {
  it("returns a prompt containing V/C/L framework dimensions", () => {
    const prompt = buildScoringPrompt("Some test content");
    expect(prompt).toContain("vSignal");
    expect(prompt).toContain("cContext");
    expect(prompt).toContain("lSlop");
    expect(prompt).toContain("originality");
    expect(prompt).toContain("insight");
    expect(prompt).toContain("credibility");
    expect(prompt).toContain("composite");
  });

  it("includes user topics when provided", () => {
    const prompt = buildScoringPrompt("Content", ["ai", "crypto"]);
    expect(prompt).toContain("ai, crypto");
  });

  it("uses 'general' when no topics provided", () => {
    const prompt = buildScoringPrompt("Content");
    expect(prompt).toContain("User interests: general");
  });

  it("uses 'general' when topics array is empty", () => {
    const prompt = buildScoringPrompt("Content", []);
    expect(prompt).toContain("User interests: general");
  });

  it("truncates content to maxContentLength", () => {
    const longText = "a".repeat(5000);
    const prompt = buildScoringPrompt(longText, undefined, 100);
    // The prompt should contain at most 100 'a' characters from the content
    const contentMatch = prompt.match(/Content: "(a+)"/);
    expect(contentMatch).toBeTruthy();
    expect(contentMatch![1].length).toBe(100);
  });

  it("defaults maxContentLength to 3000", () => {
    const longText = "b".repeat(5000);
    const prompt = buildScoringPrompt(longText);
    const contentMatch = prompt.match(/Content: "(b+)"/);
    expect(contentMatch).toBeTruthy();
    expect(contentMatch![1].length).toBe(3000);
  });

  it("includes JSON format instruction", () => {
    const prompt = buildScoringPrompt("Content");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("verdict");
  });

  it("handles content exactly at maxContentLength", () => {
    const text = "x".repeat(100);
    const prompt = buildScoringPrompt(text, undefined, 100);
    const contentMatch = prompt.match(/Content: "(x+)"/);
    expect(contentMatch).toBeTruthy();
    expect(contentMatch![1].length).toBe(100);
  });

  it("does not truncate content shorter than maxContentLength", () => {
    const text = "short";
    const prompt = buildScoringPrompt(text, undefined, 3000);
    expect(prompt).toContain('"short"');
  });

  it("includes all provided topics in prompt", () => {
    const topics = ["ai", "blockchain", "security"];
    const prompt = buildScoringPrompt("Content", topics);
    expect(prompt).toContain("ai, blockchain, security");
  });

  it("includes V/C/L composite formula", () => {
    const prompt = buildScoringPrompt("Content");
    expect(prompt).toContain("(vSignal * cContext) / (lSlop + 0.5)");
  });

  it("includes Slop Incinerator role", () => {
    const prompt = buildScoringPrompt("Content");
    expect(prompt).toContain("Slop Incinerator");
  });
});
