"use client";
import React, { useEffect } from "react";
import { useFilterMode } from "@/contexts/FilterModeContext";
import { useAuth } from "@/contexts/AuthContext";
import { isOllamaEnabled } from "@/lib/ollama/storage";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { getUserApiKey } from "@/lib/apiKey/storage";
import { colors, space, type as t, radii, transitions } from "@/styles/theme";

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

  const hasAIScoring = isOllamaEnabled() || isWebLLMEnabled() || !!getUserApiKey();

  // Auto-fallback: if Pro is persisted but conditions no longer met, revert to Lite
  useEffect(() => {
    if (filterMode === "pro" && (!isAuthenticated || !hasAIScoring)) {
      setFilterMode("lite");
    }
  }, [filterMode, isAuthenticated, hasAIScoring, setFilterMode]);

  return (
    <div style={{
      display: "flex",
      gap: space[1],
      background: colors.bg.raised,
      borderRadius: radii.md,
      padding: space[1],
      border: `1px solid ${colors.border.default}`,
    }}>
      {MODES.map(m => {
        const active = filterMode === m.key;
        const locked = m.key === "pro" && (!isAuthenticated || !hasAIScoring);
        const lockReason = !isAuthenticated ? "Login required" : "AI setup required";
        return (
          <button
            key={m.key}
            onClick={() => !locked && setFilterMode(m.key)}
            disabled={locked}
            style={{
              flex: 1,
              padding: `${space[2]}px ${space[3]}px`,
              background: active ? colors.bg.surface : "transparent",
              border: active ? `1px solid ${colors.border.emphasis}` : "1px solid transparent",
              borderRadius: radii.sm,
              color: locked ? colors.text.disabled : active ? colors.text.primary : colors.text.muted,
              fontSize: t.bodySm.size,
              fontWeight: 600,
              cursor: locked ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              transition: transitions.fast,
              textAlign: "center",
              opacity: locked ? 0.5 : 1,
            }}
          >
            <span>{m.label}</span>
            {!mobile && (
              <div style={{ fontSize: t.caption.size, color: colors.text.disabled, marginTop: 2 }}>
                {locked ? lockReason : m.sub}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
};
