import type { Page, Locator } from "@playwright/test";

export class IncineratorPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly textarea: Locator;
  readonly analyzeButton: Locator;
  readonly resultContainer: Locator;
  readonly verdictLabel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByTestId("aegis-incinerator-heading");
    this.textarea = page.getByTestId("aegis-manual-textarea");
    this.analyzeButton = page.getByTestId("aegis-manual-analyze");
    this.resultContainer = page.getByTestId("aegis-manual-result");
    this.verdictLabel = page.getByTestId("aegis-manual-verdict");
  }

  /** Type text and click Analyze, wait for result */
  async analyze(text: string) {
    await this.textarea.fill(text);
    await this.analyzeButton.click();
    await this.resultContainer.waitFor({ state: "visible", timeout: 10_000 });
  }

  /** Get the verdict text (Quality or Slop) */
  async getVerdict(): Promise<string> {
    return (await this.verdictLabel.textContent()) ?? "";
  }
}
