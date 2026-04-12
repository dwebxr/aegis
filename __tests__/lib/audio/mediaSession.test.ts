/**
 * @jest-environment jsdom
 */
import {
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  attachMediaSessionHandlers,
} from "@/lib/audio/mediaSession";
import type { AudioTrack } from "@/lib/audio/types";

class MockMediaMetadata {
  title: string;
  artist: string;
  album: string;
  artwork: unknown;
  constructor(init: { title: string; artist: string; album: string; artwork: unknown }) {
    this.title = init.title;
    this.artist = init.artist;
    this.album = init.album;
    this.artwork = init.artwork;
  }
}

interface ActionMap { [key: string]: (() => void) | null }

interface MockMS {
  metadata: MockMediaMetadata | null;
  playbackState: "none" | "paused" | "playing";
  actions: ActionMap;
  setActionHandler: (type: string, h: (() => void) | null) => void;
}

function installMockMediaSession(): MockMS {
  const actions: ActionMap = {};
  const ms: MockMS = {
    metadata: null,
    playbackState: "none",
    actions,
    setActionHandler(type, h) {
      actions[type] = h;
    },
  };
  Object.defineProperty(navigator, "mediaSession", { value: ms, configurable: true });
  (globalThis as unknown as { MediaMetadata: typeof MockMediaMetadata }).MediaMetadata = MockMediaMetadata;
  return ms;
}

function uninstallMockMediaSession() {
  delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
  delete (globalThis as unknown as { MediaMetadata?: unknown }).MediaMetadata;
}

const sampleTrack: AudioTrack = {
  id: "t1",
  title: "Sample Title",
  author: "Author A",
  lang: "en",
  chunks: ["chunk one"],
  totalChars: 9,
  isSerendipity: false,
};

describe("setMediaSessionMetadata", () => {
  afterEach(uninstallMockMediaSession);

  it("is a no-op when MediaSession API is unavailable", () => {
    expect(() =>
      setMediaSessionMetadata(sampleTrack, 0, 1),
    ).not.toThrow();
  });

  it("clears metadata when track is null", () => {
    const ms = installMockMediaSession();
    ms.metadata = new MockMediaMetadata({ title: "x", artist: "x", album: "x", artwork: [] });
    setMediaSessionMetadata(null, 0, 0);
    expect(ms.metadata).toBeNull();
  });

  it("sets title without index when only one track", () => {
    const ms = installMockMediaSession();
    setMediaSessionMetadata(sampleTrack, 0, 1);
    expect(ms.metadata?.title).toBe("Sample Title");
  });

  it("appends position label when more than one track", () => {
    const ms = installMockMediaSession();
    setMediaSessionMetadata(sampleTrack, 1, 4);
    expect(ms.metadata?.title).toBe("Sample Title (2/4)");
  });

  it("sets artist, album, and artwork", () => {
    const ms = installMockMediaSession();
    setMediaSessionMetadata(sampleTrack, 0, 1);
    expect(ms.metadata?.artist).toBe("Author A");
    expect(ms.metadata?.album).toBe("Aegis Briefing");
    expect(Array.isArray(ms.metadata?.artwork)).toBe(true);
  });
});

describe("setMediaSessionPlaybackState", () => {
  afterEach(uninstallMockMediaSession);

  it("maps 'playing' to 'playing'", () => {
    const ms = installMockMediaSession();
    setMediaSessionPlaybackState("playing");
    expect(ms.playbackState).toBe("playing");
  });

  it("maps 'paused' to 'paused'", () => {
    const ms = installMockMediaSession();
    setMediaSessionPlaybackState("paused");
    expect(ms.playbackState).toBe("paused");
  });

  it("maps idle/loading/error to 'none'", () => {
    const ms = installMockMediaSession();
    setMediaSessionPlaybackState("idle");
    expect(ms.playbackState).toBe("none");
    setMediaSessionPlaybackState("loading");
    expect(ms.playbackState).toBe("none");
    setMediaSessionPlaybackState("error");
    expect(ms.playbackState).toBe("none");
  });

  it("does not throw when MediaSession is unavailable", () => {
    expect(() => setMediaSessionPlaybackState("playing")).not.toThrow();
  });
});

describe("attachMediaSessionHandlers", () => {
  afterEach(uninstallMockMediaSession);

  it("returns a no-op cleanup when API is unavailable", () => {
    const cleanup = attachMediaSessionHandlers({
      onPlay: jest.fn(), onPause: jest.fn(), onNext: jest.fn(), onPrev: jest.fn(), onStop: jest.fn(),
    });
    expect(typeof cleanup).toBe("function");
    expect(() => cleanup()).not.toThrow();
  });

  it("registers all five action handlers", () => {
    const ms = installMockMediaSession();
    const handlers = {
      onPlay: jest.fn(), onPause: jest.fn(), onNext: jest.fn(),
      onPrev: jest.fn(), onStop: jest.fn(),
    };
    attachMediaSessionHandlers(handlers);
    expect(ms.actions["play"]).toBe(handlers.onPlay);
    expect(ms.actions["pause"]).toBe(handlers.onPause);
    expect(ms.actions["nexttrack"]).toBe(handlers.onNext);
    expect(ms.actions["previoustrack"]).toBe(handlers.onPrev);
    expect(ms.actions["stop"]).toBe(handlers.onStop);
  });

  it("invoking a registered handler runs the supplied callback", () => {
    const ms = installMockMediaSession();
    const onPlay = jest.fn();
    attachMediaSessionHandlers({
      onPlay, onPause: jest.fn(), onNext: jest.fn(), onPrev: jest.fn(), onStop: jest.fn(),
    });
    ms.actions["play"]?.();
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("cleanup nulls out handlers, metadata, and playback state", () => {
    const ms = installMockMediaSession();
    const cleanup = attachMediaSessionHandlers({
      onPlay: jest.fn(), onPause: jest.fn(), onNext: jest.fn(), onPrev: jest.fn(), onStop: jest.fn(),
    });
    setMediaSessionMetadata(sampleTrack, 0, 1);
    setMediaSessionPlaybackState("playing");
    cleanup();
    expect(ms.actions["play"]).toBeNull();
    expect(ms.actions["pause"]).toBeNull();
    expect(ms.actions["nexttrack"]).toBeNull();
    expect(ms.actions["previoustrack"]).toBeNull();
    expect(ms.actions["stop"]).toBeNull();
    expect(ms.metadata).toBeNull();
    expect(ms.playbackState).toBe("none");
  });
});
