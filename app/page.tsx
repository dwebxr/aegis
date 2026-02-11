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
import { DEMO_SOURCES } from "@/lib/demo/sources";
import { DemoBanner } from "@/components/ui/DemoBanner";
import { IngestionScheduler } from "@/lib/ingestion/scheduler";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { publishSignalToNostr, buildAegisTags } from "@/lib/nostr/publish";
import { createICPLedgerActorAsync, ICP_FEE, type ICPLedgerActor } from "@/lib/ic/icpLedger";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { Principal } from "@dfinity/principal";
import { getCanisterId } from "@/lib/ic/agent";
import type { UserReputation } from "@/lib/ic/declarations";
import type { AnalyzeResponse } from "@/lib/types/api";
import { errMsg } from "@/lib/utils/errors";

export default function AegisApp() {
  const { mobile } = useWindowSize();
  const { addNotification } = useNotify();
  const { content, isAnalyzing, syncStatus, analyze, validateItem, flagItem, addContent, clearDemoContent, loadFromIC } = useContent();
  const { isAuthenticated, identity, principalText } = useAuth();
  const { userContext, profile } = usePreferences();
  const { getSchedulerSources } = useSources();
  const { agentState } = useAgent();
  const { isDemoMode } = useDemo();

  const [tab, setTab] = useState("dashboard");
  const [icpBalance, setIcpBalance] = useState<bigint | null>(null);
  const [reputation, setReputation] = useState<UserReputation | null>(null);
  const [engagementIndex, setEngagementIndex] = useState<number | null>(null);

  const schedulerRef = useRef<IngestionScheduler | null>(null);
  const userContextRef = useRef(userContext);
  userContextRef.current = userContext;
  const ledgerRef = useRef<ICPLedgerActor | null>(null);

  // Derive Nostr keypair from principal (memoized)
  const nostrKeys = useMemo(() => {
    if (!isAuthenticated || !principalText) return null;
    return deriveNostrKeypairFromText(principalText);
  }, [isAuthenticated, principalText]);

  useEffect(() => {
    if (isAuthenticated) {
      loadFromIC().catch((err: unknown) => {
        console.warn("[page] Failed to load from IC:", errMsg(err));
        addNotification("Could not load saved content from IC", "error");
      });
    }
  }, [isAuthenticated, loadFromIC, addNotification]);

  // Initialize ICP ledger actor + fetch balance and reputation
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

  // Background ingestion scheduler
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
          const throttleMap: Record<string, number> = { "1x_day": 24 * 60 * 60 * 1000, "3x_day": 8 * 60 * 60 * 1000 };
          const throttleMs = throttleMap[freq] || 24 * 60 * 60 * 1000;
          const lastPush = Number(localStorage.getItem("aegis-push-last") || "0");
          if (Date.now() - lastPush < throttleMs) return;
        }
        // Build notification body with item previews
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
        }).catch(() => {});
      },
    });
    schedulerRef.current = scheduler;
    scheduler.start();
    return () => scheduler.stop();
  }, [addContent, demoSchedulerSources, addNotification]);

  // Clear demo content when user logs in
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
  ): Promise<{ eventId: string | null; relaysPublished: string[] }> => {
    if (!nostrKeys) {
      return { eventId: null, relaysPublished: [] };
    }

    const tags = buildAegisTags(scores.composite, scores.vSignal, scores.topics || []);

    // Staking is mandatory for authenticated users
    if (identity && principalText && !stakeAmount) {
      addNotification("ICP deposit is required to publish a signal", "error");
      return { eventId: null, relaysPublished: [] };
    }

    // Publish to Nostr relays
    const result = await publishSignalToNostr(text, nostrKeys.sk, tags);

    const signalId = uuidv4();

    // Approve + publishWithStake on IC
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

    // Also save to local content state
    addContent({
      id: signalId,
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
  }, [nostrKeys, identity, principalText, addContent, addNotification]);

  return (
    <AppShell activeTab={tab} onTabChange={setTab}>
      <DemoBanner mobile={mobile} />
      {tab === "dashboard" && <DashboardTab content={content} mobile={mobile} onValidate={handleValidate} onFlag={handleFlag} isLoading={isAuthenticated && content.length === 0 && syncStatus !== "synced"} />}
      {tab === "briefing" && <BriefingTab content={content} profile={profile} onValidate={handleValidate} onFlag={handleFlag} mobile={mobile} nostrKeys={nostrKeys} isLoading={isAuthenticated && content.length === 0 && syncStatus !== "synced"} />}
      {tab === "incinerator" && (
        <IncineratorTab
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
          onPublishSignal={isAuthenticated ? handlePublishSignal : undefined}
          nostrPubkey={nostrKeys?.pk || null}
          icpBalance={icpBalance}
          stakingEnabled={isAuthenticated}
          mobile={mobile}
        />
      )}
      {tab === "sources" && <SourcesTab onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />}
      {tab === "analytics" && <AnalyticsTab content={content} reputation={reputation} engagementIndex={engagementIndex} agentState={agentState} mobile={mobile} />}
      {tab === "settings" && <SettingsTab mobile={mobile} />}
    </AppShell>
  );
}
