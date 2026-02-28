/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

const mockPublishAgentProfile = jest.fn();
const mockSetCachedAgentProfile = jest.fn();
const mockCreateNIP98AuthHeader = jest.fn().mockReturnValue("Nostr mock-auth-header");

jest.mock("@/lib/nostr/profile", () => ({
  publishAgentProfile: (...args: unknown[]) => mockPublishAgentProfile(...args),
  setCachedAgentProfile: (...args: unknown[]) => mockSetCachedAgentProfile(...args),
}));

jest.mock("@/lib/nostr/nip98", () => ({
  createNIP98AuthHeader: (...args: unknown[]) => mockCreateNIP98AuthHeader(...args),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act } = require("react-dom/test-utils");
import { AgentProfileEditModal } from "@/components/ui/AgentProfileEditModal";
import type { NostrProfileMetadata } from "@/lib/nostr/profile";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const nostrKeys = { sk: new Uint8Array(32).fill(1), pk: "test-pubkey-hex" };
const principalText = "test-principal-id";

const defaultProps = {
  currentProfile: null as NostrProfileMetadata | null,
  nostrKeys,
  principalText,
  onClose: jest.fn(),
  onSaved: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPublishAgentProfile.mockResolvedValue({
    eventId: "mock-event-id",
    relaysPublished: ["wss://relay.test"],
    relaysFailed: [],
    mergedProfile: { name: "Agent", display_name: "Agent" },
  });
});

describe("AgentProfileEditModal — rendering (edit phase)", () => {
  it("renders Edit Agent Profile heading", () => {
    const html = renderToStaticMarkup(<AgentProfileEditModal {...defaultProps} />);
    expect(html).toContain("Edit Agent Profile");
  });

  it("renders Display Name input", () => {
    const html = renderToStaticMarkup(<AgentProfileEditModal {...defaultProps} />);
    expect(html).toContain("Display Name");
    expect(html).toContain("Aegis Agent"); // placeholder
  });

  it("renders About textarea", () => {
    const html = renderToStaticMarkup(<AgentProfileEditModal {...defaultProps} />);
    expect(html).toContain("About");
    expect(html).toContain("brief description");
  });

  it("renders Website input", () => {
    const html = renderToStaticMarkup(<AgentProfileEditModal {...defaultProps} />);
    expect(html).toContain("Website");
  });

  it("renders Banner Image URL input", () => {
    const html = renderToStaticMarkup(<AgentProfileEditModal {...defaultProps} />);
    expect(html).toContain("Banner Image URL");
  });

  it("renders Upload Image button", () => {
    const html = renderToStaticMarkup(<AgentProfileEditModal {...defaultProps} />);
    expect(html).toContain("Upload Image");
  });

  it("renders Cancel and Save buttons", () => {
    const html = renderToStaticMarkup(<AgentProfileEditModal {...defaultProps} />);
    expect(html).toContain("Cancel");
    expect(html).toContain("Save");
  });

  it("pre-fills fields from currentProfile", () => {
    const profile: NostrProfileMetadata = {
      display_name: "My Agent",
      about: "A test agent",
      website: "https://example.com",
      banner: "https://img.com/banner.jpg",
      picture: "https://img.com/avatar.jpg",
    };
    const html = renderToStaticMarkup(
      <AgentProfileEditModal {...defaultProps} currentProfile={profile} />,
    );
    expect(html).toContain("My Agent");
    expect(html).toContain("A test agent");
    expect(html).toContain("https://example.com");
    expect(html).toContain("https://img.com/banner.jpg");
    expect(html).toContain("https://img.com/avatar.jpg");
  });

  it("shows bot emoji when no picture set", () => {
    const html = renderToStaticMarkup(<AgentProfileEditModal {...defaultProps} />);
    expect(html).toContain("\uD83E\uDD16");
  });

  it("shows avatar image when picture is set", () => {
    const profile: NostrProfileMetadata = { picture: "https://img.com/avatar.jpg" };
    const html = renderToStaticMarkup(
      <AgentProfileEditModal {...defaultProps} currentProfile={profile} />,
    );
    expect(html).toContain("https://img.com/avatar.jpg");
    expect(html).toContain("Agent avatar");
  });

  it("renders mobile width when mobile prop is true", () => {
    const html = renderToStaticMarkup(
      <AgentProfileEditModal {...defaultProps} mobile />,
    );
    expect(html).toContain("92vw");
  });

  it("falls back to name when display_name is missing", () => {
    const profile: NostrProfileMetadata = { name: "fallback-name" };
    const html = renderToStaticMarkup(
      <AgentProfileEditModal {...defaultProps} currentProfile={profile} />,
    );
    expect(html).toContain("fallback-name");
  });
});

describe("AgentProfileEditModal — interaction", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  function render(props: Partial<typeof defaultProps> = {}) {
    const merged = { ...defaultProps, ...props, onClose: props.onClose || jest.fn(), onSaved: props.onSaved || jest.fn() };
    act(() => { root.render(<AgentProfileEditModal {...merged} />); });
    return merged;
  }

  it("clicking Cancel calls onClose", () => {
    const onClose = jest.fn();
    render({ onClose });

    const cancelBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Cancel");
    expect(cancelBtn).toBeTruthy();
    act(() => { cancelBtn!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking backdrop calls onClose", () => {
    const onClose = jest.fn();
    render({ onClose });

    const backdrop = container.firstElementChild as HTMLDivElement;
    act(() => { backdrop.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking modal content does NOT call onClose", () => {
    const onClose = jest.fn();
    render({ onClose });

    const modal = container.firstElementChild?.firstElementChild as HTMLDivElement;
    act(() => { modal.click(); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Save & Publish triggers publishing flow and calls onSaved", async () => {
    const onSaved = jest.fn();
    const mergedProfile = { name: "Agent", display_name: "Agent" };
    mockPublishAgentProfile.mockResolvedValue({
      eventId: "ev1",
      relaysPublished: ["wss://relay.test"],
      relaysFailed: [],
      mergedProfile,
    });

    render({ onSaved });

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save"));
    expect(saveBtn).toBeTruthy();

    await act(async () => { saveBtn!.click(); });

    expect(container.textContent).toContain("Profile Published");
    expect(mockSetCachedAgentProfile).toHaveBeenCalledWith(principalText, mergedProfile);

    // onSaved is deferred until user clicks "Done" on success screen
    expect(onSaved).not.toHaveBeenCalled();
    const doneBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Done"));
    await act(async () => { doneBtn!.click(); });
    expect(onSaved).toHaveBeenCalledWith(mergedProfile);
  });

  it("shows publishing spinner during save", async () => {
    let resolvePublish: (value: unknown) => void;
    mockPublishAgentProfile.mockReturnValue(new Promise(r => { resolvePublish = r; }));

    render();

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save"));

    act(() => { saveBtn!.click(); });
    expect(container.textContent).toContain("Publishing profile");

    // Resolve to clean up
    await act(async () => {
      resolvePublish!({
        eventId: "ev1", relaysPublished: ["wss://r"], relaysFailed: [],
        mergedProfile: { name: "Agent" },
      });
    });
  });

  it("shows error phase when publish fails", async () => {
    mockPublishAgentProfile.mockRejectedValue(new Error("Network error"));
    render();

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save"));
    await act(async () => { saveBtn!.click(); });

    expect(container.textContent).toContain("Publish Failed");
    expect(container.textContent).toContain("Network error");
  });

  it("shows error when no relays published", async () => {
    mockPublishAgentProfile.mockResolvedValue({
      eventId: "ev1",
      relaysPublished: [],
      relaysFailed: ["wss://fail.relay"],
      mergedProfile: { name: "Agent" },
    });
    render();

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save"));
    await act(async () => { saveBtn!.click(); });

    expect(container.textContent).toContain("Publish Failed");
    expect(container.textContent).toContain("Failed to publish to any relay");
  });

  it("Try Again resets to edit phase", async () => {
    mockPublishAgentProfile.mockRejectedValue(new Error("fail"));
    render();

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save"));
    await act(async () => { saveBtn!.click(); });

    const retryBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Try Again");
    expect(retryBtn).toBeTruthy();
    act(() => { retryBtn!.click(); });

    expect(container.textContent).toContain("Edit Agent Profile");
    expect(container.textContent).not.toContain("Publish Failed");
  });

  it("Done button on success phase calls onClose", async () => {
    const onClose = jest.fn();
    render({ onClose });

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save"));
    await act(async () => { saveBtn!.click(); });

    const doneBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Done");
    expect(doneBtn).toBeTruthy();
    act(() => { doneBtn!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("publishes with trimmed field values", async () => {
    render({
      currentProfile: {
        display_name: "  Agent  ",
        about: "  Bio  ",
        website: "  https://example.com  ",
      },
    });

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save"));
    await act(async () => { saveBtn!.click(); });

    const profileArg = mockPublishAgentProfile.mock.calls[0][0] as NostrProfileMetadata;
    expect(profileArg.display_name).toBe("Agent");
    expect(profileArg.about).toBe("Bio");
    expect(profileArg.website).toBe("https://example.com");
  });

  it("passes empty strings for blank fields to allow clearing", async () => {
    render({ currentProfile: null });

    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save"));
    await act(async () => { saveBtn!.click(); });

    const profileArg = mockPublishAgentProfile.mock.calls[0][0] as NostrProfileMetadata;
    expect(profileArg.display_name).toBe("");
    expect(profileArg.about).toBe("");
    expect(profileArg.website).toBe("");
    expect(profileArg.picture).toBe("");
    expect(profileArg.banner).toBe("");
  });
});

describe("AgentProfileEditModal — image upload", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.innerHTML = "";
    jest.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("rejects files larger than 5 MB", async () => {
    act(() => {
      root.render(<AgentProfileEditModal {...defaultProps} />);
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const largeFile = new File([new ArrayBuffer(6 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", { value: [largeFile], configurable: true });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Upload Failed");
    expect(container.textContent).toContain("5 MB");
  });

  it("shows uploading state during image upload", async () => {
    let resolveUpload: (value: unknown) => void;
    globalThis.fetch = jest.fn().mockReturnValue(new Promise(r => { resolveUpload = r; }));

    act(() => {
      root.render(<AgentProfileEditModal {...defaultProps} />);
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const smallFile = new File(["test"], "small.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", { value: [smallFile], configurable: true });

    act(() => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Uploading image");

    // Resolve to clean up
    await act(async () => {
      resolveUpload!({ ok: true, status: 200, json: () => Promise.resolve({ url: "https://img.com/uploaded.jpg" }) });
    });
  });

  it("shows error when upload API returns non-ok", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 400,
      json: () => Promise.resolve({ error: "Upload rejected" }),
    });

    act(() => {
      root.render(<AgentProfileEditModal {...defaultProps} />);
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Upload Failed");
    expect(container.textContent).toContain("Upload rejected");
  });

  it("sends NIP-98 auth header with upload request", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ url: "https://img.com/uploaded.jpg" }),
    });
    globalThis.fetch = mockFetch;

    act(() => {
      root.render(<AgentProfileEditModal {...defaultProps} />);
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mockCreateNIP98AuthHeader).toHaveBeenCalledWith(
      nostrKeys.sk,
      "https://nostr.build/api/v2/upload/files",
      "POST",
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/upload/image",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Nostr mock-auth-header" }),
      }),
    );
  });

  it("sets picture URL in form after successful upload", async () => {
    const uploadedUrl = "https://img.com/uploaded-avatar.jpg";
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ url: uploadedUrl }),
    });

    act(() => {
      root.render(<AgentProfileEditModal {...defaultProps} />);
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Edit Agent Profile");
    expect(container.textContent).toContain(uploadedUrl);
    const img = container.querySelector("img[alt='Agent avatar']") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe(uploadedUrl);
  });

  it("recovers from upload error via Try Again button", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 500,
      json: () => Promise.resolve({ error: "Upload rejected by server" }),
    });

    act(() => {
      root.render(<AgentProfileEditModal {...defaultProps} />);
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Upload Failed");

    const tryAgainBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Try Again"));
    expect(tryAgainBtn).toBeTruthy();

    await act(async () => { tryAgainBtn!.click(); });

    expect(container.textContent).toContain("Edit Agent Profile");
    expect(container.textContent).not.toContain("Upload Failed");

    // Upload button should be available again
    const uploadBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Upload"));
    expect(uploadBtn).toBeTruthy();
  });

  it("prevents upload during non-edit phase", async () => {
    let resolvePublish: (value: unknown) => void;
    mockPublishAgentProfile.mockReturnValue(new Promise(r => { resolvePublish = r; }));

    act(() => {
      root.render(<AgentProfileEditModal {...defaultProps} />);
    });

    // Start save to enter "publishing" phase
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save"));
    act(() => { saveBtn!.click(); });

    expect(container.textContent).toContain("Publishing");

    // Resolve to clean up
    await act(async () => {
      resolvePublish!({
        eventId: "ev1",
        relaysPublished: ["wss://relay.test"],
        relaysFailed: [],
        mergedProfile: { name: "Test" },
      });
    });
  });
});
