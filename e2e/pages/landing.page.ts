import type { Page, Locator } from "@playwright/test";

export class LandingPage {
  readonly page: Page;
  readonly hero: Locator;
  readonly heading: Locator;
  readonly tryDemoButton: Locator;
  readonly loginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.hero = page.getByTestId("aegis-landing-hero");
    this.heading = page.getByTestId("aegis-landing-heading");
    this.tryDemoButton = page.getByTestId("aegis-landing-try-demo");
    this.loginButton = page.getByTestId("aegis-landing-login");
  }

  /** Click "Try the Demo" to enter demo mode */
  async enterDemo() {
    await this.tryDemoButton.click();
  }
}
