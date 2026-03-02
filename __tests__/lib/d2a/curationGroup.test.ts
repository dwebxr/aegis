/**
 * @jest-environment jsdom
 */
import { loadGroups, saveGroup, removeGroup, addMember, removeMember } from "@/lib/d2a/curationGroup";
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

describe("CurationGroup Storage", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("returns empty array when no groups", () => {
    expect(loadGroups()).toEqual([]);
  });

  it("saves and loads a group", () => {
    saveGroup(makeGroup());
    const groups = loadGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Test Group");
  });

  it("updates existing group by id", () => {
    saveGroup(makeGroup({ name: "Original" }));
    saveGroup(makeGroup({ name: "Updated" }));
    const groups = loadGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Updated");
  });

  it("saves multiple groups with different ids", () => {
    saveGroup(makeGroup({ id: "g1" }));
    saveGroup(makeGroup({ id: "g2", dTag: "aegis-group-g2" }));
    expect(loadGroups()).toHaveLength(2);
  });

  it("removes a group by id", () => {
    saveGroup(makeGroup({ id: "g1" }));
    saveGroup(makeGroup({ id: "g2", dTag: "aegis-group-g2" }));
    removeGroup("g1");
    const groups = loadGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("g2");
  });

  it("removes non-existent group without error", () => {
    saveGroup(makeGroup());
    removeGroup("non-existent");
    expect(loadGroups()).toHaveLength(1);
  });

  it("adds a member to group", () => {
    saveGroup(makeGroup({ members: ["owner"] }));
    addMember("g1", "new-member");
    const groups = loadGroups();
    expect(groups[0].members).toEqual(["owner", "new-member"]);
  });

  it("does not add duplicate member", () => {
    saveGroup(makeGroup({ members: ["owner", "existing"] }));
    addMember("g1", "existing");
    expect(loadGroups()[0].members).toEqual(["owner", "existing"]);
  });

  it("does nothing when adding to non-existent group", () => {
    saveGroup(makeGroup());
    addMember("non-existent", "someone");
    expect(loadGroups()).toHaveLength(1);
  });

  it("removes a member from group", () => {
    saveGroup(makeGroup({ members: ["owner", "member1", "member2"] }));
    removeMember("g1", "member1");
    expect(loadGroups()[0].members).toEqual(["owner", "member2"]);
  });

  it("does nothing when removing non-existent member", () => {
    saveGroup(makeGroup({ members: ["owner"] }));
    removeMember("g1", "non-existent");
    expect(loadGroups()[0].members).toEqual(["owner"]);
  });

  it("enforces 50 group limit", () => {
    for (let i = 0; i < 55; i++) {
      saveGroup(makeGroup({ id: `g${i}`, dTag: `aegis-group-g${i}`, createdAt: i }));
    }
    expect(loadGroups().length).toBeLessThanOrEqual(50);
  });
});
