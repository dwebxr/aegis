"use client";
import React from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { ContentProvider } from "@/contexts/ContentContext";
import { PreferenceProvider, usePreferences } from "@/contexts/PreferenceContext";
import { AgentProvider } from "@/contexts/AgentContext";

function ContentWithPreferences({ children }: { children: React.ReactNode }) {
  const { onValidate, onFlag } = usePreferences();
  return (
    <ContentProvider preferenceCallbacks={{ onValidate, onFlag }}>
      {children}
    </ContentProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <PreferenceProvider>
        <ContentWithPreferences>
          <AgentProvider>
            {children}
          </AgentProvider>
        </ContentWithPreferences>
      </PreferenceProvider>
    </AuthProvider>
  );
}
