import type { BrowserContext } from "@playwright/test";

function isLocal(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export async function isolateNetwork(context: BrowserContext): Promise<void> {
  // Resolve the render-blocking font CSS import without fetching external fonts.
  await context.route(url => url.hostname === "fonts.googleapis.com", async route => {
    await route.fulfill({ status: 200, contentType: "text/css", body: "" });
  });

  // Page API mocks take precedence over this context-level fallback, including
  // explicitly mocked external feeds. Unmatched external requests never leave.
  await context.route("**/*", async route => {
    const url = route.request().url();
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "fonts.googleapis.com" && route.request().resourceType() === "stylesheet") {
      // Routes run newest first; pass font CSS to the earlier fulfillment route.
      await route.fallback();
      return;
    }
    if (isLocal(parsedUrl)) {
      await route.continue();
      return;
    }
    console.warn(`[e2e network] Blocked request: ${url}`);
    await route.abort("blockedbyclient");
  });

  // Only intercept external sockets so Next's local HMR connection still works.
  // Do not connectToServer: closing this route must never contact a real relay.
  await context.routeWebSocket(url => !isLocal(url), async socket => {
    console.warn(`[e2e network] Blocked WebSocket: ${socket.url()}`);
    await socket.close();
  });
}
