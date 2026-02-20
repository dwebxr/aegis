"use client";
import React from "react";
import { ShieldIcon, FireIcon, ZapIcon, ChartIcon, GitHubIcon, RSSIcon, SearchIcon, ShareIcon, GlobeIcon } from "@/components/icons";
import { colors, space, type as t, radii, fonts, shadows, transitions } from "@/styles/theme";

interface LandingHeroProps {
  onTryDemo: () => void;
  onLogin: () => void;
  mobile?: boolean;
}

const HOW_IT_WORKS = [
  {
    step: "1",
    icon: <RSSIcon s={22} />,
    title: "Add Your Feeds",
    desc: "Register RSS feeds, Nostr relays, or social sources you already follow.",
    color: colors.cyan[400],
  },
  {
    step: "2",
    icon: <ShieldIcon s={22} />,
    title: "AI Filters the Noise",
    desc: "Every article is scored for quality, originality, and credibility. Low-effort content is filtered out.",
    color: colors.blue[400],
  },
  {
    step: "3",
    icon: <SearchIcon s={22} />,
    title: "Read What Matters",
    desc: "Get a curated reading list daily. Only articles worth your time.",
    color: colors.green[400],
  },
];

const OUTCOMES = [
  {
    icon: <RSSIcon s={20} />,
    title: "AI-Curated Daily Reading List",
    desc: "Every morning, receive only the articles worth your time from all your feeds.",
    color: colors.cyan[400],
  },
  {
    icon: <ChartIcon s={20} />,
    title: "Instant Quality Scores",
    desc: "See quality, originality, and credibility scores at a glance. Skip the clickbait.",
    color: colors.purple[400],
  },
  {
    icon: <ShareIcon s={20} />,
    title: "Share Quality Signals on Nostr",
    desc: "Publish \u201cworth reading\u201d signals to Nostr with your evaluation attached.",
    color: colors.green[400],
  },
  {
    icon: <FireIcon s={20} />,
    title: "Peer-to-Peer Content Exchange",
    desc: "Your agent trades high-quality content with other agents. Encrypted, no middleman.",
    color: colors.orange[400],
  },
];

const FEATURES = [
  {
    icon: <ShieldIcon s={22} />,
    title: "Quality Filter",
    desc: "Automatically removes clickbait and thin aggregator posts. Only deep analysis and primary sources remain.",
    color: colors.cyan[400],
    gradient: `linear-gradient(135deg, ${colors.cyan[500]}18, ${colors.blue[600]}10)`,
    border: `${colors.cyan[500]}25`,
  },
  {
    icon: <ZapIcon s={22} />,
    title: "Nostr Publishing",
    desc: "Broadcast your curated picks to Nostr with quality scores attached. Build reputation as a trusted curator.",
    color: colors.purple[400],
    gradient: `linear-gradient(135deg, ${colors.purple[500]}18, ${colors.blue[600]}10)`,
    border: `${colors.purple[500]}25`,
  },
  {
    icon: <ChartIcon s={22} />,
    title: "Web of Trust",
    desc: "Content endorsed by people you follow on Nostr ranks higher. Your trust graph shapes your feed.",
    color: colors.green[400],
    gradient: `linear-gradient(135deg, ${colors.green[500]}18, ${colors.cyan[500]}10)`,
    border: `${colors.green[500]}25`,
  },
  {
    icon: <FireIcon s={22} />,
    title: "D2A Agents",
    desc: "Your personal agent discovers, evaluates, and exchanges quality content with other agents. Fully encrypted.",
    color: colors.orange[400],
    gradient: `linear-gradient(135deg, ${colors.orange[500]}18, ${colors.amber[500]}10)`,
    border: `${colors.orange[500]}25`,
  },
] as const;

const PERSONAS = [
  {
    role: "Crypto Trader",
    icon: <ChartIcon s={18} />,
    quote: "Instead of skimming 500 news articles a day, I read the 20 that actually move markets.",
    color: colors.cyan[400],
  },
  {
    role: "Researcher",
    icon: <SearchIcon s={18} />,
    quote: "Papers and technical posts are auto-scored for depth. I spend my time reading, not triaging.",
    color: colors.purple[400],
  },
  {
    role: "Newsletter Writer",
    icon: <GlobeIcon s={18} />,
    quote: "My agent surfaces original analysis across 50 feeds. The curated picks go straight into my weekly digest.",
    color: colors.green[400],
  },
];

const TRUST_PILLS = ["Open Source", "Self-Custodial", "No Tracking"];

const sectionLabel: React.CSSProperties = {
  fontSize: t.caption.size,
  fontWeight: 700,
  color: colors.text.disabled,
  letterSpacing: 2,
  textTransform: "uppercase" as const,
  marginBottom: space[3],
  textAlign: "center",
};

export const LandingHero: React.FC<LandingHeroProps> = ({ onTryDemo, onLogin, mobile }) => (
  <div style={{
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobile ? "auto" : "calc(100vh - 120px)",
    padding: mobile ? `${space[8]}px ${space[4]}px ${space[16]}px` : `${space[12]}px ${space[6]}px`,
    textAlign: "center",
    animation: "fadeIn .5s ease",
  }}>
    {/* Logo */}
    <div style={{
      width: 56,
      height: 56,
      borderRadius: radii.md,
      background: `linear-gradient(135deg, ${colors.cyan[500]}, ${colors.blue[600]})`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: space[6],
      boxShadow: shadows.glow.cyan,
    }}>
      <ShieldIcon s={28} />
    </div>

    {/* Hero heading */}
    <h1 style={{
      fontSize: mobile ? 28 : 40,
      fontWeight: 800,
      lineHeight: 1.1,
      letterSpacing: -0.5,
      color: colors.text.primary,
      margin: 0,
      maxWidth: 600,
    }}>
      Cut Through the Noise in Your Feeds
    </h1>

    <p style={{
      fontSize: t.body.size,
      fontWeight: 600,
      color: colors.cyan[400],
      letterSpacing: 1,
      marginTop: space[2],
      marginBottom: 0,
    }}>
      AI-powered quality filter for RSS and social feeds. Free and open source.
    </p>

    <p style={{
      fontSize: mobile ? t.bodySm.size : t.body.size,
      lineHeight: 1.6,
      color: colors.text.tertiary,
      marginTop: space[2],
      marginBottom: 0,
      maxWidth: 480,
    }}>
      Built for researchers, analysts, and anyone whose work depends on finding signal.
    </p>

    {/* CTA */}
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: space[2],
      marginTop: mobile ? space[6] : space[8],
      width: mobile ? "100%" : "auto",
    }}>
      <button
        onClick={onTryDemo}
        style={{
          padding: `${space[3]}px ${space[8]}px`,
          background: `linear-gradient(135deg, ${colors.blue[600]}, ${colors.cyan[500]})`,
          border: "none",
          borderRadius: radii.md,
          color: "#fff",
          fontSize: t.body.size,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: fonts.sans,
          boxShadow: shadows.glow.cyan,
          transition: transitions.normal,
          width: mobile ? "100%" : "auto",
        }}
      >
        Try the Demo
      </button>
      <button
        onClick={onLogin}
        style={{
          padding: `${space[1]}px ${space[4]}px`,
          background: "transparent",
          border: "none",
          borderRadius: radii.sm,
          color: colors.text.tertiary,
          fontSize: t.bodySm.size,
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: fonts.sans,
          textDecoration: "underline",
          textDecorationColor: colors.border.emphasis,
          textUnderlineOffset: 3,
          transition: transitions.normal,
        }}
      >
        or sign in with Internet Identity
      </button>
    </div>

    {/* HOW IT WORKS */}
    <div style={{ marginTop: mobile ? space[10] : space[12], maxWidth: 640, width: "100%" }}>
      <div style={sectionLabel}>How It Works</div>
      <div style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "1fr 1fr 1fr",
        gap: mobile ? space[3] : space[4],
      }}>
        {HOW_IT_WORKS.map(s => (
          <div key={s.step} style={{
            background: colors.bg.surface,
            border: `1px solid ${colors.border.default}`,
            borderRadius: radii.lg,
            padding: mobile ? `${space[4]}px` : `${space[5]}px`,
            textAlign: "center",
            position: "relative" as const,
            overflow: "hidden",
          }}>
            <div style={{
              fontSize: 48,
              fontWeight: 800,
              color: s.color,
              opacity: 0.12,
              position: "absolute" as const,
              top: mobile ? -4 : -2,
              right: mobile ? 8 : 12,
              lineHeight: 1,
              pointerEvents: "none" as const,
            }}>
              {s.step}
            </div>
            <div style={{ color: s.color, marginBottom: space[2] }}>{s.icon}</div>
            <div style={{
              fontSize: t.h3.size,
              fontWeight: t.h3.weight,
              color: colors.text.secondary,
              marginBottom: space[1],
            }}>
              {s.title}
            </div>
            <p style={{
              fontSize: t.bodySm.size,
              color: colors.text.muted,
              lineHeight: 1.5,
              margin: 0,
            }}>
              {s.desc}
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* WHAT YOU GET */}
    <div style={{ marginTop: mobile ? space[8] : space[10], maxWidth: 640, width: "100%" }}>
      <div style={sectionLabel}>What You Get</div>
      <div style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
        gap: mobile ? space[3] : space[4],
      }}>
        {OUTCOMES.map(o => (
          <div key={o.title} style={{
            background: colors.bg.surface,
            border: `1px solid ${colors.border.default}`,
            borderLeft: `3px solid ${o.color}`,
            borderRadius: radii.lg,
            padding: mobile ? `${space[4]}px` : `${space[5]}px`,
            textAlign: "left",
            transition: transitions.normal,
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: space[2],
              marginBottom: space[2],
              color: o.color,
            }}>
              {o.icon}
              <span style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: o.color }}>{o.title}</span>
            </div>
            <p style={{
              fontSize: t.bodySm.size,
              color: colors.text.muted,
              lineHeight: 1.5,
              margin: 0,
            }}>
              {o.desc}
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* FEATURES */}
    <div style={{ marginTop: mobile ? space[8] : space[10], maxWidth: 640, width: "100%" }}>
      <div style={sectionLabel}>Features</div>
      <div style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
        gap: mobile ? space[3] : space[4],
      }}>
        {FEATURES.map(f => (
          <div key={f.title} style={{
            background: f.gradient,
            border: `1px solid ${f.border}`,
            borderRadius: radii.lg,
            padding: mobile ? `${space[4]}px` : `${space[5]}px ${space[5]}px`,
            textAlign: "left",
            transition: transitions.normal,
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: space[2],
              marginBottom: space[2],
              color: f.color,
            }}>
              {f.icon}
              <span style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: f.color }}>{f.title}</span>
            </div>
            <p style={{
              fontSize: t.bodySm.size,
              color: colors.text.muted,
              lineHeight: 1.5,
              margin: 0,
            }}>
              {f.desc}
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* Trust & Safety */}
    <div style={{
      marginTop: mobile ? space[8] : space[10],
      maxWidth: 640,
      width: "100%",
      background: colors.bg.surface,
      border: `1px solid ${colors.border.default}`,
      borderRadius: radii.xl,
      padding: mobile ? `${space[5]}px` : `${space[6]}px`,
      textAlign: "center",
    }}>
      <div style={{ color: colors.text.tertiary, marginBottom: space[3] }}>
        <GitHubIcon s={24} />
      </div>
      <div style={{
        fontSize: t.h2.size,
        fontWeight: t.h2.weight,
        color: colors.text.primary,
        marginBottom: space[2],
      }}>
        Open Source &amp; Non-Custodial
      </div>
      <p style={{
        fontSize: t.bodySm.size,
        color: colors.text.muted,
        lineHeight: 1.6,
        margin: 0,
        maxWidth: 480,
        marginLeft: "auto",
        marginRight: "auto",
      }}>
        Fully open source on GitHub. Your data stays in your browser or your own Internet Computer canister. No accounts, no tracking, no vendor lock-in.
      </p>
      <div style={{
        display: "flex",
        justifyContent: "center",
        gap: space[2],
        marginTop: space[4],
        flexWrap: "wrap" as const,
      }}>
        {TRUST_PILLS.map(label => (
          <span key={label} style={{
            border: `1px solid ${colors.border.emphasis}`,
            borderRadius: radii.pill,
            padding: `${space[1]}px ${space[3]}px`,
            fontSize: t.tiny.size,
            fontWeight: 600,
            color: colors.text.tertiary,
          }}>
            {label}
          </span>
        ))}
      </div>
    </div>

    {/* WHO IT'S FOR */}
    <div style={{ marginTop: mobile ? space[8] : space[10], maxWidth: 640, width: "100%" }}>
      <div style={sectionLabel}>Who It&rsquo;s For</div>
      <div style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "1fr 1fr 1fr",
        gap: mobile ? space[3] : space[4],
      }}>
        {PERSONAS.map(p => (
          <div key={p.role} style={{
            background: colors.bg.raised,
            border: `1px solid ${colors.border.subtle}`,
            borderTop: `2px solid ${p.color}`,
            borderRadius: radii.lg,
            padding: mobile ? `${space[4]}px` : `${space[5]}px`,
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: space[1],
              color: p.color,
              marginBottom: space[2],
            }}>
              {p.icon}
              <span style={{
                fontSize: t.caption.size,
                fontWeight: 700,
                textTransform: "uppercase" as const,
                letterSpacing: 1.5,
                color: p.color,
              }}>
                {p.role}
              </span>
            </div>
            <p style={{
              fontSize: t.bodySm.size,
              color: colors.text.muted,
              lineHeight: 1.6,
              fontStyle: "italic",
              margin: 0,
            }}>
              &ldquo;{p.quote}&rdquo;
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* Footer */}
    <div style={{
      marginTop: space[8],
      fontSize: t.caption.size,
      color: colors.text.disabled,
      textAlign: "center",
    }}>
      <span style={{ fontFamily: fonts.mono }}>v3.0</span>
      <span> &middot; Use your browser&rsquo;s translate feature to read in your language.</span>
    </div>
  </div>
);
