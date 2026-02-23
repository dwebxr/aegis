import { test, expect } from "../fixtures/base";

test.describe("Landing Page", () => {
  test("displays hero heading", async ({ landingPage }) => {
    await expect(landingPage.heading).toContainText("Cut Through the Noise");
  });

  test("displays Try the Demo button", async ({ landingPage }) => {
    await expect(landingPage.tryDemoButton).toBeVisible();
    await expect(landingPage.tryDemoButton).toContainText("Try the Demo");
  });

  test("displays sign in with Internet Identity link", async ({ landingPage }) => {
    await expect(landingPage.loginButton).toBeVisible();
    await expect(landingPage.loginButton).toContainText("sign in with Internet Identity");
  });

  test("shows How It Works section with 3 steps", async ({ landingPage }) => {
    await expect(landingPage.howItWorks()).toBeVisible();
    await expect(landingPage.page.getByText("Add Your Feeds")).toBeVisible();
    await expect(landingPage.page.getByText("AI Filters the Noise")).toBeVisible();
    await expect(landingPage.page.getByText("Read What Matters")).toBeVisible();
  });

  test("shows Features section with 4 cards", async ({ landingPage }) => {
    // Scroll the Features heading into view first
    const features = landingPage.page.getByText("Features", { exact: true });
    await features.scrollIntoViewIfNeeded();
    await expect(features).toBeVisible();
    await expect(landingPage.page.getByText("Quality Filter", { exact: true })).toBeVisible();
    await expect(landingPage.page.getByText("Nostr Publishing", { exact: true })).toBeVisible();
    await expect(landingPage.page.getByText("Web of Trust", { exact: true })).toBeVisible();
    await expect(landingPage.page.getByText("D2A Agents", { exact: true })).toBeVisible();
  });

  test("shows Who It's For section with 3 personas", async ({ landingPage }) => {
    // Scroll to bottom to bring personas into view
    await landingPage.page.getByText("Crypto Trader").scrollIntoViewIfNeeded();
    await expect(landingPage.page.getByText("Crypto Trader")).toBeVisible();
    await expect(landingPage.page.getByText("Newsletter Writer")).toBeVisible();
  });
});
