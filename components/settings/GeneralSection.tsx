"use client";
import React, { useState, useEffect, useCallback } from "react";
import { colors, space, type as t, radii, transitions, fonts } from "@/styles/theme";
import { useTheme } from "@/contexts/ThemeContext";
import { usePushNotification } from "@/hooks/usePushNotification";
import { usePreferences } from "@/contexts/PreferenceContext";
import { NotificationToggle } from "@/components/ui/NotificationToggle";
import { cardStyle, sectionTitle, actionBtnStyle, pillBtn } from "./styles";

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
    } catch { /* Safari private mode */ }
  }, []);

  const handleFreqChange = (value: PushFrequency) => {
    setPushFreq(value);
    try { localStorage.setItem(LS_PUSH_FREQ_KEY, value); } catch { /* Safari private mode */ }
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

  return (
    <>
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Appearance</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: t.body.size, fontWeight: 600, color: colors.text.secondary }}>Theme</div>
            <div style={{ fontSize: t.caption.size, color: colors.text.muted, marginTop: 2 }}>
              {theme === "dark" ? "Dark" : "Light"} mode
            </div>
          </div>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            style={{
              position: "relative",
              width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
              background: theme === "light" ? colors.cyan[500] : colors.bg.raised,
              transition: transitions.fast, flexShrink: 0,
            }}
          >
            <div style={{
              position: "absolute", top: 2, left: theme === "light" ? 20 : 2,
              width: 18, height: 18, borderRadius: "50%",
              background: theme === "light" ? "#fff" : colors.text.disabled,
              transition: transitions.fast,
            }} />
          </button>
        </div>
      </div>

      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Push Notifications</div>
        <NotificationToggle />
        {isSubscribed && (
          <div style={{ marginTop: space[3] }}>
            <div style={{ fontSize: t.caption.size, fontWeight: 600, color: colors.text.muted, marginBottom: space[2] }}>
              Frequency
            </div>
            <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
              {PUSH_FREQ_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleFreqChange(opt.value)}
                  style={pillBtn(pushFreq === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
              Controls how often briefing alerts are sent. &quot;Off&quot; mutes without unsubscribing.
            </div>
          </div>
        )}
        {isSubscribed && (
          <div style={{ marginTop: space[4], borderTop: `1px solid ${colors.border.subtle}`, paddingTop: space[3] }}>
            <div style={{ fontSize: t.caption.size, fontWeight: 600, color: colors.text.muted, marginBottom: space[2] }}>
              Notification Rules
            </div>

            <div style={{ marginBottom: space[3] }}>
              <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginBottom: space[1] }}>Alert Topics</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: space[2] }}>
                {(profile.notificationPrefs?.topicAlerts ?? []).map(topic => (
                  <span key={topic} style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: t.caption.size, padding: `1px ${space[2]}px`,
                    background: `${colors.cyan[400]}10`, border: `1px solid ${colors.cyan[400]}20`,
                    borderRadius: radii.pill, color: colors.cyan[400],
                  }}>
                    {topic}
                    <button
                      onClick={() => handleRemoveAlertTopic(topic)}
                      style={{
                        background: "none", border: "none", color: colors.cyan[400],
                        cursor: "pointer", padding: 0, fontSize: t.caption.size, lineHeight: 1,
                      }}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: space[2] }}>
                <input
                  type="text"
                  value={alertTopicInput}
                  onChange={e => setAlertTopicInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleAddAlertTopic(); }}
                  placeholder="Add topic..."
                  style={{
                    flex: 1, minWidth: 100, padding: `${space[1]}px ${space[3]}px`,
                    background: colors.bg.overlay, border: `1px solid ${colors.border.subtle}`,
                    borderRadius: radii.sm, color: colors.text.primary, fontSize: t.caption.size,
                    fontFamily: "inherit", outline: "none",
                  }}
                />
                <button onClick={handleAddAlertTopic} disabled={!alertTopicInput.trim()} style={{
                  ...actionBtnStyle,
                  opacity: alertTopicInput.trim() ? 1 : 0.4,
                  cursor: alertTopicInput.trim() ? "pointer" : "not-allowed",
                }}>
                  Add
                </button>
              </div>
            </div>

            <div style={{ marginBottom: space[3] }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: t.tiny.size, color: colors.text.disabled }}>Min Score Alert</div>
                <div style={{ fontSize: t.caption.size, fontWeight: 700, fontFamily: fonts.mono, color: colors.text.secondary }}>
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
                style={{ width: "100%", accentColor: colors.cyan[500], marginTop: space[1] }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: t.tiny.size, color: colors.text.disabled }}>D2A Content Alerts</div>
                <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: 2 }}>
                  Always notify for D2A agent content
                </div>
              </div>
              <button
                onClick={() => setNotificationPrefs({
                  ...profile.notificationPrefs,
                  d2aAlerts: !(profile.notificationPrefs?.d2aAlerts ?? false),
                })}
                style={{
                  position: "relative",
                  width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                  background: (profile.notificationPrefs?.d2aAlerts ?? false) ? colors.cyan[500] : colors.bg.overlay,
                  transition: transitions.fast, flexShrink: 0,
                }}
              >
                <div style={{
                  position: "absolute", top: 2, left: (profile.notificationPrefs?.d2aAlerts ?? false) ? 20 : 2,
                  width: 18, height: 18, borderRadius: "50%",
                  background: (profile.notificationPrefs?.d2aAlerts ?? false) ? "#fff" : colors.text.disabled,
                  transition: transitions.fast,
                }} />
              </button>
            </div>
            <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
              Only send notifications for items matching these rules. Leave topics empty to match all.
            </div>
          </div>
        )}
      </div>
    </>
  );
};
