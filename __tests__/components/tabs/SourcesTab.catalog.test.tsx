import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POPULAR_SOURCES, CATALOG_CATEGORIES } from "@/lib/sources/catalog";

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

// Lazy-import after mocks
const { SourcesTab } = require("@/components/tabs/SourcesTab");

const noop = async () => ({ scores: {}, verdict: "quality", reason: "" });

describe("SourcesTab — Popular Sources catalog", () => {
  let html: string;

  beforeAll(() => {
    html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} mobile={false} />,
    );
  });

  it("renders section header", () => {
    expect(html).toContain("Popular Sources");
    expect(html).toContain("Add trusted feeds with a single tap");
  });

  it("renders All filter button", () => {
    expect(html).toContain(">All</button>");
  });

  it("renders all category labels", () => {
    for (const cat of CATALOG_CATEGORIES) {
      expect(html).toContain(cat.label);
    }
  });

  it("renders all source labels", () => {
    for (const s of POPULAR_SOURCES) {
      expect(html).toContain(s.label);
    }
  });

  it("renders source emojis", () => {
    // Spot-check a few
    expect(html).toContain("\u25B2");   // The Verge triangle
    expect(html).toContain("\u20BF");   // Bitcoin symbol for CoinDesk
    expect(html).toContain("\u26A1");   // Lightning for Wired
  });
});
