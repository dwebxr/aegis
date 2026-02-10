"use client";
import React from "react";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ContentProvider } from "@/contexts/ContentContext";
import { PreferenceProvider, usePreferences } from "@/contexts/PreferenceContext";
import { AgentProvider } from "@/contexts/AgentContext";
import { SourceProvider } from "@/contexts/SourceContext";
import { DemoProvider } from "@/contexts/DemoContext";

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
    <NotificationProvider>
      <AuthProvider>
        <DemoProvider>
        <PreferenceProvider>
          <ContentWithPreferences>
            <SourceProvider>
              <AgentProvider>
                {children}
              </AgentProvider>
            </SourceProvider>
          </ContentWithPreferences>
        </PreferenceProvider>
        </DemoProvider>
      </AuthProvider>
    </NotificationProvider>
  );
}
