"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
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
    <html lang="en">
      <body style={{ padding: 40, background: "#0a0f1e", color: "#e2e8f0", minHeight: "100vh", fontFamily: "monospace", margin: 0 }}>
        <h2 style={{ color: "#f87171" }}>Something went wrong</h2>
        <p style={{ color: "#94a3b8" }}>
          An unexpected error occurred. Please try again.
        </p>
        {error.digest && (
          <p style={{ fontSize: 11, color: "#64748b" }}>
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{ marginTop: 20, padding: "10px 20px", background: "#2563eb", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 14 }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
