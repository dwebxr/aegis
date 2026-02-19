"use client";
import React, { Suspense, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
import { loadWoTCache, saveWoTCache, clearWoTCache } from "@/lib/wot/cache";
import { DEFAULT_WOT_CONFIG } from "@/lib/wot/types";
import type { WoTGraph } from "@/lib/wot/types";
import { runFilterPipeline } from "@/lib/filtering/pipeline";
import { detectSerendipity } from "@/lib/filtering/serendipity";
import type { SerendipityItem } from "@/lib/filtering/serendipity";
import { recordFilterRun } from "@/lib/filtering/costTracker";
import { DemoBanner } from "@/components/ui/DemoBanner";
import { LandingHero } from "@/components/ui/LandingHero";
import { WoTPromptBanner } from "@/components/ui/WoTPromptBanner";
import { getLinkedAccount, saveLinkedAccount, syncLinkedAccountToIC, fetchNostrProfile, parseICSettings } from "@/lib/nostr/linkAccount";
import type { LinkedNostrAccount } from "@/lib/nostr/linkAccount";
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

function extractUrl(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return trimmed;
  } catch { /* not a bare URL */ }
  const match = trimmed.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
  return match ? match[0] : null;
}

function AegisAppInner() {
  const { mobile } = useWindowSize();
  const { addNotification } = useNotify();
  const { content, isAnalyzing, syncStatus, analyze, scoreText, validateItem, flagItem, addContent, clearDemoContent } = useContent();
  const { isAuthenticated, identity, principalText, login } = useAuth();
  const { userContext, profile } = usePreferences();
  const { getSchedulerSources } = useSources();
  const { agentState, isEnabled: agentIsEnabled, setD2AEnabled, setWoTGraph: pushWoTGraph } = useAgent();
  const { isDemoMode, bannerDismissed, dismissBanner } = useDemo();
  const { filterMode } = useFilterMode();

  const [tab, setTab] = useState("dashboard");
  const [icpBalance, setIcpBalance] = useState<bigint | null>(null);
  const [reputation, setReputation] = useState<UserReputation | null>(null);
  const [engagementIndex, setEngagementIndex] = useState<number | null>(null);
  const [wotGraph, setWotGraph] = useState<WoTGraph | null>(null);
  const [wotLoading, setWotLoading] = useState(false);
  const [publishGate, setPublishGate] = useState<PublishGateDecision | null>(null);
  const [linkedAccount, setLinkedAccount] = useState<LinkedNostrAccount | null>(() => getLinkedAccount());
  const [wotPromptDismissed, setWotPromptDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    // sessionStorage may throw in SSR or restrictive privacy modes; default to not-dismissed
    try { return sessionStorage.getItem("aegis-wot-prompt-dismissed") === "true"; } catch { return false; }
  });

  // Web Share Target
  const searchParams = useSearchParams();
  const sharedUrl = useMemo(() => {
    return extractUrl(searchParams.get("share_url"))
        || extractUrl(searchParams.get("share_text"))
        || extractUrl(searchParams.get("share_title"))
        || null;
  }, [searchParams]);
  const shareConsumedRef = useRef(false);
  const [shareState, setShareState] = useState<{
    url: string;
    status: "fetching" | "analyzing" | "done" | "error";
    error?: string;
  } | null>(null);

  const schedulerRef = useRef<IngestionScheduler | null>(null);
  const userContextRef = useRef(userContext);
  userContextRef.current = userContext;
  const ledgerRef = useRef<ICPLedgerActor | null>(null);
  const agentEnabledRef = useRef(agentIsEnabled);
  agentEnabledRef.current = agentIsEnabled;

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

  const wotRootPubkey = linkedAccount?.pubkeyHex ?? nostrKeys?.pk ?? null;
  const linkedAccountRef = useRef(linkedAccount);
  linkedAccountRef.current = linkedAccount;

  useEffect(() => {
    if (!wotRootPubkey) {
      setWotGraph(null);
      return;
    }

    const cached = loadWoTCache();
    if (cached && cached.userPubkey === wotRootPubkey) {
      setWotGraph(cached);
      return;
    }

    let cancelled = false;
    setWotLoading(true);

    // Cap at 1 hop for large follow lists (>500) to keep graph manageable
    const la = linkedAccountRef.current;
    const config = la && la.followCount > 500
      ? { ...DEFAULT_WOT_CONFIG, maxHops: 1 }
      : DEFAULT_WOT_CONFIG;

    buildFollowGraph(wotRootPubkey, config)
      .then(graph => {
        if (cancelled) return;
        setWotGraph(graph);
        saveWoTCache(graph, config.cacheTTLMs);
      })
      .catch(err => {
        console.warn("[wot] Failed to build follow graph:", errMsg(err));
      })
      .finally(() => {
        if (!cancelled) setWotLoading(false);
      });

    return () => { cancelled = true; };
  }, [wotRootPubkey]);

  useEffect(() => {
    pushWoTGraph(wotGraph);
  }, [wotGraph, pushWoTGraph]);

  const handleLinkAccount = useCallback((account: LinkedNostrAccount | null) => {
    setLinkedAccount(account);
    if (!account) {
      clearWoTCache();
      setWotPromptDismissed(false);
      try { sessionStorage.removeItem("aegis-wot-prompt-dismissed"); } catch { /* noop */ }
    }
    // Sync to IC (fire-and-forget)
    if (identity) {
      void syncLinkedAccountToIC(identity, account, agentEnabledRef.current).catch(err => console.warn("[nostr] IC account sync failed:", errMsg(err)));
    }
  }, [identity]);

  const dismissWotPrompt = useCallback(() => {
    setWotPromptDismissed(true);
    // sessionStorage may throw in SSR or restrictive privacy modes; dismissal is non-critical UI state
    try { sessionStorage.setItem("aegis-wot-prompt-dismissed", "true"); } catch { /* noop */ }
  }, []);

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
        const [balance, rep, eIndex, icSettings] = await Promise.all([
          ledger.icrc1_balance_of({ owner: principal, subaccount: [] }),
          backend.getUserReputation(principal),
          backend.getEngagementIndex(principal),
          backend.getUserSettings(principal),
        ]);
        if (cancelled) return;
        setIcpBalance(balance);
        setReputation(rep);
        setEngagementIndex(eIndex);

        // Restore user settings from IC
        const rawSettings = icSettings[0];
        if (rawSettings) {
          const { account: icAccount, d2aEnabled: icD2A } = parseICSettings(rawSettings);
          setD2AEnabled(icD2A);

          const localAccount = getLinkedAccount();

          if (!localAccount && icAccount) {
            // IC has linked account that localStorage doesn't — restore
            saveLinkedAccount(icAccount);
            setLinkedAccount(icAccount);
            // Hydrate displayName + followCount from relays in background
            void fetchNostrProfile(icAccount.pubkeyHex).then(profile => {
              if (cancelled) return;
              const hydrated: LinkedNostrAccount = { ...icAccount, displayName: profile.displayName, followCount: profile.followCount };
              saveLinkedAccount(hydrated);
              setLinkedAccount(hydrated);
            }).catch(err => console.warn("[nostr] Profile hydration failed:", errMsg(err)));
          } else if (localAccount && !icAccount) {
            void syncLinkedAccountToIC(identity, localAccount, icD2A).catch(err => console.warn("[nostr] IC account sync failed:", errMsg(err)));
          }
        }
      } catch (err) {
        console.warn("[staking] Failed to init ledger/reputation:", errMsg(err));
        addNotification("Could not load ICP balance", "error");
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, identity, principalText, addNotification, setD2AEnabled]);

  const getSchedulerSourcesRef = useRef(getSchedulerSources);
  getSchedulerSourcesRef.current = getSchedulerSources;
  const isDemoRef = useRef(isDemoMode);
  isDemoRef.current = isDemoMode;
  const principalTextRef = useRef(principalText);
  principalTextRef.current = principalText;
  const scoreTextRef = useRef(scoreText);
  scoreTextRef.current = scoreText;

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
      scoreFn: (text, userContext) => scoreTextRef.current(text, userContext),
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
        void fetch("/api/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            principal: pt,
            title: `Aegis: ${summary}`,
            body: preview || summary,
            url: "/",
            tag: `briefing-${new Date().toISOString().slice(0, 10)}`,
          }),
        }).then(r => { void r.arrayBuffer(); }).catch((err: unknown) => {
          console.warn("[push] Send notification failed:", errMsg(err));
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
  const handleAnalyzeRef = useRef(handleAnalyze);
  handleAnalyzeRef.current = handleAnalyze;

  // Web Share Target: auto-process shared URL
  useEffect(() => {
    if (!sharedUrl || shareConsumedRef.current) return;
    shareConsumedRef.current = true;
    if (isDemoMode && !bannerDismissed) dismissBanner();
    setTab("incinerator");
    window.history.replaceState({}, "", "/");
    setShareState({ url: sharedUrl, status: "fetching" });
    (async () => {
      try {
        const res = await fetch("/api/fetch/url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: sharedUrl }),
        });
        const data = await res.json();
        if (!res.ok) {
          setShareState(s => s ? { ...s, status: "error", error: data.error } : null);
          addNotification("Share: " + (data.error || "Could not fetch URL"), "error");
          return;
        }
        setShareState(s => s ? { ...s, status: "analyzing" } : null);
        await handleAnalyzeRef.current(data.content || data.description || "", {
          sourceUrl: sharedUrl,
          imageUrl: data.imageUrl,
        });
        setShareState(s => s ? { ...s, status: "done" } : null);
      } catch (err) {
        console.warn("[share] Auto-process failed:", errMsg(err));
        setShareState(s => s ? { ...s, status: "error", error: "Analysis failed" } : null);
        addNotification("Shared URL analysis failed", "error");
      }
    })();
  }, [sharedUrl, isDemoMode, bannerDismissed, dismissBanner, addNotification]);

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
    try {
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
    } catch (err) {
      console.error("[upload] Image upload failed:", errMsg(err));
      return { error: "Upload failed" };
    }
  }, [nostrKeys]);

  const showLanding = isDemoMode && !bannerDismissed;

  if (showLanding) {
    return (
      <AppShell activeTab={tab} onTabChange={setTab}>
        <LandingHero onTryDemo={dismissBanner} onLogin={login} mobile={mobile} />
      </AppShell>
    );
  }

  return (
    <AppShell activeTab={tab} onTabChange={setTab}>
      <DemoBanner mobile={mobile} />
      {isAuthenticated && !linkedAccount && !wotPromptDismissed && (
        <WoTPromptBanner onGoToSettings={() => setTab("settings")} onDismiss={dismissWotPrompt} />
      )}
      {tab === "dashboard" && <DashboardTab content={content} mobile={mobile} onValidate={handleValidate} onFlag={handleFlag} isLoading={isAuthenticated && content.length === 0 && syncStatus !== "synced"} wotLoading={wotLoading} onTabChange={setTab} discoveries={discoveries} />}
      {tab === "briefing" && <BriefingTab content={wotAdjustedContent} profile={profile} onValidate={handleValidate} onFlag={handleFlag} mobile={mobile} nostrKeys={nostrKeys} isLoading={isAuthenticated && content.length === 0 && syncStatus !== "synced"} discoveries={discoveries} onTabChange={setTab} />}
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
          shareState={shareState}
        />
      )}
      {tab === "sources" && <SourcesTab onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />}
      {tab === "analytics" && <AnalyticsTab content={content} reputation={reputation} engagementIndex={engagementIndex} agentState={agentState} mobile={mobile} pipelineStats={pipelineResult?.stats ?? null} />}
      {tab === "settings" && <SettingsTab mobile={mobile} onLinkChange={handleLinkAccount} />}
    </AppShell>
  );
}

export default function AegisApp() {
  return (
    <Suspense fallback={null}>
      <AegisAppInner />
    </Suspense>
  );
}
