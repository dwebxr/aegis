/**
 * @jest-environment jsdom
 */
import { isWebLLMEnabled, setWebLLMEnabled } from "@/lib/webllm/storage";

const STORAGE_KEY = "aegis-webllm-enabled";

beforeEach(() => {
  localStorage.clear();
});

describe("isWebLLMEnabled", () => {
  it("returns false when key is absent", () => {
    expect(isWebLLMEnabled()).toBe(false);
  });

  it("returns true when key is 'true'", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    expect(isWebLLMEnabled()).toBe(true);
  });

  it("returns false when key is 'false'", () => {
    localStorage.setItem(STORAGE_KEY, "false");
    expect(isWebLLMEnabled()).toBe(false);
  });

  it("returns false for arbitrary non-true values", () => {
    localStorage.setItem(STORAGE_KEY, "yes");
    expect(isWebLLMEnabled()).toBe(false);

    localStorage.setItem(STORAGE_KEY, "1");
    expect(isWebLLMEnabled()).toBe(false);

    localStorage.setItem(STORAGE_KEY, "");
    expect(isWebLLMEnabled()).toBe(false);
  });
});

describe("setWebLLMEnabled", () => {
  it("sets 'true' in localStorage when enabled", () => {
    setWebLLMEnabled(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("removes key from localStorage when disabled", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setWebLLMEnabled(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("round-trips: set true → check true → set false → check false", () => {
    setWebLLMEnabled(true);
    expect(isWebLLMEnabled()).toBe(true);
    setWebLLMEnabled(false);
    expect(isWebLLMEnabled()).toBe(false);
  });

  it("handles repeated enable calls idempotently", () => {
    setWebLLMEnabled(true);
    setWebLLMEnabled(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("handles repeated disable calls idempotently", () => {
    setWebLLMEnabled(false);
    setWebLLMEnabled(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
