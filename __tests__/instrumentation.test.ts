/**
 * instrumentation.ts is the entry Next evaluates before anything else, so a
 * top-level Sentry import there was charged to every cold start (the built
 * entry was 2.70MB). It must stay inert on the happy path while still reporting
 * uncaught server errors — that is the whole trade, and these tests pin it.
 */

const loaded: string[] = [];
const captureRequestError = jest.fn();

jest.mock("@sentry/nextjs", () => {
  loaded.push("@sentry/nextjs");
  return { captureRequestError };
});
jest.mock("@/sentry.server.config", () => {
  loaded.push("sentry.server.config");
  return {};
});
jest.mock("@/sentry.edge.config", () => {
  loaded.push("sentry.edge.config");
  return {};
});

const ORIGINAL_ENV = process.env;

function loadInstrumentation(env: Record<string, string | undefined> = {}) {
  jest.resetModules();
  loaded.length = 0;
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  Object.assign(process.env, env);
  return require("@/instrumentation") as typeof import("@/instrumentation");
}

const errorArgs = () => [
  new Error("boom"),
  { path: "/api/thing", method: "GET", headers: {} },
  { routerKind: "App Router", routePath: "/api/thing", routeType: "route" },
] as unknown as Parameters<
  typeof import("@sentry/nextjs").captureRequestError
>;

afterEach(() => {
  process.env = ORIGINAL_ENV;
  captureRequestError.mockClear();
});

describe("instrumentation register()", () => {
  it("loads nothing at boot, even with a DSN configured", async () => {
    const instrumentation = loadInstrumentation({
      SENTRY_DSN: "https://key@example.ingest.sentry.io/1",
      NEXT_RUNTIME: "nodejs",
    });
    await instrumentation.register();

    expect(loaded).toEqual([]);
  });
});

describe("instrumentation onRequestError()", () => {
  it("reports an uncaught server error, initialising the SDK first", async () => {
    const instrumentation = loadInstrumentation({
      SENTRY_DSN: "https://key@example.ingest.sentry.io/1",
      NEXT_RUNTIME: "nodejs",
    });
    const args = errorArgs();
    await instrumentation.onRequestError(...args);

    // Order matters: sentry.server.config runs Sentry.init() at module scope,
    // and capturing before that would hand the event to a null client.
    expect(loaded).toEqual(["sentry.server.config", "@sentry/nextjs"]);
    expect(captureRequestError).toHaveBeenCalledWith(...args);
  });

  it("uses the edge runtime config when running on the edge", async () => {
    const instrumentation = loadInstrumentation({
      SENTRY_DSN: "https://key@example.ingest.sentry.io/1",
      NEXT_RUNTIME: "edge",
    });
    await instrumentation.onRequestError(...errorArgs());

    expect(loaded).toEqual(["sentry.edge.config", "@sentry/nextjs"]);
  });

  it("stays inert when no DSN is configured", async () => {
    const instrumentation = loadInstrumentation({ NEXT_RUNTIME: "nodejs" });
    await instrumentation.onRequestError(...errorArgs());

    expect(loaded).toEqual([]);
    expect(captureRequestError).not.toHaveBeenCalled();
  });
});
