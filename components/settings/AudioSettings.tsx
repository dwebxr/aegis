"use client";
import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAudioBriefing } from "@/hooks/useAudioBriefing";
import { loadVoices, isWebSpeechAvailable } from "@/lib/audio/webspeech";
import { cardClass, sectionTitleClass } from "./styles";

interface AudioSettingsProps {
  mobile?: boolean;
}

const RATE_OPTIONS: ReadonlyArray<number> = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

const toggleBase = (on: boolean) => cn(
  "relative w-10 h-[22px] rounded-[11px] border-none cursor-pointer shrink-0 transition-fast",
  on ? "bg-cyan-500" : "bg-overlay",
);

const toggleKnob = (on: boolean): React.CSSProperties => ({
  position: "absolute",
  top: 2,
  left: on ? 20 : 2,
  width: 18,
  height: 18,
  borderRadius: "50%",
  background: on ? "#fff" : "var(--color-text-disabled)",
  transition: "left 0.15s ease",
});

/**
 * Audio briefing settings card. Surfaced inside Settings > Feeds so users
 * can toggle the Listen button on / off, choose a voice, set a default
 * speech rate, and decide whether the serendipity pick is appended to the
 * read-aloud queue.
 *
 * Renders a single muted card explaining the unavailability when the Web
 * Speech API isn't usable in this browser, rather than hiding the section
 * outright (so users still discover the feature).
 */
export const AudioSettings: React.FC<AudioSettingsProps> = ({ mobile }) => {
  const { prefs, setPrefs, available } = useAudioBriefing();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    void loadVoices().then((list) => {
      if (cancelled) return;
      setVoices(list);
      setVoicesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [available]);

  const showSettings = available && prefs.enabled;

  return (
    <div className={cardClass(mobile)}>
      <div className={sectionTitleClass}>Audio Briefing</div>

      {!isWebSpeechAvailable() ? (
        <div className="text-tiny text-disabled leading-tight">
          Audio playback is not available in this browser. The Web Speech API is missing —
          try Chrome, Edge, Safari, or Firefox.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <button
              data-testid="aegis-settings-audio-toggle"
              type="button"
              onClick={() => setPrefs({ enabled: !prefs.enabled })}
              className={toggleBase(prefs.enabled)}
              aria-label={prefs.enabled ? "Disable audio briefing" : "Enable audio briefing"}
            >
              <div style={toggleKnob(prefs.enabled)} />
            </button>
            <span className={cn("text-caption font-semibold", prefs.enabled ? "text-cyan-400" : "text-disabled")}>
              {prefs.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>

          {showSettings && (
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-tiny text-disabled mb-1">Voice</div>
                <select
                  data-testid="aegis-settings-audio-voice"
                  value={prefs.voiceURI ?? ""}
                  onChange={e => setPrefs({ voiceURI: e.target.value || undefined })}
                  className="w-full px-3 py-1 bg-overlay border border-subtle rounded-sm text-foreground text-caption font-mono outline-none cursor-pointer"
                >
                  <option value="">Auto (best match for article language)</option>
                  {voices.map(v => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} — {v.lang}{v.localService ? " (local)" : ""}
                    </option>
                  ))}
                </select>
                {!voicesLoaded && (
                  <div className="text-tiny text-disabled mt-1">Loading available voices…</div>
                )}
              </div>

              <div>
                <div className="text-tiny text-disabled mb-1">Default speed</div>
                <div className="flex flex-wrap gap-1">
                  {RATE_OPTIONS.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setPrefs({ rate: r })}
                      className={cn(
                        "px-3 py-1 rounded-sm text-caption font-[inherit] cursor-pointer transition-fast",
                        Math.abs(prefs.rate - r) < 0.01
                          ? "bg-cyan-500/[0.09] border border-cyan-500/20 text-cyan-400 font-bold"
                          : "bg-transparent border border-subtle text-muted-foreground font-medium",
                      )}
                    >
                      {r.toFixed(2)}×
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.preferTranslated}
                  onChange={e => setPrefs({ preferTranslated: e.target.checked })}
                  className="size-4 cursor-pointer"
                />
                <span className="text-caption text-secondary-foreground">
                  Read translated text when available
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.includeSerendipity}
                  onChange={e => setPrefs({ includeSerendipity: e.target.checked })}
                  className="size-4 cursor-pointer"
                />
                <span className="text-caption text-secondary-foreground">
                  Include the serendipity pick after the priority list
                </span>
              </label>
            </div>
          )}
        </>
      )}

      <div className="text-tiny text-disabled mt-3 leading-tight">
        Listen to your priority briefing read aloud through the browser&apos;s built-in
        Web Speech API. Fully on-device, no API calls, no data leaves your browser.
        Voice quality and language coverage depend on your operating system.
      </div>
    </div>
  );
};
