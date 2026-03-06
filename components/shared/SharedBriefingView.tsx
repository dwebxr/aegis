"use client";
import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { scoreGrade } from "@/styles/theme";
import type { ParsedBriefing, ParsedBriefingItem } from "@/lib/briefing/serialize";

interface SharedBriefingViewProps {
  briefing: ParsedBriefing;
  naddr: string;
}

function ItemCard({ item }: { item: ParsedBriefingItem }) {
  const grade = scoreGrade(item.composite);

  return (
    <div className="bg-card border border-border rounded-lg p-5 mb-3">
      <div className="flex items-start gap-3 mb-3">
        {item.rank && (
          <div className="size-7 rounded-sm bg-[var(--color-bg-raised)] border border-[var(--color-border-emphasis)] flex items-center justify-center text-body-sm font-bold text-muted-foreground shrink-0">
            #{item.rank}
          </div>
        )}
        {item.isSerendipity && (
          <div className="px-3 py-1 rounded-full bg-violet-600/10 border border-violet-600/20 text-caption font-semibold text-purple-400 shrink-0">
            Serendipity
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-h3 font-semibold text-foreground m-0 leading-snug">
            {item.title}
          </h3>
        </div>
        <div className="px-3 py-1 rounded-sm text-body-sm font-bold shrink-0" style={{ background: grade.bg, color: grade.color }}>
          {item.composite.toFixed(1)}
        </div>
      </div>

      {item.reason && (
        <div className="border-l-[3px] border-[var(--color-border-emphasis)] pl-3 mb-3 text-body text-[var(--color-text-tertiary)] leading-normal italic">
          {item.reason}
        </div>
      )}

      {item.text && (
        <p className="text-body text-secondary-foreground leading-normal m-0 mb-3">
          {item.text}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-caption font-semibold uppercase tracking-[0.5px]" style={{ color: grade.color }}>
          {item.verdict}
        </span>
        {item.topics.map((topic) => (
          <span
            key={topic}
            className="px-2 py-1 rounded-sm bg-[var(--color-bg-raised)] border border-[var(--color-border-subtle)] text-tiny text-muted-foreground"
          >
            #{topic}
          </span>
        ))}
        {item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-caption text-cyan-400 no-underline ml-auto"
          >
            Source &#x2197;
          </a>
        )}
      </div>
    </div>
  );
}

const kpiLabel = "text-caption text-muted-foreground uppercase tracking-[1px]";

export const SharedBriefingView: React.FC<SharedBriefingViewProps> = ({ briefing, naddr }) => {
  const priorityItems = briefing.items.filter((i) => !i.isSerendipity);
  const serendipityItems = briefing.items.filter((i) => i.isSerendipity);
  const dateStr = new Date(briefing.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Header */}
      <header className="border-b border-border px-5 py-4">
        <div className="max-w-[720px] mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 no-underline text-foreground"
          >
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span className="text-h3 font-bold">Aegis</span>
          </Link>
          <a
            href={`https://njump.me/${naddr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-body-sm text-purple-400 no-underline transition-fast"
          >
            View on Nostr &#x2197;
          </a>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[720px] mx-auto px-5 py-8">
        <h1 className="text-display font-bold leading-tight tracking-tight text-foreground m-0 mb-2">
          {briefing.title}
        </h1>

        <p className="text-body text-muted-foreground mb-2">
          {dateStr}
        </p>

        {briefing.summary && (
          <p className="text-body-lg text-secondary-foreground leading-relaxed mb-6">
            {briefing.summary}
          </p>
        )}

        <div className="flex gap-4 mb-8 py-4 border-t border-b border-border">
          <div>
            <div className="text-kpi-value font-bold text-cyan-400">
              {briefing.insightCount}
            </div>
            <div className={kpiLabel}>Insights</div>
          </div>
          <div>
            <div className="text-kpi-value font-bold text-muted-foreground">
              {briefing.totalItems}
            </div>
            <div className={kpiLabel}>Evaluated</div>
          </div>
          <div>
            <div className="text-kpi-value font-bold text-red-400">
              {briefing.totalItems - briefing.insightCount}
            </div>
            <div className={kpiLabel}>Burned</div>
          </div>
        </div>

        {/* Priority Items */}
        {priorityItems.length > 0 && (
          <section className="mb-8">
            <h2 className="text-h2 font-bold text-foreground m-0 mb-4">
              Priority Briefing
            </h2>
            {priorityItems.map((item, i) => (
              <ItemCard key={`p${item.rank ?? i}-${item.title}`} item={item} />
            ))}
          </section>
        )}

        {/* Serendipity */}
        {serendipityItems.length > 0 && (
          <section className="mb-8">
            <h2 className="text-h2 font-bold text-purple-400 m-0 mb-2">
              Serendipity Pick
            </h2>
            <p className="text-body-sm text-muted-foreground mb-4">
              Selected outside usual topics to prevent filter bubbles.
            </p>
            {serendipityItems.map((item, i) => (
              <ItemCard key={`s${i}-${item.title}`} item={item} />
            ))}
          </section>
        )}

        {/* CTA */}
        <div className="text-center px-5 py-10 border-t border-border">
          <p className="text-body-lg text-[var(--color-text-tertiary)] mb-5">
            Zero-noise briefings powered by AI + Nostr + Internet Computer
          </p>
          <Link
            href="/"
            className="inline-block px-8 py-3 bg-gradient-to-br from-purple-600 to-blue-600 rounded-md text-white text-body font-bold no-underline shadow-md transition-fast"
          >
            Try Aegis
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center p-5 border-t border-[var(--color-border-subtle)] text-caption text-[var(--color-text-disabled)]">
        Curated by Aegis — AI Content Quality Filter
      </footer>
    </div>
  );
};
