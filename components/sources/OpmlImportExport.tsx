"use client";
import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useSources } from "@/contexts/SourceContext";
import { useNotify } from "@/contexts/NotificationContext";
import { useDemo } from "@/contexts/DemoContext";
import { sourcesToOpml, opmlToSources } from "@/lib/sources/opml";
import type { SavedSource } from "@/lib/types/sources";

const btnBase = "px-4 py-2 bg-gradient-to-br from-blue-600 to-blue-700 rounded-md text-white text-body-sm font-bold transition-fast border-none font-[inherit]";

export function OpmlImportExport() {
  const { sources, addSource } = useSources();
  const { addNotification } = useNotify();
  const { isDemoMode } = useDemo();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<
    Omit<SavedSource, "id" | "createdAt">[] | null
  >(null);

  const rssCount = sources.filter((s) => s.type === "rss" && s.feedUrl).length;

  function handleExport() {
    const xml = sourcesToOpml(sources);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aegis-sources.opml";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const xml = reader.result as string;
      const parsed = opmlToSources(xml);
      const existingUrls = new Set(
        sources.filter((s) => s.feedUrl).map((s) => s.feedUrl),
      );
      const newFeeds = parsed.filter((s) => !existingUrls.has(s.feedUrl));

      if (newFeeds.length === 0) {
        addNotification("No new feeds found", "info");
      } else {
        setPending(newFeeds.map((s) => ({
          type: s.type,
          label: s.label,
          feedUrl: s.feedUrl,
          enabled: s.enabled,
        })));
      }
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.onerror = () => {
      addNotification("Failed to read file", "error");
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsText(file);
  }

  function confirmImport() {
    if (!pending) return;
    let added = 0;
    for (const s of pending) {
      if (addSource(s)) added++;
    }
    addNotification(`Imported ${added} feeds`, "success");
    setPending(null);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={isDemoMode}
        className={cn(btnBase, isDemoMode ? "opacity-50 cursor-default" : "cursor-pointer")}
      >
        Import OPML
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".opml,.xml"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={handleExport}
        disabled={rssCount === 0}
        className={cn(btnBase, rssCount === 0 ? "opacity-50 cursor-default" : "cursor-pointer")}
      >
        Export OPML
      </button>

      {pending && (
        <div className="flex items-center gap-2 text-body-sm text-secondary-foreground">
          <span>Import {pending.length} new feeds?</span>
          <button
            type="button"
            onClick={confirmImport}
            className="px-3 py-1 bg-gradient-to-br from-green-500 to-green-400 rounded-md text-white text-body-sm font-bold cursor-pointer transition-fast border-none font-[inherit]"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setPending(null)}
            className="px-3 py-1 bg-surface-1 rounded-md text-secondary-foreground text-body-sm font-bold cursor-pointer transition-fast border border-border font-[inherit]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
