"use client";
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { usePreferences } from "./PreferenceContext";
import { useContent } from "./ContentContext";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { AgentManager } from "@/lib/agent/manager";
import type { AgentState } from "@/lib/agent/types";

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
};

const AgentContext = createContext<AgentContextValue>({
  agentState: defaultState,
  isEnabled: false,
  toggleAgent: () => {},
});

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, principalText } = useAuth();
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
    if (!isAuthenticated || !principalText || !isEnabled) {
      if (managerRef.current) {
        managerRef.current.stop();
        managerRef.current = null;
      }
      setAgentState(defaultState);
      return;
    }

    const keys = deriveNostrKeypairFromText(principalText);

    const manager = new AgentManager(
      keys.sk,
      keys.pk,
      {
        onNewContent: (item) => addContent(item),
        getContent: () => contentRef.current,
        getPrefs: () => profileRef.current,
        onStateChange: (state) => setAgentState(state),
      },
    );

    managerRef.current = manager;
    manager.start();

    return () => {
      manager.stop();
    };
  }, [isAuthenticated, principalText, isEnabled, addContent]);

  return (
    <AgentContext.Provider value={{ agentState, isEnabled, toggleAgent }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  return useContext(AgentContext);
}
