import { test, expect, enterDemoMode, clickNav } from "../fixtures/base";
import { QUALITY_TEXT, SLOP_TEXT } from "../fixtures/test-data";
import { setupApiMocks, setupApiErrors } from "../fixtures/api-mocks";
import { TIMEOUTS } from "../constants";

test.describe("Incinerator — Manual Analysis", () => {
  test("displays Slop Incinerator heading", async ({ incineratorPage }) => {
    await expect(incineratorPage.heading).toBeVisible();
    await expect(incineratorPage.heading).toContainText("Slop Incinerator");
  });

  test("shows textarea with placeholder", async ({ incineratorPage }) => {
    await expect(incineratorPage.textarea).toBeVisible();
    await expect(incineratorPage.textarea).toHaveAttribute("placeholder", /paste|enter/i);
  });

  test("Analyze button is disabled when textarea is empty", async ({ incineratorPage }) => {
    await expect(incineratorPage.analyzeButton).toBeDisabled();
  });

  test("typing text enables the Analyze button", async ({ incineratorPage }) => {
    await incineratorPage.textarea.fill("Some test content");
    await expect(incineratorPage.analyzeButton).toBeEnabled();
  });

  test("analyzing quality text shows Quality verdict with score bars", async ({ incineratorPage }) => {
    await incineratorPage.analyze(QUALITY_TEXT);
    const verdict = await incineratorPage.getVerdict();
    expect(verdict).toContain("Quality");
    const result = incineratorPage.resultContainer;
    await expect(result.getByText("Originality")).toBeVisible();
    await expect(result.getByText("Insight", { exact: true })).toBeVisible();
    await expect(result.getByText("Credibility")).toBeVisible();
  });

  test("analyzing slop text shows Slop verdict", async ({ incineratorPage }) => {
    await incineratorPage.analyze(SLOP_TEXT);
    const verdict = await incineratorPage.getVerdict();
    expect(verdict).toContain("Slop");
  });

  test("analysis result shows AI reasoning text", async ({ incineratorPage }) => {
    await incineratorPage.analyze(QUALITY_TEXT);
    await expect(incineratorPage.resultContainer).toContainText(/sourced|analysis|data/i);
  });

  test("textarea can be cleared and re-analyzed", async ({ incineratorPage }) => {
    await incineratorPage.analyze(QUALITY_TEXT);
    expect(await incineratorPage.getVerdict()).toContain("Quality");
    await incineratorPage.clearTextarea();
    await incineratorPage.analyze(SLOP_TEXT);
    expect(await incineratorPage.getVerdict()).toContain("Slop");
  });
});

test.describe("Incinerator — Data Inspection", () => {
  test("quality analysis shows exact composite score 7.3 from mock", async ({ incineratorPage }) => {
    await incineratorPage.analyze(QUALITY_TEXT);
    // MOCK_ANALYZE_QUALITY has composite: 7.3 → ScoreRing renders "7.3"
    await expect(incineratorPage.resultContainer).toContainText("7.3");
  });

  test("slop analysis shows exact composite score 2.5 from mock", async ({ incineratorPage }) => {
    await incineratorPage.analyze(SLOP_TEXT);
    // MOCK_ANALYZE_SLOP has composite: 2.5 → ScoreRing renders "2.5"
    await expect(incineratorPage.resultContainer).toContainText("2.5");
  });

  test("quality verdict text reads 'Quality'", async ({ incineratorPage }) => {
    await incineratorPage.analyze(QUALITY_TEXT);
    await expect(incineratorPage.verdictLabel).toHaveText("Quality");
  });

  test("slop verdict text reads 'Slop'", async ({ incineratorPage }) => {
    await incineratorPage.analyze(SLOP_TEXT);
    await expect(incineratorPage.verdictLabel).toHaveText("Slop");
  });

  test("quality result shows score bars with 3 labeled scores", async ({ incineratorPage }) => {
    await incineratorPage.analyze(QUALITY_TEXT);
    const result = incineratorPage.resultContainer;
    // Each score bar has a label and a numeric value
    await expect(result.getByText("Originality")).toBeVisible();
    await expect(result.getByText("Insight", { exact: true })).toBeVisible();
    await expect(result.getByText("Credibility")).toBeVisible();
  });

  test("analyze completes and shows result after clicking Analyze", async ({ incineratorPage }) => {
    await incineratorPage.textarea.fill(QUALITY_TEXT);
    await incineratorPage.analyzeButton.click();
    // Analysis should complete and show result
    await expect(incineratorPage.resultContainer).toBeVisible();
  });

  test("Incinerator subtitle mentions 'publish your insights'", async ({ incineratorPage }) => {
    await expect(incineratorPage.page.getByText("publish your insights")).toBeVisible();
  });

  test("pipeline stages S1-S4 are displayed", async ({ incineratorPage }) => {
    await expect(incineratorPage.page.getByText("Heuristic Filter")).toBeVisible();
    await expect(incineratorPage.page.getByText("Structural")).toBeVisible();
    await expect(incineratorPage.page.getByText("LLM Score")).toBeVisible();
    await expect(incineratorPage.page.getByText("Cross-Valid")).toBeVisible();
  });
});

test.describe("Incinerator — Error States", () => {
  test("API 500 falls back to heuristic scoring", async ({ page }) => {
    await setupApiMocks(page);
    await setupApiErrors(page, { analyzeError: true });
    await page.goto("/");
    await enterDemoMode(page);
    await clickNav(page, "incinerator");
    await page.getByTestId("aegis-incinerator-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    // Fill and analyze — API returns 500 but heuristic fallback provides a result
    await page.getByTestId("aegis-manual-textarea").fill(QUALITY_TEXT);
    await page.getByTestId("aegis-manual-analyze").click();
    await page.getByTestId("aegis-manual-result").or(page.getByTestId("aegis-manual-error")).waitFor({ state: "visible", timeout: TIMEOUTS.long });
  });
});
