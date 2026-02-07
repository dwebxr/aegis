import type React from "react";

// ── Typography ──────────────────────────────────────────────
export const fonts = {
  sans: "'Outfit','Noto Sans JP',-apple-system,sans-serif",
  mono: "'JetBrains Mono',monospace",
} as const;

// ── Breakpoints ─────────────────────────────────────────────
export const breakpoints = {
  mobile: 680,
  tablet: 960,
} as const;

// ── Color palette ───────────────────────────────────────────
export const colors = {
  bg: {
    root: "#0a0f1e",
    surface: "#0f1729",
    raised: "#131c33",
    overlay: "rgba(15,23,42,0.85)",
  },
  border: {
    subtle: "rgba(255,255,255,0.04)",
    default: "rgba(255,255,255,0.07)",
    emphasis: "rgba(255,255,255,0.12)",
  },
  text: {
    primary: "#f1f5f9",
    secondary: "#e2e8f0",
    tertiary: "#94a3b8",
    muted: "#64748b",
    disabled: "#475569",
  },
  cyan: { 50: "#ecfeff", 400: "#22d3ee", 500: "#06b6d4" },
  green: {
    400: "#34d399",
    500: "#10b981",
    bg: "rgba(52,211,153,0.06)",
    border: "rgba(52,211,153,0.15)",
  },
  orange: {
    400: "#fb923c",
    500: "#f97316",
    bg: "rgba(249,115,22,0.06)",
    border: "rgba(249,115,22,0.15)",
  },
  red: {
    400: "#f87171",
    500: "#ef4444",
    bg: "rgba(248,113,113,0.06)",
    border: "rgba(248,113,113,0.15)",
  },
  blue: { 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8" },
  purple: { 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed" },
  amber: { 400: "#fbbf24", 500: "#f59e0b" },
  sky: { 400: "#38bdf8" },
} as const;

// ── Spacing (4px base) ──────────────────────────────────────
export const space = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96,
} as const;

// ── Typography scale ────────────────────────────────────────
export const type = {
  display:  { size: 32, mobileSz: 24, weight: 800, lineHeight: 1.1, letterSpacing: -0.5 },
  h1:       { size: 24, mobileSz: 20, weight: 700, lineHeight: 1.2, letterSpacing: -0.3 },
  h2:       { size: 18, mobileSz: 16, weight: 700, lineHeight: 1.3 },
  h3:       { size: 15, mobileSz: 14, weight: 600, lineHeight: 1.4 },
  bodyLg:   { size: 15, mobileSz: 14, weight: 400, lineHeight: 1.7 },
  body:     { size: 14, mobileSz: 13, weight: 400, lineHeight: 1.6 },
  bodySm:   { size: 12, weight: 500, lineHeight: 1.5 },
  kpiLabel: { size: 10, weight: 600, lineHeight: 1.2, letterSpacing: 1.5 },
  kpiValue: { size: 28, mobileSz: 22, weight: 800, lineHeight: 1.1 },
  kpiSub:   { size: 11, weight: 500, lineHeight: 1.3 },
  caption:  { size: 10, weight: 500, lineHeight: 1.3, letterSpacing: 0.5 },
  tiny:     { size: 9, weight: 600, lineHeight: 1.2, letterSpacing: 0.5 },
} as const;

// ── Shadows ─────────────────────────────────────────────────
export const shadows = {
  sm: "0 1px 3px rgba(0,0,0,0.3)",
  md: "0 4px 12px rgba(0,0,0,0.4)",
  lg: "0 8px 24px rgba(0,0,0,0.5)",
  glow: {
    cyan: "0 0 20px rgba(6,182,212,0.15)",
    green: "0 0 20px rgba(52,211,153,0.15)",
    orange: "0 0 20px rgba(249,115,22,0.2)",
    purple: "0 0 20px rgba(124,58,237,0.15)",
  },
} as const;

// ── Border radii ────────────────────────────────────────────
export const radii = {
  sm: 8, md: 12, lg: 16, xl: 20, pill: 999,
} as const;

// ── Transitions ─────────────────────────────────────────────
export const transitions = {
  fast: "all 0.15s ease",
  normal: "all 0.25s ease",
  slow: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

// ── Reusable style fragments ────────────────────────────────
export const kpiLabelStyle: React.CSSProperties = {
  fontSize: type.kpiLabel.size,
  fontWeight: type.kpiLabel.weight,
  lineHeight: type.kpiLabel.lineHeight,
  letterSpacing: type.kpiLabel.letterSpacing,
  textTransform: "uppercase",
  color: colors.text.muted,
};

// ── Score grade helper ──────────────────────────────────────
export function scoreGrade(composite: number): { grade: string; color: string; bg: string } {
  if (composite >= 8) return { grade: "A", color: colors.green[400], bg: colors.green.bg };
  if (composite >= 6) return { grade: "B", color: colors.cyan[400], bg: "rgba(6,182,212,0.08)" };
  if (composite >= 4) return { grade: "C", color: colors.amber[400], bg: "rgba(251,191,36,0.08)" };
  if (composite >= 2) return { grade: "D", color: colors.orange[400], bg: colors.orange.bg };
  return { grade: "F", color: colors.red[400], bg: colors.red.bg };
}
