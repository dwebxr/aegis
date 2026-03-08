/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { YouTubePreview } from "@/components/ui/ContentCard";

describe("YouTubePreview", () => {
  it.each([
    ["standard watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["youtu.be short", "https://youtu.be/abc123_-XYZ", "abc123_-XYZ"],
    ["shorts", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["embed", "https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["live", "https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["mobile", "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["extra params", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
  ])("renders thumbnail for %s URL", (_label, url, expectedId) => {
    const { container } = render(<YouTubePreview sourceUrl={url} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.src).toContain(`img.youtube.com/vi/${expectedId}/mqdefault.jpg`);
  });

  it.each([
    ["undefined", undefined],
    ["empty string", ""],
    ["non-YouTube", "https://example.com/article"],
    ["malformed", "not-a-url"],
    ["channel", "https://www.youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ"],
  ])("renders nothing for %s sourceUrl", (_label, url) => {
    const { container } = render(<YouTubePreview sourceUrl={url} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows thumbnail button and no iframe on initial render", () => {
    const { container } = render(
      <YouTubePreview sourceUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />
    );
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("play button has correct aria-label and type", () => {
    const { container } = render(
      <YouTubePreview sourceUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />
    );
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-label")).toBe("Play YouTube video");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("clicking play button replaces thumbnail with iframe embed", () => {
    const { container } = render(
      <YouTubePreview sourceUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />
    );
    expect(container.querySelector("iframe")).toBeNull();

    fireEvent.click(container.querySelector("button")!);

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1");
    expect(container.querySelector("button")).toBeNull();
  });

  it("iframe has correct allow and allowFullScreen attributes", () => {
    const { container } = render(
      <YouTubePreview sourceUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />
    );
    fireEvent.click(container.querySelector("button")!);

    const iframe = container.querySelector("iframe")!;
    const allow = iframe.getAttribute("allow") ?? "";
    expect(allow).toContain("autoplay");
    expect(allow).toContain("picture-in-picture");
    expect(iframe.getAttribute("allowfullscreen")).not.toBeNull();
  });

  // stopPropagation prevents card toggle when clicking the preview
  it("clicking the preview container stops event propagation", () => {
    const parentHandler = jest.fn();
    const { container } = render(
      <div onClick={parentHandler}>
        <YouTubePreview sourceUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />
      </div>
    );
    fireEvent.click(container.querySelector(".aspect-video")!);
    expect(parentHandler).not.toHaveBeenCalled();
  });

  it("clicking the play button stops event propagation to parent", () => {
    const parentHandler = jest.fn();
    const { container } = render(
      <div onClick={parentHandler}>
        <YouTubePreview sourceUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />
      </div>
    );
    fireEvent.click(container.querySelector("button")!);
    expect(parentHandler).not.toHaveBeenCalled();
  });
});
