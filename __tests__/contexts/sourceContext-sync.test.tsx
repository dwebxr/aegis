/**
 * @jest-environment jsdom
 */
/**
 * SourceContext — IC sync integration tests.
 * Tests doSync flow: pending deletes flush, IC source fetch/merge,
 * content-key based deletion, IC conversion helpers, error handling.
 */
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import type { SavedSource } from "@/lib/types/sources";
import type { SourceConfigEntry } from "@/lib/ic/declarations";
import { Principal } from "@dfinity/principal";

/* ── In-memory stores ── */
const sourceStore = new Map<string, SavedSource[]>();
const deleteStore = new Map<string, Set<string>>();

/* ── Mock actor ── */
const mockDeleteSourceConfig = jest.fn<Promise<boolean>, [string]>();
const mockGetUserSourceConfigs = jest.fn<Promise<SourceConfigEntry[]>, [Principal]>();
const mockSaveSourceConfig = jest.fn<Promise<void>, [SourceConfigEntry]>();
const mockActor = {
  deleteSourceConfig: mockDeleteSourceConfig,
  getUserSourceConfigs: mockGetUserSourceConfigs,
  saveSourceConfig: mockSaveSourceConfig,
};

const TEST_PRINCIPAL = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");
const mockIdentity = { getPrincipal: () => TEST_PRINCIPAL };
const PRINCIPAL_TEXT = TEST_PRINCIPAL.toText();

let mockAuth: { isAuthenticated: boolean; identity: unknown; principalText: string } = {
  isAuthenticated: false, identity: null, principalText: "",
};
let mockDemo = { isDemoMode: false };
const mockAddNotification = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));
jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => mockDemo,
}));
jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: mockAddNotification, removeNotification: jest.fn() }),
}));
jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: jest.fn().mockImplementation(() => Promise.resolve(mockActor)),
}));
jest.mock("@/lib/sources/storage", () => ({
  loadSources: (pt: string) => sourceStore.get(pt) ?? [],
  saveSources: (pt: string, sources: SavedSource[]) => { sourceStore.set(pt, sources); },
  inferPlatform: () => undefined,
  loadPendingDeletes: (pt: string) => deleteStore.get(pt) ?? new Set<string>(),
  savePendingDeletes: (pt: string, ids: Set<string>) => {
    if (ids.size === 0) deleteStore.delete(pt);
    else deleteStore.set(pt, new Set(ids));
  },
}));
jest.mock("@/lib/ingestion/sourceState", () => ({
  getSourceKey: (type: string, config: Record<string, string>) => `${type}:${JSON.stringify(config)}`,
  resetSourceErrors: jest.fn(),
}));

import { SourceProvider, useSources } from "@/contexts/SourceContext";
import { createBackendActorAsync } from "@/lib/ic/actor";

/* ── Helpers ── */
function makeICSource(overrides: Partial<SourceConfigEntry> & { id: string }): SourceConfigEntry {
  return {
    owner: TEST_PRINCIPAL,
    sourceType: "rss",
    configJson: JSON.stringify({ label: overrides.id, feedUrl: `https://${overrides.id}.com/feed` }),
    enabled: true,
    createdAt: BigInt(Date.now()) * BigInt(1_000_000),
    ...overrides,
  };
}

function makeLocalSource(overrides: Partial<SavedSource> & { id: string }): SavedSource {
  return {
    type: "rss",
    label: overrides.id,
    enabled: true,
    feedUrl: `https://${overrides.id}.com/feed`,
    createdAt: Date.now(),
    ...overrides,
  };
}

let captured: { sources: SavedSource[]; syncStatus: string; syncError: string };

function Consumer() {
  const ctx = useSources();
  captured = { sources: ctx.sources, syncStatus: ctx.syncStatus, syncError: ctx.syncError };
  return (
    <div>
      <span data-testid="count">{ctx.sources.length}</span>
      <span data-testid="sync">{ctx.syncStatus}</span>
      <span data-testid="error">{ctx.syncError}</span>
      <span data-testid="ids">{ctx.sources.map(s => s.id).join(",")}</span>
      <button data-testid="add-rss" onClick={() => ctx.addSource({ type: "rss", label: "New Feed", enabled: true, feedUrl: "https://new.com/feed" })} />
      <button data-testid="remove-first" onClick={() => { if (ctx.sources[0]) ctx.removeSource(ctx.sources[0].id); }} />
    </div>
  );
}

function renderAuth() {
  return render(<SourceProvider><Consumer /></SourceProvider>);
}

beforeEach(() => {
  mockAuth = { isAuthenticated: true, identity: mockIdentity, principalText: PRINCIPAL_TEXT };
  mockDemo = { isDemoMode: false };
  mockAddNotification.mockClear();
  sourceStore.clear();
  deleteStore.clear();
  mockDeleteSourceConfig.mockReset().mockResolvedValue(true);
  mockGetUserSourceConfigs.mockReset().mockResolvedValue([]);
  mockSaveSourceConfig.mockReset().mockResolvedValue(undefined);
  (createBackendActorAsync as jest.Mock).mockReset().mockResolvedValue(mockActor);
  captured = { sources: [], syncStatus: "idle", syncError: "" };
});

// ─── IC Sync: doSync flow ───

describe("doSync — basic IC sync", () => {
  it("syncs IC sources on mount when authenticated", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "ic-1", configJson: JSON.stringify({ label: "IC Feed", feedUrl: "https://ic.com/feed" }) }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);
    expect(captured.sources[0].label).toBe("IC Feed");
    expect(captured.sources[0].feedUrl).toBe("https://ic.com/feed");
  });

  it("merges IC sources with local-only sources", async () => {
    sourceStore.set(PRINCIPAL_TEXT, [makeLocalSource({ id: "local-1", feedUrl: "https://local.com/feed" })]);
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "ic-1", configJson: JSON.stringify({ label: "IC", feedUrl: "https://ic.com/feed" }) }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(2);
    const ids = captured.sources.map(s => s.id);
    expect(ids).toContain("ic-1");
    expect(ids).toContain("local-1");
  });

  it("pushes local-only sources to IC", async () => {
    sourceStore.set(PRINCIPAL_TEXT, [makeLocalSource({ id: "local-1" })]);
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(mockSaveSourceConfig).toHaveBeenCalled());
    expect(mockSaveSourceConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: "local-1", sourceType: "rss" })
    );
  });

  it("deduplicates IC sources with same feedUrl", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "dup-1", configJson: JSON.stringify({ label: "Feed A", feedUrl: "https://same.com/feed" }) }),
      makeICSource({ id: "dup-2", configJson: JSON.stringify({ label: "Feed B", feedUrl: "https://same.com/feed" }) }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);
  });

  it("resets state when user logs out", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "ic-1" }),
    ]);
    const { rerender } = renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);

    mockAuth = { isAuthenticated: false, identity: null, principalText: "" };
    rerender(<SourceProvider><Consumer /></SourceProvider>);
    expect(captured.sources).toHaveLength(0);
    expect(captured.syncStatus).toBe("idle");
  });
});

// ─── Pending Deletes ───

describe("doSync — pending deletes flush", () => {
  it("flushes pending deletes to IC on sync", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["del-1", "del-2"]));
    mockDeleteSourceConfig.mockResolvedValue(true);
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(mockDeleteSourceConfig).toHaveBeenCalledWith("del-1");
    expect(mockDeleteSourceConfig).toHaveBeenCalledWith("del-2");
  });

  it("removes successfully deleted IDs from pendingDeletes", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["del-ok"]));
    mockDeleteSourceConfig.mockResolvedValue(true);
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(deleteStore.has(PRINCIPAL_TEXT)).toBe(false);
  });

  it("keeps failed delete IDs in pendingDeletes for retry", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["del-fail"]));
    mockDeleteSourceConfig.mockRejectedValue(new Error("network error"));
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    const remaining = deleteStore.get(PRINCIPAL_TEXT);
    expect(remaining).toBeDefined();
    expect(remaining!.has("del-fail")).toBe(true);
  });

  it("filters IC sources by pending delete IDs even when IC delete fails", async () => {
    // Delete call fails (network error), so ID stays in pendingDeletes
    // IC still returns the source, but it should be filtered out
    deleteStore.set(PRINCIPAL_TEXT, new Set(["to-delete"]));
    mockDeleteSourceConfig.mockRejectedValue(new Error("network"));
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "to-delete", configJson: JSON.stringify({ label: "Gone", feedUrl: "https://gone.com/feed" }) }),
      makeICSource({ id: "keep", configJson: JSON.stringify({ label: "Keep", feedUrl: "https://keep.com/feed" }) }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);
    expect(captured.sources[0].id).toBe("keep");
  });

  it("does not send content keys to deleteSourceConfig", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["real-id", "rss:https://example.com/feed"]));
    mockDeleteSourceConfig.mockResolvedValue(true);
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(mockDeleteSourceConfig).toHaveBeenCalledTimes(1);
    expect(mockDeleteSourceConfig).toHaveBeenCalledWith("real-id");
  });
});

// ─── Content Key Based Deletion ───

describe("content key based deletion", () => {
  it("filters IC sources with different ID but same feedUrl as deleted source", async () => {
    // User deleted "local-id" with feedUrl "https://vitalik.eth/feed"
    // IC has "ic-id" with same feedUrl — content key blocks it
    deleteStore.set(PRINCIPAL_TEXT, new Set(["local-id", "rss:https://vitalik.eth/feed"]));
    mockDeleteSourceConfig.mockResolvedValue(true);
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "ic-id", configJson: JSON.stringify({ label: "Vitalik", feedUrl: "https://vitalik.eth/feed" }) }),
      makeICSource({ id: "other", configJson: JSON.stringify({ label: "Other", feedUrl: "https://other.com/feed" }) }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);
    expect(captured.sources[0].id).toBe("other");
  });

  it("cleans up stale content keys after IC confirms source is gone", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["rss:https://gone.com/feed"]));
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(deleteStore.has(PRINCIPAL_TEXT)).toBe(false);
  });

  it("retains content key while IC still has matching source", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["rss:https://still-there.com/feed"]));
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "ic-x", configJson: JSON.stringify({ label: "X", feedUrl: "https://still-there.com/feed" }) }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    const pending = deleteStore.get(PRINCIPAL_TEXT);
    expect(pending).toBeDefined();
    expect(pending!.has("rss:https://still-there.com/feed")).toBe(true);
    expect(captured.sources).toHaveLength(0);
  });

  it("removeSource stores both ID and content key in pendingDeletes", async () => {
    // Make IC delete fail so pendingDeletes entries are not cleaned up by .then()
    mockDeleteSourceConfig.mockRejectedValue(new Error("offline"));
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "rm-1", configJson: JSON.stringify({ label: "Feed", feedUrl: "https://removeme.com/feed" }) }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);

    await act(async () => { screen.getByTestId("remove-first").click(); });
    const pending = deleteStore.get(PRINCIPAL_TEXT);
    expect(pending).toBeDefined();
    expect(pending!.has("rm-1")).toBe(true);
    expect(pending!.has("rss:https://removeme.com/feed")).toBe(true);
  });

  it("addSource clears content key from pendingDeletes for re-added source", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["old-id", "rss:https://new.com/feed"]));
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));

    await act(async () => { screen.getByTestId("add-rss").click(); });
    const pending = deleteStore.get(PRINCIPAL_TEXT);
    if (pending) {
      expect(pending.has("rss:https://new.com/feed")).toBe(false);
    }
    expect(captured.sources).toHaveLength(1);
  });

  it("content key works for nostr sources (sorted relays)", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["nostr:wss://relay.example.com"]));
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({
        id: "nostr-ic",
        sourceType: "nostr",
        configJson: JSON.stringify({ label: "Nostr", relays: ["wss://relay.example.com"], pubkeys: ["pk1"] }),
      }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(0);
  });

  it("content key works for farcaster sources (fid)", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["fc:5650"]));
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({
        id: "fc-ic",
        sourceType: "farcaster",
        configJson: JSON.stringify({ label: "Vitalik", fid: 5650, username: "vitalik" }),
      }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(0);
  });

  it("local sources with pending content key are excluded on load", async () => {
    sourceStore.set(PRINCIPAL_TEXT, [
      makeLocalSource({ id: "abc", feedUrl: "https://blocked.com/feed" }),
      makeLocalSource({ id: "def", feedUrl: "https://allowed.com/feed" }),
    ]);
    deleteStore.set(PRINCIPAL_TEXT, new Set(["rss:https://blocked.com/feed"]));
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);
    expect(captured.sources[0].id).toBe("def");
  });
});

// ─── IC Conversion: icToSaved ───

describe("doSync — icToSaved edge cases", () => {
  it("skips sources with corrupted configJson", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      { id: "bad", owner: TEST_PRINCIPAL, sourceType: "rss", configJson: "not-json{{{", enabled: true, createdAt: BigInt(0) },
      makeICSource({ id: "good", configJson: JSON.stringify({ label: "OK", feedUrl: "https://ok.com/feed" }) }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);
    expect(captured.sources[0].id).toBe("good");
  });

  it("skips sources with unknown sourceType", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      { id: "unknown", owner: TEST_PRINCIPAL, sourceType: "twitter", configJson: JSON.stringify({ label: "X" }), enabled: true, createdAt: BigInt(0) },
      makeICSource({ id: "good" }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);
    expect(captured.sources[0].id).toBe("good");
  });

  it("handles missing optional fields in configJson", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      { id: "minimal", owner: TEST_PRINCIPAL, sourceType: "rss", configJson: JSON.stringify({}), enabled: true, createdAt: BigInt(1000000000) },
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);
    expect(captured.sources[0].label).toBe("rss");
    expect(captured.sources[0].feedUrl).toBeUndefined();
  });

  it("parses nostr source with relays and pubkeys arrays", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({
        id: "nostr-1",
        sourceType: "nostr",
        configJson: JSON.stringify({
          label: "Nostr Feed",
          relays: ["wss://r1.example.com", "wss://r2.example.com"],
          pubkeys: ["pk-abc", "pk-def"],
        }),
      }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources[0].type).toBe("nostr");
    expect(captured.sources[0].relays).toEqual(["wss://r1.example.com", "wss://r2.example.com"]);
    expect(captured.sources[0].pubkeys).toEqual(["pk-abc", "pk-def"]);
  });

  it("parses farcaster source with fid and username", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({
        id: "fc-1",
        sourceType: "farcaster",
        configJson: JSON.stringify({ label: "Alice", fid: 42, username: "alice" }),
      }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources[0].type).toBe("farcaster");
    expect(captured.sources[0].fid).toBe(42);
    expect(captured.sources[0].username).toBe("alice");
  });

  it("converts createdAt from nanoseconds to milliseconds", async () => {
    const msTimestamp = 1700000000000;
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({
        id: "ts-1",
        createdAt: BigInt(msTimestamp) * BigInt(1_000_000),
      }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources[0].createdAt).toBe(msTimestamp);
  });

  it("rejects non-string arrays for relays/pubkeys", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({
        id: "bad-relays",
        sourceType: "nostr",
        configJson: JSON.stringify({ label: "Bad", relays: [1, 2, 3], pubkeys: "not-array" }),
      }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources[0].relays).toBeUndefined();
    expect(captured.sources[0].pubkeys).toBeUndefined();
  });

  it("parses platform field from IC configJson", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({
        id: "with-platform",
        configJson: JSON.stringify({ label: "YT", feedUrl: "https://youtube.com/feeds/videos.xml?channel_id=123", platform: "youtube" }),
      }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources[0].platform).toBe("youtube");
  });

  it("ignores invalid platform values", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({
        id: "bad-platform",
        configJson: JSON.stringify({ label: "X", feedUrl: "https://x.com/feed", platform: "nonexistent" }),
      }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources[0].platform).toBeUndefined();
  });

  it("preserves enabled=false from IC", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "disabled-ic", enabled: false }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources[0].enabled).toBe(false);
  });

  it("handles non-numeric fid gracefully", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({
        id: "bad-fid",
        sourceType: "farcaster",
        configJson: JSON.stringify({ label: "FC", fid: "not-a-number", username: "test" }),
      }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources[0].fid).toBeUndefined();
  });
});

// ─── Error Handling ───

describe("doSync — error handling", () => {
  it("handles actor creation failure", async () => {
    (createBackendActorAsync as jest.Mock).mockRejectedValue(new Error("no agent"));
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("error"));
    expect(captured.syncError).toContain("no agent");
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.stringContaining("IC sync unavailable"),
      "error"
    );
  });

  it("handles getUserSourceConfigs failure", async () => {
    mockGetUserSourceConfigs.mockRejectedValue(new Error("canister trapped"));
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("error"));
    expect(captured.syncError).toContain("canister trapped");
  });

  it("handles partial push failure (some local→IC fail)", async () => {
    sourceStore.set(PRINCIPAL_TEXT, [
      makeLocalSource({ id: "ok-1", feedUrl: "https://ok.com/feed" }),
      makeLocalSource({ id: "fail-1", feedUrl: "https://fail.com/feed" }),
    ]);
    mockGetUserSourceConfigs.mockResolvedValue([]);
    mockSaveSourceConfig.mockImplementation((entry) => {
      if (entry.id === "fail-1") return Promise.reject(new Error("save failed"));
      return Promise.resolve();
    });
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("error"));
    expect(captured.syncError).toContain("Some sources failed to sync");
    expect(mockSaveSourceConfig).toHaveBeenCalledTimes(2);
  });

  it("removeSource shows notification when actor not ready", async () => {
    // Start authenticated but with slow actor creation
    let resolveActor: (v: unknown) => void;
    (createBackendActorAsync as jest.Mock).mockImplementation(() => new Promise(r => { resolveActor = r; }));
    sourceStore.set(PRINCIPAL_TEXT, [makeLocalSource({ id: "s1" })]);
    renderAuth();
    // Actor is still pending — remove source while actor not ready
    await act(async () => { screen.getByTestId("remove-first").click(); });
    expect(mockAddNotification).toHaveBeenCalledWith("Source removed locally — IC sync pending", "info");
    // Clean up
    await act(async () => { resolveActor!(mockActor); });
  });
});

// ─── Concurrent / Async Behavior ───

describe("concurrent behavior", () => {
  it("cancels in-flight sync on unmount (no errors thrown)", async () => {
    // Make actor creation slow so unmount happens during sync
    let resolveActor: (v: unknown) => void;
    (createBackendActorAsync as jest.Mock).mockImplementation(() => new Promise(r => { resolveActor = r; }));

    const { unmount } = renderAuth();
    unmount();

    // Resolve after unmount — should not throw or update state
    await act(async () => { resolveActor!(mockActor); });
    // Test passes if no error is thrown
  });

  it("cancels in-flight sync on auth change (stale sources not added)", async () => {
    // Make actor creation slow
    let resolveActor: (v: unknown) => void;
    (createBackendActorAsync as jest.Mock).mockImplementation(() => new Promise(r => { resolveActor = r; }));
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "stale" }),
    ]);

    const { rerender } = renderAuth();

    // Log out before actor resolves
    mockAuth = { isAuthenticated: false, identity: null, principalText: "" };
    rerender(<SourceProvider><Consumer /></SourceProvider>);

    // Resolve old actor — sync should be cancelled
    await act(async () => { resolveActor!(mockActor); });
    expect(captured.sources).toHaveLength(0);
  });

  it("handles delete call rejection without blocking sync", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["del-err"]));
    mockDeleteSourceConfig.mockRejectedValue(new Error("delete failed"));
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "ok", configJson: JSON.stringify({ label: "OK", feedUrl: "https://ok.com/feed" }) }),
    ]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(captured.sources).toHaveLength(1);
    expect(captured.sources[0].id).toBe("ok");
  });
});

// ─── toggleSource / updateSource IC save ───

describe("toggleSource and updateSource IC save", () => {
  function ToggleUpdateConsumer() {
    const ctx = useSources();
    captured = { sources: ctx.sources, syncStatus: ctx.syncStatus, syncError: ctx.syncError };
    return (
      <div>
        <span data-testid="enabled">{ctx.sources.map(s => String(s.enabled)).join(",")}</span>
        <span data-testid="labels">{ctx.sources.map(s => s.label).join(",")}</span>
        <button data-testid="toggle-first" onClick={() => { if (ctx.sources[0]) ctx.toggleSource(ctx.sources[0].id); }} />
        <button data-testid="update-first" onClick={() => { if (ctx.sources[0]) ctx.updateSource(ctx.sources[0].id, { label: "Updated" }); }} />
        <button data-testid="toggle-missing" onClick={() => ctx.toggleSource("nonexistent-id")} />
        <button data-testid="update-missing" onClick={() => ctx.updateSource("nonexistent-id", { label: "X" })} />
      </div>
    );
  }

  it("toggleSource calls saveToIC with the toggled source", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "t1", configJson: JSON.stringify({ label: "Feed", feedUrl: "https://t1.com/feed" }), enabled: true }),
    ]);
    render(<SourceProvider><ToggleUpdateConsumer /></SourceProvider>);
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    mockSaveSourceConfig.mockClear();

    await act(async () => { screen.getByTestId("toggle-first").click(); });
    expect(screen.getByTestId("enabled").textContent).toBe("false");
    expect(mockSaveSourceConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1", enabled: false })
    );
  });

  it("updateSource calls saveToIC with the updated source", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([
      makeICSource({ id: "u1", configJson: JSON.stringify({ label: "Old", feedUrl: "https://u1.com/feed" }) }),
    ]);
    render(<SourceProvider><ToggleUpdateConsumer /></SourceProvider>);
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    mockSaveSourceConfig.mockClear();

    await act(async () => { screen.getByTestId("update-first").click(); });
    expect(screen.getByTestId("labels").textContent).toBe("Updated");
    expect(mockSaveSourceConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", configJson: expect.stringContaining("Updated") })
    );
  });

  it("toggleSource is no-op for nonexistent ID", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([]);
    render(<SourceProvider><ToggleUpdateConsumer /></SourceProvider>);
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    mockSaveSourceConfig.mockClear();

    await act(async () => { screen.getByTestId("toggle-missing").click(); });
    expect(mockSaveSourceConfig).not.toHaveBeenCalled();
  });

  it("updateSource is no-op for nonexistent ID", async () => {
    mockGetUserSourceConfigs.mockResolvedValue([]);
    render(<SourceProvider><ToggleUpdateConsumer /></SourceProvider>);
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    mockSaveSourceConfig.mockClear();

    await act(async () => { screen.getByTestId("update-missing").click(); });
    expect(mockSaveSourceConfig).not.toHaveBeenCalled();
  });
});

// ─── isContentKey / contentKey edge cases ───

describe("isContentKey and contentKey edge cases (via pendingDeletes behavior)", () => {
  it("UUID-like IDs with colons are NOT treated as content keys", async () => {
    // A source ID that contains ":" should still be sent to deleteSourceConfig
    deleteStore.set(PRINCIPAL_TEXT, new Set(["urn:uuid:abc-123"]));
    mockDeleteSourceConfig.mockResolvedValue(true);
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    // Should be sent to IC as a real ID, not skipped as content key
    expect(mockDeleteSourceConfig).toHaveBeenCalledWith("urn:uuid:abc-123");
  });

  it("content keys with known prefixes are NOT sent to deleteSourceConfig", async () => {
    deleteStore.set(PRINCIPAL_TEXT, new Set(["rss:https://x.com/feed", "nostr:wss://relay", "fc:999"]));
    mockDeleteSourceConfig.mockResolvedValue(true);
    mockGetUserSourceConfigs.mockResolvedValue([]);
    renderAuth();
    await waitFor(() => expect(captured.syncStatus).toBe("synced"));
    expect(mockDeleteSourceConfig).not.toHaveBeenCalled();
  });
});
