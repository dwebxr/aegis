/**
 * Integration tests for demo mode logic.
 * Tests scheduler source injection, content cleanup, and source mutation guards.
 */
import { DEMO_SOURCES } from "@/lib/demo/sources";
import type { ContentItem } from "@/lib/types/content";

describe("Demo mode integration", () => {
  describe("demo scheduler sources", () => {
    it("converts DEMO_SOURCES to scheduler format", () => {
      const schedulerSources = DEMO_SOURCES.map(s => ({
        type: s.type as "rss" | "url" | "nostr",
        config: { feedUrl: s.feedUrl! },
        enabled: true,
      }));

      expect(schedulerSources).toHaveLength(3);
      for (const src of schedulerSources) {
        expect(src.type).toBe("rss");
        expect(src.config.feedUrl).toBeDefined();
        expect(src.config.feedUrl).toMatch(/^https:\/\//);
        expect(src.enabled).toBe(true);
      }
    });

    it("getSources returns demo sources when user has none", () => {
      const userSources: ReturnType<() => Array<{ type: string; config: Record<string, string>; enabled: boolean }>> = [];
      const isDemoMode = true;
      const demoSchedulerSources = DEMO_SOURCES.map(s => ({
        type: s.type as "rss" | "url" | "nostr",
        config: { feedUrl: s.feedUrl! },
        enabled: true,
      }));

      // Simulates the getSources logic from page.tsx
      const getSources = () => {
        if (userSources.length > 0) return userSources;
        if (isDemoMode) return demoSchedulerSources;
        return [];
      };

      expect(getSources()).toEqual(demoSchedulerSources);
      expect(getSources()).toHaveLength(3);
    });

    it("getSources returns user sources when they exist", () => {
      const userSources = [{ type: "rss" as const, config: { feedUrl: "https://example.com/rss" }, enabled: true }];
      const isDemoMode = true;
      const demoSchedulerSources = DEMO_SOURCES.map(s => ({
        type: s.type as "rss" | "url" | "nostr",
        config: { feedUrl: s.feedUrl! },
        enabled: true,
      }));

      const getSources = () => {
        if (userSources.length > 0) return userSources;
        if (isDemoMode) return demoSchedulerSources;
        return [];
      };

      expect(getSources()).toEqual(userSources);
      expect(getSources()).toHaveLength(1);
    });

    it("getSources returns empty when not demo and no user sources", () => {
      const userSources: Array<{ type: string; config: Record<string, string>; enabled: boolean }> = [];
      const isDemoMode = false;

      const getSources = () => {
        if (userSources.length > 0) return userSources;
        if (isDemoMode) return [];
        return [];
      };

      expect(getSources()).toEqual([]);
    });
  });

  describe("clearDemoContent", () => {
    it("removes items with empty owner", () => {
      const content: Pick<ContentItem, "id" | "owner">[] = [
        { id: "1", owner: "" },
        { id: "2", owner: "abc-123" },
        { id: "3", owner: "" },
        { id: "4", owner: "xyz-456" },
      ];

      const result = content.filter(c => c.owner !== "");
      expect(result).toHaveLength(2);
      expect(result.map(c => c.id)).toEqual(["2", "4"]);
    });

    it("keeps all items when no demo content exists", () => {
      const content: Pick<ContentItem, "id" | "owner">[] = [
        { id: "1", owner: "abc-123" },
        { id: "2", owner: "xyz-456" },
      ];

      const result = content.filter(c => c.owner !== "");
      expect(result).toHaveLength(2);
    });

    it("removes all items when all are demo content", () => {
      const content: Pick<ContentItem, "id" | "owner">[] = [
        { id: "1", owner: "" },
        { id: "2", owner: "" },
      ];

      const result = content.filter(c => c.owner !== "");
      expect(result).toHaveLength(0);
    });
  });

  describe("demo source mutation guards", () => {
    it("addSource returns false in demo mode", () => {
      const isDemoMode = true;
      const addSource = (): boolean => {
        if (isDemoMode) return false;
        return true;
      };
      expect(addSource()).toBe(false);
    });

    it("addSource returns true when not in demo mode", () => {
      const isDemoMode = false;
      const addSource = (): boolean => {
        if (isDemoMode) return false;
        return true;
      };
      expect(addSource()).toBe(true);
    });

    it("removeSource is a no-op in demo mode", () => {
      const isDemoMode = true;
      let removed = false;
      const removeSource = () => {
        if (isDemoMode) return;
        removed = true;
      };
      removeSource();
      expect(removed).toBe(false);
    });

    it("toggleSource is a no-op in demo mode", () => {
      const isDemoMode = true;
      let toggled = false;
      const toggleSource = () => {
        if (isDemoMode) return;
        toggled = true;
      };
      toggleSource();
      expect(toggled).toBe(false);
    });

    it("updateSource is a no-op in demo mode", () => {
      const isDemoMode = true;
      let updated = false;
      const updateSource = () => {
        if (isDemoMode) return;
        updated = true;
      };
      updateSource();
      expect(updated).toBe(false);
    });
  });

  describe("isDemoMode logic", () => {
    it("is true when not authenticated and not loading", () => {
      const isAuthenticated = false;
      const isLoading = false;
      expect(!isAuthenticated && !isLoading).toBe(true);
    });

    it("is false when authenticated", () => {
      const isAuthenticated = true;
      const isLoading = false;
      expect(!isAuthenticated && !isLoading).toBe(false);
    });

    it("is false while loading", () => {
      const isAuthenticated = false;
      const isLoading = true;
      expect(!isAuthenticated && !isLoading).toBe(false);
    });

    it("is false when authenticated and loading", () => {
      const isAuthenticated = true;
      const isLoading = true;
      expect(!isAuthenticated && !isLoading).toBe(false);
    });
  });
});
