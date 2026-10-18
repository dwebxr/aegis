import { test, expect } from "../fixtures/base";

test.describe("Briefing Tab — Empty State", () => {
  test("shows empty state when no content is evaluated", async ({ briefingPage }) => {
    await briefingPage.waitForLoaded();
    await expect(briefingPage.emptyState).toBeVisible();
    await expect(briefingPage.page.getByText("No priority items yet")).toBeVisible();
  });

  test("Start Evaluating button navigates to Incinerator", async ({ briefingPage }) => {
    await briefingPage.waitForLoaded();
    const button = briefingPage.startEvalButton;
    await expect(button).toBeVisible();
    await button.click();
    await expect(briefingPage.page.getByTestId("aegis-incinerator-heading")).toBeVisible();
  });
});

test.describe("Briefing Tab — Authenticated", () => {
  test("shows Your Briefing heading", async ({ authBriefingPage }) => {
    await expect(authBriefingPage.heading).toBeVisible();
    await expect(authBriefingPage.heading).toContainText("Your Briefing");
  });

  test("shows insight count text with numeric values", async ({ authBriefingPage }) => {
    await expect(authBriefingPage.insightCount).toBeVisible();
    await expect(authBriefingPage.insightCount).toContainText(/insights selected from/);
    await expect(authBriefingPage.insightCount).toContainText(/\d/);
  });

  test("shows the seeded priority content list", async ({ authBriefingPage }) => {
    await expect(authBriefingPage.priorityList).toBeVisible();
  });

  test("Filtered Out toggle reveals the filtered content", async ({ authBriefingPage }) => {
    await expect(authBriefingPage.filteredToggle).toBeVisible();
    await expect(authBriefingPage.filteredToggle).toHaveAttribute("aria-expanded", "false");
    await authBriefingPage.filteredToggle.click();
    await expect(authBriefingPage.filteredToggle).toHaveAttribute("aria-expanded", "true");
    // e2e-filtered-1 passes the pipeline burn but misses the briefing threshold after
    // WoT weighting. The slop item is burned by the pipeline and never reaches this tab.
    await expect(authBriefingPage.page.locator('[id="card-e2e-filtered-1"]')).toBeVisible();
    await expect(authBriefingPage.page.locator('[id="card-e2e-slop-1"]')).toHaveCount(0);
  });

  test("heading persists after loading completes", async ({ authBriefingPage }) => {
    await authBriefingPage.waitForLoaded();
    await expect(authBriefingPage.heading).toBeVisible();
    await expect(authBriefingPage.heading).toContainText("Your Briefing");
  });

  test("insight count remains visible after filter toggle", async ({ authBriefingPage }) => {
    await authBriefingPage.waitForLoaded();
    await expect(authBriefingPage.insightCount).toBeVisible();
    await expect(authBriefingPage.filteredToggle).toBeVisible();
    await authBriefingPage.filteredToggle.click();
    await expect(authBriefingPage.filteredToggle).toHaveAttribute("aria-expanded", "true");
    await expect(authBriefingPage.insightCount).toBeVisible();
  });
});
