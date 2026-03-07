"use client";
import React, { useState, useEffect } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueSize } from "@/lib/offline/actionQueue";
import { cn } from "@/lib/utils";

export const SyncStatusBanner: React.FC = () => {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let active = true;
    const check = () => {
      queueSize()
        .then(n => { if (active) setPending(n); })
        .catch(e => { console.debug("[sync] IndexedDB unavailable:", e); });
    };
    check();
    const interval = setInterval(check, 5_000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  if (online && pending === 0) return null;

  const isOffline = !online;
  const message = isOffline
    ? `Offline${pending > 0 ? ` \u2014 ${pending} action${pending !== 1 ? "s" : ""} pending sync` : ""}`
    : `Syncing ${pending} pending action${pending !== 1 ? "s" : ""}...`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "px-4 py-2 rounded-md mb-3 text-caption font-semibold text-center",
        isOffline
          ? "bg-red-400/[0.08] border border-red-400/[0.19] text-red-400"
          : "bg-amber-400/[0.08] border border-amber-400/[0.19] text-amber-400"
      )}
    >
      {message}
    </div>
  );
};
