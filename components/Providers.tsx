"use client";
import React from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { ContentProvider } from "@/contexts/ContentContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ContentProvider>
        {children}
      </ContentProvider>
    </AuthProvider>
  );
}
