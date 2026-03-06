import { cn } from "@/lib/utils";

export const cardClass = (mobile?: boolean) => cn(
  "bg-card border border-border rounded-lg",
  mobile ? "p-4 mb-3" : "p-5 mb-4"
);

export const sectionTitleClass = "text-body font-bold text-foreground mb-3 tracking-[0.3px]";

export const actionBtnClass = "px-3 py-1 bg-overlay border border-subtle rounded-sm text-muted-foreground text-caption font-semibold cursor-pointer font-[inherit] transition-fast";

export const confirmBtnClass = "px-3 py-1 bg-amber-400/10 border border-amber-400/20 rounded-sm text-amber-400 text-caption font-semibold cursor-pointer font-[inherit]";

export const cancelBtnClass = "px-3 py-1 bg-transparent border border-subtle rounded-sm text-muted-foreground text-caption font-semibold cursor-pointer font-[inherit]";

export const pillBtnClass = (active: boolean) => cn(
  "px-3 py-1 rounded-sm text-caption font-[inherit] cursor-pointer transition-fast",
  active
    ? "bg-cyan-500/[0.09] border border-cyan-500/20 text-cyan-400 font-bold"
    : "bg-transparent border border-subtle text-muted-foreground font-medium"
);
