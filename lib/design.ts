/**
 * Aegis Design System — Tailwind class helpers
 *
 * Maps the old styles/theme.ts patterns to Tailwind utility classes.
 * Use these during migration; once all inline styles are gone,
 * styles/theme.ts can be removed.
 */

/* ── Score Grade ─────────────────────────────────────────── */

export type ScoreGradeInfo = {
  grade: string;
  color: string;      // hex for inline/svg
  tw: string;         // tailwind text color class
  twBg: string;       // tailwind background class
  twBorder: string;   // tailwind border class
  twGlow: string;     // tailwind shadow glow class
};

export function scoreGradeTw(composite: number): ScoreGradeInfo {
  if (composite >= 8) return {
    grade: "A",
    color: "#34d399",
    tw: "text-emerald-400",
    twBg: "bg-emerald-dim",
    twBorder: "border-emerald-border",
    twGlow: "shadow-glow-green",
  };
  if (composite >= 6) return {
    grade: "B",
    color: "#22d3ee",
    tw: "text-cyan-400",
    twBg: "bg-cyan-400/[0.08]",
    twBorder: "border-cyan-400/25",
    twGlow: "shadow-glow-cyan",
  };
  if (composite >= 4) return {
    grade: "C",
    color: "#fbbf24",
    tw: "text-amber-400",
    twBg: "bg-amber-dim",
    twBorder: "border-amber-400/25",
    twGlow: "shadow-md",
  };
  if (composite >= 2) return {
    grade: "D",
    color: "#fb923c",
    tw: "text-orange-400",
    twBg: "bg-orange-dim",
    twBorder: "border-orange-border",
    twGlow: "shadow-glow-orange",
  };
  return {
    grade: "F",
    color: "#f87171",
    tw: "text-red-400",
    twBg: "bg-red-dim",
    twBorder: "border-red-border",
    twGlow: "shadow-md",
  };
}

/* ── Typography Presets ──────────────────────────────────── */
/* Use these as className values: cn(typography.h1, "additional-class") */

export const typography = {
  display: "text-display font-extrabold leading-display tracking-tight",
  h1: "text-h1 font-bold leading-h1 tracking-snug",
  h2: "text-h2 font-bold leading-h2",
  h3: "text-h3 font-semibold leading-h3",
  bodyLg: "text-body-lg leading-body-lg",
  body: "text-body leading-body",
  bodySm: "text-body-sm font-medium leading-body-sm",
  kpiLabel: "text-kpi-label font-semibold leading-[1.2] tracking-wider uppercase text-muted-foreground",
  kpiValue: "text-kpi font-extrabold leading-display",
  kpiSub: "text-kpi-sub font-medium leading-h2",
  caption: "text-caption font-medium leading-[1.3] tracking-wide",
  tiny: "text-tiny font-semibold leading-[1.2] tracking-wide",
} as const;

/* ── Common Component Patterns ───────────────────────────── */

export const patterns = {
  card: "bg-card border border-border rounded-lg p-5",
  cardCompact: "bg-card border border-border rounded-lg p-4",
  cardHover: "bg-card border border-border rounded-lg p-5 transition-fast hover:border-teal-border hover:shadow-glow-teal",
  surface: "bg-navy-light border border-border rounded-lg",
  raised: "bg-navy-lighter border border-border rounded-lg",
  overlay: "bg-[var(--color-bg-overlay)] backdrop-blur-sm",
  pillActive: "px-3 py-1 rounded-lg text-caption font-bold bg-teal-dim text-teal border border-teal-border",
  pillInactive: "px-3 py-1 rounded-lg text-caption font-medium bg-transparent text-muted-foreground border border-border transition-fast hover:text-foreground",
  sectionTitle: "text-body font-bold text-foreground tracking-[0.3px]",
} as const;
