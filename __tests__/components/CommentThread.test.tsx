/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { CommentThread } from "@/components/ui/CommentThread";
import type { StoredComment } from "@/lib/d2a/comments";

function makeComment(overrides: Partial<StoredComment> = {}): StoredComment {
  return {
    id: "c1",
    contentHash: "hash1",
    senderPk: "sender-pk-abc123def456",
    comment: "Test comment",
    timestamp: 1700000000000,
    direction: "received",
    ...overrides,
  };
}

describe("CommentThread", () => {
  it("renders nothing when comments array is empty", () => {
    const { container } = render(<CommentThread comments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a single comment", () => {
    render(<CommentThread comments={[makeComment({ comment: "Hello world" })]} />);
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("sorts comments by timestamp ascending", () => {
    const comments = [
      makeComment({ id: "c2", comment: "Second", timestamp: 2000 }),
      makeComment({ id: "c1", comment: "First", timestamp: 1000 }),
      makeComment({ id: "c3", comment: "Third", timestamp: 3000 }),
    ];
    const { container } = render(<CommentThread comments={comments} />);
    const texts = Array.from(container.querySelectorAll(".break-words")).map(el => el.textContent);
    expect(texts).toEqual(["First", "Second", "Third"]);
  });

  it("marks sent comments with 'You'", () => {
    render(
      <CommentThread
        comments={[makeComment({ direction: "sent", comment: "My message" })]}
      />,
    );
    expect(screen.getByText(/You/)).toBeTruthy();
  });

  it("marks received comments with truncated sender pubkey", () => {
    render(
      <CommentThread
        comments={[makeComment({ senderPk: "abcdefghijklmnop", direction: "received" })]}
      />,
    );
    expect(screen.getByText(/abcdefgh\.\.\./)).toBeTruthy();
  });

  it("identifies sent comments by currentUserPk match", () => {
    render(
      <CommentThread
        comments={[makeComment({ senderPk: "my-pk", direction: "received" })]}
        currentUserPk="my-pk"
      />,
    );
    expect(screen.getByText(/You/)).toBeTruthy();
  });

  it("renders multiple comments", () => {
    const comments = [
      makeComment({ id: "c1", comment: "First comment" }),
      makeComment({ id: "c2", comment: "Second comment" }),
    ];
    render(<CommentThread comments={comments} />);
    expect(screen.getByText("First comment")).toBeTruthy();
    expect(screen.getByText("Second comment")).toBeTruthy();
  });

  it("formats timestamp with date and time", () => {
    const { container } = render(
      <CommentThread comments={[makeComment({ timestamp: 1700000000000 })]} />,
    );
    // Should contain some formatted date string (locale-dependent)
    const timeEl = container.querySelector(".text-\\[9px\\]");
    expect(timeEl).toBeTruthy();
    expect(timeEl!.textContent!.length).toBeGreaterThan(5);
  });

  it("aligns sent messages to the right", () => {
    const { container } = render(
      <CommentThread comments={[makeComment({ direction: "sent" })]} />,
    );
    const wrapper = container.querySelector(".justify-end");
    expect(wrapper).toBeTruthy();
  });

  it("aligns received messages to the left", () => {
    const { container } = render(
      <CommentThread comments={[makeComment({ direction: "received" })]} />,
    );
    const wrapper = container.querySelector(".justify-start");
    expect(wrapper).toBeTruthy();
  });
});
