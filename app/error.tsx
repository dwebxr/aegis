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
    <div className="p-10 bg-[#0a0f1e] text-slate-200 min-h-screen font-mono">
      <h2 className="text-red-400">Something went wrong</h2>
      <pre className="bg-slate-800 p-4 rounded-lg overflow-auto text-[13px] whitespace-pre-wrap">
        {error.message || "An unexpected error occurred. Please try again."}
      </pre>
      {error.stack && (
        <details className="mt-3">
          <summary className="cursor-pointer text-slate-500">Details</summary>
          <pre className="bg-slate-800 p-4 rounded-lg overflow-auto text-[11px] mt-2 whitespace-pre-wrap">
            {error.stack}
          </pre>
        </details>
      )}
      {error.digest && (
        <p className="mt-3 text-[11px] text-slate-500">
          Error ID: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="mt-5 px-5 py-2.5 bg-blue-600 border-none rounded-lg text-white cursor-pointer text-sm"
      >
        Try again
      </button>
    </div>
  );
}
