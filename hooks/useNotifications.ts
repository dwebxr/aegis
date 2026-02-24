"use client";
import { useState, useCallback, useRef, useEffect } from "react";

export interface Notification {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

export const DEDUPE_WINDOW_MS = 5_000;
let nextId = 1;

/** Pure function: returns true if this notification should be suppressed. Updates recentMap if not suppressed. */
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

/** Pure function: returns auto-dismiss duration in ms based on notification type. */
export function computeDismissDuration(type: Notification["type"]): number {
  return type === "error" ? 5000 : 2500;
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
