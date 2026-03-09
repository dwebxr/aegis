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
    it("stores a valid key and returns true", () => {
      expect(setUserApiKey("sk-ant-api03-mykey")).toBe(true);
      expect(localStorage.getItem("aegis-user-api-key")).toBe("sk-ant-api03-mykey");
    });

    it("throws on invalid prefix", () => {
      expect(() => setUserApiKey("invalid-key")).toThrow("Invalid API key format");
    });

    it("throws on empty string", () => {
      expect(() => setUserApiKey("")).toThrow("Invalid API key format");
    });

    it("accepts any key starting with sk-ant-", () => {
      expect(setUserApiKey("sk-ant-anything")).toBe(true);
      expect(getUserApiKey()).toBe("sk-ant-anything");
    });

    it("returns false when localStorage throws (quota)", () => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("QuotaExceededError"); };
      expect(setUserApiKey("sk-ant-api03-key")).toBe(false);
      Storage.prototype.setItem = orig;
    });
  });

  describe("clearUserApiKey", () => {
    it("removes the stored key and returns true", () => {
      setUserApiKey("sk-ant-api03-toremove");
      expect(getUserApiKey()).toBe("sk-ant-api03-toremove");

      expect(clearUserApiKey()).toBe(true);
      expect(getUserApiKey()).toBeNull();
    });

    it("returns true when no key exists", () => {
      expect(clearUserApiKey()).toBe(true);
    });

    it("returns false when localStorage throws", () => {
      const orig = Storage.prototype.removeItem;
      Storage.prototype.removeItem = () => { throw new Error("Denied"); };
      expect(clearUserApiKey()).toBe(false);
      Storage.prototype.removeItem = orig;
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
