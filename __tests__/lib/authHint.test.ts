/**
 * @jest-environment jsdom
 */
import { syncAuthHint } from "@/lib/authHint";

describe("syncAuthHint", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-auth-hint");
  });

  it("stores the hint when authenticated", () => {
    syncAuthHint(true);
    expect(localStorage.getItem("aegis-auth-hint")).toBe("1");
  });

  it("keeps the pre-paint attribute while authenticated (landing is unmounted by React anyway)", () => {
    document.documentElement.setAttribute("data-auth-hint", "1");
    syncAuthHint(true);
    expect(document.documentElement.getAttribute("data-auth-hint")).toBe("1");
  });

  it("clears both hint and attribute when unauthenticated so the hidden landing becomes visible", () => {
    localStorage.setItem("aegis-auth-hint", "1");
    document.documentElement.setAttribute("data-auth-hint", "1");
    syncAuthHint(false);
    expect(localStorage.getItem("aegis-auth-hint")).toBeNull();
    expect(document.documentElement.hasAttribute("data-auth-hint")).toBe(false);
  });

  it("still removes the attribute when localStorage throws (private mode)", () => {
    document.documentElement.setAttribute("data-auth-hint", "1");
    const spy = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    syncAuthHint(false);
    expect(document.documentElement.hasAttribute("data-auth-hint")).toBe(false);
    spy.mockRestore();
  });
});
