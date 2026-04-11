/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "@testing-library/jest-dom";

const mockSetPrefs = jest.fn();
let mockHookValue = {
  status: { status: "idle" as const, trackIndex: -1, trackCount: 0, chunkIndex: 0, currentTrack: null, rate: 1.0, error: null },
  prefs: { enabled: true, rate: 1.0, voiceURI: undefined as string | undefined, preferTranslated: true, includeSerendipity: true },
  available: true,
  start: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  next: jest.fn(),
  prev: jest.fn(),
  stop: jest.fn(),
  setRate: jest.fn(),
  setPrefs: mockSetPrefs,
};

jest.mock("@/hooks/useAudioBriefing", () => ({
  __esModule: true,
  useAudioBriefing: () => mockHookValue,
}));

const mockLoadVoices = jest.fn().mockResolvedValue([
  { voiceURI: "voice-en", name: "English (US)", lang: "en-US", localService: true, default: true },
  { voiceURI: "voice-ja", name: "Japanese", lang: "ja-JP", localService: false, default: false },
]);
jest.mock("@/lib/audio/webspeech", () => ({
  __esModule: true,
  loadVoices: () => mockLoadVoices(),
}));

import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AudioSettings } from "@/components/settings/AudioSettings";

beforeEach(() => {
  mockSetPrefs.mockClear();
  mockLoadVoices.mockClear();
  mockHookValue = {
    status: { status: "idle", trackIndex: -1, trackCount: 0, chunkIndex: 0, currentTrack: null, rate: 1.0, error: null },
    prefs: { enabled: true, rate: 1.0, voiceURI: undefined, preferTranslated: true, includeSerendipity: true },
    available: true,
    start: jest.fn(), pause: jest.fn(), resume: jest.fn(), next: jest.fn(),
    prev: jest.fn(), stop: jest.fn(), setRate: jest.fn(), setPrefs: mockSetPrefs,
  };
});

afterEach(() => cleanup());

describe("AudioSettings — availability", () => {
  it("renders unavailable copy when Web Speech API is not present", () => {
    mockHookValue.available = false;
    render(<AudioSettings />);
    expect(screen.getByText(/Audio playback is not available/i)).toBeInTheDocument();
    expect(screen.queryByTestId("aegis-settings-audio-toggle")).not.toBeInTheDocument();
  });

  it("renders the on/off toggle when available", () => {
    render(<AudioSettings />);
    expect(screen.getByTestId("aegis-settings-audio-toggle")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });
});

describe("AudioSettings — toggle", () => {
  it("clicking enabled toggle dispatches setPrefs({enabled: false})", () => {
    render(<AudioSettings />);
    fireEvent.click(screen.getByTestId("aegis-settings-audio-toggle"));
    expect(mockSetPrefs).toHaveBeenCalledWith({ enabled: false });
  });

  it("when prefs.enabled is false, hides the voice/rate/checkbox controls", () => {
    mockHookValue.prefs.enabled = false;
    render(<AudioSettings />);
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByTestId("aegis-settings-audio-voice")).not.toBeInTheDocument();
  });

  it("toggle aria-label changes based on enabled state", () => {
    const { rerender } = render(<AudioSettings />);
    expect(screen.getByLabelText("Disable audio briefing")).toBeInTheDocument();
    mockHookValue.prefs.enabled = false;
    rerender(<AudioSettings />);
    expect(screen.getByLabelText("Enable audio briefing")).toBeInTheDocument();
  });
});

describe("AudioSettings — voice picker", () => {
  it("loads voices on mount when available", async () => {
    render(<AudioSettings />);
    await waitFor(() => expect(mockLoadVoices).toHaveBeenCalledTimes(1));
  });

  it("does NOT load voices when not available", () => {
    mockHookValue.available = false;
    render(<AudioSettings />);
    expect(mockLoadVoices).not.toHaveBeenCalled();
  });

  it("populates voice select with loaded voices and Auto fallback", async () => {
    render(<AudioSettings />);
    const select = await screen.findByTestId("aegis-settings-audio-voice");
    await waitFor(() => {
      const opts = (select as HTMLSelectElement).querySelectorAll("option");
      expect(opts.length).toBe(3);
    });
    const opts = (select as HTMLSelectElement).querySelectorAll("option");
    expect(opts[0].textContent).toMatch(/Auto/);
    expect(opts[1].textContent).toMatch(/English/);
    expect(opts[2].textContent).toMatch(/Japanese/);
  });

  it("changing voice select calls setPrefs with voiceURI", async () => {
    render(<AudioSettings />);
    const select = (await screen.findByTestId("aegis-settings-audio-voice")) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll("option").length).toBe(3));
    fireEvent.change(select, { target: { value: "voice-ja" } });
    expect(mockSetPrefs).toHaveBeenCalledWith({ voiceURI: "voice-ja" });
  });

  it("selecting Auto (empty value) clears voiceURI", async () => {
    mockHookValue.prefs.voiceURI = "voice-en";
    render(<AudioSettings />);
    const select = (await screen.findByTestId("aegis-settings-audio-voice")) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll("option").length).toBe(3));
    fireEvent.change(select, { target: { value: "" } });
    expect(mockSetPrefs).toHaveBeenCalledWith({ voiceURI: undefined });
  });

  it("shows 'Loading available voices…' before voices resolve", () => {
    mockLoadVoices.mockReturnValueOnce(new Promise(() => {}));
    render(<AudioSettings />);
    expect(screen.getByText(/Loading available voices/i)).toBeInTheDocument();
  });
});

describe("AudioSettings — rate buttons", () => {
  it("renders all six rate options", () => {
    render(<AudioSettings />);
    for (const r of [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]) {
      expect(screen.getByText(`${r.toFixed(2)}×`)).toBeInTheDocument();
    }
  });

  it("highlights the active rate (1.0)", () => {
    render(<AudioSettings />);
    const oneX = screen.getByText("1.00×");
    expect(oneX.className).toContain("text-cyan-400");
    const twoX = screen.getByText("2.00×");
    expect(twoX.className).not.toContain("text-cyan-400");
  });

  it("clicking a rate dispatches setPrefs({rate})", () => {
    render(<AudioSettings />);
    fireEvent.click(screen.getByText("1.50×"));
    expect(mockSetPrefs).toHaveBeenCalledWith({ rate: 1.5 });
  });
});

describe("AudioSettings — checkboxes", () => {
  it("preferTranslated checkbox reflects prefs and dispatches on change", () => {
    render(<AudioSettings />);
    const cbox = screen.getByLabelText(/Read translated text/i) as HTMLInputElement;
    expect(cbox.checked).toBe(true);
    fireEvent.click(cbox);
    expect(mockSetPrefs).toHaveBeenCalledWith({ preferTranslated: false });
  });

  it("includeSerendipity checkbox reflects prefs and dispatches on change", () => {
    mockHookValue.prefs.includeSerendipity = false;
    render(<AudioSettings />);
    const cbox = screen.getByLabelText(/serendipity pick/i) as HTMLInputElement;
    expect(cbox.checked).toBe(false);
    fireEvent.click(cbox);
    expect(mockSetPrefs).toHaveBeenCalledWith({ includeSerendipity: true });
  });
});
