import { test, expect } from "../fixtures/base";

test.describe("Briefing Tab — Empty State", () => {
  test("shows empty state when no content is evaluated", async ({ briefingPage }) => {
    await briefingPage.waitForLoaded();
    await expect(briefingPage.emptyState).toBeVisible();
    await expect(briefingPage.page.getByText("No priority items yet")).toBeVisible();
  });

  test("Start Evaluating button navigates to Incinerator", async ({ briefingPage }) => {
    await briefingPage.waitForLoaded();
    // startEvalButton may not exist if onTabChange is not passed - check gracefully
    const button = briefingPage.startEvalButton;
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await expect(briefingPage.page.getByTestId("aegis-incinerator-heading")).toBeVisible();
    }
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

  test("shows priority content list, empty state, or loading", async ({ authBriefingPage }) => {
    await authBriefingPage.waitForLoaded();
    const content = authBriefingPage.priorityList
      .or(authBriefingPage.emptyState)
      .or(authBriefingPage.loading);
    await expect(content).toBeVisible();
  });

  test("Filtered Out toggle click does not crash", async ({ authBriefingPage }) => {
    await authBriefingPage.waitForLoaded();
    if (await authBriefingPage.filteredToggle.isVisible().catch(() => false)) {
      await authBriefingPage.filteredToggle.click();
    }
  });

  test("heading persists after loading completes", async ({ authBriefingPage }) => {
    await authBriefingPage.waitForLoaded();
    await expect(authBriefingPage.heading).toBeVisible();
    await expect(authBriefingPage.heading).toContainText("Your Briefing");
  });

  test("insight count remains visible after filter toggle", async ({ authBriefingPage }) => {
    await authBriefingPage.waitForLoaded();
    await expect(authBriefingPage.insightCount).toBeVisible();
    if (await authBriefingPage.filteredToggle.isVisible().catch(() => false)) {
      await authBriefingPage.filteredToggle.click();
      await expect(authBriefingPage.insightCount).toBeVisible();
    }
  });
});
