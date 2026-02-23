import type { Page, Locator } from "@playwright/test";

export class NavigationPage {
  readonly page: Page;
  readonly mainContent: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mainContent = page.getByTestId("aegis-main-content");
  }

  /** Get sidebar nav button by tab id */
  sidebarNav(id: string): Locator {
    return this.page.getByTestId(`aegis-nav-${id}`);
  }

  /** Get mobile nav button by tab id */
  mobileNav(id: string): Locator {
    return this.page.getByTestId(`aegis-nav-mobile-${id}`);
  }

  /** Get settings button */
  settingsButton(): Locator {
    return this.page.getByTestId("aegis-nav-settings");
  }

  /** Get demo banner */
  demoBanner(): Locator {
    return this.page.getByTestId("aegis-demo-banner");
  }

  /** Get demo banner dismiss button */
  demoBannerDismiss(): Locator {
    return this.page.getByTestId("aegis-demo-banner-dismiss");
  }
}
