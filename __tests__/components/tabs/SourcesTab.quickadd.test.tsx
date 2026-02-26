import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({
    sources: [],
    syncStatus: "idle",
    syncError: null,
    addSource: () => true,
    removeSource: () => {},
    toggleSource: () => {},
    updateSource: () => {},
  }),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: false }),
}));

jest.mock("@/lib/ingestion/sourceState", () => ({
  loadSourceStates: () => ({}),
  getSourceHealth: () => "healthy",
  getSourceKey: () => "",
}));

const { SourcesTab } = require("@/components/tabs/SourcesTab");

const noop = async () => ({ scores: {}, verdict: "quality", reason: "" });

describe("SourcesTab — X (Twitter) source tab", () => {
  let html: string;

  beforeAll(() => {
    html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} mobile={false} />,
    );
  });

  it("renders X (Twitter) as a source tab", () => {
    expect(html).toContain("X (Twitter)");
  });

  it("renders the mathematical double-struck X icon", () => {
    // U+1D54F renders as surrogate pair in UTF-16
    expect(html).toContain("\uD835\uDD4F");
  });

  it("renders alongside other source tabs", () => {
    expect(html).toContain("URL");
    expect(html).toContain("RSS");
    expect(html).toContain("X (Twitter)");
    expect(html).toContain("Nostr");
  });
});
