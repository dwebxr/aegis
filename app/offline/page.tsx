"use client";

export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0a0f1e",
        color: "#e2e8f0",
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>&#x1F6E1;</div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
        You&apos;re offline
      </h1>
      <p style={{ color: "#94a3b8", maxWidth: "24rem", marginBottom: "1.5rem" }}>
        Aegis needs an internet connection to fetch and analyze content. Please check your connection and try again.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "0.625rem 1.5rem",
          borderRadius: "0.5rem",
          border: "1px solid #334155",
          backgroundColor: "#1e293b",
          color: "#e2e8f0",
          cursor: "pointer",
          fontSize: "0.875rem",
          fontWeight: 500,
        }}
      >
        Retry
      </button>
    </div>
  );
}
