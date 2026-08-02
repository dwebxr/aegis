/**
 * @jest-environment jsdom
 */
/**
 * The scheduler must not poll on behalf of a tab nobody is looking at.
 *
 * Every cycle ends in POSTs to our own /api/fetch/* functions, so a backgrounded
 * or abandoned tab was spending Vercel Active CPU indefinitely. These tests pin
 * both gates and, just as importantly, the catch-up that keeps a returning user
 * from noticing them.
 */
import { IngestionScheduler } from "@/lib/ingestion/scheduler";
import { BASE_CYCLE_MS } from "@/lib/ingestion/sourceState";

const mockStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, val: string) => mockStorage.set(key, val),
    removeItem: (key: string) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
  },
  writable: true,
});

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

const originalFetch = global.fetch;
let getSources: jest.Mock;
let scheduler: IngestionScheduler;

beforeEach(() => {
  mockStorage.clear();
  jest.useFakeTimers();
  // getSources is the first thing runCycle touches, so its call count is a
  // faithful proxy for "a cycle ran" without needing the network at all.
  getSources = jest.fn(() => []);
  scheduler = new IngestionScheduler({
    onNewContent: jest.fn(),
    getSources: getSources as unknown as () => [],
    getUserContext: () => null,
  });
});

afterEach(() => {
  scheduler.stop();
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  jest.useRealTimers();
  global.fetch = originalFetch;
});

/** Drains the dedup init promise chain that the 5s timer kicks off. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("IngestionScheduler visibility gate", () => {
  it("runs the interval cycle while the tab is visible", async () => {
    setHidden(false);
    scheduler.start();
    jest.advanceTimersByTime(5000);
    await flush();
    const afterInitial = getSources.mock.calls.length;
    expect(afterInitial).toBeGreaterThan(0);

    jest.advanceTimersByTime(BASE_CYCLE_MS);
    await flush();
    expect(getSources.mock.calls.length).toBeGreaterThan(afterInitial);
  });

  it("skips cycles while the tab is hidden", async () => {
    scheduler.start();
    setHidden(true);
    jest.advanceTimersByTime(5000);
    await flush();
    jest.advanceTimersByTime(BASE_CYCLE_MS * 3);
    await flush();

    expect(getSources).not.toHaveBeenCalled();
  });

  it("runs exactly one catch-up cycle when the tab becomes visible again", async () => {
    scheduler.start();
    setHidden(true);
    jest.advanceTimersByTime(BASE_CYCLE_MS * 3);
    await flush();
    expect(getSources).not.toHaveBeenCalled();

    setHidden(false);
    await flush();
    expect(getSources).toHaveBeenCalledTimes(1);
  });

  it("stops listening for visibility changes after stop()", async () => {
    scheduler.start();
    setHidden(true);
    scheduler.stop();

    setHidden(false);
    await flush();
    expect(getSources).not.toHaveBeenCalled();
  });
});

/** Mirrors IDLE_PAUSE_MS in lib/ingestion/scheduler.ts. */
const IDLE_PAUSE_MS = 2 * 60 * 60 * 1000;

/**
 * Moves the wall clock forward WITHOUT firing timers. The idle gate reads
 * elapsed-time-since-interaction, so advancing timers alone would just replay
 * ticks that are each still inside the window.
 */
function idleFor(ms: number): void {
  jest.setSystemTime(new Date(Date.now() + ms));
}

describe("IngestionScheduler idle gate", () => {
  it("pauses cycles once the tab has gone two hours without interaction", async () => {
    scheduler.start();
    jest.advanceTimersByTime(5000);
    await flush();
    getSources.mockClear();

    idleFor(IDLE_PAUSE_MS + 1000);
    jest.advanceTimersByTime(BASE_CYCLE_MS);
    await flush();

    expect(getSources).not.toHaveBeenCalled();
  });

  it("keeps running while interaction is recent", async () => {
    scheduler.start();
    jest.advanceTimersByTime(5000);
    await flush();
    getSources.mockClear();

    // Half the window, so the tick below still lands inside it.
    idleFor(IDLE_PAUSE_MS / 2);
    jest.advanceTimersByTime(BASE_CYCLE_MS);
    await flush();

    expect(getSources).toHaveBeenCalledTimes(1);
  });

  it("resumes with a single catch-up cycle on the next interaction", async () => {
    scheduler.start();
    jest.advanceTimersByTime(5000);
    await flush();
    idleFor(IDLE_PAUSE_MS + 1000);
    getSources.mockClear();

    document.dispatchEvent(new Event("keydown"));
    await flush();
    expect(getSources).toHaveBeenCalledTimes(1);

    // A second interaction inside the active window must not add a cycle.
    document.dispatchEvent(new Event("pointerdown"));
    await flush();
    expect(getSources).toHaveBeenCalledTimes(1);
  });
});
