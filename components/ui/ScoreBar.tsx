"use client";
import React from "react";

interface ScoreBarProps {
  label: string;
  score: number;
  color: string;
}

export const ScoreBar: React.FC<ScoreBarProps> = ({ label, score, color }) => (
  <div className="mb-1.5">
    <div className="flex justify-between text-caption text-muted-foreground mb-0.5">
      <span>{label}</span>
      <span className="font-bold" style={{ color }}>{score}/10</span>
    </div>
    <div className="h-1 bg-navy-lighter rounded-sm overflow-hidden">
      <div
        className="h-full rounded-sm transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: `${score * 10}%`, background: color }}
      />
    </div>
  </div>
);
