/** @jest-environment jsdom */

const mockDefaultCache = [{ matcher: () => true, handler: { cacheName: "others" } }];
const mockSerwist = jest.fn().mockImplementation(() => ({ addEventListeners: jest.fn() }));
const mockNetworkOnly = jest.fn();
jest.mock("@serwist/next/worker", () => ({ defaultCache: mockDefaultCache }));
jest.mock("serwist", () => ({ Serwist: mockSerwist, NetworkOnly: mockNetworkOnly }));

it("routes MediaPipe loader and wasm through NetworkOnly before the default runtime cache", () => {
  require("@/app/sw");
  const { runtimeCaching } = mockSerwist.mock.calls[0][0] as {
    runtimeCaching: Array<{ matcher: unknown; handler: unknown }>;
  };
  const vendorIndex = runtimeCaching.findIndex(route => typeof route.matcher === "function"
    && route.matcher({ url: new URL("https://example.com/vendor/mediapipe/tasks-genai@0.10.29/wasm/genai_wasm_internal.wasm") }));
  expect(vendorIndex).toBeGreaterThanOrEqual(0);
  expect(vendorIndex).toBeLessThan(runtimeCaching.indexOf(mockDefaultCache[0]));
  const vendorRoute = runtimeCaching[vendorIndex];
  expect(vendorRoute.handler).toBeInstanceOf(mockNetworkOnly);
  const matcher = vendorRoute.matcher as (context: { url: URL }) => boolean;
  expect(matcher({ url: new URL("https://example.com/vendor/mediapipe/tasks-genai@0.10.29/wasm/genai_wasm_internal.js") })).toBe(true);
  expect(matcher({ url: new URL("https://example.com/other.js") })).toBe(false);
});
