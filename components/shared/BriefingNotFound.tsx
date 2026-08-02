import React from "react";
import Link from "next/link";

/**
 * Shown when a shared-briefing address resolves to nothing.
 *
 * Rendered with HTTP 200 rather than through notFound(). Next never caches a
 * 404, so every crawl of a stale or mistyped /b/<naddr> link started a fresh
 * server render — including, before the format check, a 15-second relay query.
 * At 200 the page joins the route's ISR cache and a repeat costs nothing.
 * generateMetadata marks it noindex, so nothing enters a search index.
 */
export function BriefingNotFound({ naddr }: { naddr: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h1 className="text-h1 font-bold text-foreground mb-3">Briefing not found</h1>
      <p className="text-body text-muted-foreground mb-2">
        This briefing is no longer on the relays we query, or the link is incomplete.
      </p>
      <p className="text-caption text-muted-foreground font-mono break-all mb-8">{naddr}</p>
      <Link
        href="/"
        className="inline-block px-5 py-2.5 rounded-lg bg-accent text-accent-foreground font-semibold no-underline"
      >
        Go to Aegis
      </Link>
    </div>
  );
}
