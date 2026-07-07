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
    await expect(landingPage.page.getByText("Add your feeds")).toBeVisible();
    await expect(landingPage.page.getByText("AI filters out the slop")).toBeVisible();
    await expect(landingPage.page.getByText("Read only what matters")).toBeVisible();
  });

  test("Feature sections show current headings", async ({ landingPage }) => {
    await expect(landingPage.page.getByText("Add RSS and social sources in one place")).toBeVisible();
    await expect(landingPage.page.getByText("AI that knows what's real — and what's slop")).toBeVisible();
    await expect(landingPage.page.getByText("A new layer of signal, beyond big social")).toBeVisible();
    await expect(landingPage.page.getByText("Read anywhere, like a native app")).toBeVisible();
  });

  test("Who It's For section shows personas", async ({ landingPage }) => {
    await expect(landingPage.page.getByText("Crypto traders")).toBeVisible();
    await expect(landingPage.page.getByText("Newsletter writers")).toBeVisible();
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
