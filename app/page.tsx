"use client";
import React, { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { NotificationToast } from "@/components/ui/NotificationToast";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import { FeedTab } from "@/components/tabs/FeedTab";
import { IncineratorTab } from "@/components/tabs/IncineratorTab";
import { SourcesTab } from "@/components/tabs/SourcesTab";
import { AnalyticsTab } from "@/components/tabs/AnalyticsTab";
import { useWindowSize } from "@/hooks/useWindowSize";
import { useNotifications } from "@/hooks/useNotifications";
import { useContent } from "@/contexts/ContentContext";
import { useAuth } from "@/contexts/AuthContext";

export default function AegisApp() {
  const { mobile } = useWindowSize();
  const { notifications, addNotification } = useNotifications();
  const { content, isAnalyzing, analyze, validateItem, flagItem, loadFromIC } = useContent();
  const { isAuthenticated } = useAuth();

  const [tab, setTab] = useState("dashboard");
  const [isProc, setIsProc] = useState(false);
  const [procCnt, setProcCnt] = useState(0);

  useEffect(() => {
    if (isAuthenticated) {
      loadFromIC().catch(() => {});
    }
  }, [isAuthenticated, loadFromIC]);

  useEffect(() => {
    const iv = setInterval(() => setProcCnt(p => p + Math.floor(Math.random() * 3)), 3000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const run = () => { setIsProc(true); setTimeout(() => setIsProc(false), 3500); };
    run();
    const iv = setInterval(run, 7000);
    return () => clearInterval(iv);
  }, []);

  const handleValidate = (id: string) => {
    validateItem(id);
    addNotification("Validated ✓", "success");
  };

  const handleFlag = (id: string) => {
    flagItem(id);
    addNotification("Flagged as slop", "error");
  };

  const handleAnalyze = async (text: string) => {
    const result = await analyze(text);
    addNotification(
      result.verdict === "quality" ? "Quality confirmed ✓" : "Slop identified 🔥",
      result.verdict === "quality" ? "success" : "error"
    );
    return result;
  };

  return (
    <AppShell activeTab={tab} onTabChange={setTab}>
      {tab === "dashboard" && <DashboardTab content={content} mobile={mobile} procCnt={procCnt} />}
      {tab === "feed" && <FeedTab content={content} onValidate={handleValidate} onFlag={handleFlag} mobile={mobile} />}
      {tab === "incinerator" && <IncineratorTab isProc={isProc} onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />}
      {tab === "sources" && <SourcesTab onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />}
      {tab === "analytics" && <AnalyticsTab content={content} mobile={mobile} />}
      <NotificationToast notifications={notifications} mobile={mobile} />
    </AppShell>
  );
}
