"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Tracks browser online/offline state and fires a callback when connectivity
 * is restored. Useful for triggering offline queue replay.
 */
export function useOnlineStatus(onReconnect?: () => void): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const callbackRef = useRef(onReconnect);
  callbackRef.current = onReconnect;

  const wasOfflineRef = useRef(false);

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
