import {
  isIcLlmCircuitOpen,
  recordIcLlmSuccess,
  recordIcLlmFailure,
  _resetIcLlmCircuit,
  _icLlmCircuitState,
  _icLlmCircuitFailures,
  _IC_LLM_CIRCUIT_CONSTANTS,
} from "@/lib/ic/icLlmCircuitBreaker";

beforeEach(() => {
  _resetIcLlmCircuit();
});

describe("icLlmCircuitBreaker — initial state", () => {
  it("starts closed with zero failures", () => {
    expect(_icLlmCircuitState()).toBe("closed");
    expect(_icLlmCircuitFailures()).toBe(0);
    expect(isIcLlmCircuitOpen()).toBe(false);
  });
});

describe("icLlmCircuitBreaker — failure accumulation", () => {
  it("stays closed after 1 failure", () => {
    recordIcLlmFailure();
    expect(_icLlmCircuitState()).toBe("closed");
    expect(isIcLlmCircuitOpen()).toBe(false);
    expect(_icLlmCircuitFailures()).toBe(1);
  });

  it("stays closed after 2 failures (below threshold of 3)", () => {
    recordIcLlmFailure();
    recordIcLlmFailure();
    expect(_icLlmCircuitState()).toBe("closed");
    expect(isIcLlmCircuitOpen()).toBe(false);
    expect(_icLlmCircuitFailures()).toBe(2);
  });

  it("opens after reaching the failure threshold (3)", () => {
    recordIcLlmFailure();
    recordIcLlmFailure();
    recordIcLlmFailure();
    expect(_icLlmCircuitState()).toBe("open");
    expect(isIcLlmCircuitOpen()).toBe(true);
  });

  it("threshold constant matches observed behavior", () => {
    expect(_IC_LLM_CIRCUIT_CONSTANTS.FAILURE_THRESHOLD).toBe(3);
    expect(_IC_LLM_CIRCUIT_CONSTANTS.OPEN_DURATION_MS).toBe(60_000);
  });
});

describe("icLlmCircuitBreaker — success resets", () => {
  it("success resets consecutive-failure counter", () => {
    recordIcLlmFailure();
    recordIcLlmFailure();
    expect(_icLlmCircuitFailures()).toBe(2);
    recordIcLlmSuccess();
    expect(_icLlmCircuitFailures()).toBe(0);
    expect(_icLlmCircuitState()).toBe("closed");
  });

  it("interleaved success + failure never trips breaker", () => {
    recordIcLlmFailure();
    recordIcLlmSuccess();
    recordIcLlmFailure();
    recordIcLlmSuccess();
    recordIcLlmFailure();
    recordIcLlmFailure();
    expect(_icLlmCircuitState()).toBe("closed");
    expect(isIcLlmCircuitOpen()).toBe(false);
  });

  it("success in an already-closed breaker is a no-op", () => {
    recordIcLlmSuccess();
    recordIcLlmSuccess();
    expect(_icLlmCircuitFailures()).toBe(0);
    expect(_icLlmCircuitState()).toBe("closed");
  });
});

describe("icLlmCircuitBreaker — cooldown expiry", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("stays open for OPEN_DURATION_MS", () => {
    jest.setSystemTime(new Date("2026-04-12T12:00:00Z"));
    recordIcLlmFailure();
    recordIcLlmFailure();
    recordIcLlmFailure();
    expect(isIcLlmCircuitOpen()).toBe(true);

    // One second before cooldown expires — still open
    jest.setSystemTime(new Date("2026-04-12T12:00:59Z"));
    expect(isIcLlmCircuitOpen()).toBe(true);
  });

  it("transitions to half-open at OPEN_DURATION_MS", () => {
    jest.setSystemTime(new Date("2026-04-12T12:00:00Z"));
    recordIcLlmFailure();
    recordIcLlmFailure();
    recordIcLlmFailure();
    jest.setSystemTime(new Date("2026-04-12T12:01:00Z"));
    // isIcLlmCircuitOpen returns false because half-open allows probes
    expect(isIcLlmCircuitOpen()).toBe(false);
    expect(_icLlmCircuitState()).toBe("half-open");
  });

});

describe("icLlmCircuitBreaker — half-open probe", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function trip(): void {
    recordIcLlmFailure();
    recordIcLlmFailure();
    recordIcLlmFailure();
  }

  it("probe success closes the breaker and resets counter", () => {
    jest.setSystemTime(new Date("2026-04-12T12:00:00Z"));
    trip();
    jest.setSystemTime(new Date("2026-04-12T12:01:00Z"));
    expect(_icLlmCircuitState()).toBe("half-open");

    recordIcLlmSuccess();
    expect(_icLlmCircuitState()).toBe("closed");
    expect(_icLlmCircuitFailures()).toBe(0);
    expect(isIcLlmCircuitOpen()).toBe(false);
  });

  it("probe failure immediately re-opens the breaker and restarts cooldown", () => {
    jest.setSystemTime(new Date("2026-04-12T12:00:00Z"));
    trip();
    jest.setSystemTime(new Date("2026-04-12T12:01:00Z"));
    // Transition into half-open
    expect(isIcLlmCircuitOpen()).toBe(false);
    expect(_icLlmCircuitState()).toBe("half-open");

    recordIcLlmFailure();
    expect(_icLlmCircuitState()).toBe("open");
    expect(isIcLlmCircuitOpen()).toBe(true);

    // Cooldown restarted — 30s later still open
    jest.setSystemTime(new Date("2026-04-12T12:01:30Z"));
    expect(isIcLlmCircuitOpen()).toBe(true);
    // 60s after the probe failure — half-open again
    jest.setSystemTime(new Date("2026-04-12T12:02:00Z"));
    expect(isIcLlmCircuitOpen()).toBe(false);
    expect(_icLlmCircuitState()).toBe("half-open");
  });

  it("second consecutive 60s cooldown + recovery cycle works", () => {
    // open → half-open → open → half-open → success → closed
    jest.setSystemTime(new Date("2026-04-12T12:00:00Z"));
    trip();
    jest.setSystemTime(new Date("2026-04-12T12:01:00Z"));
    expect(isIcLlmCircuitOpen()).toBe(false); // → half-open
    recordIcLlmFailure();                      // → open
    jest.setSystemTime(new Date("2026-04-12T12:02:00Z"));
    expect(isIcLlmCircuitOpen()).toBe(false); // → half-open again
    recordIcLlmSuccess();                      // → closed
    expect(_icLlmCircuitState()).toBe("closed");
    expect(_icLlmCircuitFailures()).toBe(0);
  });
});

describe("icLlmCircuitBreaker — reset seam", () => {
  it("_resetIcLlmCircuit wipes everything", () => {
    recordIcLlmFailure();
    recordIcLlmFailure();
    recordIcLlmFailure();
    expect(_icLlmCircuitState()).toBe("open");
    _resetIcLlmCircuit();
    expect(_icLlmCircuitState()).toBe("closed");
    expect(_icLlmCircuitFailures()).toBe(0);
    expect(isIcLlmCircuitOpen()).toBe(false);
  });
});
