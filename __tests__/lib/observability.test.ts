/**
 * The whole point of lib/observability.ts is that the Sentry SDK — a ~2.7MB
 * chunk of @sentry/node + OpenTelemetry — is not in the module graph a route
 * evaluates at cold boot. These tests pin that: no DSN means no load at all,
 * and with a DSN the SDK is loaded on the first reported event, not on import.
 */

const loaded: string[] = [];
const captureException = jest.fn();
const captureMessage = jest.fn();
const flush = jest.fn().mockResolvedValue(true);

jest.mock("@sentry/nextjs", () => {
  loaded.push("@sentry/nextjs");
  return { captureException, captureMessage, flush };
});
jest.mock("@/sentry.server.config", () => {
  loaded.push("sentry.server.config");
  return {};
});
// after() throws outside a request scope; the facade must fall back to a
// detached promise rather than propagate that into the caller.
jest.mock("next/server", () => ({
  after: () => { throw new Error("no request scope"); },
}));

const ORIGINAL_ENV = process.env;

function loadFacade(dsn?: string) {
  jest.resetModules();
  loaded.length = 0;
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) process.env.SENTRY_DSN = dsn;
  return require("@/lib/observability") as typeof import("@/lib/observability");
}

/** Lets the facade's detached promise chain settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  captureException.mockClear();
  captureMessage.mockClear();
  flush.mockClear();
});

describe("lib/observability", () => {
  it("does not load the SDK just by being imported", () => {
    loadFacade("https://key@example.ingest.sentry.io/1");
    expect(loaded).toEqual([]);
  });

  it("never loads the SDK when no DSN is configured", async () => {
    const obs = loadFacade();
    obs.captureException(new Error("boom"));
    await settle();

    expect(loaded).toEqual([]);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("initialises and captures on the first reported event", async () => {
    const obs = loadFacade("https://key@example.ingest.sentry.io/1");
    const err = new Error("boom");
    obs.captureException(err, { tags: { route: "test" } });
    await settle();

    // The runtime config runs Sentry.init() at module scope, so it must be
    // imported before the capture — otherwise the event hits a null client.
    expect(loaded).toEqual(["sentry.server.config", "@sentry/nextjs"]);
    expect(captureException).toHaveBeenCalledWith(err, { tags: { route: "test" } });
  });

  it("flushes after capturing, so a frozen instance cannot drop the event", async () => {
    const obs = loadFacade("https://key@example.ingest.sentry.io/1");
    obs.captureException(new Error("boom"));
    await settle();

    expect(flush).toHaveBeenCalled();
  });

  it("loads the SDK once across many events", async () => {
    const obs = loadFacade("https://key@example.ingest.sentry.io/1");
    obs.captureException(new Error("one"));
    obs.captureMessage("two");
    obs.captureException(new Error("three"));
    await settle();

    expect(loaded).toEqual(["sentry.server.config", "@sentry/nextjs"]);
    expect(captureException).toHaveBeenCalledTimes(2);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps events in submission order", async () => {
    const obs = loadFacade("https://key@example.ingest.sentry.io/1");
    const order: string[] = [];
    captureMessage.mockImplementation((m: string) => { order.push(m); });

    obs.captureMessage("first");
    obs.captureMessage("second");
    await settle();

    expect(order).toEqual(["first", "second"]);
  });

  it("swallows a reporting failure instead of failing the caller", async () => {
    const obs = loadFacade("https://key@example.ingest.sentry.io/1");
    captureException.mockImplementationOnce(() => { throw new Error("transport down"); });
    const warn = jest.spyOn(console, "warn").mockImplementation();

    expect(() => obs.captureException(new Error("boom"))).not.toThrow();
    await settle();

    expect(warn).toHaveBeenCalledWith("[observability] Sentry delivery failed:", expect.any(Error));
    warn.mockRestore();
  });
});
