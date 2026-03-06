import { cn } from "@/lib/utils";

export const cardClass = (mobile?: boolean) => cn(
  "bg-card border border-border rounded-lg",
  mobile ? "p-4 mb-3" : "p-5 mb-4"
);

export const sectionTitleClass = "text-body font-bold text-foreground mb-3 tracking-[0.3px]";

export const actionBtnClass = "px-3 py-1 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)] rounded-sm text-muted-foreground text-caption font-semibold cursor-pointer font-[inherit] transition-fast";

export const confirmBtnClass = "px-3 py-1 bg-amber-400/10 border border-amber-400/20 rounded-sm text-amber-400 text-caption font-semibold cursor-pointer font-[inherit]";

export const cancelBtnClass = "px-3 py-1 bg-transparent border border-[var(--color-border-subtle)] rounded-sm text-muted-foreground text-caption font-semibold cursor-pointer font-[inherit]";

export const pillBtnClass = (active: boolean) => cn(
  "px-3 py-1 rounded-sm text-caption font-[inherit] cursor-pointer transition-fast",
  active
    ? "bg-cyan-500/[0.09] border border-cyan-500/20 text-cyan-400 font-bold"
    : "bg-transparent border border-[var(--color-border-subtle)] text-muted-foreground font-medium"
);

// Keep old exports as aliases for backwards compat during migration
import { colors, space, type as t, radii, transitions } from "@/styles/theme";

export const cardStyle = (mobile?: boolean): React.CSSProperties => ({
  background: colors.bg.surface,
  border: `1px solid ${colors.border.default}`,
  borderRadius: radii.lg,
  padding: mobile ? space[4] : space[5],
  marginBottom: mobile ? space[3] : space[4],
});

export const sectionTitle: React.CSSProperties = {
  fontSize: t.body.size,
  fontWeight: 700,
  color: colors.text.primary,
  marginBottom: space[3],
  letterSpacing: 0.3,
};

export const actionBtnStyle: React.CSSProperties = {
  padding: `${space[1]}px ${space[3]}px`,
  background: colors.bg.overlay,
  border: `1px solid ${colors.border.subtle}`,
  borderRadius: radii.sm,
  color: colors.text.muted,
  fontSize: t.caption.size,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  transition: transitions.fast,
};

export const confirmBtnStyle: React.CSSProperties = {
  padding: `${space[1]}px ${space[3]}px`,
  background: `${colors.amber[400]}1A`,
  border: `1px solid ${colors.amber[400]}33`,
  borderRadius: radii.sm,
  color: colors.amber[400],
  fontSize: t.caption.size,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const cancelBtnStyle: React.CSSProperties = {
  padding: `${space[1]}px ${space[3]}px`,
  background: "transparent",
  border: `1px solid ${colors.border.subtle}`,
  borderRadius: radii.sm,
  color: colors.text.muted,
  fontSize: t.caption.size,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const pillBtn = (active: boolean): React.CSSProperties => ({
  padding: `${space[1]}px ${space[3]}px`,
  borderRadius: radii.sm,
  fontSize: t.caption.size,
  fontWeight: active ? 700 : 500,
  fontFamily: "inherit",
  cursor: "pointer",
  transition: transitions.fast,
  background: active ? `${colors.cyan[500]}18` : "transparent",
  color: active ? colors.cyan[400] : colors.text.muted,
  border: `1px solid ${active ? `${colors.cyan[500]}33` : colors.border.subtle}`,
});
