export const breakpoints = {
  mobile: 680,
  tablet: 960,
} as const;

// bg/text/border resolve via CSS custom properties on [data-theme]; accents are hex (theme-invariant).
export const colors = {
  bg: {
    root: "var(--color-bg-root)",
    surface: "var(--color-bg-surface)",
    raised: "var(--color-bg-raised)",
    overlay: "var(--color-bg-overlay)",
  },
  border: {
    subtle: "var(--color-border-subtle)",
    default: "var(--color-border-default)",
    emphasis: "var(--color-border-emphasis)",
  },
  text: {
    primary: "var(--color-text-primary)",
    secondary: "var(--color-text-secondary)",
    tertiary: "var(--color-text-tertiary)",
    muted: "var(--color-text-muted)",
    disabled: "var(--color-text-disabled)",
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
  purple: { 300: "#d8b4fe", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed" },
  amber: { 400: "#fbbf24", 500: "#f59e0b" },
  sky: { 400: "#38bdf8" },
} as const;

export function scoreGrade(composite: number): { grade: string; color: string; bg: string } {
  if (composite >= 8) return { grade: "A", color: colors.green[400], bg: colors.green.bg };
  if (composite >= 6) return { grade: "B", color: colors.cyan[400], bg: "rgba(6,182,212,0.08)" };
  if (composite >= 4) return { grade: "C", color: colors.amber[400], bg: "rgba(251,191,36,0.08)" };
  if (composite >= 2) return { grade: "D", color: colors.orange[400], bg: colors.orange.bg };
  return { grade: "F", color: colors.red[400], bg: colors.red.bg };
}
