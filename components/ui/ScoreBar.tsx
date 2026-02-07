"use client";
import React from "react";

interface ScoreBarProps {
  label: string;
  score: number;
  color: string;
}

export const ScoreBar: React.FC<ScoreBarProps> = ({ label, score, color }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8892a4", marginBottom: 3 }}>
      <span>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{score}/10</span>
    </div>
    <div style={{ height: 4, background: "#1e2a3a", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${score * 10}%`, background: color, borderRadius: 2, transition: "width 0.8s cubic-bezier(.16,1,.3,1)" }} />
    </div>
  </div>
);
