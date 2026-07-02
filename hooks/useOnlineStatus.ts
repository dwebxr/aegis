"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export function useOnlineStatus(onReconnect?: () => void): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const callbackRef = useRef(onReconnect);
  callbackRef.current = onReconnect;

  // Initialise from the actual connectivity at mount, not a blind false: a PWA
  // *opened* while offline (subway/flight) queues actions, and on reconnect the
  // 'online' handler must fire the drain callback. Hard-coding false meant the
  // cold-start-offline case never drained until a full reload.
  const wasOfflineRef = useRef(typeof navigator !== "undefined" ? !navigator.onLine : false);

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      callbackRef.current?.();
    }
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    wasOfflineRef.current = true;
  }, []);

  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return isOnline;
}
