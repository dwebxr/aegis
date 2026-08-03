"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Connectivity, as the browser reports it — and `true` wherever it cannot.
 *
 * Node 21 added a global `navigator`, so `typeof navigator !== "undefined"` no
 * longer distinguishes server from browser. It has no `onLine`, so on the
 * server that read produced `undefined`: every server render reported OFFLINE,
 * shipped a red "Offline" banner in the HTML, and then disagreed with the
 * client — a hydration mismatch on every single page load, which makes React
 * throw away the server tree and re-render the page. Test the property, not the
 * object.
 */
function readOnline(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
    ? navigator.onLine
    : true;
}

export function useOnlineStatus(onReconnect?: () => void): boolean {
  const [isOnline, setIsOnline] = useState(readOnline);
  const callbackRef = useRef(onReconnect);
  callbackRef.current = onReconnect;

  // Initialise from the actual connectivity at mount, not a blind false: a PWA
  // *opened* while offline (subway/flight) queues actions, and on reconnect the
  // 'online' handler must fire the drain callback. Hard-coding false meant the
  // cold-start-offline case never drained until a full reload.
  const wasOfflineRef = useRef(!readOnline());

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
