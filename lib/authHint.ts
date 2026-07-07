"use client";

/**
 * Paint-time auth hint.
 *
 * The landing page is server-rendered into the initial HTML for crawlers
 * (SEO/AIEO). Returning authenticated users would see it flash while the
 * async Internet Identity check runs, so:
 *  - an inline <head> script sets `data-auth-hint="1"` on <html> before
 *    first paint when this localStorage key is present, and a CSS rule
 *    hides `[data-landing-gate]` under that attribute;
 *  - AuthContext calls syncAuthHint() once auth state resolves, keeping the
 *    key in sync and removing the attribute when the user turns out to be
 *    unauthenticated (expired delegation, logout, anonymous principal) so
 *    the landing page becomes visible again.
 */
const AUTH_HINT_KEY = "aegis-auth-hint";

export function syncAuthHint(authenticated: boolean): void {
  try {
    if (authenticated) {
      localStorage.setItem(AUTH_HINT_KEY, "1");
    } else {
      localStorage.removeItem(AUTH_HINT_KEY);
    }
  } catch {
    console.debug("[auth-hint] localStorage unavailable");
  }
  if (!authenticated) {
    document.documentElement.removeAttribute("data-auth-hint");
  }
}
