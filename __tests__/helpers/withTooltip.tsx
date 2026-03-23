import React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Wraps children in TooltipProvider for tests using shadcn Tooltip components */
export function WithTooltip({ children }: { children: React.ReactNode }) {
  return <TooltipProvider delayDuration={0}>{children}</TooltipProvider>;
}
