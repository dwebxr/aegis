import { extractYouTubeVideoId, youTubeEmbedUrl } from "@/lib/utils/youtube";

describe("extractYouTubeVideoId", () => {
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

  it("handles extra query params on watch URL", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLxyz")).toBe("dQw4w9WgXcQ");
  });

  it("handles query params on youtu.be URL", () => {
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe("dQw4w9WgXcQ");
  });

  it("handles IDs with hyphens and underscores", () => {
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=a-b_c-d_e-f")).toBe("a-b_c-d_e-f");
  });

  it("returns null for YouTube channel URLs", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ")).toBeNull();
    expect(extractYouTubeVideoId("https://youtube.com/@VeritasiumEN")).toBeNull();
  });

  it("returns null for YouTube home page", () => {
    expect(extractYouTubeVideoId("https://youtube.com/")).toBeNull();
    expect(extractYouTubeVideoId("https://www.youtube.com")).toBeNull();
  });

  it("returns null for playlist URLs", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/playlist?list=PLxyz")).toBeNull();
  });

  it("returns null for non-YouTube URLs", () => {
    expect(extractYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeVideoId("https://vimeo.com/12345")).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(extractYouTubeVideoId("not-a-url")).toBeNull();
    expect(extractYouTubeVideoId("")).toBeNull();
  });

  it("returns null for IDs that are not exactly 11 characters", () => {
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=short")).toBeNull();
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=waytoolongvideoid")).toBeNull();
  });
});

describe("youTubeEmbedUrl", () => {
  it("builds correct embed URL", () => {
    expect(youTubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });
});
