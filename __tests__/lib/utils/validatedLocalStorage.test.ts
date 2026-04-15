/**
 * @jest-environment jsdom
 */

import { getValidated, setValidated, removeValidated, type Guard } from "@/lib/utils/validatedLocalStorage";

const isString: Guard<string> = (v): v is string => typeof v === "string";
interface Shape { n: number; flag: boolean }
const isShape: Guard<Shape> = (v): v is Shape =>
  !!v && typeof v === "object" && typeof (v as Shape).n === "number" && typeof (v as Shape).flag === "boolean";

beforeEach(() => {
  localStorage.clear();
});

describe("getValidated", () => {
  it("returns fallback when key is absent", () => {
    expect(getValidated("missing", isString, "fb")).toBe("fb");
  });

  it("returns the parsed value when guard passes", () => {
    localStorage.setItem("k", JSON.stringify("ok"));
    expect(getValidated("k", isString, "fb")).toBe("ok");
  });

  it("returns fallback when JSON is malformed", () => {
    localStorage.setItem("k", "{not json");
    expect(getValidated("k", isString, "fb")).toBe("fb");
  });

  it("returns fallback when guard rejects", () => {
    localStorage.setItem("k", JSON.stringify(123));
    expect(getValidated("k", isString, "fb")).toBe("fb");
  });

  it("validates structured shapes", () => {
    localStorage.setItem("k", JSON.stringify({ n: 1, flag: true }));
    expect(getValidated("k", isShape, { n: 0, flag: false })).toEqual({ n: 1, flag: true });
    localStorage.setItem("k", JSON.stringify({ n: 1, flag: "yes" }));
    expect(getValidated("k", isShape, { n: 0, flag: false })).toEqual({ n: 0, flag: false });
  });
});

describe("setValidated", () => {
  it("writes JSON and reports success", () => {
    expect(setValidated("k", { n: 1, flag: true })).toBe(true);
    expect(JSON.parse(localStorage.getItem("k")!)).toEqual({ n: 1, flag: true });
  });

  it("returns false on QuotaExceededError without throwing", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
    expect(() => setValidated("k", "v")).not.toThrow();
    expect(setValidated("k", "v")).toBe(false);
    Storage.prototype.setItem = original;
  });
});

describe("removeValidated", () => {
  it("removes a key", () => {
    localStorage.setItem("k", "v");
    removeValidated("k");
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("does not throw on a missing key", () => {
    expect(() => removeValidated("never-there")).not.toThrow();
  });
});
