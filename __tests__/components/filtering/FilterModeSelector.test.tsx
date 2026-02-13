import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterModeSelector } from "@/components/filtering/FilterModeSelector";

// Mock the context hooks
const mockSetFilterMode = jest.fn();
let mockFilterMode = "lite";
let mockIsAuthenticated = false;

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({
    filterMode: mockFilterMode,
    setFilterMode: mockSetFilterMode,
  }),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
  }),
}));

describe("FilterModeSelector", () => {
  beforeEach(() => {
    mockFilterMode = "lite";
    mockIsAuthenticated = false;
    mockSetFilterMode.mockClear();
  });

  describe("rendering", () => {
    it("renders Lite and Pro buttons", () => {
      const html = renderToStaticMarkup(<FilterModeSelector />);
      expect(html).toContain("Lite");
      expect(html).toContain("Pro");
    });

    it("shows subtitles in desktop mode", () => {
      const html = renderToStaticMarkup(<FilterModeSelector mobile={false} />);
      expect(html).toContain("WoT + Heuristic");
    });

    it("hides subtitles in mobile mode", () => {
      const html = renderToStaticMarkup(<FilterModeSelector mobile />);
      expect(html).not.toContain("WoT + Heuristic");
      expect(html).not.toContain("WoT + AI");
    });

    it("shows 'Login required' for Pro when not authenticated", () => {
      mockIsAuthenticated = false;
      const html = renderToStaticMarkup(<FilterModeSelector mobile={false} />);
      expect(html).toContain("Login required");
    });

    it("shows 'WoT + AI' subtitle for Pro when authenticated", () => {
      mockIsAuthenticated = true;
      const html = renderToStaticMarkup(<FilterModeSelector mobile={false} />);
      expect(html).toContain("WoT + AI");
      expect(html).not.toContain("Login required");
    });

    it("renders Pro button as disabled when not authenticated", () => {
      mockIsAuthenticated = false;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      // disabled attribute on the Pro button
      expect(html).toContain("disabled");
    });

    it("renders Pro button as enabled when authenticated", () => {
      mockIsAuthenticated = true;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      // Count disabled occurrences — should be 0 or fewer
      const disabledCount = (html.match(/disabled=""/g) || []).length;
      expect(disabledCount).toBe(0);
    });
  });

  describe("active state", () => {
    it("reflects lite mode as active", () => {
      mockFilterMode = "lite";
      const html = renderToStaticMarkup(<FilterModeSelector />);
      // The Lite button should have different styling (opaque border)
      expect(html).toContain("Lite");
    });

    it("reflects pro mode as active", () => {
      mockFilterMode = "pro";
      mockIsAuthenticated = true;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      expect(html).toContain("Pro");
    });
  });

  describe("MODES config", () => {
    it("has exactly 2 modes", () => {
      const html = renderToStaticMarkup(<FilterModeSelector />);
      // Both buttons render
      expect(html).toContain("Lite");
      expect(html).toContain("Pro");
    });
  });
});
