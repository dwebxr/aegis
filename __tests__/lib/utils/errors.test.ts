/**
 * Tests for lib/utils/errors.ts — errMsg utility.
 * Covers: Error objects, non-Error values, edge cases (null, undefined, objects, symbols).
 */
import { errMsg } from "@/lib/utils/errors";

describe("errMsg", () => {
  describe("Error instances", () => {
    it("extracts message from a standard Error", () => {
      expect(errMsg(new Error("something broke"))).toBe("something broke");
    });

    it("extracts message from a TypeError", () => {
      expect(errMsg(new TypeError("cannot read property"))).toBe("cannot read property");
    });

    it("extracts message from a RangeError", () => {
      expect(errMsg(new RangeError("out of bounds"))).toBe("out of bounds");
    });

    it("handles Error with empty message", () => {
      expect(errMsg(new Error(""))).toBe("");
    });

    it("handles Error subclass", () => {
      class CustomError extends Error {
        constructor(msg: string) {
          super(msg);
          this.name = "CustomError";
        }
      }
      expect(errMsg(new CustomError("custom issue"))).toBe("custom issue");
    });
  });

  describe("non-Error values", () => {
    it("stringifies a string", () => {
      expect(errMsg("plain string error")).toBe("plain string error");
    });

    it("stringifies a number", () => {
      expect(errMsg(42)).toBe("42");
    });

    it("stringifies zero", () => {
      expect(errMsg(0)).toBe("0");
    });

    it("stringifies NaN", () => {
      expect(errMsg(NaN)).toBe("NaN");
    });

    it("stringifies boolean true", () => {
      expect(errMsg(true)).toBe("true");
    });

    it("stringifies boolean false", () => {
      expect(errMsg(false)).toBe("false");
    });

    it("stringifies null", () => {
      expect(errMsg(null)).toBe("null");
    });

    it("stringifies undefined", () => {
      expect(errMsg(undefined)).toBe("undefined");
    });

    it("stringifies a plain object", () => {
      expect(errMsg({ code: 500, msg: "fail" })).toBe("[object Object]");
    });

    it("stringifies an object with custom toString", () => {
      const obj = { toString: () => "custom error repr" };
      expect(errMsg(obj)).toBe("custom error repr");
    });

    it("stringifies a bigint", () => {
      expect(errMsg(BigInt(123))).toBe("123");
    });

    it("stringifies a symbol", () => {
      expect(errMsg(Symbol("test"))).toBe("Symbol(test)");
    });

    it("stringifies an empty string", () => {
      expect(errMsg("")).toBe("");
    });

    it("stringifies an array", () => {
      expect(errMsg([1, 2, 3])).toBe("1,2,3");
    });
  });

  describe("boundary between Error and non-Error", () => {
    it("treats an Error-like object (with message property) as non-Error", () => {
      const fake = { message: "I look like an Error" };
      // Not an instanceof Error → String() path
      expect(errMsg(fake)).toBe("[object Object]");
    });

    it("treats an object created via Object.create(Error.prototype) as Error", () => {
      const proto = Object.create(Error.prototype);
      proto.message = "proto-error";
      expect(errMsg(proto)).toBe("proto-error");
    });
  });
});
