import { test, expect } from "../fixtures/base";
import { QUALITY_TEXT, SLOP_TEXT } from "../fixtures/test-data";

test.describe("Incinerator - Manual Analysis", () => {
  test("displays Slop Incinerator heading", async ({ incineratorPage }) => {
    await expect(incineratorPage.heading).toContainText("Slop Incinerator");
  });

  test("shows textarea with placeholder", async ({ incineratorPage }) => {
    await expect(incineratorPage.textarea).toBeVisible();
    await expect(incineratorPage.textarea).toHaveAttribute(
      "placeholder",
      "Paste content here for AI quality analysis...",
    );
  });

  test("Analyze button is disabled when textarea is empty", async ({ incineratorPage }) => {
    await expect(incineratorPage.analyzeButton).toBeVisible();
    // Button should have opacity 0.5 (disabled state) or be actually disabled
    await expect(incineratorPage.analyzeButton).toBeDisabled();
  });

  test("typing text enables the Analyze button", async ({ incineratorPage }) => {
    await incineratorPage.textarea.fill("Some text to analyze");
    await expect(incineratorPage.analyzeButton).toBeEnabled();
  });

  test("analyzing quality text shows Quality verdict", async ({ incineratorPage }) => {
    await incineratorPage.analyze(QUALITY_TEXT);
    const verdict = await incineratorPage.getVerdict();
    expect(verdict).toBe("Quality");
  });

  test("analyzing slop text shows Slop verdict", async ({ incineratorPage }) => {
    await incineratorPage.analyze(SLOP_TEXT);
    const verdict = await incineratorPage.getVerdict();
    expect(verdict).toBe("Slop");
  });

  test("result shows score bars after analysis", async ({ incineratorPage }) => {
    await incineratorPage.analyze(QUALITY_TEXT);
    const result = incineratorPage.resultContainer;
    await expect(result.getByText("Originality")).toBeVisible();
    await expect(result.getByText("Insight")).toBeVisible();
    await expect(result.getByText("Credibility")).toBeVisible();
  });
});
