"use client";
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { usePreferences } from "./PreferenceContext";
import { useContent } from "./ContentContext";
import { useNotify } from "./NotificationContext";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { AgentManager } from "@/lib/agent/manager";
import { D2A_MATCH_FEE, D2A_APPROVE_AMOUNT } from "@/lib/agent/protocol";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { createICPLedgerActorAsync, ICP_FEE } from "@/lib/ic/icpLedger";
import { getCanisterId } from "@/lib/ic/agent";
import { Principal } from "@dfinity/principal";
import type { AgentState } from "@/lib/agent/types";
import { errMsg } from "@/lib/utils/errors";

interface AgentContextValue {
  agentState: AgentState;
  isEnabled: boolean;
  toggleAgent: () => void;
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
};

const AgentContext = createContext<AgentContextValue>({
  agentState: defaultState,
  isEnabled: false,
  toggleAgent: () => {},
});

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { addNotification } = useNotify();
  const { isAuthenticated, identity, principalText } = useAuth();
  const { profile } = usePreferences();
  const { content, addContent } = useContent();
  const [agentState, setAgentState] = useState<AgentState>(defaultState);
  const [isEnabled, setIsEnabled] = useState(false);
  const managerRef = useRef<AgentManager | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const contentRef = useRef(content);
  contentRef.current = content;

  const toggleAgent = useCallback(() => {
    setIsEnabled(prev => !prev);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !principalText || !identity || !isEnabled) {
      if (managerRef.current) {
        managerRef.current.stop();
        managerRef.current = null;
      }
      setAgentState(defaultState);
      return;
    }

    let cancelled = false;
    const keys = deriveNostrKeypairFromText(principalText);
    const capturedIdentity = identity;

    const startAgent = async () => {
      // Step 1: Pre-approve canister for D2A match fees (ICRC-2)
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
        console.warn("[agent] D2A fee pre-approve failed:", errMsg(err));
        addNotification("D2A fee pre-approval failed — matches may not settle", "error");
      }
      if (cancelled) return;

      // Step 2: Create and start agent manager (after approval completes)
      const manager = new AgentManager(
        keys.sk,
        keys.pk,
        {
          onNewContent: (item) => addContent(item),
          getContent: () => contentRef.current,
          getPrefs: () => profileRef.current,
          onStateChange: (state) => setAgentState(state),
          onD2AMatchComplete: async (_senderPk, senderPrincipalId, contentHash) => {
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
                BigInt(D2A_MATCH_FEE),
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
        undefined, // relayUrls (use default)
        principalText, // IC principal for presence broadcast
      );

      if (cancelled) {
        manager.stop();
        return;
      }

      managerRef.current = manager;
      manager.start();
    };

    startAgent();

    return () => {
      cancelled = true;
      if (managerRef.current) {
        managerRef.current.stop();
        managerRef.current = null;
      }
    };
  }, [isAuthenticated, principalText, identity, isEnabled, addContent, addNotification]);

  const value = useMemo(() => ({
    agentState, isEnabled, toggleAgent,
  }), [agentState, isEnabled, toggleAgent]);

  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  return useContext(AgentContext);
}
