"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

export default function ApiDocsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--scalar-background-1, #0b0f1a)" }}>
      <ApiReferenceReact
        configuration={{
          url: "/openapi.yaml",
          theme: "purple",
          hideClientButton: false,
          metaData: {
            title: "Aegis API — interactive reference",
          },
        }}
      />
    </main>
  );
}
