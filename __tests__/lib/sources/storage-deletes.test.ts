/**
 * Tests for pendingDeletes persistence in source storage.
 * Verifies that source deletions survive tab close / component remount.
 *
 * @jest-environment jsdom
 */

import { loadPendingDeletes, savePendingDeletes, loadSources, saveSources } from "@/lib/sources/storage";

const PRINCIPAL = "test-principal-abc";

beforeEach(() => {
  localStorage.clear();
});

describe("savePendingDeletes / loadPendingDeletes", () => {
  it("returns empty set when nothing saved", () => {
    const result = loadPendingDeletes(PRINCIPAL);
    expect(result).toEqual(new Set());
  });

  it("round-trips a set of IDs", () => {
    const ids = new Set(["id-1", "id-2", "id-3"]);
    savePendingDeletes(PRINCIPAL, ids);
    const loaded = loadPendingDeletes(PRINCIPAL);
    expect(loaded).toEqual(ids);
  });

  it("removes localStorage entry when set is empty", () => {
    savePendingDeletes(PRINCIPAL, new Set(["id-1"]));
    expect(localStorage.getItem("aegis_pending_deletes_" + PRINCIPAL)).not.toBeNull();

    savePendingDeletes(PRINCIPAL, new Set());
    expect(localStorage.getItem("aegis_pending_deletes_" + PRINCIPAL)).toBeNull();
  });

  it("isolates by principal — different principals have separate delete sets", () => {
    savePendingDeletes("alice", new Set(["a1"]));
    savePendingDeletes("bob", new Set(["b1", "b2"]));

    expect(loadPendingDeletes("alice")).toEqual(new Set(["a1"]));
    expect(loadPendingDeletes("bob")).toEqual(new Set(["b1", "b2"]));
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem("aegis_pending_deletes_" + PRINCIPAL, "not-json{{{");
    expect(loadPendingDeletes(PRINCIPAL)).toEqual(new Set());
  });

  it("handles non-array JSON gracefully", () => {
    localStorage.setItem("aegis_pending_deletes_" + PRINCIPAL, '{"not":"array"}');
    expect(loadPendingDeletes(PRINCIPAL)).toEqual(new Set());
  });

  it("filters out non-string values from stored array", () => {
    localStorage.setItem("aegis_pending_deletes_" + PRINCIPAL, JSON.stringify(["valid-id", 123, null, true]));
    expect(loadPendingDeletes(PRINCIPAL)).toEqual(new Set(["valid-id"]));
  });
});

describe("loadSources filters pendingDeletes", () => {
  it("loadSources does not filter by itself — filtering is done by caller", () => {
    // Save sources including one that should be deleted
    const sources = [
      { id: "keep", type: "rss", label: "Keep", enabled: true, feedUrl: "https://keep.com/feed", createdAt: 1000 },
      { id: "delete-me", type: "rss", label: "Delete", enabled: true, feedUrl: "https://delete.com/feed", createdAt: 2000 },
    ];
    saveSources(PRINCIPAL, sources as import("@/lib/types/sources").SavedSource[]);

    // loadSources returns all — filtering is responsibility of SourceContext
    const loaded = loadSources(PRINCIPAL);
    expect(loaded).toHaveLength(2);

    // Caller should filter using pendingDeletes
    const pendingDeletes = new Set(["delete-me"]);
    const filtered = loaded.filter(s => !pendingDeletes.has(s.id));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("keep");
  });
});

describe("deletion lifecycle", () => {
  it("simulates full delete → close tab → reopen flow", () => {
    // 1. User has sources saved
    const sources = [
      { id: "src-1", type: "rss", label: "Feed 1", enabled: true, feedUrl: "https://a.com/feed", createdAt: 1000 },
      { id: "src-2", type: "rss", label: "Feed 2", enabled: true, feedUrl: "https://b.com/feed", createdAt: 2000 },
    ];
    saveSources(PRINCIPAL, sources as import("@/lib/types/sources").SavedSource[]);

    // 2. User deletes src-2 — SourceContext would call:
    const remaining = sources.filter(s => s.id !== "src-2");
    saveSources(PRINCIPAL, remaining as import("@/lib/types/sources").SavedSource[]);
    const pendingDeletes = new Set(["src-2"]);
    savePendingDeletes(PRINCIPAL, pendingDeletes);

    // 3. Tab closes (state lost), tab reopens — SourceContext would call:
    const restoredDeletes = loadPendingDeletes(PRINCIPAL);
    const loaded = loadSources(PRINCIPAL).filter(s => !restoredDeletes.has(s.id));

    // src-2 should NOT be in loaded sources
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("src-1");
    expect(restoredDeletes.has("src-2")).toBe(true);

    // 4. After IC delete succeeds — SourceContext would call:
    restoredDeletes.delete("src-2");
    savePendingDeletes(PRINCIPAL, restoredDeletes);

    // 5. Verify cleanup
    expect(loadPendingDeletes(PRINCIPAL)).toEqual(new Set());
    expect(localStorage.getItem("aegis_pending_deletes_" + PRINCIPAL)).toBeNull();
  });

  it("handles IC sync re-fetching deleted source — pendingDeletes blocks restoration", () => {
    // IC returns sources including one the user deleted locally
    const icSources = [
      { id: "ic-1", type: "rss", label: "IC Feed", enabled: true, feedUrl: "https://ic.com/feed", createdAt: 1000 },
      { id: "deleted-locally", type: "rss", label: "Deleted", enabled: true, feedUrl: "https://gone.com/feed", createdAt: 2000 },
    ];

    // User deleted "deleted-locally" — pendingDeletes has it
    const pendingDeletes = new Set(["deleted-locally"]);
    savePendingDeletes(PRINCIPAL, pendingDeletes);

    // doSync filters IC sources by pendingDeletes
    const filtered = icSources.filter(s => !pendingDeletes.has(s.id));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("ic-1");
  });
});
