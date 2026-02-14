"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import { BriefingTab } from "@/components/tabs/BriefingTab";
import { IncineratorTab } from "@/components/tabs/IncineratorTab";
import { SourcesTab } from "@/components/tabs/SourcesTab";
import { AnalyticsTab } from "@/components/tabs/AnalyticsTab";
import { SettingsTab } from "@/components/tabs/SettingsTab";
import { useWindowSize } from "@/hooks/useWindowSize";
import { useNotify } from "@/contexts/NotificationContext";
import { useContent } from "@/contexts/ContentContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferenceContext";
import { useSources } from "@/contexts/SourceContext";
import { useAgent } from "@/contexts/AgentContext";
import { useDemo } from "@/contexts/DemoContext";
import { useFilterMode } from "@/contexts/FilterModeContext";
import { DEMO_SOURCES } from "@/lib/demo/sources";
import { buildFollowGraph } from "@/lib/wot/graph";
import { loadWoTCache, saveWoTCache } from "@/lib/wot/cache";
import { DEFAULT_WOT_CONFIG } from "@/lib/wot/types";
import type { WoTGraph } from "@/lib/wot/types";
import { runFilterPipeline } from "@/lib/filtering/pipeline";
import { detectSerendipity } from "@/lib/filtering/serendipity";
import type { SerendipityItem } from "@/lib/filtering/serendipity";
import { recordFilterRun } from "@/lib/filtering/costTracker";
import { DemoBanner } from "@/components/ui/DemoBanner";
import { IngestionScheduler } from "@/lib/ingestion/scheduler";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { publishSignalToNostr, buildAegisTags } from "@/lib/nostr/publish";
import { createNIP98AuthHeader } from "@/lib/nostr/nip98";
import { createICPLedgerActorAsync, ICP_FEE, type ICPLedgerActor } from "@/lib/ic/icpLedger";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { Principal } from "@dfinity/principal";
import { getCanisterId } from "@/lib/ic/agent";
import type { UserReputation } from "@/lib/ic/declarations";
import type { AnalyzeResponse } from "@/lib/types/api";
import { errMsg } from "@/lib/utils/errors";
import { checkPublishGate, type PublishGateDecision } from "@/lib/reputation/publishGate";

const MS_PER_HOUR = 60 * 60 * 1000;
const PUSH_THROTTLE: Record<string, number> = {
  "1x_day": 24 * MS_PER_HOUR,
  "3x_day": 8 * MS_PER_HOUR,
};

export default function AegisApp() {
  const { mobile } = useWindowSize();
  const { addNotification } = useNotify();
  const { content, isAnalyzing, syncStatus, analyze, validateItem, flagItem, addContent, clearDemoContent, loadFromIC } = useContent();
  const { isAuthenticated, identity, principalText } = useAuth();
  const { userContext, profile } = usePreferences();
  const { getSchedulerSources } = useSources();
  const { agentState, setWoTGraph: pushWoTGraph } = useAgent();
  const { isDemoMode } = useDemo();
  const { filterMode } = useFilterMode();

  const [tab, setTab] = useState("dashboard");
  const [icpBalance, setIcpBalance] = useState<bigint | null>(null);
  const [reputation, setReputation] = useState<UserReputation | null>(null);
  const [engagementIndex, setEngagementIndex] = useState<number | null>(null);
  const [wotGraph, setWotGraph] = useState<WoTGraph | null>(null);
  const [wotLoading, setWotLoading] = useState(false);
  const [publishGate, setPublishGate] = useState<PublishGateDecision | null>(null);

  const schedulerRef = useRef<IngestionScheduler | null>(null);
  const userContextRef = useRef(userContext);
  userContextRef.current = userContext;
  const ledgerRef = useRef<ICPLedgerActor | null>(null);

  const nostrKeys = useMemo(() => {
    if (!isAuthenticated || !principalText) return null;
    return deriveNostrKeypairFromText(principalText);
  }, [isAuthenticated, principalText]);

  useEffect(() => {
    if (!nostrKeys?.pk) { setPublishGate(null); return; }
    setPublishGate(checkPublishGate(nostrKeys.pk));
  }, [nostrKeys?.pk]);

  const filterModeRef = useRef(filterMode);
  filterModeRef.current = filterMode;

  useEffect(() => {
    if (!nostrKeys?.pk) {
      setWotGraph(null);
      return;
    }

    const cached = loadWoTCache();
    if (cached && cached.userPubkey === nostrKeys.pk) {
      setWotGraph(cached);
      return;
    }

    let cancelled = false;
    setWotLoading(true);

    buildFollowGraph(nostrKeys.pk, DEFAULT_WOT_CONFIG)
      .then(graph => {
        if (cancelled) return;
        setWotGraph(graph);
        saveWoTCache(graph, DEFAULT_WOT_CONFIG.cacheTTLMs);
      })
      .catch(err => {
        console.warn("[wot] Failed to build follow graph:", errMsg(err));
      })
      .finally(() => {
        if (!cancelled) setWotLoading(false);
      });

    return () => { cancelled = true; };
  }, [nostrKeys?.pk]);

  // Push WoT graph to agent manager so trust-based fees use real social graph data
  useEffect(() => {
    pushWoTGraph(wotGraph);
  }, [wotGraph, pushWoTGraph]);

  const pipelineResult = useMemo(() => {
    if (content.length === 0) return null;
    return runFilterPipeline(content, wotGraph, {
      mode: filterMode,
      wotEnabled: !!wotGraph,
      qualityThreshold: profile.calibration.qualityThreshold,
    });
  }, [content, wotGraph, filterMode, profile.calibration.qualityThreshold]);

  const wotAdjustedContent = useMemo(() => {
    if (!pipelineResult) return content;
    return pipelineResult.items.map(fi => ({
      ...fi.item,
      scores: { ...fi.item.scores, composite: fi.weightedComposite },
    }));
  }, [pipelineResult, content]);

  // WoT serendipity discoveries (Pro mode only)
  const discoveries = useMemo<SerendipityItem[]>(() => {
    if (!pipelineResult || filterMode !== "pro") return [];
    return detectSerendipity(pipelineResult);
  }, [pipelineResult, filterMode]);

  const lastRecordedRef = useRef<typeof pipelineResult>(null);
  useEffect(() => {
    if (!pipelineResult || pipelineResult === lastRecordedRef.current) return;
    lastRecordedRef.current = pipelineResult;
    recordFilterRun({
      articlesEvaluated: pipelineResult.stats.totalInput,
      wotScoredCount: pipelineResult.stats.wotScoredCount,
      aiScoredCount: pipelineResult.stats.aiScoredCount,
      discoveriesFound: discoveries.length,
      aiCostUSD: pipelineResult.stats.estimatedAPICost,
    });
  }, [pipelineResult, discoveries.length]);

  useEffect(() => {
    if (isAuthenticated) {
      loadFromIC().catch((err: unknown) => {
        console.warn("[page] Failed to load from IC:", errMsg(err));
        addNotification("Could not load saved content from IC", "error");
      });
    }
  }, [isAuthenticated, loadFromIC, addNotification]);

  useEffect(() => {
    if (!isAuthenticated || !identity || !principalText) {
      ledgerRef.current = null;
      setIcpBalance(null);
      setReputation(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [ledger, backend] = await Promise.all([
          createICPLedgerActorAsync(identity),
          createBackendActorAsync(identity),
        ]);
        if (cancelled) return;
        ledgerRef.current = ledger;

        const principal = Principal.fromText(principalText);
        const [balance, rep, eIndex] = await Promise.all([
          ledger.icrc1_balance_of({ owner: principal, subaccount: [] }),
          backend.getUserReputation(principal),
          backend.getEngagementIndex(principal),
        ]);
        if (cancelled) return;
        setIcpBalance(balance);
        setReputation(rep);
        setEngagementIndex(eIndex);
      } catch (err) {
        console.warn("[staking] Failed to init ledger/reputation:", errMsg(err));
        addNotification("Could not load ICP balance — staking may be unavailable", "error");
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, identity, principalText, addNotification]);

  const getSchedulerSourcesRef = useRef(getSchedulerSources);
  getSchedulerSourcesRef.current = getSchedulerSources;
  const isDemoRef = useRef(isDemoMode);
  isDemoRef.current = isDemoMode;
  const principalTextRef = useRef(principalText);
  principalTextRef.current = principalText;

  const demoSchedulerSources = useMemo(() =>
    DEMO_SOURCES.map(s => ({
      type: s.type as "rss" | "url" | "nostr",
      config: { feedUrl: s.feedUrl! },
      enabled: true,
    })),
  []);

  useEffect(() => {
    const scheduler = new IngestionScheduler({
      onNewContent: addContent,
      getSources: () => {
        const userSources = getSchedulerSourcesRef.current();
        if (userSources.length > 0) return userSources;
        if (isDemoRef.current) return demoSchedulerSources;
        return [];
      },
      getUserContext: () => userContextRef.current,
      getSkipAI: () => filterModeRef.current === "lite",
      onSourceAutoDisabled: (key, error) => {
        addNotification(`Source auto-disabled after repeated failures: ${key} (${error})`, "error");
      },
      onCycleComplete: (count, items) => {
        const pt = principalTextRef.current;
        if (!pt || !localStorage.getItem("aegis-push-enabled")) return;
        // Throttle based on user-selected frequency (Settings tab)
        const freq = localStorage.getItem("aegis-push-frequency") || "1x_day";
        if (freq === "off") return;
        if (freq !== "realtime") {
          const throttleMs = PUSH_THROTTLE[freq] || PUSH_THROTTLE["1x_day"];
          const lastPush = Number(localStorage.getItem("aegis-push-last") || "0");
          if (Date.now() - lastPush < throttleMs) return;
        }
        const quality = items.filter(i => i.verdict === "quality");
        const preview = (quality.length > 0 ? quality : items)
          .slice(0, 3)
          .map(i => `${i.verdict === "quality" ? "\u2713" : "\u2717"} ${i.text.slice(0, 60).replace(/\n/g, " ")}`)
          .join("\n");
        const summary = `${count} item${count > 1 ? "s" : ""} scored`;
        localStorage.setItem("aegis-push-last", String(Date.now()));
        fetch("/api/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            principal: pt,
            title: `Aegis: ${summary}`,
            body: preview || summary,
            url: "/",
            tag: `briefing-${new Date().toISOString().slice(0, 10)}`,
          }),
        }).catch((err: unknown) => {
          console.warn("[push] Send notification failed:", err instanceof Error ? err.message : err);
        });
      },
    });
    schedulerRef.current = scheduler;
    scheduler.start();
    return () => scheduler.stop();
  }, [addContent, demoSchedulerSources, addNotification]);

  useEffect(() => {
    if (isAuthenticated) clearDemoContent();
  }, [isAuthenticated, clearDemoContent]);

  const handleValidate = (id: string) => {
    validateItem(id);
    addNotification("Validated \u2713", "success");
  };

  const handleFlag = (id: string) => {
    flagItem(id);
    addNotification("Flagged", "error");
  };

  const handleAnalyze = async (text: string, meta?: { sourceUrl?: string; imageUrl?: string }) => {
    try {
      const result = await analyze(text, userContext, meta);
      addNotification(
        result.verdict === "quality" ? "Quality confirmed \u2713" : "Slop identified \uD83D\uDD25",
        result.verdict === "quality" ? "success" : "error"
      );
      return result;
    } catch (err) {
      console.error("[page] Analysis failed:", errMsg(err));
      addNotification("Analysis failed — check connection", "error");
      throw err;
    }
  };

  const handlePublishSignal = useCallback(async (
    text: string,
    scores: AnalyzeResponse,
    stakeAmount?: bigint,
    imageUrl?: string,
  ): Promise<{ eventId: string | null; relaysPublished: string[] }> => {
    if (!nostrKeys) {
      return { eventId: null, relaysPublished: [] };
    }

    const tags = buildAegisTags(scores.composite, scores.vSignal, scores.topics || [], imageUrl);

    if (publishGate && !publishGate.canPublish) {
      addNotification(publishGate.reason, "error");
      return { eventId: null, relaysPublished: [] };
    }
    if (publishGate?.requiresDeposit && !stakeAmount) {
      addNotification("Quality deposit required \u2014 your recent signals received low ratings", "error");
      return { eventId: null, relaysPublished: [] };
    }

    // Publish to Nostr relays (append image URL to content — Nostr clients auto-render it)
    const publishText = imageUrl ? `${text}\n\n${imageUrl}` : text;
    const result = await publishSignalToNostr(publishText, nostrKeys.sk, tags);

    const signalId = uuidv4();

    if (stakeAmount && identity && principalText) {
      try {
        const canisterId = getCanisterId();
        const spender = Principal.fromText(canisterId);

        // ICRC-2 approve: let canister transfer our ICP
        if (!ledgerRef.current) {
          ledgerRef.current = await createICPLedgerActorAsync(identity);
        }
        const approveResult = await ledgerRef.current.icrc2_approve({
          from_subaccount: [],
          spender: { owner: spender, subaccount: [] },
          amount: stakeAmount + ICP_FEE, // Include fee for the transfer_from
          expected_allowance: [],
          expires_at: [],
          fee: [],
          memo: [],
          created_at_time: [],
        });

        if ("Err" in approveResult) {
          addNotification("ICP approve failed — check balance", "error");
        } else {
          const backend = await createBackendActorAsync(identity);
          const stakeResult = await backend.publishWithStake({
            id: signalId,
            owner: Principal.fromText(principalText),
            text: text.slice(0, 300),
            nostrEventId: result.eventId ? [result.eventId] : [],
            nostrPubkey: nostrKeys.pk ? [nostrKeys.pk] : [],
            scores: {
              originality: Math.round(scores.originality),
              insight: Math.round(scores.insight),
              credibility: Math.round(scores.credibility),
              compositeScore: scores.composite,
            },
            verdict: scores.verdict === "quality" ? { quality: null } : { slop: null },
            topics: scores.topics || [],
            createdAt: BigInt(Date.now() * 1_000_000),
          }, stakeAmount);

          if ("ok" in stakeResult) {
            addNotification(`Deposited & published! Signal quality bond secured`, "success");
            try {
              const bal = await ledgerRef.current.icrc1_balance_of({ owner: Principal.fromText(principalText), subaccount: [] });
              setIcpBalance(bal);
            } catch (err) {
              console.warn("[staking] Balance refresh failed:", errMsg(err));
            }
          } else {
            addNotification(`Stake failed: ${stakeResult.err}`, "error");
          }
        }
      } catch (err) {
        console.error("[staking] publishWithStake failed:", errMsg(err));
        addNotification("Deposit failed — signal published without quality bond", "error");
      }
    }

    addContent({
      id: signalId,
      owner: principalText,
      author: "You",
      avatar: "\uD83D\uDCE1",
      text: text.slice(0, 300),
      source: "manual",
      imageUrl: imageUrl || undefined,
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
      nostrPubkey: nostrKeys.pk,
      scoredByAI: true,
    });

    if (nostrKeys?.pk) setPublishGate(checkPublishGate(nostrKeys.pk));

    if (!stakeAmount) {
      addNotification(
        result.relaysPublished.length > 0
          ? `Signal published to ${result.relaysPublished.length} relays`
          : "Signal saved locally (relay publish failed)",
        result.relaysPublished.length > 0 ? "success" : "error"
      );
    }

    return {
      eventId: result.eventId,
      relaysPublished: result.relaysPublished,
    };
  }, [nostrKeys, identity, principalText, addContent, addNotification, publishGate]);

  const handleUploadImage = useCallback(async (file: File): Promise<{ url?: string; error?: string }> => {
    const form = new FormData();
    form.append("file", file);
    const headers: Record<string, string> = {};
    if (nostrKeys) {
      headers["Authorization"] = createNIP98AuthHeader(
        nostrKeys.sk,
        "https://nostr.build/api/v2/upload/files",
        "POST",
      );
    }
    const res = await fetch("/api/upload/image", { method: "POST", headers, body: form });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Upload failed" };
    return { url: data.url };
  }, [nostrKeys]);

  return (
    <AppShell activeTab={tab} onTabChange={setTab}>
      <DemoBanner mobile={mobile} />
      {tab === "dashboard" && <DashboardTab content={content} mobile={mobile} onValidate={handleValidate} onFlag={handleFlag} isLoading={isAuthenticated && content.length === 0 && syncStatus !== "synced"} wotLoading={wotLoading} />}
      {tab === "briefing" && <BriefingTab content={wotAdjustedContent} profile={profile} onValidate={handleValidate} onFlag={handleFlag} mobile={mobile} nostrKeys={nostrKeys} isLoading={isAuthenticated && content.length === 0 && syncStatus !== "synced"} discoveries={discoveries} />}
      {tab === "incinerator" && (
        <IncineratorTab
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
          onPublishSignal={isAuthenticated ? handlePublishSignal : undefined}
          onUploadImage={isAuthenticated ? handleUploadImage : undefined}
          nostrPubkey={nostrKeys?.pk || null}
          icpBalance={icpBalance}
          stakingEnabled={isAuthenticated && (publishGate?.requiresDeposit ?? false)}
          publishGate={publishGate}
          mobile={mobile}
        />
      )}
      {tab === "sources" && <SourcesTab onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />}
      {tab === "analytics" && <AnalyticsTab content={content} reputation={reputation} engagementIndex={engagementIndex} agentState={agentState} mobile={mobile} pipelineStats={pipelineResult?.stats ?? null} />}
      {tab === "settings" && <SettingsTab mobile={mobile} />}
    </AppShell>
  );
}
