import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Docs",
  description: "REST and x402 paid API reference for the Aegis agent briefing platform.",
};

export default function ApiDocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
