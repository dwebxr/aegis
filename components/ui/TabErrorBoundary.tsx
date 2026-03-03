"use client";
import React from "react";
import * as Sentry from "@sentry/nextjs";
import { colors, space, type as t, radii, fonts } from "@/styles/theme";

interface Props {
  tabName: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class TabErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    Sentry.captureException(error, { extra: { tab: this.props.tabName, componentStack: info.componentStack } });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        padding: space[6], textAlign: "center",
        display: "flex", flexDirection: "column", alignItems: "center", gap: space[4],
        minHeight: 200,
      }}>
        <div style={{
          fontSize: t.h2.size, fontWeight: t.h2.weight, color: colors.red[400],
        }}>
          {this.props.tabName} encountered an error
        </div>
        <pre style={{
          background: colors.bg.raised, border: `1px solid ${colors.border.default}`,
          borderRadius: radii.md, padding: space[4],
          fontSize: t.caption.size, fontFamily: fonts.mono,
          color: colors.text.muted, maxWidth: 480, overflow: "auto",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          textAlign: "left",
        }}>
          {this.state.error.message}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            padding: `${space[2]}px ${space[5]}px`,
            background: colors.blue[600], border: "none", borderRadius: radii.md,
            color: "#fff", cursor: "pointer", fontSize: t.body.size, fontWeight: 600,
            fontFamily: "inherit",
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}
