"use client";
import { useState, useEffect } from "react";
import { breakpoints } from "@/styles/theme";

export function useWindowSize() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1024);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return {
    width,
    mobile: width < breakpoints.mobile,
    tablet: width >= breakpoints.mobile && width < breakpoints.tablet,
  };
}
