"use client";
import React, { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useFilterMode } from "@/contexts/FilterModeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAgent } from "@/contexts/AgentContext";
import { isOllamaEnabled } from "@/lib/ollama/storage";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { getUserApiKey } from "@/lib/apiKey/storage";

interface FilterModeSelectorProps {
  mobile?: boolean;
}

const MODES = [
  { key: "lite" as const, label: "Lite", sub: "WoT + Heuristic" },
  { key: "pro" as const, label: "Pro", sub: "WoT + AI" },
] as const;

export const FilterModeSelector: React.FC<FilterModeSelectorProps> = ({ mobile }) => {
  const { filterMode, setFilterMode } = useFilterMode();
  const { isAuthenticated } = useAuth();
  const { isEnabled: agentEnabled } = useAgent();

  const hasAIScoring = isOllamaEnabled() || isWebLLMEnabled() || !!getUserApiKey() || agentEnabled;

  // Auto-fallback: if Pro is persisted but conditions no longer met, revert to Lite
  useEffect(() => {
    if (filterMode === "pro" && (!isAuthenticated || !hasAIScoring)) {
      setFilterMode("lite");
    }
  }, [filterMode, isAuthenticated, hasAIScoring, setFilterMode]);

  return (
    <div className="flex gap-1 bg-[var(--color-bg-raised)] rounded-md p-1 border border-border">
      {MODES.map(m => {
        const active = filterMode === m.key;
        const locked = m.key === "pro" && (!isAuthenticated || !hasAIScoring);
        const lockReason = !isAuthenticated ? "Login required" : "AI setup required";
        return (
          <button
            key={m.key}
            onClick={() => !locked && setFilterMode(m.key)}
            disabled={locked}
            className={cn(
              "flex-1 px-3 py-2 rounded-sm text-body-sm font-semibold font-[inherit] transition-fast text-center",
              active
                ? "bg-card border border-[var(--color-border-emphasis)] text-foreground"
                : "bg-transparent border border-transparent text-muted-foreground",
              locked && "text-[var(--color-text-disabled)] cursor-not-allowed opacity-50",
              !locked && "cursor-pointer"
            )}
          >
            <span>{m.label}</span>
            {!mobile && (
              <div className="text-caption text-[var(--color-text-disabled)] mt-0.5">
                {locked ? lockReason : m.sub}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
};
