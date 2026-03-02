"use client";
import React, { useState, useEffect } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueSize } from "@/lib/offline/actionQueue";
import { colors, space, type as t, radii } from "@/styles/theme";

export const SyncStatusBanner: React.FC = () => {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let active = true;
    const check = () => {
      queueSize()
        .then(n => { if (active) setPending(n); })
        .catch(() => { /* IndexedDB unavailable */ });
    };
    check();
    const interval = setInterval(check, 5_000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  if (online && pending === 0) return null;

  const isOffline = !online;
  const bg = isOffline ? `${colors.red[400]}15` : `${colors.amber[400]}15`;
  const borderColor = isOffline ? `${colors.red[400]}30` : `${colors.amber[400]}30`;
  const textColor = isOffline ? colors.red[400] : colors.amber[400];
  const message = isOffline
    ? `Offline${pending > 0 ? ` \u2014 ${pending} action${pending !== 1 ? "s" : ""} pending sync` : ""}`
    : `Syncing ${pending} pending action${pending !== 1 ? "s" : ""}...`;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: `${space[2]}px ${space[4]}px`,
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: radii.md,
        marginBottom: space[3],
        fontSize: t.caption.size,
        fontWeight: 600,
        color: textColor,
        textAlign: "center",
      }}
    >
      {message}
    </div>
  );
};
