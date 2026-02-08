"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { createBackendActor } from "@/lib/ic/actor";
import { SAMPLE_CONTENT } from "@/lib/utils/constants";
import { relativeTime } from "@/lib/utils/scores";
import type { ContentItem } from "@/lib/types/content";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import type { _SERVICE } from "@/lib/ic/declarations";

interface ContentState {
  content: ContentItem[];
  isAnalyzing: boolean;
  isSyncing: boolean;
  syncStatus: "idle" | "syncing" | "synced" | "offline";
  analyze: (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }) => Promise<AnalyzeResponse>;
  validateItem: (id: string) => void;
  flagItem: (id: string) => void;
  addContent: (item: ContentItem) => void;
  syncToIC: () => Promise<void>;
  loadFromIC: () => Promise<void>;
}

type PreferenceCallbacks = {
  onValidate?: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
  onFlag?: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
};

const ContentContext = createContext<ContentState>({
  content: [],
  isAnalyzing: false,
  isSyncing: false,
  syncStatus: "idle",
  analyze: async () => ({ originality: 0, insight: 0, credibility: 0, composite: 0, verdict: "slop" as const, reason: "" }),
  validateItem: () => {},
  flagItem: () => {},
  addContent: () => {},
  syncToIC: async () => {},
  loadFromIC: async () => {},
});

export function ContentProvider({ children, preferenceCallbacks }: { children: React.ReactNode; preferenceCallbacks?: PreferenceCallbacks }) {
  const { isAuthenticated, identity, principal } = useAuth();
  const [content, setContent] = useState<ContentItem[]>(SAMPLE_CONTENT);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "offline">("idle");
  const actorRef = useRef<_SERVICE | null>(null);

  useEffect(() => {
    if (isAuthenticated && identity) {
      try {
        actorRef.current = createBackendActor(identity);
        setSyncStatus("idle");
      } catch (err) {
        console.error("Failed to create IC actor:", err);
        actorRef.current = null;
        setSyncStatus("offline");
      }
    } else {
      actorRef.current = null;
      setSyncStatus("offline");
    }
  }, [isAuthenticated, identity]);

  useEffect(() => {
    const iv = setInterval(() => {
      setContent(prev => prev.map(c => ({ ...c, timestamp: relativeTime(c.createdAt) })));
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  const analyze = useCallback(async (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }): Promise<AnalyzeResponse> => {
    setIsAnalyzing(true);
    try {
    const body: Record<string, unknown> = { text, source: "manual" };
    if (userContext) body.userContext = userContext;
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Analyze API returned ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();

    const result: AnalyzeResponse = data.fallback || data;

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

    if (actorRef.current && isAuthenticated) {
      actorRef.current.saveEvaluation({
        id: evaluation.id,
        owner: principal!,
        author: evaluation.author,
        avatar: evaluation.avatar,
        text: evaluation.text,
        source: meta?.sourceUrl ? { url: null } : { manual: null },
        sourceUrl: evaluation.sourceUrl ? [evaluation.sourceUrl] as [string] : [] as [],
        scores: {
          originality: Math.round(evaluation.scores.originality),
          insight: Math.round(evaluation.scores.insight),
          credibility: Math.round(evaluation.scores.credibility),
          compositeScore: evaluation.scores.composite,
        },
        verdict: evaluation.verdict === "quality" ? { quality: null } : { slop: null },
        reason: evaluation.reason,
        createdAt: BigInt(evaluation.createdAt * 1_000_000),
        validated: evaluation.validated,
        flagged: evaluation.flagged,
      }).catch((err: unknown) => console.warn("IC saveEvaluation failed:", err));
    }

    return result;
    } finally { setIsAnalyzing(false); }
  }, [isAuthenticated, principal]);

  const validateItem = useCallback((id: string) => {
    setContent(prev => {
      const item = prev.find(c => c.id === id);
      if (item && preferenceCallbacks?.onValidate) {
        preferenceCallbacks.onValidate(item.topics || [], item.author, item.scores.composite, item.verdict);
      }
      if (item && actorRef.current && isAuthenticated) {
        actorRef.current.updateEvaluation(id, true, item.flagged)
          .catch((err: unknown) => console.warn("IC updateEvaluation (validate) failed:", err));
      }
      return prev.map(c => c.id === id ? { ...c, validated: true } : c);
    });
  }, [isAuthenticated, preferenceCallbacks]);

  const flagItem = useCallback((id: string) => {
    setContent(prev => {
      const item = prev.find(c => c.id === id);
      if (item && preferenceCallbacks?.onFlag) {
        preferenceCallbacks.onFlag(item.topics || [], item.author, item.scores.composite, item.verdict);
      }
      if (item && actorRef.current && isAuthenticated) {
        actorRef.current.updateEvaluation(id, item.validated, true)
          .catch((err: unknown) => console.warn("IC updateEvaluation (flag) failed:", err));
      }
      return prev.map(c => c.id === id ? { ...c, flagged: true } : c);
    });
  }, [isAuthenticated, preferenceCallbacks]);

  const addContent = useCallback((item: ContentItem) => {
    setContent(prev => [item, ...prev]);
  }, []);

  const syncToIC = useCallback(async () => {
    if (!actorRef.current || !isAuthenticated || !principal) return;
    setIsSyncing(true);
    setSyncStatus("syncing");

    const userContent = content.filter(c => c.owner === principal.toText());
    if (userContent.length === 0) {
      setIsSyncing(false);
      setSyncStatus("synced");
      return;
    }

    const mapSource = (s: string) => {
      switch (s) {
        case "rss": return { rss: null };
        case "url": return { url: null };
        case "twitter": return { twitter: null };
        case "nostr": return { nostr: null };
        default: return { manual: null };
      }
    };

    const evals = userContent.map(c => ({
      id: c.id,
      owner: principal,
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
    }));

    try {
      await actorRef.current.batchSaveEvaluations(evals);
      setSyncStatus("synced");
    } catch (err) {
      console.error("Failed to sync to IC:", err);
      setSyncStatus("offline");
    } finally {
      setIsSyncing(false);
    }
  }, [content, isAuthenticated, principal]);

  const loadFromIC = useCallback(async () => {
    if (!actorRef.current || !isAuthenticated || !principal) return;
    setIsSyncing(true);
    setSyncStatus("syncing");

    try {
      const icEvals = await actorRef.current.getUserEvaluations(principal, BigInt(0), BigInt(100));

      const mapSourceBack = (s: { manual: null } | { rss: null } | { url: null } | { twitter: null } | { nostr: null }): string => {
        if ("manual" in s) return "manual";
        if ("rss" in s) return "rss";
        if ("url" in s) return "url";
        if ("twitter" in s) return "twitter";
        if ("nostr" in s) return "nostr";
        return "manual";
      };

      const loaded: ContentItem[] = icEvals.map(e => ({
        id: e.id,
        owner: e.owner.toText(),
        author: e.author,
        avatar: e.avatar,
        text: e.text,
        source: mapSourceBack(e.source) as ContentItem["source"],
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
      console.error("Failed to load from IC:", err);
      setSyncStatus("offline");
    } finally {
      setIsSyncing(false);
    }
  }, [isAuthenticated, principal]);

  return (
    <ContentContext.Provider value={{
      content, isAnalyzing, isSyncing, syncStatus,
      analyze, validateItem, flagItem, addContent, syncToIC, loadFromIC,
    }}>
      {children}
    </ContentContext.Provider>
  );
}

export function useContent() {
  return useContext(ContentContext);
}
