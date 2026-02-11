"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { relativeTime } from "@/lib/utils/scores";
import { useNotify } from "./NotificationContext";
import type { ContentItem } from "@/lib/types/content";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import type { _SERVICE, ContentSource } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";

const CONTENT_CACHE_KEY = "aegis-content-cache";
const MAX_CACHED_ITEMS = 200;

function loadCachedContent(): ContentItem[] {
  if (typeof globalThis.localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CONTENT_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c: unknown): c is ContentItem =>
        !!c && typeof c === "object" &&
        typeof (c as ContentItem).id === "string" &&
        typeof (c as ContentItem).createdAt === "number",
    );
  } catch {
    return [];
  }
}

function saveCachedContent(items: ContentItem[]): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(items.slice(0, MAX_CACHED_ITEMS)));
  } catch {
    // localStorage full — ignore
  }
}

interface ContentState {
  content: ContentItem[];
  isAnalyzing: boolean;
  syncStatus: "idle" | "syncing" | "synced" | "offline";
  analyze: (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }) => Promise<AnalyzeResponse>;
  validateItem: (id: string) => void;
  flagItem: (id: string) => void;
  addContent: (item: ContentItem) => void;
  clearDemoContent: () => void;
  loadFromIC: () => Promise<void>;
}

type PreferenceCallbacks = {
  onValidate?: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
  onFlag?: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
};

const ContentContext = createContext<ContentState>({
  content: [],
  isAnalyzing: false,
  syncStatus: "idle",
  analyze: async () => ({ originality: 0, insight: 0, credibility: 0, composite: 0, verdict: "slop" as const, reason: "" }),
  validateItem: () => {},
  flagItem: () => {},
  addContent: () => {},
  clearDemoContent: () => {},
  loadFromIC: async () => {},
});

function mapSource(s: string): ContentSource {
  switch (s) {
    case "rss": return { rss: null };
    case "url": return { url: null };
    case "twitter": return { twitter: null };
    case "nostr": return { nostr: null };
    default: return { manual: null };
  }
}

function mapSourceBack(s: ContentSource): string {
  if ("rss" in s) return "rss";
  if ("url" in s) return "url";
  if ("twitter" in s) return "twitter";
  if ("nostr" in s) return "nostr";
  return "manual";
}

function toICEvaluation(c: ContentItem, owner: import("@dfinity/principal").Principal) {
  return {
    id: c.id,
    owner,
    author: c.author,
    avatar: c.avatar,
    text: c.text,
    source: mapSource(c.source),
    sourceUrl: c.sourceUrl ? [c.sourceUrl] as [string] : [] as [],
    scores: {
      originality: Math.round(c.scores.originality),
      insight: Math.round(c.scores.insight),
      credibility: Math.round(c.scores.credibility),
      compositeScore: c.scores.composite,
    },
    verdict: c.verdict === "quality" ? { quality: null } : { slop: null },
    reason: c.reason,
    createdAt: BigInt(c.createdAt * 1_000_000),
    validated: c.validated,
    flagged: c.flagged,
  };
}

export function ContentProvider({ children, preferenceCallbacks }: { children: React.ReactNode; preferenceCallbacks?: PreferenceCallbacks }) {
  const { addNotification } = useNotify();
  const { isAuthenticated, identity, principal } = useAuth();
  const [content, setContent] = useState<ContentItem[]>(() => loadCachedContent());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "offline">("idle");
  const actorRef = useRef<_SERVICE | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (isAuthenticated && identity) {
      createBackendActorAsync(identity)
        .then(actor => {
          actorRef.current = actor;
          setSyncStatus("idle");
        })
        .catch((err: unknown) => {
          console.error("[content] Failed to create IC actor:", errMsg(err));
          actorRef.current = null;
          setSyncStatus("offline");
          addNotification("Could not connect to IC — content won't sync", "error");
        });
    } else {
      actorRef.current = null;
      setSyncStatus("offline");
    }
  }, [isAuthenticated, identity, addNotification]);

  // Persist content to localStorage whenever it changes
  useEffect(() => {
    saveCachedContent(content);
  }, [content]);

  useEffect(() => {
    const timestampTimer = setInterval(() => {
      setContent(prev => {
        let changed = false;
        const next = prev.map(c => {
          const ts = relativeTime(c.createdAt);
          if (ts !== c.timestamp) {
            changed = true;
            return { ...c, timestamp: ts };
          }
          return c;
        });
        return changed ? next : prev;
      });
    }, 30000);
    return () => clearInterval(timestampTimer);
  }, []);

  const analyze = useCallback(async (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }): Promise<AnalyzeResponse> => {
    setIsAnalyzing(true);
    try {
    let result: AnalyzeResponse | null = null;

    // Tier 1: IC LLM via canister (free, on-chain)
    if (actorRef.current && isAuthenticated) {
      try {
        const topics = userContext
          ? [...(userContext.highAffinityTopics || []), ...(userContext.recentTopics || [])].slice(0, 10)
          : [];
        const icResult = await Promise.race([
          actorRef.current.analyzeOnChain(text.slice(0, 3000), topics),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("IC LLM timeout (30s)")), 30_000)),
        ]);
        if ("ok" in icResult) {
          const a = icResult.ok;
          result = {
            originality: a.originality,
            insight: a.insight,
            credibility: a.credibility,
            composite: a.compositeScore,
            verdict: "quality" in a.verdict ? "quality" : "slop",
            reason: a.reason,
            topics: a.topics,
            vSignal: a.vSignal.length > 0 ? a.vSignal[0] : undefined,
            cContext: a.cContext.length > 0 ? a.cContext[0] : undefined,
            lSlop: a.lSlop.length > 0 ? a.lSlop[0] : undefined,
          };
        } else if ("err" in icResult) {
          console.warn("[analyze] IC LLM returned error, falling back to API:", icResult.err);
        }
      } catch (err) {
        console.warn("[analyze] IC LLM failed, falling back to API:", errMsg(err));
      }
    }

    // Tier 2: Claude API via /api/analyze (premium / fallback)
    if (!result) {
      const body: Record<string, unknown> = { text, source: "manual" };
      if (userContext) body.userContext = userContext;
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        // API failed but may include heuristic fallback
        if (data.fallback) {
          console.warn(`[analyze] API returned ${res.status}, using fallback (tier: ${data.fallback.tier})`);
          result = data.fallback;
        } else {
          throw new Error(`Analyze API returned ${res.status}: ${data.error || res.statusText}`);
        }
      } else {
        result = data;
      }
    }

    if (!result) {
      throw new Error("Analysis failed: no result from IC LLM or API");
    }

    const evaluation: ContentItem = {
      id: uuidv4(),
      owner: principal ? principal.toText() : "",
      author: "You",
      avatar: "\u{1F50D}",
      text: text.slice(0, 300),
      source: meta?.sourceUrl ? "url" : "manual",
      sourceUrl: meta?.sourceUrl,
      imageUrl: meta?.imageUrl,
      scores: {
        originality: result.originality,
        insight: result.insight,
        credibility: result.credibility,
        composite: result.composite,
      },
      verdict: result.verdict,
      reason: result.reason,
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "just now",
      topics: result.topics,
      vSignal: result.vSignal,
      cContext: result.cContext,
      lSlop: result.lSlop,
    };
    setContent(prev => [evaluation, ...prev]);

    if (actorRef.current && isAuthenticated && principal) {
      actorRef.current.saveEvaluation(toICEvaluation(evaluation, principal)).catch((err: unknown) => {
        console.warn("[content] IC saveEvaluation failed:", errMsg(err));
        setSyncStatus("offline");
        addNotification("Evaluation saved locally but IC sync failed", "error");
      });
    }

    return result;
    } finally { setIsAnalyzing(false); }
  }, [isAuthenticated, principal, addNotification]);

  const validateItem = useCallback((id: string) => {
    const item = contentRef.current.find(c => c.id === id);
    setContent(prev => prev.map(c => c.id === id ? { ...c, validated: true } : c));
    if (item && preferenceCallbacks?.onValidate) {
      preferenceCallbacks.onValidate(item.topics || [], item.author, item.scores.composite, item.verdict);
    }
    if (item && actorRef.current && isAuthenticated) {
      actorRef.current.updateEvaluation(id, true, item.flagged)
        .catch((err: unknown) => {
          console.warn("[content] IC updateEvaluation (validate) failed:", errMsg(err));
          setSyncStatus("offline");
          addNotification("Validation saved locally but IC sync failed", "error");
        });
    }
  }, [isAuthenticated, preferenceCallbacks, addNotification]);

  const flagItem = useCallback((id: string) => {
    const item = contentRef.current.find(c => c.id === id);
    setContent(prev => prev.map(c => c.id === id ? { ...c, flagged: true } : c));
    if (item && preferenceCallbacks?.onFlag) {
      preferenceCallbacks.onFlag(item.topics || [], item.author, item.scores.composite, item.verdict);
    }
    if (item && actorRef.current && isAuthenticated) {
      actorRef.current.updateEvaluation(id, item.validated, true)
        .catch((err: unknown) => {
          console.warn("[content] IC updateEvaluation (flag) failed:", errMsg(err));
          setSyncStatus("offline");
          addNotification("Flag saved locally but IC sync failed", "error");
        });
    }
  }, [isAuthenticated, preferenceCallbacks, addNotification]);

  const addContent = useCallback((item: ContentItem) => {
    // Deduplicate by sourceUrl (URL/RSS) or by text (manual/nostr)
    const isDuplicate = contentRef.current.some(c =>
      (item.sourceUrl && c.sourceUrl === item.sourceUrl) ||
      (!item.sourceUrl && c.text === item.text),
    );
    if (isDuplicate) return;

    // Set owner if authenticated and item has no owner (e.g. scheduler items)
    const owned = (!item.owner && isAuthenticated && principal)
      ? { ...item, owner: principal.toText() }
      : item;

    setContent(prev => [owned, ...prev]);

    // Persist to IC canister (fire-and-forget)
    if (actorRef.current && isAuthenticated && principal) {
      actorRef.current.saveEvaluation(toICEvaluation(owned, principal)).catch((err: unknown) => {
        console.warn("[content] IC save (addContent) failed:", errMsg(err));
        setSyncStatus("offline");
        addNotification("Content saved locally but IC sync failed", "error");
      });
    }
  }, [isAuthenticated, principal, addNotification]);

  const clearDemoContent = useCallback(() => {
    setContent(prev => prev.filter(c => c.owner !== ""));
  }, []);

  const loadFromIC = useCallback(async () => {
    if (!actorRef.current || !isAuthenticated || !principal) return;
    setSyncStatus("syncing");

    try {
      const PAGE_SIZE = BigInt(100);
      const allEvals: Awaited<ReturnType<_SERVICE["getUserEvaluations"]>> = [];
      let offset = BigInt(0);
      for (;;) {
        const page = await actorRef.current.getUserEvaluations(principal, offset, PAGE_SIZE);
        allEvals.push(...page);
        if (BigInt(page.length) < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      const loaded: ContentItem[] = allEvals.map(e => ({
        id: e.id,
        owner: e.owner.toText(),
        author: e.author,
        avatar: e.avatar,
        text: e.text,
        source: mapSourceBack(e.source) as ContentItem["source"],
        sourceUrl: e.sourceUrl.length > 0 ? e.sourceUrl[0] : undefined,
        scores: {
          originality: e.scores.originality,
          insight: e.scores.insight,
          credibility: e.scores.credibility,
          composite: e.scores.compositeScore,
        },
        verdict: ("quality" in e.verdict ? "quality" : "slop") as ContentItem["verdict"],
        reason: e.reason,
        createdAt: Number(e.createdAt) / 1_000_000,
        validated: e.validated,
        flagged: e.flagged,
        timestamp: relativeTime(Number(e.createdAt) / 1_000_000),
      }));

      if (loaded.length > 0) {
        setContent(prev => {
          const existingIds = new Set(loaded.map(l => l.id));
          const nonDuplicates = prev.filter(c => !existingIds.has(c.id));
          return [...loaded, ...nonDuplicates];
        });
      }

      setSyncStatus("synced");
    } catch (err) {
      console.error("[content] Failed to load from IC:", errMsg(err));
      setSyncStatus("offline");
      addNotification("Could not load content history from IC", "error");
    }
  }, [isAuthenticated, principal, addNotification]);

  const value = useMemo(() => ({
    content, isAnalyzing, syncStatus,
    analyze, validateItem, flagItem, addContent, clearDemoContent, loadFromIC,
  }), [content, isAnalyzing, syncStatus, analyze, validateItem, flagItem, addContent, clearDemoContent, loadFromIC]);

  return (
    <ContentContext.Provider value={value}>
      {children}
    </ContentContext.Provider>
  );
}

export function useContent() {
  return useContext(ContentContext);
}
