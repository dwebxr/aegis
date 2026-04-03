"use client";
import React from "react";
import { usePreferences } from "@/contexts/PreferenceContext";
import { cardClass, sectionTitleClass, pillBtnClass } from "./styles";
import {
  LANGUAGES,
  DEFAULT_TRANSLATION_PREFS,
  type TranslationLanguage,
  type TranslationPolicy,
  type TranslationBackend,
} from "@/lib/translation/types";

const POLICY_OPTIONS: ReadonlyArray<{ value: TranslationPolicy; label: string; desc: string }> = [
  { value: "off", label: "Off", desc: "Translation disabled — no translate buttons or auto-translation" },
  { value: "manual", label: "Manual", desc: "Translate only when you tap the translate button" },
  { value: "high_quality", label: "High quality", desc: "Auto-translate posts above the score threshold" },
  { value: "all", label: "All posts", desc: "Auto-translate every post in the feed" },
];

const BACKEND_OPTIONS: ReadonlyArray<{ value: TranslationBackend; label: string; desc: string }> = [
  { value: "auto", label: "Auto", desc: "Use best available engine" },
  { value: "ic", label: "IC LLM", desc: "On-chain Llama 3.1 — free, no device load" },
  { value: "browser", label: "Browser", desc: "WebLLM — in-browser, requires WebGPU" },
  { value: "local", label: "Local", desc: "Ollama — local server" },
  { value: "cloud", label: "Cloud", desc: "Claude API — highest quality" },
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
    </div>
  );
};
