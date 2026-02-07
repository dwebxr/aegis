"use client";
import React from "react";
import { colors, type as t, transitions } from "@/styles/theme";

interface ScoreBarProps {
  label: string;
  score: number;
  color: string;
}

export const ScoreBar: React.FC<ScoreBarProps> = ({ label, score, color }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: t.caption.size, color: colors.text.muted, marginBottom: 3 }}>
      <span>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{score}/10</span>
    </div>
    <div style={{ height: 4, background: colors.bg.raised, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${score * 10}%`, background: color, borderRadius: 2, transition: transitions.slow }} />
    </div>
  </div>
);
