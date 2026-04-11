/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommentInput } from "@/components/ui/CommentInput";
import { MAX_COMMENT_LENGTH } from "@/lib/agent/protocol";

afterEach(() => cleanup());

const baseProps = {
  contentHash: "hash-abc",
  contentTitle: "An interesting article about distributed systems",
  peerPubkey: "abcdef1234567890",
};

describe("CommentInput", () => {
  it("renders textarea, send button and counter at MAX_COMMENT_LENGTH", () => {
    render(<CommentInput {...baseProps} onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Comment to abcdef12/);
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute("maxLength", String(MAX_COMMENT_LENGTH));
    expect(screen.getByText("Send")).toBeInTheDocument();
    expect(screen.getByText(String(MAX_COMMENT_LENGTH))).toBeInTheDocument();
  });

  it("disables send button when text is empty", () => {
    render(<CommentInput {...baseProps} onSend={() => {}} />);
    const sendBtn = screen.getByText("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("disables send button for whitespace-only input", () => {
    const onSend = jest.fn();
    render(<CommentInput {...baseProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Comment to/);
    fireEvent.change(textarea, { target: { value: "    " } });
    const sendBtn = screen.getByText("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(sendBtn);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("enables send and updates counter when typing", () => {
    render(<CommentInput {...baseProps} onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Comment to/);
    fireEvent.change(textarea, { target: { value: "hello" } });
    const sendBtn = screen.getByText("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    expect(screen.getByText(String(MAX_COMMENT_LENGTH - 5))).toBeInTheDocument();
  });

  it("calls onSend with trimmed comment, hash, truncated title (80 chars), and timestamp", () => {
    const onSend = jest.fn();
    const longTitle = "x".repeat(120);
    render(<CommentInput {...baseProps} contentTitle={longTitle} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Comment to/);
    fireEvent.change(textarea, { target: { value: "  hello world  " } });
    const before = Date.now();
    fireEvent.click(screen.getByText("Send"));
    const after = Date.now();

    expect(onSend).toHaveBeenCalledTimes(1);
    const payload = onSend.mock.calls[0][0];
    expect(payload.contentHash).toBe("hash-abc");
    expect(payload.contentTitle).toHaveLength(80);
    expect(payload.contentTitle).toBe("x".repeat(80));
    expect(payload.comment).toBe("hello world");
    expect(payload.timestamp).toBeGreaterThanOrEqual(before);
    expect(payload.timestamp).toBeLessThanOrEqual(after);
  });

  it("clears textarea after successful send", () => {
    render(<CommentInput {...baseProps} onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Comment to/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.click(screen.getByText("Send"));
    expect(textarea.value).toBe("");
    expect(screen.getByText(String(MAX_COMMENT_LENGTH))).toBeInTheDocument();
  });

  it("highlights counter in amber when fewer than 20 chars remain", () => {
    render(<CommentInput {...baseProps} onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Comment to/);
    fireEvent.change(textarea, { target: { value: "x".repeat(MAX_COMMENT_LENGTH - 10) } });
    const counter = screen.getByText("10");
    expect(counter.className).toContain("text-amber-400");
  });

  it("counter uses disabled color when above 20 chars remaining", () => {
    render(<CommentInput {...baseProps} onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Comment to/);
    fireEvent.change(textarea, { target: { value: "short" } });
    const counter = screen.getByText(String(MAX_COMMENT_LENGTH - 5));
    expect(counter.className).toContain("text-disabled");
  });

  it("truncates peer pubkey to 8 chars in placeholder", () => {
    render(<CommentInput {...baseProps} onSend={() => {}} />);
    expect(screen.getByPlaceholderText("Comment to abcdef12...")).toBeInTheDocument();
  });
});
