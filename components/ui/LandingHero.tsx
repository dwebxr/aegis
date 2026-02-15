"use client";
import React from "react";
import { ShieldIcon, FireIcon, ZapIcon, ChartIcon, GitHubIcon } from "@/components/icons";
import { colors, space, type as t, radii, fonts, shadows, transitions } from "@/styles/theme";

interface LandingHeroProps {
  onTryDemo: () => void;
  onLogin: () => void;
  mobile?: boolean;
}

const FEATURES = [
  {
    icon: <ShieldIcon s={22} />,
    title: "Quality Filter",
    desc: "AI evaluates content for originality, insight, and credibility",
    color: colors.cyan[400],
    gradient: `linear-gradient(135deg, ${colors.cyan[500]}18, ${colors.blue[600]}10)`,
    border: `${colors.cyan[500]}25`,
  },
  {
    icon: <ZapIcon s={22} />,
    title: "Nostr Publishing",
    desc: "Share quality signals with self-evaluation scores to the open web",
    color: colors.purple[400],
    gradient: `linear-gradient(135deg, ${colors.purple[500]}18, ${colors.blue[600]}10)`,
    border: `${colors.purple[500]}25`,
  },
  {
    icon: <ChartIcon s={22} />,
    title: "Web of Trust",
    desc: "Filter content based on your social graph for trusted signal",
    color: colors.green[400],
    gradient: `linear-gradient(135deg, ${colors.green[500]}18, ${colors.cyan[500]}10)`,
    border: `${colors.green[500]}25`,
  },
  {
    icon: <FireIcon s={22} />,
    title: "D2A Agents",
    desc: "AI agents exchange content with encrypted peer-to-peer protocols",
    color: colors.orange[400],
    gradient: `linear-gradient(135deg, ${colors.orange[500]}18, ${colors.amber[500]}10)`,
    border: `${colors.orange[500]}25`,
  },
] as const;

const MANIFESTO = [
  "Every feed-based social network is being consumed by the content it was designed to distribute. The flood of AI-generated noise isn\u2019t a bug to fix \u2014 it\u2019s the endgame of an architecture that rewards volume over value.",
  "What replaces it won\u2019t look like a feed at all. Agents will aggregate sources, score quality, and route content directly to people who\u2019d actually want it. No algorithmic middleman. No engagement farming. Just signal, delivered peer to peer.",
  "We\u2019re building that layer.",
];

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

    {/* Heading */}
    <h1 style={{
      fontSize: mobile ? 28 : 40,
      fontWeight: 800,
      lineHeight: 1.1,
      letterSpacing: -0.5,
      color: colors.text.primary,
      margin: 0,
      maxWidth: 600,
    }}>
      Feeds Won&rsquo;t Survive What&rsquo;s Coming
    </h1>

    <p style={{
      fontSize: mobile ? t.body.mobileSz : t.bodyLg.size,
      lineHeight: 1.7,
      color: colors.text.muted,
      marginTop: space[4],
      maxWidth: 520,
    }}>
      Social networks are drowning in AI-generated noise &mdash; and no algorithm can save them. Aegis is the infrastructure that comes after: agents that filter, curate, and deliver signal peer to peer.
    </p>

    {/* Manifesto */}
    <div style={{
      marginTop: mobile ? space[6] : space[8],
      maxWidth: 560,
      width: "100%",
      textAlign: "left",
      borderLeft: `2px solid ${colors.cyan[500]}30`,
      paddingLeft: mobile ? space[4] : space[5],
    }}>
      {MANIFESTO.map((para, i) => (
        <p key={i} style={{
          fontSize: mobile ? t.bodySm.size : t.body.size,
          lineHeight: 1.75,
          margin: 0,
          marginTop: i > 0 ? space[3] : 0,
          fontWeight: i === MANIFESTO.length - 1 ? 600 : 400,
          color: i === MANIFESTO.length - 1 ? colors.text.secondary : colors.text.muted,
        }}>
          {para}
        </p>
      ))}
    </div>

    {/* Feature cards */}
    <div style={{
      display: "grid",
      gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
      gap: mobile ? space[3] : space[4],
      marginTop: mobile ? space[8] : space[10],
      maxWidth: 640,
      width: "100%",
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

    {/* CTAs */}
    <div style={{
      display: "flex",
      flexDirection: mobile ? "column" : "row",
      gap: space[3],
      marginTop: mobile ? space[8] : space[10],
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
        Explore Demo
      </button>
      <button
        onClick={onLogin}
        style={{
          padding: `${space[3]}px ${space[8]}px`,
          background: "transparent",
          border: `1px solid ${colors.border.emphasis}`,
          borderRadius: radii.md,
          color: colors.text.secondary,
          fontSize: t.body.size,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: fonts.sans,
          transition: transitions.normal,
          width: mobile ? "100%" : "auto",
        }}
      >
        Login with Internet Identity
      </button>
    </div>

    {/* Footer note */}
    <div style={{
      marginTop: space[8],
      display: "flex",
      alignItems: "center",
      gap: space[2],
      fontSize: t.caption.size,
      color: colors.text.disabled,
    }}>
      <GitHubIcon s={12} />
      <span>Open Source &amp; Non-Custodial</span>
      <span style={{ color: colors.text.disabled }}>&middot;</span>
      <span style={{ fontFamily: fonts.mono }}>v3.0</span>
    </div>
  </div>
);
