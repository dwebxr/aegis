"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import { BriefingTab } from "@/components/tabs/BriefingTab";
import { IncineratorTab } from "@/components/tabs/IncineratorTab";
import { SourcesTab } from "@/components/tabs/SourcesTab";
import { AnalyticsTab } from "@/components/tabs/AnalyticsTab";
import { useWindowSize } from "@/hooks/useWindowSize";
import { useNotify } from "@/contexts/NotificationContext";
import { useContent } from "@/contexts/ContentContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferenceContext";
import { useSources } from "@/contexts/SourceContext";
import { useAgent } from "@/contexts/AgentContext";
import { IngestionScheduler } from "@/lib/ingestion/scheduler";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { publishSignalToNostr, buildAegisTags } from "@/lib/nostr/publish";
import { createICPLedgerActorAsync, ICP_FEE, type ICPLedgerActor } from "@/lib/ic/icpLedger";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { Principal } from "@dfinity/principal";
import { getCanisterId } from "@/lib/ic/agent";
import type { UserReputation } from "@/lib/ic/declarations";
import type { AnalyzeResponse } from "@/lib/types/api";

export default function AegisApp() {
  const { mobile } = useWindowSize();
  const { addNotification } = useNotify();
  const { content, isAnalyzing, analyze, validateItem, flagItem, addContent, loadFromIC } = useContent();
  const { isAuthenticated, identity, principalText } = useAuth();
  const { userContext, profile } = usePreferences();
  const { getSchedulerSources } = useSources();
  const { agentState } = useAgent();

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
        console.warn("Failed to load from IC:", err);
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
        console.warn("[staking] Failed to init ledger/reputation:", err instanceof Error ? err.message : "unknown");
        addNotification("Could not load ICP balance — staking may be unavailable", "error");
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, identity, principalText, addNotification]);

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
      console.error("Analysis failed:", err);
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
          // Call publishWithStake on aegis_backend
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
            // Refresh balance
            try {
              const bal = await ledgerRef.current.icrc1_balance_of({ owner: Principal.fromText(principalText), subaccount: [] });
              setIcpBalance(bal);
            } catch (err) {
              console.warn("[staking] Balance refresh failed:", err instanceof Error ? err.message : "unknown");
            }
          } else {
            addNotification(`Stake failed: ${stakeResult.err}`, "error");
          }
        }
      } catch (err) {
        console.error("[staking] publishWithStake failed:", err);
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
      {tab === "dashboard" && <DashboardTab content={content} mobile={mobile} onValidate={handleValidate} onFlag={handleFlag} />}
      {tab === "briefing" && <BriefingTab content={content} profile={profile} onValidate={handleValidate} onFlag={handleFlag} mobile={mobile} />}
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
    </AppShell>
  );
}
