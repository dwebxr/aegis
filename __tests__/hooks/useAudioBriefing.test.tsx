/**
 * @jest-environment jsdom
 */
import { renderHook, act, cleanup } from "@testing-library/react";
import { installSpeechSynthesisMock } from "../lib/audio/mockSpeech";
import { useAudioBriefing } from "@/hooks/useAudioBriefing";
import { _resetEngine, getPlayerStatus } from "@/lib/audio/engine";
import { _resetVoiceCache } from "@/lib/audio/webspeech";
import type { TrackSource } from "@/lib/audio/types";
import type { ContentItem } from "@/lib/types/content";

function makeItem(id: string, text: string): ContentItem {
  return {
    id,
    owner: "owner",
    author: `Author ${id}`,
    avatar: "🤖",
    text,
    source: "manual",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "test",
    createdAt: 0,
    validated: false,
    flagged: false,
    timestamp: "now",
    topics: [],
  };
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("useAudioBriefing", () => {
  let mock: ReturnType<typeof installSpeechSynthesisMock>;

  beforeEach(() => {
    mock = installSpeechSynthesisMock();
    _resetVoiceCache();
    _resetEngine();
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    _resetEngine();
    mock.uninstall();
  });

  it("initializes with idle status and default prefs", () => {
    const { result } = renderHook(() => useAudioBriefing());
    expect(result.current.status.status).toBe("idle");
    expect(result.current.prefs.rate).toBe(1.0);
    expect(typeof result.current.start).toBe("function");
    expect(typeof result.current.pause).toBe("function");
    expect(typeof result.current.resume).toBe("function");
    expect(typeof result.current.next).toBe("function");
    expect(typeof result.current.prev).toBe("function");
    expect(typeof result.current.stop).toBe("function");
    expect(typeof result.current.setRate).toBe("function");
    expect(typeof result.current.setPrefs).toBe("function");
  });

  it("reports available=true when Web Speech API is present", () => {
    const { result } = renderHook(() => useAudioBriefing());
    expect(result.current.available).toBe(true);
  });

  it("reports available=false when Web Speech API is missing", () => {
    mock.uninstall();
    const { result } = renderHook(() => useAudioBriefing());
    expect(result.current.available).toBe(false);
    mock = installSpeechSynthesisMock();
  });

  it("start() drives the engine through playback to idle", async () => {
    const { result } = renderHook(() => useAudioBriefing());
    const sources: TrackSource[] = [
      { item: makeItem("a", "Short article."), isSerendipity: false },
    ];
    await act(async () => {
      result.current.start(sources);
      await flush();
      await flush();
      await flush();
    });
    expect(result.current.status.status).toBe("idle");
  });

  it("setRate() updates React state and persists to localStorage", () => {
    const { result } = renderHook(() => useAudioBriefing());
    act(() => {
      result.current.setRate(1.75);
    });
    expect(result.current.prefs.rate).toBe(1.75);
    expect(JSON.parse(localStorage.getItem("aegis-audio-prefs")!).rate).toBe(1.75);
  });

  it("setRate() outside an active session does not mutate the engine snapshot", async () => {
    // setPlaybackRate is documented as a no-op without a live session. Drive
    // the engine through an error session so we exercise the post-session
    // code path.
    const { result } = renderHook(() => useAudioBriefing());
    mock.synth.errorMode = "synthesis-failed";
    await act(async () => {
      result.current.start([{ item: makeItem("a", "Lengthy article."), isSerendipity: false }]);
      await flush();
    });
    mock.synth.errorMode = null;
    const beforeRate = getPlayerStatus().rate;
    act(() => {
      result.current.setRate(1.5);
    });
    expect(getPlayerStatus().rate).toBe(beforeRate);
    expect(result.current.prefs.rate).toBe(1.5);
    expect(JSON.parse(localStorage.getItem("aegis-audio-prefs")!).rate).toBe(1.5);
  });

  it("setPrefs() merges patch into prefs and persists to localStorage", () => {
    const { result } = renderHook(() => useAudioBriefing());
    act(() => {
      result.current.setPrefs({ preferTranslated: false, includeSerendipity: false });
    });
    const stored = JSON.parse(localStorage.getItem("aegis-audio-prefs")!);
    expect(result.current.prefs.preferTranslated).toBe(false);
    expect(result.current.prefs.includeSerendipity).toBe(false);
    expect(stored.preferTranslated).toBe(false);
    expect(stored.includeSerendipity).toBe(false);
  });

  it("setPrefs({ rate }) updates prefs and persists rate", () => {
    const { result } = renderHook(() => useAudioBriefing());
    act(() => {
      result.current.setPrefs({ rate: 0.75 });
    });
    expect(result.current.prefs.rate).toBe(0.75);
    expect(JSON.parse(localStorage.getItem("aegis-audio-prefs")!).rate).toBe(0.75);
  });

  it("setPrefs without a rate key leaves the persisted rate untouched", () => {
    const { result } = renderHook(() => useAudioBriefing());
    act(() => { result.current.setRate(1.5); });
    act(() => { result.current.setPrefs({ preferTranslated: false }); });
    const stored = JSON.parse(localStorage.getItem("aegis-audio-prefs")!);
    expect(stored.rate).toBe(1.5);
    expect(stored.preferTranslated).toBe(false);
  });

  it("control surface (pause/resume/next/prev/stop) does not throw without an active session", () => {
    const { result } = renderHook(() => useAudioBriefing());
    expect(() => {
      result.current.pause();
      result.current.resume();
      result.current.next();
      result.current.prev();
      result.current.stop();
    }).not.toThrow();
    expect(getPlayerStatus().status).toBe("idle");
  });

  it("multi-track playback drains back to idle", async () => {
    const { result } = renderHook(() => useAudioBriefing());
    const sources: TrackSource[] = [
      { item: makeItem("a", "First article."), isSerendipity: false },
      { item: makeItem("b", "Second article."), isSerendipity: false },
    ];
    await act(async () => {
      result.current.start(sources);
      await flush();
      await flush();
      await flush();
      await flush();
    });
    expect(result.current.status.status).toBe("idle");
  });

  it("emits error status when nothing to read", async () => {
    const { result } = renderHook(() => useAudioBriefing());
    const sources: TrackSource[] = [
      { item: makeItem("a", ""), isSerendipity: false },
    ];
    await act(async () => {
      result.current.start(sources);
      await flush();
    });
    expect(result.current.status.status).toBe("error");
    expect(result.current.status.error).toMatch(/Nothing to read/i);
  });
});
