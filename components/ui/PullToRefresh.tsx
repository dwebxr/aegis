"use client";
import React, { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const THRESHOLD = 72;
const MAX_PULL = 128;
const DAMPING = 0.45;
const LOCK_DIST = 10;
const RELOAD_DELAY = 400;

type Phase = "idle" | "pulling" | "ready" | "refreshing";

interface PullToRefreshProps {
  scrollRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  children: React.ReactNode;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  scrollRef,
  enabled,
  children,
}) => {
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const gesture = useRef({
    startY: 0,
    startX: 0,
    startScrollTop: 0,
    active: false,
    locked: false,
    vertical: false,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;

    const setHeight = (h: number, animate = false) => {
      const ind = indicatorRef.current;
      if (!ind) return;
      ind.style.transition = animate
        ? "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
        : "none";
      ind.style.height = `${h}px`;
    };

    const updatePhase = (p: Phase) => {
      if (phaseRef.current === p) return;
      phaseRef.current = p;
      setPhase(p);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (phaseRef.current === "refreshing") return;
      const t = e.touches[0];
      gesture.current = {
        startY: t.clientY,
        startX: t.clientX,
        startScrollTop: el.scrollTop,
        active: false,
        locked: false,
        vertical: false,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (phaseRef.current === "refreshing") return;
      const g = gesture.current;
      const t = e.touches[0];
      const dy = t.clientY - g.startY;
      const dx = t.clientX - g.startX;

      if (!g.locked) {
        if (Math.abs(dy) > LOCK_DIST || Math.abs(dx) > LOCK_DIST) {
          g.locked = true;
          g.vertical = Math.abs(dy) > Math.abs(dx);
        }
        return;
      }

      if (!g.vertical || g.startScrollTop > 0 || dy <= 0) {
        if (g.active) {
          g.active = false;
          setHeight(0, true);
          updatePhase("idle");
        }
        return;
      }

      g.active = true;
      e.preventDefault();
      const pullY = Math.min(MAX_PULL, dy * DAMPING);
      setHeight(pullY);
      updatePhase(pullY >= THRESHOLD ? "ready" : "pulling");
    };

    const onTouchEnd = () => {
      const g = gesture.current;
      if (!g.active) return;
      g.active = false;

      if (phaseRef.current === "ready") {
        updatePhase("refreshing");
        setHeight(THRESHOLD);
        setTimeout(() => window.location.reload(), RELOAD_DELAY);
      } else {
        setHeight(0, true);
        updatePhase("idle");
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [scrollRef, enabled]);

  if (!enabled) return <>{children}</>;

  return (
    <>
      <div ref={indicatorRef} className="h-0 overflow-hidden flex items-center justify-center">
        <div className="flex flex-col items-center gap-1 py-3">
          {phase === "refreshing" ? (
            <div className="size-5 border-2 border-border border-t-purple-400 rounded-full animate-spin" />
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn(
                "transition-transform duration-200",
                phase === "ready" ? "rotate-180 text-purple-400" : "text-muted-foreground"
              )}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
          <span className={cn(
            "text-[11px] font-medium select-none transition-colors duration-200",
            phase === "ready" ? "text-purple-400" : "text-muted-foreground"
          )}>
            {phase === "refreshing"
              ? "Refreshing..."
              : phase === "ready"
                ? "Release to refresh"
                : "Pull to refresh"}
          </span>
        </div>
      </div>
      {children}
    </>
  );
};
