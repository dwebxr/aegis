/**
 * @jest-environment jsdom
 */
import { loadGroups, saveGroup, removeGroup } from "@/lib/d2a/curationGroup";
import type { CurationGroup } from "@/lib/d2a/curationGroup";

const STORAGE_KEY = "aegis-curation-groups";

function makeGroup(overrides: Partial<CurationGroup> = {}): CurationGroup {
  return {
    id: "g1",
    dTag: "aegis-group-g1",
    name: "Test Group",
    description: "A test group",
    topics: ["bitcoin"],
    members: ["owner-pk"],
    ownerPk: "owner-pk",
    createdAt: Date.now(),
    lastSynced: 0,
    ...overrides,
  };
}

describe("CurationGroup — error handling and edge cases", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty array for corrupt JSON in localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "{broken json");
    const spy = jest.spyOn(console, "warn").mockImplementation();
    const result = loadGroups();
    expect(result).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns empty array for non-array JSON", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "array" }));
    const result = loadGroups();
    expect(result).toEqual([]);
  });

  it("returns empty array for JSON null", () => {
    localStorage.setItem(STORAGE_KEY, "null");
    const result = loadGroups();
    expect(result).toEqual([]);
  });

  it("handles localStorage.setItem failure gracefully", () => {
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    // Should not throw
    saveGroup(makeGroup());

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[curation-group]"),
      expect.any(DOMException),
    );

    spy.mockRestore();
    warnSpy.mockRestore();
  });

  it("evicts oldest group when limit reached", () => {
    // Save 50 groups
    for (let i = 0; i < 50; i++) {
      saveGroup(makeGroup({ id: `g${i}`, dTag: `d${i}`, createdAt: i * 1000 }));
    }
    expect(loadGroups()).toHaveLength(50);

    // Save 51st group — oldest (createdAt=0) should be evicted
    saveGroup(makeGroup({ id: "new", dTag: "dnew", createdAt: 99999 }));
    const groups = loadGroups();
    expect(groups).toHaveLength(50);
    expect(groups.find(g => g.id === "g0")).toBeUndefined(); // oldest evicted
    expect(groups.find(g => g.id === "new")).toBeDefined();
  });

  it("removeGroup with empty storage is a no-op", () => {
    // Should not throw
    removeGroup("non-existent");
    expect(loadGroups()).toEqual([]);
  });

  it("handles empty string group id", () => {
    saveGroup(makeGroup({ id: "" }));
    const groups = loadGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("");
  });
});
