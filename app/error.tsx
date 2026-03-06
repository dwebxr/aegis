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
      <p className="bg-slate-800 p-4 rounded-lg text-[13px]">
        An unexpected error occurred. Please try again, or contact support with the error ID below.
      </p>
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
