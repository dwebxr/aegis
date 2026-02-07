"use client";
import { useState, useCallback } from "react";

export interface Notification {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback((text: string, type: Notification["type"]) => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 2500);
  }, []);

  return { notifications, addNotification };
}
