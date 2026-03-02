"use client";

import { useState, useEffect } from "react";
import { queueSize } from "@/lib/offline/actionQueue";

export default function OfflinePage() {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    queueSize()
      .then(setPending)
      .catch(() => { /* IndexedDB unavailable */ });
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0a0f1e",
        color: "#e2e8f0",
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>&#x1F6E1;</div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
        You&apos;re offline
      </h1>
      <p style={{ color: "#94a3b8", maxWidth: "24rem", marginBottom: "0.75rem" }}>
        Aegis needs an internet connection to fetch and analyze content.
      </p>
      <p style={{ color: "#64748b", fontSize: "0.875rem", maxWidth: "24rem", marginBottom: "1.5rem" }}>
        Your cached evaluations are still available offline.
      </p>
      {pending > 0 && (
        <div style={{
          padding: "0.625rem 1.5rem",
          borderRadius: "0.5rem",
          border: "1px solid #f59e0b33",
          backgroundColor: "#f59e0b15",
          color: "#fbbf24",
          fontSize: "0.875rem",
          fontWeight: 600,
          marginBottom: "1rem",
          maxWidth: "24rem",
        }}>
          {pending} action{pending !== 1 ? "s" : ""} pending sync — will sync when online
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <button
          onClick={() => { window.location.href = "/"; }}
          style={{
            padding: "0.625rem 1.5rem",
            borderRadius: "0.5rem",
            border: "1px solid #6366f1",
            backgroundColor: "#312e81",
            color: "#e2e8f0",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          View Cached Dashboard
        </button>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "0.625rem 1.5rem",
            borderRadius: "0.5rem",
            border: "1px solid #334155",
            backgroundColor: "#1e293b",
            color: "#e2e8f0",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          Retry Connection
        </button>
      </div>
    </div>
  );
}
