"use client";
import React, { useState } from "react";
import { colors, space, type as t } from "@/styles/theme";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import type { ContentItem } from "@/lib/types/content";
import { exportContentCSV, exportContentJSON } from "@/lib/utils/export";
import type { ExportPeriod, ExportType } from "@/lib/utils/export";
import { cardStyle, sectionTitle, actionBtnStyle, confirmBtnStyle, cancelBtnStyle, pillBtn } from "./styles";

interface DataSectionProps {
  mobile?: boolean;
  content: ContentItem[];
}

const PERIOD_OPTIONS: { label: string; value: ExportPeriod }[] = [
  { label: "Today", value: "today" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All", value: "all" },
];

const TYPE_OPTIONS: { label: string; value: ExportType }[] = [
  { label: "Quality only", value: "quality" },
  { label: "All", value: "all" },
];

export const DataSection: React.FC<DataSectionProps> = ({ mobile, content }) => {
  const { isAuthenticated, principalText } = useAuth();
  const { addNotification } = useNotify();

  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [exportPeriod, setExportPeriod] = useState<ExportPeriod>("all");
  const [exportType, setExportType] = useState<ExportType>("all");

  const handleClearCache = () => {
    if (confirmAction !== "clearCache") {
      setConfirmAction("clearCache");
      return;
    }
    localStorage.removeItem("aegis_article_dedup");
    localStorage.removeItem("aegis_source_states");
    setConfirmAction(null);
    addNotification("Content cache cleared", "success");
  };

  const handleResetPrefs = () => {
    if (confirmAction !== "resetPrefs") {
      setConfirmAction("resetPrefs");
      return;
    }
    if (principalText) {
      localStorage.removeItem(`aegis_prefs_${principalText}`);
    }
    setConfirmAction(null);
    addNotification("Preferences reset — reload to apply", "success");
  };

  const scope = { period: exportPeriod, type: exportType };

  return (
    <>
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Export</div>

        {content.length > 0 ? (
          <>
            <div style={{ marginBottom: space[3] }}>
              <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginBottom: space[1] }}>Period</div>
              <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
                {PERIOD_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setExportPeriod(opt.value)} style={pillBtn(exportPeriod === opt.value)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: space[3] }}>
              <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginBottom: space[1] }}>Content</div>
              <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
                {TYPE_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setExportType(opt.value)} style={pillBtn(exportType === opt.value)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
              <button
                onClick={() => exportContentCSV(content, scope)}
                style={{
                  ...actionBtnStyle,
                  background: `${colors.cyan[500]}18`,
                  color: colors.cyan[400],
                  border: `1px solid ${colors.cyan[500]}33`,
                }}
              >
                Export CSV
              </button>
              <button
                onClick={() => exportContentJSON(content, scope)}
                style={{
                  ...actionBtnStyle,
                  background: `${colors.cyan[500]}18`,
                  color: colors.cyan[400],
                  border: `1px solid ${colors.cyan[500]}33`,
                }}
              >
                Export JSON
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: t.caption.size, color: colors.text.disabled }}>
            No content to export yet. Evaluate some content first.
          </div>
        )}

        <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
          Download your evaluations as CSV or JSON. Choose a time period and content type to filter.
        </div>
      </div>

      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Data Management</div>
        <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
          {confirmAction === "clearCache" ? (
            <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
              <span style={{ fontSize: t.caption.size, color: colors.amber[400], fontWeight: 600 }}>Clear cache?</span>
              <button onClick={handleClearCache} style={confirmBtnStyle}>Confirm</button>
              <button onClick={() => setConfirmAction(null)} style={cancelBtnStyle}>Cancel</button>
            </div>
          ) : (
            <button onClick={handleClearCache} style={actionBtnStyle}>
              Clear Content Cache
            </button>
          )}

          {confirmAction === "resetPrefs" ? (
            <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
              <span style={{ fontSize: t.caption.size, color: colors.red[400], fontWeight: 600 }}>Reset preferences?</span>
              <button onClick={handleResetPrefs} style={{ ...confirmBtnStyle, color: colors.red[400], borderColor: `${colors.red[400]}33` }}>Confirm</button>
              <button onClick={() => setConfirmAction(null)} style={cancelBtnStyle}>Cancel</button>
            </div>
          ) : (
            <button onClick={handleResetPrefs} disabled={!isAuthenticated} style={{ ...actionBtnStyle, opacity: isAuthenticated ? 1 : 0.4, cursor: isAuthenticated ? "pointer" : "not-allowed" }}>
              Reset Preferences
            </button>
          )}
        </div>
        <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
          Cache stores dedup hashes &amp; source state. Preferences include your topic weights &amp; author quality data.
        </div>
      </div>
    </>
  );
};
