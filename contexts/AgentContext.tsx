"use client";
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { usePreferences } from "./PreferenceContext";
import { useContent } from "./ContentContext";
import { useNotify } from "./NotificationContext";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { AgentManager } from "@/lib/agent/manager";
import { D2A_APPROVE_AMOUNT } from "@/lib/agent/protocol";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { createICPLedgerActorAsync, ICP_FEE } from "@/lib/ic/icpLedger";
import { getCanisterId } from "@/lib/ic/agent";
import { Principal } from "@dfinity/principal";
import type { AgentState, D2ACommentPayload } from "@/lib/agent/types";
import type { WoTGraph } from "@/lib/wot/types";
import type { NostrProfileMetadata } from "@/lib/nostr/profile";
import { sendComment as sendCommentMsg } from "@/lib/agent/handshake";
import { saveComment, loadComments } from "@/lib/d2a/comments";
import type { StoredComment } from "@/lib/d2a/comments";
import { getCachedAgentProfile, setCachedAgentProfile, fetchAgentProfile } from "@/lib/nostr/profile";
import { errMsg } from "@/lib/utils/errors";
import { syncLinkedAccountToIC, getLinkedAccount } from "@/lib/nostr/linkAccount";
import { DEFAULT_RELAYS } from "@/lib/nostr/types";

interface AgentContextValue {
  agentState: AgentState;
  isEnabled: boolean;
  toggleAgent: () => void;
  setD2AEnabled: (enabled: boolean) => void;
  setWoTGraph: (graph: WoTGraph | null) => void;
  wotGraph: WoTGraph | null;
  agentProfile: NostrProfileMetadata | null;
  agentProfileLoading: boolean;
  refreshAgentProfile: () => Promise<void>;
  nostrKeys: { sk: Uint8Array; pk: string } | null;
  sendComment: (peerPubkey: string, payload: D2ACommentPayload) => Promise<void>;
  d2aComments: StoredComment[];
}

const defaultState: AgentState = {
  isActive: false,
  myPubkey: null,
  peers: [],
  activeHandshakes: [],
  receivedItems: 0,
  sentItems: 0,
  d2aMatchCount: 0,
  consecutiveErrors: 0,
  activityLog: [],
};

const AgentContext = createContext<AgentContextValue>({
  agentState: defaultState,
  isEnabled: false,
  toggleAgent: () => {},
  setD2AEnabled: () => {},
  setWoTGraph: () => {},
  wotGraph: null,
  agentProfile: null,
  agentProfileLoading: false,
  refreshAgentProfile: async () => {},
  nostrKeys: null,
  sendComment: async () => {},
  d2aComments: [],
});

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { addNotification } = useNotify();
  const { isAuthenticated, identity, principalText } = useAuth();
  const { profile } = usePreferences();
  const { content, addContent } = useContent();
  const [agentState, setAgentState] = useState<AgentState>(defaultState);
  const [isEnabled, setD2AEnabled] = useState(false);
  const [d2aComments, setD2aComments] = useState<StoredComment[]>(() => loadComments());
  const [wotGraph, setWotGraphState] = useState<WoTGraph | null>(null);
  const [agentProfile, setAgentProfile] = useState<NostrProfileMetadata | null>(null);
  const [agentProfileLoading, setAgentProfileLoading] = useState(false);
  const managerRef = useRef<AgentManager | null>(null);
  const profileFetchId = useRef(0);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const contentRef = useRef(content);
  contentRef.current = content;

  const nostrKeys = useMemo(() => {
    if (!principalText) return null;
    return deriveNostrKeypairFromText(principalText);
  }, [principalText]);

  const refreshAgentProfile = useCallback(async () => {
    if (!nostrKeys || !principalText) return;
    const fetchId = ++profileFetchId.current;
    setAgentProfileLoading(true);
    try {
      const cached = getCachedAgentProfile(principalText);
      if (cached) setAgentProfile(cached);

      const fresh = await fetchAgentProfile(nostrKeys.pk);
      if (fetchId !== profileFetchId.current) return; // stale request
      if (fresh) {
        setAgentProfile(fresh);
        setCachedAgentProfile(principalText, fresh);
      }
    } catch (err) {
      if (fetchId !== profileFetchId.current) return;
      console.warn("[agent-profile] Fetch failed:", errMsg(err));
    } finally {
      if (fetchId === profileFetchId.current) {
        setAgentProfileLoading(false);
      }
    }
  }, [nostrKeys, principalText]);

  useEffect(() => {
    if (isAuthenticated && principalText && nostrKeys) {
      void refreshAgentProfile();
    } else {
      profileFetchId.current++; // cancel any in-flight fetch
      setAgentProfile(null);
      setAgentProfileLoading(false);
    }
  }, [isAuthenticated, principalText, nostrKeys, refreshAgentProfile]);

  const toggleAgent = useCallback(() => {
    setD2AEnabled(prev => {
      const next = !prev;
      if (identity) {
        void syncLinkedAccountToIC(identity, getLinkedAccount(), next).catch(e => console.warn("[agent] IC sync failed:", errMsg(e)));
      }
      return next;
    });
  }, [identity]);

  const setWoTGraph = useCallback((graph: WoTGraph | null) => {
    setWotGraphState(graph);
    if (managerRef.current) {
      managerRef.current.setWoTGraph(graph);
    }
  }, []);

  const handleSendComment = useCallback(async (peerPubkey: string, payload: D2ACommentPayload) => {
    if (!nostrKeys) throw new Error("No Nostr keys available");
    await sendCommentMsg(nostrKeys.sk, nostrKeys.pk, peerPubkey, payload, DEFAULT_RELAYS);
    const stored: StoredComment = {
      id: `${payload.contentHash}-${nostrKeys.pk}-${payload.timestamp}`,
      contentHash: payload.contentHash,
      senderPk: nostrKeys.pk,
      comment: payload.comment,
      timestamp: payload.timestamp,
      direction: "sent",
    };
    saveComment(stored);
    setD2aComments(loadComments());
  }, [nostrKeys]);

  useEffect(() => {
    if (!isAuthenticated || !principalText || !identity || !isEnabled || !nostrKeys) {
      if (managerRef.current) {
        managerRef.current.stop();
        managerRef.current = null;
      }
      setAgentState(defaultState);
      return;
    }

    let cancelled = false;
    const keys = nostrKeys;
    const capturedIdentity = identity;

    const startAgent = async () => {
      const canisterId = getCanisterId();
      try {
        const ledger = await createICPLedgerActorAsync(capturedIdentity);
        if (cancelled) return;
        const spender = Principal.fromText(canisterId);
        await ledger.icrc2_approve({
          from_subaccount: [],
          spender: { owner: spender, subaccount: [] },
          amount: BigInt(D2A_APPROVE_AMOUNT) + ICP_FEE,
          expected_allowance: [],
          expires_at: [],
          fee: [],
          memo: [],
          created_at_time: [],
        });
      } catch (err) {
        console.warn("[agent] D2A fee pre-approve failed (trusted-only mode):", errMsg(err));
        addNotification("D2A started in trusted-only mode. Fund wallet to exchange with unknown peers.", "info");
      }
      if (cancelled) return;

      const manager = new AgentManager(
        keys.sk,
        keys.pk,
        {
          onNewContent: (item) => addContent(item),
          getContent: () => contentRef.current,
          getPrefs: () => profileRef.current,
          onStateChange: (state) => setAgentState(state),
          onComment: (msg, senderPk) => {
            const stored: StoredComment = {
              id: `${msg.payload.contentHash}-${senderPk}-${msg.payload.timestamp}`,
              contentHash: msg.payload.contentHash,
              senderPk,
              comment: msg.payload.comment,
              timestamp: msg.payload.timestamp,
              direction: "received",
            };
            saveComment(stored);
            setD2aComments(loadComments());
            addNotification(`Comment from ${senderPk.slice(0, 8)}... on "${msg.payload.contentTitle.slice(0, 30)}"`, "info");
          },
          onD2AMatchComplete: async (_senderPk, senderPrincipalId, contentHash, fee) => {
            if (!senderPrincipalId) {
              console.warn("[agent] D2A match: sender has no IC principal, skipping fee");
              return;
            }
            try {
              const backend = await createBackendActorAsync(capturedIdentity);
              const senderPrincipal = Principal.fromText(senderPrincipalId);
              const matchId = uuidv4();
              const result = await backend.recordD2AMatch(
                matchId,
                senderPrincipal,
                contentHash,
                BigInt(fee),
              );
              if (!("ok" in result)) {
                console.warn("[agent] D2A match recording failed:", result.err);
                addNotification("D2A match recording failed on IC", "error");
              }
            } catch (err) {
              console.warn("[agent] recordD2AMatch call failed:", errMsg(err));
              addNotification("D2A match recording failed on IC", "error");
            }
          },
        },
        undefined,
        principalText,
      );

      managerRef.current = manager;
      if (cancelled) {
        manager.stop();
        managerRef.current = null;
        return;
      }

      manager.start();
    };

    startAgent().catch(err => {
      console.error("[agent] Unhandled startAgent error:", errMsg(err));
    });

    return () => {
      cancelled = true;
      if (managerRef.current) {
        managerRef.current.stop();
        managerRef.current = null;
      }
    };
  }, [isAuthenticated, principalText, identity, isEnabled, nostrKeys, addContent, addNotification]);

  // D2A event notifications — fires toasts for significant agent state transitions
  const prevStateRef = useRef<AgentState>(defaultState);
  useEffect(() => {
    const prev = prevStateRef.current;
    const curr = agentState;
    prevStateRef.current = curr;

    // Skip if agent just became active (initial state flood)
    if (!prev.isActive && curr.isActive) return;
    // Skip if agent stopped
    if (!curr.isActive) return;

    if (curr.receivedItems > prev.receivedItems) {
      const count = curr.receivedItems - prev.receivedItems;
      addNotification(`Received ${count} item${count > 1 ? "s" : ""} from D2A peer`, "success");
    }
    if (curr.sentItems > prev.sentItems) {
      const count = curr.sentItems - prev.sentItems;
      addNotification(`Sent ${count} item${count > 1 ? "s" : ""} to D2A peer`, "success");
    }
    if (curr.d2aMatchCount > prev.d2aMatchCount) {
      addNotification("D2A fee-paid match completed", "success");
    }
    if (curr.peers.length > prev.peers.length && prev.peers.length > 0) {
      const newCount = curr.peers.length - prev.peers.length;
      addNotification(`Discovered ${newCount} new D2A peer${newCount > 1 ? "s" : ""}`, "info");
    }
    if (curr.consecutiveErrors > 0 && curr.lastError && curr.lastError !== prev.lastError) {
      addNotification(`D2A Agent error: ${curr.lastError.slice(0, 80)}`, "error");
    }
  }, [agentState, addNotification]);

  const value = useMemo(() => ({
    agentState, isEnabled, toggleAgent, setD2AEnabled, setWoTGraph, wotGraph,
    agentProfile, agentProfileLoading, refreshAgentProfile, nostrKeys,
    sendComment: handleSendComment, d2aComments,
  }), [agentState, isEnabled, toggleAgent, setWoTGraph, wotGraph,
    agentProfile, agentProfileLoading, refreshAgentProfile, nostrKeys,
    handleSendComment, d2aComments]);

  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  return useContext(AgentContext);
}
