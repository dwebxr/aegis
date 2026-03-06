"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import type { ContentItem } from "@/lib/types/content";
import { exportContentCSV, exportContentJSON } from "@/lib/utils/export";
import type { ExportPeriod, ExportType } from "@/lib/utils/export";
import { cardClass, sectionTitleClass, actionBtnClass, confirmBtnClass, cancelBtnClass, pillBtnClass } from "./styles";

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
      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>Export</div>

        {content.length > 0 ? (
          <>
            <div className="mb-3">
              <div className="text-tiny text-disabled mb-1">Period</div>
              <div className="flex gap-1 flex-wrap">
                {PERIOD_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setExportPeriod(opt.value)} className={pillBtnClass(exportPeriod === opt.value)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <div className="text-tiny text-disabled mb-1">Content</div>
              <div className="flex gap-1 flex-wrap">
                {TYPE_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setExportType(opt.value)} className={pillBtnClass(exportType === opt.value)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                data-testid="aegis-settings-export-csv"
                onClick={() => exportContentCSV(content, scope)}
                className="px-3 py-1 bg-cyan-500/[0.09] border border-cyan-500/20 rounded-sm text-cyan-400 text-caption font-semibold cursor-pointer font-[inherit] transition-fast"
              >
                Export CSV
              </button>
              <button
                data-testid="aegis-settings-export-json"
                onClick={() => exportContentJSON(content, scope)}
                className="px-3 py-1 bg-cyan-500/[0.09] border border-cyan-500/20 rounded-sm text-cyan-400 text-caption font-semibold cursor-pointer font-[inherit] transition-fast"
              >
                Export JSON
              </button>
            </div>
          </>
        ) : (
          <div className="text-caption text-disabled">
            No content to export yet. Evaluate some content first.
          </div>
        )}

        <div className="text-tiny text-disabled mt-2 leading-tight">
          Download your evaluations as CSV or JSON. Choose a time period and content type to filter.
        </div>
      </div>

      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>Data Management</div>
        <div className="flex gap-2 flex-wrap items-center">
          {confirmAction === "clearCache" ? (
            <div className="flex items-center gap-2">
              <span className="text-caption text-amber-400 font-semibold">Clear cache?</span>
              <button onClick={handleClearCache} className={confirmBtnClass}>Confirm</button>
              <button onClick={() => setConfirmAction(null)} className={cancelBtnClass}>Cancel</button>
            </div>
          ) : (
            <button data-testid="aegis-settings-clear-cache" onClick={handleClearCache} className={actionBtnClass}>
              Clear Content Cache
            </button>
          )}

          {confirmAction === "resetPrefs" ? (
            <div className="flex items-center gap-2">
              <span className="text-caption text-red-400 font-semibold">Reset preferences?</span>
              <button onClick={handleResetPrefs} className={cn(confirmBtnClass, "text-red-400 border-red-400/20")}>Confirm</button>
              <button onClick={() => setConfirmAction(null)} className={cancelBtnClass}>Cancel</button>
            </div>
          ) : (
            <button
              data-testid="aegis-settings-reset-prefs"
              onClick={handleResetPrefs}
              disabled={!isAuthenticated}
              className={cn(actionBtnClass, !isAuthenticated && "opacity-40 cursor-not-allowed")}
            >
              Reset Preferences
            </button>
          )}
        </div>
        <div className="text-tiny text-disabled mt-2 leading-tight">
          Cache stores dedup hashes &amp; source state. Preferences include your topic weights &amp; author quality data.
        </div>
      </div>
    </>
  );
};
