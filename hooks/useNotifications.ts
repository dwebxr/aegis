"use client";
import { useState, useCallback, useRef, useEffect } from "react";

export interface Notification {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

const DEDUPE_WINDOW_MS = 5_000;

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const recentRef = useRef<Map<string, number>>(new Map());
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    return () => { timersRef.current.forEach(t => clearTimeout(t)); };
  }, []);

  const addNotification = useCallback((text: string, type: Notification["type"]) => {
    // Suppress duplicate error notifications within the dedupe window
    const now = Date.now();
    if (type === "error") {
      const lastSeen = recentRef.current.get(text);
      if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return;
      recentRef.current.set(text, now);
    }

    const id = now;
    setNotifications(prev => [...prev, { id, text, type }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 2500);
    timersRef.current.add(timer);
  }, []);

  return { notifications, addNotification };
}
