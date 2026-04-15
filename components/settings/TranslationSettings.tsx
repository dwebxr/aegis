"use client";
import React, { useEffect, useState } from "react";
import { usePreferences } from "@/contexts/PreferenceContext";
import { cardClass, sectionTitleClass, pillBtnClass } from "./styles";
import {
  LANGUAGES,
  DEFAULT_TRANSLATION_PREFS,
  type TranslationLanguage,
  type TranslationPolicy,
  type TranslationBackend,
} from "@/lib/translation/types";
import {
  formatDebugLog,
  clearTranslationDebugLog,
  getTranslationDebugLog,
  type TranslationDebugEntry,
} from "@/lib/translation/debugLog";

const POLICY_OPTIONS: ReadonlyArray<{ value: TranslationPolicy; label: string; desc: string }> = [
  { value: "off", label: "Off", desc: "Translation disabled — no translate buttons or auto-translation" },
  { value: "manual", label: "Manual", desc: "Translate only when you tap the translate button" },
  { value: "high_quality", label: "High quality", desc: "Auto-translate posts above the score threshold" },
  { value: "all", label: "All posts", desc: "Auto-translate every post in the feed" },
];

const BACKEND_OPTIONS: ReadonlyArray<{ value: TranslationBackend; label: string; desc: string }> = [
  { value: "auto", label: "Auto", desc: "Local → Browser → Claude (BYOK if set) → IC LLM. Free paths first; no server costs." },
  { value: "ic", label: "IC LLM", desc: "On-chain Llama 3.1 — free, sign-in required, ~42% success rate" },
  { value: "browser", label: "Browser", desc: "In-browser via WebGPU (MediaPipe on mobile, WebLLM on desktop)" },
  { value: "local", label: "Local", desc: "Ollama — local server" },
  { value: "cloud", label: "Cloud", desc: "Claude API (requires your own Anthropic API key in BYOK settings)" },
];

interface TranslationSettingsProps {
  mobile?: boolean;
}

const selectClass = "px-3 py-1 bg-overlay border border-subtle rounded-sm text-foreground text-caption font-[inherit] outline-none cursor-pointer";

export const TranslationSettings: React.FC<TranslationSettingsProps> = ({ mobile }) => {
  const { profile, setTranslationPrefs } = usePreferences();
  const prefs = profile.translationPrefs ?? DEFAULT_TRANSLATION_PREFS;

  function update(partial: Partial<typeof prefs>) {
    setTranslationPrefs({ ...prefs, ...partial });
  }

  return (
    <div className={cardClass(mobile)}>
      <div className={sectionTitleClass}>Translation</div>

      <div className="mb-4">
        <div className="text-caption font-semibold text-muted-foreground mb-2">
          Translation Policy
        </div>
        <div className="flex gap-1 flex-wrap">
          {POLICY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => update({ policy: opt.value })}
              className={pillBtnClass(prefs.policy === opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="text-tiny text-disabled mt-2 leading-normal">
          {POLICY_OPTIONS.find(o => o.value === prefs.policy)?.desc}
        </div>
      </div>

      {prefs.policy !== "off" && (
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-body font-semibold text-secondary-foreground">Language</div>
            <div className="text-caption text-muted-foreground mt-0.5">
              Translate content into this language
            </div>
          </div>
          <select
            value={prefs.targetLanguage}
            onChange={e => update({ targetLanguage: e.target.value as TranslationLanguage })}
            className={selectClass}
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.nativeLabel} ({l.label})</option>
            ))}
          </select>
        </div>
      )}

      {prefs.policy === "high_quality" && (
        <div className="mb-4">
          <div className="flex justify-between items-center">
            <div className="text-tiny text-disabled">Min Score for Auto-Translate</div>
            <div className="text-caption font-bold font-mono text-secondary-foreground">
              {prefs.minScore}/10
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={prefs.minScore}
            onChange={e => update({ minScore: parseInt(e.target.value, 10) })}
            className="w-full mt-1"
            style={{ accentColor: "var(--color-cyan-500, #06b6d4)" }}
          />
        </div>
      )}

      {prefs.policy !== "off" && (
        <div>
          <div className="text-caption font-semibold text-muted-foreground mb-2">
            Translation Engine
          </div>
          <div className="flex gap-1 flex-wrap">
            {BACKEND_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => update({ backend: opt.value })}
                className={pillBtnClass(prefs.backend === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="text-tiny text-disabled mt-2 leading-normal">
            {BACKEND_OPTIONS.find(o => o.value === prefs.backend)?.desc}
          </div>
        </div>
      )}

      <TranslationDebugPanel mobile={mobile} />
    </div>
  );
};

const APP_VERSION =
  process.env.NEXT_PUBLIC_BUILD_SHA?.slice(0, 7) ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  "local";

/**
 * Diagnostic panel showing the last N translation attempts (per-item
 * per-backend with timing + outcome). Mobile users — especially in
 * standalone PWA mode — cannot easily open the browser console, so the
 * cascade writes its per-attempt diagnostics to localStorage and this
 * panel surfaces them. The "Copy" button puts the formatted log on the
 * clipboard so the user can share it when reporting translation issues.
 */
const TranslationDebugPanel: React.FC<{ mobile?: boolean }> = ({ mobile }) => {
  const [entries, setEntries] = useState<TranslationDebugEntry[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const refresh = () => setEntries(getTranslationDebugLog());
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleCopy = async () => {
    const text = formatDebugLog(APP_VERSION);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for browsers / contexts without clipboard API
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    clearTranslationDebugLog();
    setEntries([]);
  };

  return (
    <div className="mt-6 pt-4 border-t border-subtle">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-caption font-semibold text-muted-foreground">
          Translation Diagnostics
        </div>
        <div className="text-tiny font-mono text-disabled">build {APP_VERSION}</div>
      </div>

      <div className="text-tiny text-disabled mb-3 leading-normal">
        The last {entries.length} translation attempts (per-item per-backend).
        Copy this log and paste it if a translation problem persists.
      </div>

      <div className="flex gap-2 mb-3 flex-wrap">
        <button
          onClick={handleCopy}
          className="px-3 py-1 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] bg-cyan-500/[0.09] border border-cyan-500/20 text-cyan-400"
        >
          {copied ? "Copied ✓" : "Copy log"}
        </button>
        <button
          onClick={handleClear}
          className="px-3 py-1 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] bg-transparent border border-subtle text-muted-foreground"
        >
          Clear
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="text-tiny text-disabled italic">
          No translation attempts recorded yet. Try translating an item.
        </div>
      ) : (
        <div className={mobile ? "max-h-[240px] overflow-auto" : "max-h-[320px] overflow-auto"}>
          {entries.slice().reverse().map((e, i) => (
            <div
              key={`${e.timestamp}-${i}`}
              className="text-tiny font-mono py-1 border-b border-subtle last:border-b-0 leading-normal"
            >
              <div className="flex gap-2 flex-wrap">
                <span className="text-disabled">{e.timestamp.slice(11, 19)}</span>
                <span className="text-cyan-400">[{e.backend}]</span>
                <span
                  className={
                    e.outcome === "ok"
                      ? "text-emerald-400"
                      : e.outcome === "skip"
                        ? "text-amber-400"
                        : "text-red-400"
                  }
                >
                  {e.outcome}
                </span>
                <span className="text-disabled">{e.elapsedMs}ms</span>
              </div>
              <div className="text-disabled truncate">{e.itemHint}</div>
              {e.reason && <div className="text-red-400/70 break-words">{e.reason}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
