"use client";
import React, { useRef, useState, useEffect } from "react";
import { colors } from "@/styles/theme";

// ── Configuration ──────────────────────────────────────────────
const THRESHOLD = 72;    // px of pull needed to trigger refresh
const MAX_PULL = 128;    // max visual pull distance (damped)
const DAMPING = 0.45;    // resistance factor for overscroll feel
const LOCK_DIST = 10;    // px before locking swipe direction
const RELOAD_DELAY = 400; // ms spinner shown before reload

type Phase = "idle" | "pulling" | "ready" | "refreshing";

interface PullToRefreshProps {
  /** Ref to the scrollable container (e.g. <main>) */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Enable only on mobile / PWA */
  enabled: boolean;
  children: React.ReactNode;
}

/**
 * Pull-to-refresh for PWA standalone mode.
 * Renders an expandable indicator above children; touch gestures are
 * bound to the scrollRef element. Only activates when scrollTop ≤ 0.
 */
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

    // Direct DOM update for smooth 60fps indicator resize
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

    // ── Touch handlers ──────────────────────────────────────
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

      // Direction lock: wait until user moves past threshold
      if (!g.locked) {
        if (Math.abs(dy) > LOCK_DIST || Math.abs(dx) > LOCK_DIST) {
          g.locked = true;
          g.vertical = Math.abs(dy) > Math.abs(dx);
        }
        return;
      }

      // Only handle vertical pull-down from scroll top
      if (!g.vertical || g.startScrollTop > 0 || dy <= 0) {
        if (g.active) {
          g.active = false;
          setHeight(0, true);
          updatePhase("idle");
        }
        return;
      }

      // Activate pull-to-refresh
      g.active = true;
      e.preventDefault(); // block native scroll / rubber-band
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
      {/* Pull indicator — height is controlled via direct DOM updates */}
      <div
        ref={indicatorRef}
        style={{
          height: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            padding: "12px 0",
          }}
        >
          {phase === "refreshing" ? (
            <div
              style={{
                width: 20,
                height: 20,
                border: `2px solid ${colors.border.default}`,
                borderTopColor: colors.purple[400],
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke={phase === "ready" ? colors.purple[400] : colors.text.muted}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transition: "transform 0.2s ease",
                transform: phase === "ready" ? "rotate(180deg)" : "rotate(0deg)",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: phase === "ready" ? colors.purple[400] : colors.text.muted,
              transition: "color 0.2s ease",
              userSelect: "none",
            }}
          >
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
