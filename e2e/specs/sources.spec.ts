import { test, expect } from "../fixtures/base";

test.describe("Sources Tab", () => {
  test("displays Content Sources heading", async ({ sourcesPage }) => {
    await expect(sourcesPage.heading).toContainText("Content Sources");
  });

  test("shows source type tabs", async ({ sourcesPage }) => {
    await expect(sourcesPage.page.getByRole("button", { name: "URL" })).toBeVisible();
    await expect(sourcesPage.page.getByRole("button", { name: "RSS" })).toBeVisible();
    await expect(sourcesPage.page.getByRole("button", { name: /X \(Twitter\)/ })).toBeVisible();
    await expect(sourcesPage.page.getByRole("button", { name: "Nostr" })).toBeVisible();
  });

  test("shows Popular Sources catalog", async ({ sourcesPage }) => {
    await expect(sourcesPage.popularSources()).toBeVisible();
  });

  test("demo mode shows read-only banner", async ({ sourcesPage }) => {
    await expect(sourcesPage.demoReadOnlyBanner()).toBeVisible();
  });

  test("RSS tab shows Quick Add presets", async ({ sourcesPage }) => {
    // Switch to RSS tab to see Quick Add section
    await sourcesPage.page.getByRole("button", { name: "RSS" }).click();
    await expect(sourcesPage.page.getByText("Quick Add")).toBeVisible();
    await expect(sourcesPage.page.getByRole("button", { name: "YouTube" })).toBeVisible();
    await expect(sourcesPage.page.getByRole("button", { name: "Topic" })).toBeVisible();
  });

  test("URL tab shows article extraction form", async ({ sourcesPage }) => {
    await expect(sourcesPage.page.getByText("Article URL")).toBeVisible();
    await expect(sourcesPage.page.getByRole("button", { name: "Extract" })).toBeVisible();
  });
});
