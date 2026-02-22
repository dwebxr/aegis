import { extractYouTubeVideoId, youTubeEmbedUrl } from "@/lib/utils/youtube";

describe("extractYouTubeVideoId", () => {
  // ─── Standard URL patterns ───

  it("extracts ID from standard watch URL", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from watch URL without www", () => {
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from mobile watch URL", () => {
    expect(extractYouTubeVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from youtu.be short URL", () => {
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from shorts URL", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from embed URL", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from live stream URL", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://youtube.com/live/abc123_-XYZ")).toBe("abc123_-XYZ");
  });

  // ─── Query params and fragments ───

  it("handles extra query params on watch URL", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLxyz")).toBe("dQw4w9WgXcQ");
  });

  it("handles query params on youtu.be URL", () => {
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe("dQw4w9WgXcQ");
  });

  it("handles v param not as first param", () => {
    expect(extractYouTubeVideoId("https://youtube.com/watch?list=PLxyz&v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  // ─── Protocol handling ───

  it("extracts ID from HTTP (non-HTTPS) URL", () => {
    expect(extractYouTubeVideoId("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("http://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  // ─── Character coverage ───

  it("handles IDs with hyphens and underscores", () => {
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=a-b_c-d_e-f")).toBe("a-b_c-d_e-f");
  });

  it("handles IDs with all digit characters", () => {
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=12345678901")).toBe("12345678901");
  });

  it("handles IDs with mixed case letters", () => {
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=AbCdEfGhIjK")).toBe("AbCdEfGhIjK");
  });

  // ─── Trailing slash handling ───

  it("handles trailing slash on youtu.be URL", () => {
    // URL parser normalizes youtu.be/ID/ → pathname = /ID/
    // split on [/?#] → first segment is the ID
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ/")).toBe("dQw4w9WgXcQ");
  });

  // ─── Rejection cases ───

  it("returns null for YouTube channel URLs", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ")).toBeNull();
    expect(extractYouTubeVideoId("https://youtube.com/@VeritasiumEN")).toBeNull();
    expect(extractYouTubeVideoId("https://youtube.com/c/Veritasium")).toBeNull();
  });

  it("returns null for YouTube home page", () => {
    expect(extractYouTubeVideoId("https://youtube.com/")).toBeNull();
    expect(extractYouTubeVideoId("https://www.youtube.com")).toBeNull();
  });

  it("returns null for playlist URLs", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/playlist?list=PLxyz")).toBeNull();
  });

  it("returns null for search URLs", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/results?search_query=test")).toBeNull();
  });

  it("returns null for feed/trending URLs", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/feed/trending")).toBeNull();
  });

  it("returns null for non-YouTube URLs", () => {
    expect(extractYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeVideoId("https://vimeo.com/12345")).toBeNull();
    expect(extractYouTubeVideoId("https://dailymotion.com/video/x7tgad0")).toBeNull();
  });

  it("returns null for youtube-nocookie.com (different domain)", () => {
    expect(extractYouTubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(extractYouTubeVideoId("not-a-url")).toBeNull();
    expect(extractYouTubeVideoId("")).toBeNull();
  });

  it("returns null for IDs that are not exactly 11 characters", () => {
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=short")).toBeNull();
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=waytoolongvideoid")).toBeNull();
    expect(extractYouTubeVideoId("https://youtu.be/abc")).toBeNull();
    expect(extractYouTubeVideoId("https://youtube.com/shorts/toolong12345")).toBeNull();
  });

  it("returns null when v param is missing from watch URL", () => {
    expect(extractYouTubeVideoId("https://youtube.com/watch?list=PLxyz")).toBeNull();
    expect(extractYouTubeVideoId("https://youtube.com/watch")).toBeNull();
  });

  it("returns null for unknown subdomains", () => {
    expect(extractYouTubeVideoId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("youTubeEmbedUrl", () => {
  it("builds correct embed URL from video ID", () => {
    expect(youTubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("builds embed URL with hyphens and underscores in ID", () => {
    expect(youTubeEmbedUrl("a-b_c-d_e-f")).toBe("https://www.youtube.com/embed/a-b_c-d_e-f");
  });
});
