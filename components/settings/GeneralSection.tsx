"use client";
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { usePushNotification } from "@/hooks/usePushNotification";
import { usePreferences } from "@/contexts/PreferenceContext";
import { NotificationToggle } from "@/components/ui/NotificationToggle";
import { cardClass, sectionTitleClass, actionBtnClass, pillBtnClass } from "./styles";

const LS_PUSH_FREQ_KEY = "aegis-push-frequency";

const PUSH_FREQ_OPTIONS = [
  { label: "Off", value: "off" },
  { label: "1x/day", value: "1x_day" },
  { label: "3x/day", value: "3x_day" },
  { label: "Realtime", value: "realtime" },
] as const;

type PushFrequency = typeof PUSH_FREQ_OPTIONS[number]["value"];

interface GeneralSectionProps {
  mobile?: boolean;
}

const toggleTrack = (on: boolean) => cn(
  "relative w-10 h-[22px] rounded-[11px] border-none cursor-pointer shrink-0 transition-fast",
  on ? "bg-cyan-500" : "bg-raised"
);

const toggleThumb = (on: boolean) => cn(
  "absolute top-[2px] w-[18px] h-[18px] rounded-full transition-fast",
  on ? "left-5 bg-white" : "left-[2px] bg-disabled"
);

export const GeneralSection: React.FC<GeneralSectionProps> = ({ mobile }) => {
  const { theme, setTheme } = useTheme();
  const { isSubscribed } = usePushNotification();
  const { profile, setNotificationPrefs } = usePreferences();

  const [pushFreq, setPushFreq] = useState<PushFrequency>("1x_day");
  const [alertTopicInput, setAlertTopicInput] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_PUSH_FREQ_KEY);
      if (saved && PUSH_FREQ_OPTIONS.some(o => o.value === saved)) {
        setPushFreq(saved as PushFrequency);
      }
    } catch (e) { console.debug("[settings] localStorage read failed:", e); }
  }, []);

  const handleFreqChange = (value: PushFrequency) => {
    setPushFreq(value);
    try { localStorage.setItem(LS_PUSH_FREQ_KEY, value); } catch (err) { console.warn("[settings] Failed to save push frequency:", err); }
  };

  const handleAddAlertTopic = useCallback(() => {
    const topic = alertTopicInput.trim().toLowerCase();
    if (!topic) return;
    const current = profile.notificationPrefs?.topicAlerts ?? [];
    if (current.includes(topic)) { setAlertTopicInput(""); return; }
    setNotificationPrefs({
      ...profile.notificationPrefs,
      topicAlerts: [...current, topic],
    });
    setAlertTopicInput("");
  }, [alertTopicInput, profile.notificationPrefs, setNotificationPrefs]);

  const handleRemoveAlertTopic = useCallback((topic: string) => {
    const current = profile.notificationPrefs?.topicAlerts ?? [];
    setNotificationPrefs({
      ...profile.notificationPrefs,
      topicAlerts: current.filter(t => t !== topic),
    });
  }, [profile.notificationPrefs, setNotificationPrefs]);

  const isLight = theme === "light";
  const d2aOn = profile.notificationPrefs?.d2aAlerts ?? false;

  return (
    <>
      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>Appearance</div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-body font-semibold text-secondary-foreground">Theme</div>
            <div className="text-caption text-muted-foreground mt-0.5">
              {isLight ? "Light" : "Dark"} mode
            </div>
          </div>
          <button
            data-testid="aegis-settings-theme-toggle"
            onClick={() => setTheme(isLight ? "dark" : "light")}
            aria-label={`Switch to ${isLight ? "dark" : "light"} mode`}
            className={toggleTrack(isLight)}
          >
            <div className={toggleThumb(isLight)} />
          </button>
        </div>
      </div>

      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>Push Notifications</div>
        <NotificationToggle />
        {isSubscribed && (
          <div className="mt-3">
            <div className="text-caption font-semibold text-muted-foreground mb-2">
              Frequency
            </div>
            <div className="flex gap-1 flex-wrap">
              {PUSH_FREQ_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleFreqChange(opt.value)}
                  className={pillBtnClass(pushFreq === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="text-tiny text-disabled mt-2 leading-normal">
              Controls how often briefing alerts are sent. &quot;Off&quot; mutes without unsubscribing.
            </div>
          </div>
        )}
        {isSubscribed && (
          <div className="mt-4 border-t border-subtle pt-3">
            <div className="text-caption font-semibold text-muted-foreground mb-2">
              Notification Rules
            </div>

            <div className="mb-3">
              <div className="text-tiny text-disabled mb-1">Alert Topics</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {(profile.notificationPrefs?.topicAlerts ?? []).map(topic => (
                  <span key={topic} className="inline-flex items-center gap-1 text-caption px-2 py-px bg-cyan-400/[0.06] border border-cyan-400/[0.12] rounded-full text-cyan-400">
                    {topic}
                    <button
                      onClick={() => handleRemoveAlertTopic(topic)}
                      className="bg-transparent border-none text-cyan-400 cursor-pointer p-0 text-caption leading-none"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  data-testid="aegis-settings-alert-topic-input"
                  type="text"
                  value={alertTopicInput}
                  onChange={e => setAlertTopicInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleAddAlertTopic(); }}
                  placeholder="Add topic..."
                  className="flex-1 min-w-[100px] px-3 py-1 bg-overlay border border-subtle rounded-sm text-foreground text-caption font-[inherit] outline-none"
                />
                <button
                  data-testid="aegis-settings-alert-topic-add"
                  onClick={handleAddAlertTopic}
                  disabled={!alertTopicInput.trim()}
                  className={cn(actionBtnClass, !alertTopicInput.trim() && "opacity-40 cursor-not-allowed")}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="mb-3">
              <div className="flex justify-between items-center">
                <div className="text-tiny text-disabled">Min Score Alert</div>
                <div className="text-caption font-bold font-mono text-secondary-foreground">
                  {profile.notificationPrefs?.minScoreAlert ?? 5}/10
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={profile.notificationPrefs?.minScoreAlert ?? 5}
                onChange={e => setNotificationPrefs({
                  ...profile.notificationPrefs,
                  minScoreAlert: parseInt(e.target.value, 10),
                })}
                className="w-full mt-1"
                style={{ accentColor: "var(--color-cyan-500, #06b6d4)" }}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-tiny text-disabled">D2A Content Alerts</div>
                <div className="text-tiny text-disabled mt-0.5">
                  Always notify for D2A agent content
                </div>
              </div>
              <button
                onClick={() => setNotificationPrefs({
                  ...profile.notificationPrefs,
                  d2aAlerts: !d2aOn,
                })}
                className={toggleTrack(d2aOn)}
              >
                <div className={toggleThumb(d2aOn)} />
              </button>
            </div>
            <div className="text-tiny text-disabled mt-2 leading-normal">
              Only send notifications for items matching these rules. Leave topics empty to match all.
            </div>
          </div>
        )}
      </div>
    </>
  );
};
