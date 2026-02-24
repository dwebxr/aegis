import type { Page } from "@playwright/test";

/**
 * Inject mock auth state into the page before the app loads.
 * The AuthContext checks for window.__AEGIS_MOCK_AUTH in non-production builds.
 */
export async function setupAuthMock(page: Page, authenticated: boolean = true) {
  await page.addInitScript((isAuth: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__AEGIS_MOCK_AUTH = isAuth;
    w.__AEGIS_MOCK_PRINCIPAL = "2vxsx-fae"; // anonymous principal
  }, authenticated);
}
