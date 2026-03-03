import { test, expect } from "../fixtures/base";

test.describe("Landing Page", () => {
  test("displays hero section with main heading", async ({ landingPage }) => {
    await expect(landingPage.hero).toBeVisible();
    await expect(landingPage.heading).toContainText("Cut Through the Noise");
  });

  test("shows Try the Demo and Login buttons", async ({ landingPage }) => {
    await expect(landingPage.tryDemoButton).toBeVisible();
    await expect(landingPage.loginButton).toBeVisible();
    await expect(landingPage.loginButton).toContainText(/sign in with Internet Identity/i);
  });

  test("How It Works section shows 3 steps", async ({ landingPage }) => {
    await expect(landingPage.page.getByText("Add Your Feeds")).toBeVisible();
    await expect(landingPage.page.getByText("AI Filters the Noise")).toBeVisible();
    await expect(landingPage.page.getByText("Read What Matters")).toBeVisible();
  });

  test("Features section shows 4 feature cards", async ({ landingPage }) => {
    await expect(landingPage.page.getByText("Quality Filter").first()).toBeVisible();
    await expect(landingPage.page.getByText("Nostr Publishing").first()).toBeVisible();
    await expect(landingPage.page.getByText("Web of Trust").first()).toBeVisible();
    await expect(landingPage.page.getByText("D2A Agents").first()).toBeVisible();
  });

  test("Who It's For section shows personas", async ({ landingPage }) => {
    await expect(landingPage.page.getByText("Crypto Trader")).toBeVisible();
    await expect(landingPage.page.getByText("Newsletter Writer")).toBeVisible();
  });

  test("Try Demo button enters demo mode and shows dashboard", async ({ landingPage }) => {
    await landingPage.enterDemo();
    await expect(landingPage.hero).not.toBeVisible();
    await expect(landingPage.page.getByTestId("aegis-dashboard")).toBeVisible();
  });

  test("Login button is visible in sidebar after entering demo", async ({ dashboardPage }) => {
    await expect(dashboardPage.page.getByText(/Login with Internet Identity/i).or(dashboardPage.page.getByText(/sign in/i))).toBeVisible();
  });
});
