"use client";

import { useState, useEffect } from "react";
import { queueSize } from "@/lib/offline/actionQueue";

export default function OfflinePage() {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    queueSize()
      .then(setPending)
      .catch(e => { console.debug("[offline] IndexedDB unavailable:", e); });
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a0f1e] text-slate-200 font-sans text-center p-8">
      <div className="text-[4rem] mb-4">&#x1F6E1;</div>
      <h1 className="text-2xl font-semibold mb-2">
        You&apos;re offline
      </h1>
      <p className="text-slate-400 max-w-[24rem] mb-3">
        Aegis needs an internet connection to fetch and analyze content.
      </p>
      <p className="text-slate-500 text-sm max-w-[24rem] mb-6">
        Your cached evaluations are still available offline.
      </p>
      {pending > 0 && (
        <div className="px-6 py-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.08] text-amber-300 text-sm font-semibold mb-4 max-w-[24rem]">
          {pending} action{pending !== 1 ? "s" : ""} pending sync — will sync when online
        </div>
      )}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => { window.location.href = "/"; }}
          className="px-6 py-2.5 rounded-lg border border-indigo-500 bg-indigo-900 text-slate-200 cursor-pointer text-sm font-medium"
        >
          View Cached Dashboard
        </button>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 cursor-pointer text-sm font-medium"
        >
          Retry Connection
        </button>
      </div>
    </div>
  );
}
