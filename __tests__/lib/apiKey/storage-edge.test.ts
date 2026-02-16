/**
 * @jest-environment jsdom
 */
import {
  getUserApiKey,
  setUserApiKey,
  clearUserApiKey,
  maskApiKey,
} from "@/lib/apiKey/storage";

describe("apiKey/storage — edge cases and boundary conditions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("setUserApiKey — localStorage unavailable", () => {
    it("does not throw when localStorage is undefined", () => {
      const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      Object.defineProperty(globalThis, "localStorage", { value: undefined, writable: true, configurable: true });

      // setUserApiKey should not throw (guards against undefined)
      expect(() => setUserApiKey("sk-ant-test-key")).not.toThrow();

      // Restore
      if (origDescriptor) Object.defineProperty(globalThis, "localStorage", origDescriptor);
    });
  });

  describe("clearUserApiKey — localStorage unavailable", () => {
    it("does not throw when localStorage is undefined", () => {
      const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      Object.defineProperty(globalThis, "localStorage", { value: undefined, writable: true, configurable: true });

      expect(() => clearUserApiKey()).not.toThrow();

      if (origDescriptor) Object.defineProperty(globalThis, "localStorage", origDescriptor);
    });
  });

  describe("getUserApiKey — localStorage unavailable (globalThis check)", () => {
    it("returns null when localStorage is undefined on globalThis", () => {
      const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      Object.defineProperty(globalThis, "localStorage", { value: undefined, writable: true, configurable: true });

      expect(getUserApiKey()).toBeNull();

      if (origDescriptor) Object.defineProperty(globalThis, "localStorage", origDescriptor);
    });
  });

  describe("maskApiKey — boundary values", () => {
    it("returns empty string unchanged", () => {
      expect(maskApiKey("")).toBe("");
    });

    it("returns 1-char string unchanged", () => {
      expect(maskApiKey("x")).toBe("x");
    });

    it("returns exactly 12-char string unchanged", () => {
      expect(maskApiKey("123456789012")).toBe("123456789012");
    });

    it("masks 13-char string", () => {
      // First 7 + "..." + last 4
      expect(maskApiKey("1234567890abc")).toBe("1234567...0abc");
    });

    it("masks typical Anthropic key format", () => {
      const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
      const masked = maskApiKey(key);
      expect(masked).toMatch(/^sk-ant-\.\.\..*$/);
      expect(masked.endsWith("wxyz")).toBe(true);
      // Should not expose middle of key
      expect(masked).not.toContain("abcdef");
    });

    it("masks very long key", () => {
      const key = "sk-ant-api03-" + "a".repeat(100);
      const masked = maskApiKey(key);
      expect(masked.length).toBe(14); // 7 + 3 ("...") + 4
    });
  });

  describe("setUserApiKey — validation edge cases", () => {
    it("throws for key with 'sk-ant' but no trailing dash", () => {
      expect(() => setUserApiKey("sk-ant")).toThrow("Invalid API key format");
    });

    it("accepts key with just the prefix and nothing else", () => {
      setUserApiKey("sk-ant-");
      expect(getUserApiKey()).toBe("sk-ant-");
    });

    it("throws for 'SK-ANT-' (case sensitivity)", () => {
      expect(() => setUserApiKey("SK-ANT-uppercase")).toThrow("Invalid API key format");
    });

    it("throws for key with spaces", () => {
      expect(() => setUserApiKey("   sk-ant-test")).toThrow("Invalid API key format");
    });
  });

  describe("getUserApiKey — cross-contamination check", () => {
    it("only reads from the specific storage key", () => {
      // Set a different key
      localStorage.setItem("other-key", "sk-ant-wrong");
      expect(getUserApiKey()).toBeNull();
    });

    it("reads correct value after multiple set/clear cycles", () => {
      setUserApiKey("sk-ant-first");
      expect(getUserApiKey()).toBe("sk-ant-first");

      clearUserApiKey();
      expect(getUserApiKey()).toBeNull();

      setUserApiKey("sk-ant-second");
      expect(getUserApiKey()).toBe("sk-ant-second");

      setUserApiKey("sk-ant-third");
      expect(getUserApiKey()).toBe("sk-ant-third");
    });
  });
});
