/**
 * @jest-environment jsdom
 */
import {
  getUserApiKey,
  setUserApiKey,
  clearUserApiKey,
  maskApiKey,
} from "@/lib/apiKey/storage";

describe("apiKey/storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getUserApiKey", () => {
    it("returns null when no key is stored", () => {
      expect(getUserApiKey()).toBeNull();
    });

    it("returns stored key", () => {
      localStorage.setItem("aegis-user-api-key", "sk-ant-api03-test123");
      expect(getUserApiKey()).toBe("sk-ant-api03-test123");
    });
  });

  describe("setUserApiKey", () => {
    it("stores a valid key in localStorage", () => {
      setUserApiKey("sk-ant-api03-mykey");
      expect(localStorage.getItem("aegis-user-api-key")).toBe("sk-ant-api03-mykey");
    });

    it("throws on invalid prefix", () => {
      expect(() => setUserApiKey("invalid-key")).toThrow("Invalid API key format");
    });

    it("throws on empty string", () => {
      expect(() => setUserApiKey("")).toThrow("Invalid API key format");
    });

    it("accepts any key starting with sk-ant-", () => {
      setUserApiKey("sk-ant-anything");
      expect(getUserApiKey()).toBe("sk-ant-anything");
    });
  });

  describe("clearUserApiKey", () => {
    it("removes the stored key", () => {
      setUserApiKey("sk-ant-api03-toremove");
      expect(getUserApiKey()).toBe("sk-ant-api03-toremove");

      clearUserApiKey();
      expect(getUserApiKey()).toBeNull();
    });

    it("does not throw when no key exists", () => {
      expect(() => clearUserApiKey()).not.toThrow();
    });
  });

  describe("maskApiKey", () => {
    it("masks a standard key showing first 7 and last 4 chars", () => {
      expect(maskApiKey("sk-ant-api03-abcdefghijklmnop")).toBe("sk-ant-...mnop");
    });

    it("returns short keys unchanged", () => {
      expect(maskApiKey("sk-ant-1234")).toBe("sk-ant-1234");
    });

    it("handles exactly 12 char key unchanged", () => {
      expect(maskApiKey("sk-ant-12345")).toBe("sk-ant-12345");
    });

    it("masks 13+ char keys", () => {
      const result = maskApiKey("sk-ant-123456");
      expect(result).toBe("sk-ant-...3456");
    });
  });

  describe("localStorage unavailable", () => {
    it("getUserApiKey returns null when localStorage throws", () => {
      const orig = Storage.prototype.getItem;
      Storage.prototype.getItem = () => { throw new Error("Denied"); };
      expect(getUserApiKey()).toBeNull();
      Storage.prototype.getItem = orig;
    });
  });
});
