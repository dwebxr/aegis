"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { AppShell } from "@/components/layout/AppShell";
import { NotificationToast } from "@/components/ui/NotificationToast";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import { BriefingTab } from "@/components/tabs/BriefingTab";
import { IncineratorTab } from "@/components/tabs/IncineratorTab";
import { SourcesTab } from "@/components/tabs/SourcesTab";
import { AnalyticsTab } from "@/components/tabs/AnalyticsTab";
import { useWindowSize } from "@/hooks/useWindowSize";
import { useNotifications } from "@/hooks/useNotifications";
import { useContent } from "@/contexts/ContentContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferenceContext";
import { useSources } from "@/contexts/SourceContext";
import { IngestionScheduler } from "@/lib/ingestion/scheduler";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { publishSignalToNostr, buildAegisTags } from "@/lib/nostr/publish";
import type { AnalyzeResponse } from "@/lib/types/api";

export default function AegisApp() {
  const { mobile } = useWindowSize();
  const { notifications, addNotification } = useNotifications();
  const { content, isAnalyzing, analyze, validateItem, flagItem, addContent, loadFromIC } = useContent();
  const { isAuthenticated, principalText } = useAuth();
  const { userContext, profile } = usePreferences();
  const { getSchedulerSources } = useSources();

  const [tab, setTab] = useState("dashboard");

  const schedulerRef = useRef<IngestionScheduler | null>(null);
  const userContextRef = useRef(userContext);
  userContextRef.current = userContext;

  // Derive Nostr keypair from principal (memoized)
  const nostrKeys = useMemo(() => {
    if (!isAuthenticated || !principalText) return null;
    return deriveNostrKeypairFromText(principalText);
  }, [isAuthenticated, principalText]);

  useEffect(() => {
    if (isAuthenticated) {
      loadFromIC().catch((err: unknown) => console.warn("Failed to load from IC:", err));
    }
  }, [isAuthenticated, loadFromIC]);

  // Background ingestion scheduler
  const getSchedulerSourcesRef = useRef(getSchedulerSources);
  getSchedulerSourcesRef.current = getSchedulerSources;

  useEffect(() => {
    const scheduler = new IngestionScheduler({
      onNewContent: (item) => {
        addContent(item);
      },
      getSources: () => getSchedulerSourcesRef.current(),
      getUserContext: () => userContextRef.current,
    });
    schedulerRef.current = scheduler;
    scheduler.start();
    return () => scheduler.stop();
  }, [addContent]);


  const handleValidate = (id: string) => {
    validateItem(id);
    addNotification("Validated \u2713", "success");
  };

  const handleFlag = (id: string) => {
    flagItem(id);
    addNotification("Flagged as slop", "error");
  };

  const handleAnalyze = async (text: string) => {
    try {
      const result = await analyze(text, userContext);
      addNotification(
        result.verdict === "quality" ? "Quality confirmed \u2713" : "Slop identified \uD83D\uDD25",
        result.verdict === "quality" ? "success" : "error"
      );
      return result;
    } catch (err) {
      console.error("Analysis failed:", err);
      addNotification("Analysis failed — check connection", "error");
      throw err;
    }
  };

  const handlePublishSignal = useCallback(async (
    text: string,
    scores: AnalyzeResponse,
  ): Promise<{ eventId: string | null; relaysPublished: string[] }> => {
    if (!nostrKeys) {
      return { eventId: null, relaysPublished: [] };
    }

    const tags = buildAegisTags(scores.composite, scores.vSignal, scores.topics || []);

    // Publish to Nostr relays
    const result = await publishSignalToNostr(text, nostrKeys.sk, tags);

    // Also save to IC canister if available
    addContent({
      id: uuidv4(),
      owner: principalText,
      author: "You",
      avatar: "\uD83D\uDCE1",
      text: text.slice(0, 300),
      source: "manual",
      scores: {
        originality: scores.originality,
        insight: scores.insight,
        credibility: scores.credibility,
        composite: scores.composite,
      },
      verdict: scores.verdict,
      reason: scores.reason,
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "just now",
      topics: scores.topics,
      vSignal: scores.vSignal,
      cContext: scores.cContext,
      lSlop: scores.lSlop,
    });

    addNotification(
      result.relaysPublished.length > 0
        ? `Signal published to ${result.relaysPublished.length} relays`
        : "Signal saved locally (relay publish failed)",
      result.relaysPublished.length > 0 ? "success" : "error"
    );

    return {
      eventId: result.eventId,
      relaysPublished: result.relaysPublished,
    };
  }, [nostrKeys, principalText, addContent, addNotification]);

  return (
    <AppShell activeTab={tab} onTabChange={setTab}>
      {tab === "dashboard" && <DashboardTab content={content} mobile={mobile} onValidate={handleValidate} onFlag={handleFlag} />}
      {tab === "briefing" && <BriefingTab content={content} profile={profile} onValidate={handleValidate} onFlag={handleFlag} mobile={mobile} />}
      {tab === "incinerator" && (
        <IncineratorTab
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
          onPublishSignal={isAuthenticated ? handlePublishSignal : undefined}
          nostrPubkey={nostrKeys?.pk || null}
          mobile={mobile}
        />
      )}
      {tab === "sources" && <SourcesTab onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />}
      {tab === "analytics" && <AnalyticsTab content={content} mobile={mobile} />}
      <NotificationToast notifications={notifications} mobile={mobile} />
    </AppShell>
  );
}
