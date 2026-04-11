"use client";
import { useState, useCallback, useRef, useEffect } from "react";

export interface Notification {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

export const DEDUPE_WINDOW_MS = 5_000;
let nextId = 1;

export function shouldSuppressDuplicate(
  recentMap: Map<string, number>,
  text: string,
  type: Notification["type"],
  now: number,
): boolean {
  if (type !== "error") return false;
  const lastSeen = recentMap.get(text);
  if (lastSeen !== undefined && now - lastSeen < DEDUPE_WINDOW_MS) return true;
  recentMap.set(text, now);
  return false;
}

export function computeDismissDuration(type: Notification["type"]): number {
  // Errors stay on screen for 30 seconds so the user has time to read
  // and copy them on mobile (where opening the browser console is not
  // feasible). Info / success messages dismiss faster since they don't
  // need to be acted on.
  return type === "error" ? 30000 : 2500;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const recentRef = useRef<Map<string, number>>(new Map());
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    return () => { timersRef.current.forEach(t => clearTimeout(t)); };
  }, []);

  const addNotification = useCallback((text: string, type: Notification["type"]) => {
    if (shouldSuppressDuplicate(recentRef.current, text, type, Date.now())) return;

    const id = nextId++;
    setNotifications(prev => [...prev, { id, text, type }]);
    const duration = computeDismissDuration(type);
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, duration);
    timersRef.current.add(timer);
  }, []);

  const removeNotification = useCallback((id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  return { notifications, addNotification, removeNotification };
}
