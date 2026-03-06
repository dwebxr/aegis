"use client";
import React from "react";
import * as Sentry from "@sentry/nextjs";

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
      <div className="p-6 text-center flex flex-col items-center gap-4 min-h-[200px]">
        <div className="text-h2 font-bold text-red-400">
          {this.props.tabName} encountered an error
        </div>
        <pre className="bg-navy-lighter border border-border rounded-md p-4 text-caption font-mono text-muted-foreground max-w-[480px] overflow-auto whitespace-pre-wrap break-words text-left">
          {this.state.error.message}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          className="px-5 py-2 bg-blue-600 border-none rounded-md text-white cursor-pointer text-body font-semibold font-[inherit]"
        >
          Retry
        </button>
      </div>
    );
  }
}
