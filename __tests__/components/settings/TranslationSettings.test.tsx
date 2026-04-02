/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TranslationPrefs } from "@/lib/translation/types";

let mockPrefs: TranslationPrefs | undefined;
const mockSetTranslationPrefs = jest.fn();

jest.mock("@/contexts/PreferenceContext", () => ({
  usePreferences: () => ({
    profile: { translationPrefs: mockPrefs },
    setTranslationPrefs: mockSetTranslationPrefs,
  }),
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

import { TranslationSettings } from "@/components/settings/TranslationSettings";

beforeEach(() => {
  mockPrefs = undefined;
  mockSetTranslationPrefs.mockClear();
});

describe("TranslationSettings", () => {
  it("renders all sections", () => {
    render(<TranslationSettings />);
    expect(screen.getByText("Translation")).toBeTruthy();
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.getByText("Translation Policy")).toBeTruthy();
    expect(screen.getByText("Translation Engine")).toBeTruthy();
  });

  it("renders all language options in select", () => {
    render(<TranslationSettings />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.options.length).toBe(10);
    const labels = Array.from(select.options).map(o => o.text);
    expect(labels).toContain("日本語 (Japanese)");
    expect(labels).toContain("English (English)");
    expect(labels).toContain("中文 (Chinese)");
  });

  it("uses default prefs when profile has no translationPrefs", () => {
    mockPrefs = undefined;
    render(<TranslationSettings />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("en");
    expect(screen.getByText("Manual")).toBeTruthy();
  });

  it("reflects existing prefs from profile", () => {
    mockPrefs = { targetLanguage: "ja", policy: "all", backend: "ic", minScore: 8 };
    render(<TranslationSettings />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("ja");
  });

  it("calls setTranslationPrefs when language changes", () => {
    render(<TranslationSettings />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "ja" } });
    expect(mockSetTranslationPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ targetLanguage: "ja" }),
    );
  });

  it("calls setTranslationPrefs when policy button is clicked", () => {
    render(<TranslationSettings />);
    fireEvent.click(screen.getByText("High quality"));
    expect(mockSetTranslationPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ policy: "high_quality" }),
    );
  });

  it("calls setTranslationPrefs when backend button is clicked", () => {
    render(<TranslationSettings />);
    fireEvent.click(screen.getByText("IC LLM"));
    expect(mockSetTranslationPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ backend: "ic" }),
    );
  });

  it("shows min score slider only for high_quality policy", () => {
    mockPrefs = { targetLanguage: "en", policy: "manual", backend: "auto", minScore: 6 };
    const { rerender } = render(<TranslationSettings />);
    expect(screen.queryByText("Min Score for Auto-Translate")).toBeNull();

    mockPrefs = { targetLanguage: "en", policy: "high_quality", backend: "auto", minScore: 6 };
    rerender(<TranslationSettings />);
    expect(screen.getByText("Min Score for Auto-Translate")).toBeTruthy();
    expect(screen.getByText("6/10")).toBeTruthy();
  });

  it("updates minScore when slider changes", () => {
    mockPrefs = { targetLanguage: "en", policy: "high_quality", backend: "auto", minScore: 6 };
    render(<TranslationSettings />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "8" } });
    expect(mockSetTranslationPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ minScore: 8 }),
    );
  });

  it("shows all 3 policy options", () => {
    render(<TranslationSettings />);
    expect(screen.getByText("Manual")).toBeTruthy();
    expect(screen.getByText("High quality")).toBeTruthy();
    expect(screen.getByText("All posts")).toBeTruthy();
  });

  it("shows all 5 backend options", () => {
    render(<TranslationSettings />);
    expect(screen.getByText("Auto")).toBeTruthy();
    expect(screen.getByText("IC LLM")).toBeTruthy();
    expect(screen.getByText("Browser")).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
    expect(screen.getByText("Cloud")).toBeTruthy();
  });

  it("shows description for active policy", () => {
    mockPrefs = { targetLanguage: "en", policy: "all", backend: "auto", minScore: 6 };
    render(<TranslationSettings />);
    expect(screen.getByText("Auto-translate every post in the feed")).toBeTruthy();
  });

  it("shows description for active backend", () => {
    mockPrefs = { targetLanguage: "en", policy: "manual", backend: "ic", minScore: 6 };
    render(<TranslationSettings />);
    expect(screen.getByText("On-chain Llama 3.1 — free, no device load")).toBeTruthy();
  });

  it("preserves other prefs when changing one field", () => {
    mockPrefs = { targetLanguage: "ja", policy: "high_quality", backend: "ic", minScore: 7 };
    render(<TranslationSettings />);
    fireEvent.click(screen.getByText("Cloud"));
    const call = mockSetTranslationPrefs.mock.calls[0][0];
    expect(call.targetLanguage).toBe("ja");
    expect(call.policy).toBe("high_quality");
    expect(call.backend).toBe("cloud");
    expect(call.minScore).toBe(7);
  });
});
