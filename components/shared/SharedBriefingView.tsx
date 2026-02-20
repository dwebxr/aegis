"use client";
import React from "react";
import Link from "next/link";
import { colors, space, type as t, radii, shadows, transitions, scoreGrade, fonts } from "@/styles/theme";
import type { ParsedBriefing, ParsedBriefingItem } from "@/lib/briefing/serialize";

interface SharedBriefingViewProps {
  briefing: ParsedBriefing;
  naddr: string;
}

function ItemCard({ item }: { item: ParsedBriefingItem }) {
  const grade = scoreGrade(item.composite);

  return (
    <div style={{
      background: colors.bg.surface,
      border: `1px solid ${colors.border.default}`,
      borderRadius: radii.lg,
      padding: space[5],
      marginBottom: space[3],
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: space[3], marginBottom: space[3] }}>
        {item.rank && (
          <div style={{
            width: 28,
            height: 28,
            borderRadius: radii.sm,
            background: colors.bg.raised,
            border: `1px solid ${colors.border.emphasis}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: t.bodySm.size,
            fontWeight: 700,
            color: colors.text.muted,
            flexShrink: 0,
          }}>
            #{item.rank}
          </div>
        )}
        {item.isSerendipity && (
          <div style={{
            padding: `${space[1]}px ${space[3]}px`,
            borderRadius: radii.pill,
            background: "rgba(124,58,237,0.1)",
            border: "1px solid rgba(124,58,237,0.2)",
            fontSize: t.caption.size,
            fontWeight: 600,
            color: colors.purple[400],
            flexShrink: 0,
          }}>
            Serendipity
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            fontSize: t.h3.size,
            fontWeight: t.h3.weight,
            color: colors.text.primary,
            margin: 0,
            lineHeight: t.h3.lineHeight,
          }}>
            {item.title}
          </h3>
        </div>
        <div style={{
          padding: `${space[1]}px ${space[3]}px`,
          borderRadius: radii.sm,
          background: grade.bg,
          color: grade.color,
          fontSize: t.bodySm.size,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {item.composite.toFixed(1)}
        </div>
      </div>

      {item.reason && (
        <div style={{
          borderLeft: `3px solid ${colors.border.emphasis}`,
          paddingLeft: space[3],
          marginBottom: space[3],
          fontSize: t.body.size,
          color: colors.text.tertiary,
          lineHeight: t.body.lineHeight,
          fontStyle: "italic",
        }}>
          {item.reason}
        </div>
      )}

      {item.text && (
        <p style={{
          fontSize: t.body.size,
          color: colors.text.secondary,
          lineHeight: t.body.lineHeight,
          margin: 0,
          marginBottom: space[3],
        }}>
          {item.text}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <span style={{
          fontSize: t.caption.size,
          fontWeight: 600,
          color: grade.color,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}>
          {item.verdict}
        </span>
        {item.topics.map((topic) => (
          <span
            key={topic}
            style={{
              padding: `${space[1]}px ${space[2]}px`,
              borderRadius: radii.sm,
              background: colors.bg.raised,
              border: `1px solid ${colors.border.subtle}`,
              fontSize: t.tiny.size,
              color: colors.text.muted,
            }}
          >
            #{topic}
          </span>
        ))}
        {item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: t.caption.size,
              color: colors.cyan[400],
              textDecoration: "none",
              marginLeft: "auto",
            }}
          >
            Source &#x2197;
          </a>
        )}
      </div>
    </div>
  );
}

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
    <div style={{
      minHeight: "100vh",
      background: colors.bg.root,
      color: colors.text.primary,
      fontFamily: fonts.sans,
    }}>
      {/* Header */}
      <header style={{
        borderBottom: `1px solid ${colors.border.default}`,
        padding: `${space[4]}px ${space[5]}px`,
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: space[2],
              textDecoration: "none",
              color: colors.text.primary,
            }}
          >
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span style={{ fontSize: t.h3.size, fontWeight: 700 }}>Aegis</span>
          </Link>
          <a
            href={`https://njump.me/${naddr}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: t.bodySm.size,
              color: colors.purple[400],
              textDecoration: "none",
              transition: transitions.fast,
            }}
          >
            View on Nostr &#x2197;
          </a>
        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 720, margin: "0 auto", padding: `${space[8]}px ${space[5]}px` }}>
        <h1 style={{
          fontSize: t.display.size,
          fontWeight: t.display.weight,
          lineHeight: t.display.lineHeight,
          letterSpacing: t.display.letterSpacing,
          color: colors.text.primary,
          margin: 0,
          marginBottom: space[2],
        }}>
          {briefing.title}
        </h1>

        <p style={{
          fontSize: t.body.size,
          color: colors.text.muted,
          marginBottom: space[2],
        }}>
          {dateStr}
        </p>

        {briefing.summary && (
          <p style={{
            fontSize: t.bodyLg.size,
            color: colors.text.secondary,
            lineHeight: t.bodyLg.lineHeight,
            marginBottom: space[6],
          }}>
            {briefing.summary}
          </p>
        )}

        <div style={{
          display: "flex",
          gap: space[4],
          marginBottom: space[8],
          padding: `${space[4]}px 0`,
          borderTop: `1px solid ${colors.border.default}`,
          borderBottom: `1px solid ${colors.border.default}`,
        }}>
          <div>
            <div style={{ fontSize: t.kpiValue.size, fontWeight: t.kpiValue.weight, color: colors.cyan[400] }}>
              {briefing.insightCount}
            </div>
            <div style={{ fontSize: t.caption.size, color: colors.text.muted, textTransform: "uppercase", letterSpacing: 1 }}>
              Insights
            </div>
          </div>
          <div>
            <div style={{ fontSize: t.kpiValue.size, fontWeight: t.kpiValue.weight, color: colors.text.muted }}>
              {briefing.totalItems}
            </div>
            <div style={{ fontSize: t.caption.size, color: colors.text.muted, textTransform: "uppercase", letterSpacing: 1 }}>
              Evaluated
            </div>
          </div>
          <div>
            <div style={{ fontSize: t.kpiValue.size, fontWeight: t.kpiValue.weight, color: colors.red[400] }}>
              {briefing.totalItems - briefing.insightCount}
            </div>
            <div style={{ fontSize: t.caption.size, color: colors.text.muted, textTransform: "uppercase", letterSpacing: 1 }}>
              Burned
            </div>
          </div>
        </div>

        {/* Priority Items */}
        {priorityItems.length > 0 && (
          <section style={{ marginBottom: space[8] }}>
            <h2 style={{
              fontSize: t.h2.size,
              fontWeight: t.h2.weight,
              color: colors.text.primary,
              margin: 0,
              marginBottom: space[4],
            }}>
              Priority Briefing
            </h2>
            {priorityItems.map((item, i) => (
              <ItemCard key={i} item={item} />
            ))}
          </section>
        )}

        {/* Serendipity */}
        {serendipityItems.length > 0 && (
          <section style={{ marginBottom: space[8] }}>
            <h2 style={{
              fontSize: t.h2.size,
              fontWeight: t.h2.weight,
              color: colors.purple[400],
              margin: 0,
              marginBottom: space[2],
            }}>
              Serendipity Pick
            </h2>
            <p style={{
              fontSize: t.bodySm.size,
              color: colors.text.muted,
              marginBottom: space[4],
            }}>
              Selected outside usual topics to prevent filter bubbles.
            </p>
            {serendipityItems.map((item, i) => (
              <ItemCard key={i} item={item} />
            ))}
          </section>
        )}

        {/* CTA */}
        <div style={{
          textAlign: "center",
          padding: `${space[10]}px ${space[5]}px`,
          borderTop: `1px solid ${colors.border.default}`,
        }}>
          <p style={{
            fontSize: t.bodyLg.size,
            color: colors.text.tertiary,
            marginBottom: space[5],
          }}>
            Zero-noise briefings powered by AI + Nostr + Internet Computer
          </p>
          <Link
            href="/"
            style={{
              display: "inline-block",
              padding: `${space[3]}px ${space[8]}px`,
              background: `linear-gradient(135deg, ${colors.purple[600]}, ${colors.blue[600]})`,
              borderRadius: radii.md,
              color: "#fff",
              fontSize: t.body.size,
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: shadows.md,
              transition: transitions.fast,
            }}
          >
            Try Aegis
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: "center",
        padding: `${space[5]}px`,
        borderTop: `1px solid ${colors.border.subtle}`,
        fontSize: t.caption.size,
        color: colors.text.disabled,
      }}>
        Curated by Aegis — AI Content Quality Filter
      </footer>
    </div>
  );
};
