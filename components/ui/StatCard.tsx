"use client";
import React from "react";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/design";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  mobile?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({ icon, label, value, sub, color, mobile }) => {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg bg-card border border-border",
        "transition-all duration-250 ease-out",
        "hover:-translate-y-0.5 hover:shadow-md",
        mobile ? "px-4 py-4" : "px-6 py-5"
      )}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      {/* Radial glow decoration */}
      <div
        className="absolute -top-5 -right-5 size-20 rounded-full"
        style={{ background: `radial-gradient(circle, ${color}12, transparent 70%)` }}
      />

      <div className="flex items-center gap-2 mb-3">
        <div
          className="size-7 rounded-sm flex items-center justify-center"
          style={{ background: `${color}15`, color }}
        >
          {icon}
        </div>
        <span className={typography.kpiLabel}>{label}</span>
      </div>

      <div className={cn(
        "font-mono font-extrabold text-foreground leading-[1.1]",
        mobile ? "text-[22px]" : "text-kpi"
      )}>
        {value}
      </div>

      {sub && (
        <div className="text-caption font-medium text-[var(--color-text-disabled)] mt-1">
          {sub}
        </div>
      )}
    </div>
  );
};
