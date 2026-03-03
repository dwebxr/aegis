import type { Page, Locator } from "@playwright/test";
import { TIMEOUTS } from "../constants";

export class SourcesPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly urlTab: Locator;
  readonly rssTab: Locator;
  readonly twitterTab: Locator;
  readonly nostrTab: Locator;
  readonly urlInput: Locator;
  readonly extractButton: Locator;
  readonly urlResult: Locator;
  readonly urlError: Locator;
  readonly rssInput: Locator;
  readonly catalog: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByTestId("aegis-sources-heading");
    this.urlTab = page.getByTestId("aegis-sources-tab-url");
    this.rssTab = page.getByTestId("aegis-sources-tab-rss");
    this.twitterTab = page.getByTestId("aegis-sources-tab-twitter");
    this.nostrTab = page.getByTestId("aegis-sources-tab-nostr");
    this.urlInput = page.getByTestId("aegis-sources-url-input");
    this.extractButton = page.getByTestId("aegis-sources-extract-btn");
    this.urlResult = page.getByTestId("aegis-sources-url-result");
    this.urlError = page.getByTestId("aegis-sources-url-error");
    this.rssInput = page.getByTestId("aegis-sources-rss-input");
    this.catalog = page.getByTestId("aegis-sources-catalog");
  }

  quickAddButton(label: string): Locator {
    return this.page.getByRole("button", { name: label });
  }

  demoReadOnlyBanner() {
    return this.page.getByText("Demo sources are read-only");
  }

  async switchToTab(tab: "url" | "rss" | "twitter" | "nostr") {
    const tabMap = { url: this.urlTab, rss: this.rssTab, twitter: this.twitterTab, nostr: this.nostrTab };
    await tabMap[tab].click();
  }

  async extractUrl(url: string) {
    await this.urlInput.fill(url);
    await this.extractButton.click();
    await this.urlResult.waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
  }
}
