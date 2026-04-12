/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "@testing-library/jest-dom";

const mockLoadVoices = jest.fn().mockResolvedValue([
  { voiceURI: "voice-en", name: "English (US)", lang: "en-US", localService: true, default: true },
]);
jest.mock("@/lib/audio/webspeech", () => ({
  __esModule: true,
  loadVoices: () => mockLoadVoices(),
}));

import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AudioBriefingPlayer } from "@/components/ui/AudioBriefingPlayer";
import type { UseAudioBriefingResult } from "@/hooks/useAudioBriefing";
import type { PlayerStatus, AudioTrack } from "@/lib/audio/types";

function makeTrack(over: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: "t1",
    title: "Sample Article Title",
    author: "Author A",
    lang: "en",
    chunks: ["chunk one"],
    totalChars: 9,
    isSerendipity: false,
    ...over,
  };
}

function makeAudio(overrides: Partial<UseAudioBriefingResult> = {}): UseAudioBriefingResult {
  return {
    available: true,
    status: {
      status: "playing",
      trackIndex: 0,
      trackCount: 3,
      chunkIndex: 0,
      currentTrack: makeTrack(),
      rate: 1.0,
      error: null,
    },
    prefs: {
      enabled: true,
      rate: 1.0,
      voiceURI: undefined,
      preferTranslated: true,
      includeSerendipity: true,
    },
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    next: jest.fn(),
    prev: jest.fn(),
    stop: jest.fn(),
    setRate: jest.fn(),
    setPrefs: jest.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mockLoadVoices.mockClear();
});

describe("AudioBriefingPlayer — visibility", () => {
  it("renders nothing when status is idle", () => {
    const audio = makeAudio({
      status: { status: "idle", trackIndex: -1, trackCount: 0, chunkIndex: 0, currentTrack: null, rate: 1, error: null },
    });
    const { container } = render(<AudioBriefingPlayer audio={audio} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders region with aria-label when active", () => {
    render(<AudioBriefingPlayer audio={makeAudio()} />);
    expect(screen.getByLabelText("Audio briefing player")).toBeInTheDocument();
  });
});

describe("AudioBriefingPlayer — track display", () => {
  it("shows track title, author, and position label", () => {
    render(<AudioBriefingPlayer audio={makeAudio()} />);
    expect(screen.getByText("Sample Article Title")).toBeInTheDocument();
    expect(screen.getByText("Author A")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("shows 'Loading…' when status=loading", () => {
    render(
      <AudioBriefingPlayer
        audio={makeAudio({
          status: { status: "loading", trackIndex: -1, trackCount: 0, chunkIndex: 0, currentTrack: null, rate: 1, error: null },
        })}
      />,
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    expect(screen.getByText(/Preparing/i)).toBeInTheDocument();
  });

  it("shows error label and error text when status=error", () => {
    render(
      <AudioBriefingPlayer
        audio={makeAudio({
          status: { status: "error", trackIndex: -1, trackCount: 0, chunkIndex: 0, currentTrack: null, rate: 1, error: "synth failed" },
        })}
      />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("synth failed")).toBeInTheDocument();
  });

  it("error fallback message when error is null", () => {
    render(
      <AudioBriefingPlayer
        audio={makeAudio({
          status: { status: "error", trackIndex: -1, trackCount: 0, chunkIndex: 0, currentTrack: null, rate: 1, error: null },
        })}
      />,
    );
    expect(screen.getByText(/Audio playback failed/i)).toBeInTheDocument();
  });
});

describe("AudioBriefingPlayer — control buttons", () => {
  it("play/pause button calls pause when playing", () => {
    const audio = makeAudio();
    render(<AudioBriefingPlayer audio={audio} />);
    fireEvent.click(screen.getByLabelText("Pause audio briefing"));
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.resume).not.toHaveBeenCalled();
  });

  it("play/pause button calls resume when paused", () => {
    const audio = makeAudio({
      status: { status: "paused", trackIndex: 0, trackCount: 3, chunkIndex: 0, currentTrack: makeTrack(), rate: 1, error: null },
    });
    render(<AudioBriefingPlayer audio={audio} />);
    fireEvent.click(screen.getByLabelText("Resume audio briefing"));
    expect(audio.resume).toHaveBeenCalledTimes(1);
    expect(audio.pause).not.toHaveBeenCalled();
  });

  it("next button calls audio.next() and is disabled on last track", () => {
    const audio = makeAudio({
      status: { status: "playing", trackIndex: 0, trackCount: 3, chunkIndex: 0, currentTrack: makeTrack(), rate: 1, error: null },
    });
    const { rerender } = render(<AudioBriefingPlayer audio={audio} />);
    fireEvent.click(screen.getByLabelText("Next article"));
    expect(audio.next).toHaveBeenCalledTimes(1);

    const last = makeAudio({
      status: { status: "playing", trackIndex: 2, trackCount: 3, chunkIndex: 0, currentTrack: makeTrack(), rate: 1, error: null },
    });
    rerender(<AudioBriefingPlayer audio={last} />);
    expect((screen.getByLabelText("Next article") as HTMLButtonElement).disabled).toBe(true);
  });

  it("prev button is disabled on first track", () => {
    const audio = makeAudio();
    render(<AudioBriefingPlayer audio={audio} />);
    expect((screen.getByLabelText("Previous article") as HTMLButtonElement).disabled).toBe(true);
  });

  it("prev button calls audio.prev() when not on first track", () => {
    const audio = makeAudio({
      status: { status: "playing", trackIndex: 1, trackCount: 3, chunkIndex: 0, currentTrack: makeTrack(), rate: 1, error: null },
    });
    render(<AudioBriefingPlayer audio={audio} />);
    fireEvent.click(screen.getByLabelText("Previous article"));
    expect(audio.prev).toHaveBeenCalledTimes(1);
  });

  it("close button calls audio.stop()", () => {
    const audio = makeAudio();
    render(<AudioBriefingPlayer audio={audio} />);
    fireEvent.click(screen.getByLabelText("Close audio player"));
    expect(audio.stop).toHaveBeenCalledTimes(1);
  });

  it("disables prev/next/play-pause when status=loading", () => {
    const audio = makeAudio({
      status: { status: "loading", trackIndex: -1, trackCount: 0, chunkIndex: 0, currentTrack: null, rate: 1, error: null },
    });
    render(<AudioBriefingPlayer audio={audio} />);
    expect((screen.getByLabelText("Previous article") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Next article") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Pause audio briefing") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables prev/next/play-pause when status=error", () => {
    const audio = makeAudio({
      status: { status: "error", trackIndex: -1, trackCount: 0, chunkIndex: 0, currentTrack: null, rate: 1, error: "x" },
    });
    render(<AudioBriefingPlayer audio={audio} />);
    expect((screen.getByLabelText("Previous article") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Next article") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AudioBriefingPlayer — speed picker (desktop only)", () => {
  it("renders speed picker on desktop", () => {
    render(<AudioBriefingPlayer audio={makeAudio()} />);
    expect(screen.getByLabelText("Playback speed")).toBeInTheDocument();
  });

  it("hides speed picker on mobile", () => {
    render(<AudioBriefingPlayer audio={makeAudio()} mobile />);
    expect(screen.queryByLabelText("Playback speed")).not.toBeInTheDocument();
  });

  it("changing speed picker calls setRate with parsed float", () => {
    const audio = makeAudio();
    render(<AudioBriefingPlayer audio={audio} />);
    const select = screen.getByLabelText("Playback speed") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "1.5" } });
    expect(audio.setRate).toHaveBeenCalledWith(1.5);
  });
});

describe("AudioBriefingPlayer — mobile positioning", () => {
  it("applies safe-area-aware bottom offset on mobile", () => {
    render(<AudioBriefingPlayer audio={makeAudio()} mobile />);
    const region = screen.getByLabelText("Audio briefing player");
    expect(region.className).toContain("bottom-[calc(var(--mobile-nav-h)+0.75rem)]");
  });

  it("applies standard bottom offset on desktop", () => {
    render(<AudioBriefingPlayer audio={makeAudio()} />);
    const region = screen.getByLabelText("Audio briefing player");
    expect(region.className).toContain("bottom-6");
    expect(region.className).not.toContain("bottom-[calc(");
  });
});

describe("AudioBriefingPlayer — voice label", () => {
  it("queries voices and displays voice label when voiceURI is set", async () => {
    const audio = makeAudio({
      prefs: { enabled: true, rate: 1, voiceURI: "voice-en", preferTranslated: true, includeSerendipity: true },
    });
    render(<AudioBriefingPlayer audio={audio} />);
    await waitFor(() => expect(mockLoadVoices).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/English \(US\) \(en-US\)/)).toBeInTheDocument());
  });

  it("does not query voices when voiceURI is undefined", () => {
    render(<AudioBriefingPlayer audio={makeAudio()} />);
    expect(mockLoadVoices).not.toHaveBeenCalled();
  });

  it("voice label is hidden on mobile even when set", async () => {
    mockLoadVoices.mockResolvedValueOnce([
      { voiceURI: "voice-en", name: "English (US)", lang: "en-US", localService: true, default: true },
    ]);
    const audio = makeAudio({
      prefs: { enabled: true, rate: 1, voiceURI: "voice-en", preferTranslated: true, includeSerendipity: true },
    });
    render(<AudioBriefingPlayer audio={audio} mobile />);
    await waitFor(() => expect(mockLoadVoices).toHaveBeenCalled());
    expect(screen.queryByText(/English \(US\) \(en-US\)/)).not.toBeInTheDocument();
  });
});
