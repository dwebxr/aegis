import type { Page } from "@playwright/test";

/**
 * Inject mock auth state into the page before the app loads.
 * The AuthContext checks for window.__AEGIS_MOCK_AUTH in non-production builds.
 */
export async function setupAuthMock(page: Page, authenticated: boolean = true) {
  await page.addInitScript((isAuth: boolean) => {
    const w = window as Window & { __AEGIS_MOCK_AUTH?: boolean; __AEGIS_MOCK_PRINCIPAL?: string };
    w.__AEGIS_MOCK_AUTH = isAuth;
    w.__AEGIS_MOCK_PRINCIPAL = "2vxsx-fae"; // anonymous principal
  }, authenticated);
}
