"use client";
import { useState, useEffect, useLayoutEffect } from "react";
import { breakpoints } from "@/styles/theme";

// Server render can't know the viewport, so the first client render must use
// the same fixed width (1024) to hydrate cleanly against the prerendered
// landing page. The layout effect swaps in the real width before first paint.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useWindowSize() {
  const [width, setWidth] = useState(1024);

  useIsomorphicLayoutEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    handler();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return {
    width,
    mobile: width < breakpoints.mobile,
    tablet: width >= breakpoints.mobile && width < breakpoints.tablet,
  };
}
