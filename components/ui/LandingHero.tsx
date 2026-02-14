"use client";
import React from "react";
import { ShieldIcon, FireIcon, ZapIcon, ChartIcon } from "@/components/icons";
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
      Content Intelligence for the Open Web
    </h1>

    <p style={{
      fontSize: mobile ? t.body.mobileSz : t.bodyLg.size,
      lineHeight: 1.7,
      color: colors.text.muted,
      marginTop: space[4],
      maxWidth: 520,
    }}>
      Aegis filters noise, curates quality, and publishes your insights to the decentralized web &mdash; powered by AI and the Internet Computer.
    </p>

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
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      <span>Open Source &amp; Non-Custodial</span>
      <span style={{ color: colors.text.disabled }}>&middot;</span>
      <span style={{ fontFamily: fonts.mono }}>v3.0</span>
    </div>
  </div>
);
