"use client";
import { useState, useCallback } from "react";
import type { AnalyzeResponse } from "@/lib/types/api";

export function useAnalyze() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const analyze = useCallback(async (text: string): Promise<AnalyzeResponse> => {
    setIsAnalyzing(true);
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source: "manual" }),
    });
    const data = await res.json();
    setIsAnalyzing(false);
    if (data.fallback) return data.fallback;
    return data;
  }, []);

  return { analyze, isAnalyzing };
}
