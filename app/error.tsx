"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div style={{ padding: 40, background: "#0a0f1e", color: "#e2e8f0", minHeight: "100vh", fontFamily: "monospace" }}>
      <h2 style={{ color: "#f87171" }}>Something went wrong</h2>
      <pre style={{ background: "#1e293b", padding: 16, borderRadius: 8, overflow: "auto", fontSize: 13, whiteSpace: "pre-wrap" }}>
        {error.message || "An unexpected error occurred. Please try again."}
      </pre>
      {error.stack && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", color: "#64748b" }}>Details</summary>
          <pre style={{ background: "#1e293b", padding: 16, borderRadius: 8, overflow: "auto", fontSize: 11, marginTop: 8, whiteSpace: "pre-wrap" }}>
            {error.stack}
          </pre>
        </details>
      )}
      {error.digest && (
        <p style={{ marginTop: 12, fontSize: 11, color: "#64748b" }}>
          Error ID: {error.digest}
        </p>
      )}
      <button onClick={reset} style={{ marginTop: 20, padding: "10px 20px", background: "#2563eb", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 14 }}>
        Try again
      </button>
    </div>
  );
}
