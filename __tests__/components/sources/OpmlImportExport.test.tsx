/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import type { SavedSource } from "@/lib/types/sources";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

let mockSources: SavedSource[] = [];
let mockDemoMode = false;
const mockAddSource = jest.fn().mockReturnValue(true);
const mockAddNotification = jest.fn();

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({
    sources: mockSources,
    addSource: mockAddSource,
  }),
}));

jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({
    addNotification: mockAddNotification,
    removeNotification: jest.fn(),
  }),
}));

jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: mockDemoMode }),
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// jsdom lacks URL.createObjectURL / revokeObjectURL
if (typeof URL.createObjectURL === "undefined") {
  URL.createObjectURL = jest.fn().mockReturnValue("blob:mock-url");
}
if (typeof URL.revokeObjectURL === "undefined") {
  URL.revokeObjectURL = jest.fn();
}

import { OpmlImportExport } from "@/components/sources/OpmlImportExport";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeSrc(overrides: Partial<SavedSource> = {}): SavedSource {
  return {
    id: "rss:https://example.com/feed",
    type: "rss",
    label: "Example",
    feedUrl: "https://example.com/feed",
    enabled: true,
    createdAt: 1000,
    ...overrides,
  };
}

const VALID_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Feed A" xmlUrl="https://a.com/feed"/>
    <outline text="Feed B" xmlUrl="https://b.com/feed"/>
    <outline text="Feed C" xmlUrl="https://c.com/feed"/>
  </body>
</opml>`;

const INVALID_OPML = "<not valid xml!!!>";

function createFile(content: string, name = "test.opml"): File {
  return new File([content], name, { type: "application/xml" });
}

function getFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

async function simulateFileSelect(file: File) {
  const input = getFileInput();
  const notifyBefore = mockAddNotification.mock.calls.length;

  fireEvent.change(input, { target: { files: [file] } });

  // Wait for FileReader callback to complete and React to re-render.
  // Either a notification fires or the confirmation UI appears.
  await waitFor(() => {
    const notified = mockAddNotification.mock.calls.length > notifyBefore;
    const confirmVisible = screen.queryByText("Confirm") !== null;
    if (!notified && !confirmVisible) {
      throw new Error("FileReader callback has not completed yet");
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Setup / Teardown                                                   */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  mockSources = [];
  mockDemoMode = false;
  mockAddSource.mockClear().mockReturnValue(true);
  mockAddNotification.mockClear();
});

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

describe("rendering", () => {
  it("renders Import and Export buttons", () => {
    render(<OpmlImportExport />);
    expect(screen.getByText("Import OPML")).toBeTruthy();
    expect(screen.getByText("Export OPML")).toBeTruthy();
  });

  it("renders a hidden file input with correct accept types", () => {
    render(<OpmlImportExport />);
    const input = getFileInput();
    expect(input).toBeTruthy();
    expect(input.accept).toBe(".opml,.xml");
    expect(input.className).toContain("hidden");
  });

  it("does not render confirmation dialog initially", () => {
    render(<OpmlImportExport />);
    expect(screen.queryByText("Confirm")).toBeNull();
    expect(screen.queryByText("Cancel")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Export button state                                                */
/* ------------------------------------------------------------------ */

describe("export button", () => {
  it("is disabled when there are no RSS sources", () => {
    mockSources = [];
    render(<OpmlImportExport />);
    const btn = screen.getByText("Export OPML") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("is disabled when sources exist but none are RSS with feedUrl", () => {
    mockSources = [
      makeSrc({ id: "nostr:1", type: "nostr", feedUrl: undefined, relays: ["wss://r.com"] }),
      makeSrc({ id: "fc:1", type: "farcaster", feedUrl: undefined, fid: 1 }),
    ];
    render(<OpmlImportExport />);
    expect((screen.getByText("Export OPML") as HTMLButtonElement).disabled).toBe(true);
  });

  it("is enabled when RSS sources with feedUrl exist", () => {
    mockSources = [makeSrc()];
    render(<OpmlImportExport />);
    expect((screen.getByText("Export OPML") as HTMLButtonElement).disabled).toBe(false);
  });

  it("triggers download with correct filename on click", () => {
    mockSources = [makeSrc()];
    const clickedAnchors: HTMLAnchorElement[] = [];
    const origCreateElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") {
        jest.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {
          clickedAnchors.push(el as HTMLAnchorElement);
        });
      }
      return el;
    });

    render(<OpmlImportExport />);
    act(() => { screen.getByText("Export OPML").click(); });

    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].download).toBe("aegis-sources.opml");
    expect(clickedAnchors[0].href).toContain("blob:");

    (document.createElement as jest.Mock).mockRestore();
  });

  it("passes current sources to sourcesToOpml and produces valid XML in blob", async () => {
    const src = makeSrc({ feedUrl: "https://export-test.com/feed", label: "ExportTest" });
    mockSources = [src];

    let capturedBlob: Blob | null = null;
    (URL.createObjectURL as jest.Mock).mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return "blob:captured";
    });

    const origCreateElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") jest.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {});
      return el;
    });

    render(<OpmlImportExport />);
    act(() => { screen.getByText("Export OPML").click(); });

    expect(capturedBlob).not.toBeNull();
    const xml = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsText(capturedBlob!);
    });
    expect(xml).toContain("https://export-test.com/feed");
    expect(xml).toContain("ExportTest");
    expect(xml).toContain("<opml");
    expect(xml).toContain('<?xml version="1.0"');

    (document.createElement as jest.Mock).mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  Import flow — new feeds                                            */
/* ------------------------------------------------------------------ */

describe("import flow — new feeds", () => {
  it("shows confirmation with correct count after file select", async () => {
    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(VALID_OPML));

    expect(screen.getByText("Import 3 new feeds?")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("calls addSource for each feed on confirm", async () => {
    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(VALID_OPML));

    act(() => { screen.getByText("Confirm").click(); });

    expect(mockAddSource).toHaveBeenCalledTimes(3);
    // Each call should NOT include id or createdAt
    for (const call of mockAddSource.mock.calls) {
      const arg = call[0];
      expect(arg).not.toHaveProperty("id");
      expect(arg).not.toHaveProperty("createdAt");
      expect(arg.type).toBe("rss");
      expect(arg.enabled).toBe(true);
      expect(arg.feedUrl).toMatch(/^https:\/\//);
    }
  });

  it("shows success notification with actual added count", async () => {
    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(VALID_OPML));

    act(() => { screen.getByText("Confirm").click(); });

    expect(mockAddNotification).toHaveBeenCalledWith("Imported 3 feeds", "success");
  });

  it("hides confirmation dialog after confirm", async () => {
    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(VALID_OPML));
    expect(screen.getByText("Confirm")).toBeTruthy();

    act(() => { screen.getByText("Confirm").click(); });

    expect(screen.queryByText("Confirm")).toBeNull();
  });

  it("reports actual addSource success count when some are rejected", async () => {
    // addSource returns false for the second call (duplicate at context level)
    mockAddSource
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(VALID_OPML));

    act(() => { screen.getByText("Confirm").click(); });

    expect(mockAddNotification).toHaveBeenCalledWith("Imported 2 feeds", "success");
  });
});

/* ------------------------------------------------------------------ */
/*  Import flow — cancel                                               */
/* ------------------------------------------------------------------ */

describe("import flow — cancel", () => {
  it("hides confirmation dialog on cancel without calling addSource", async () => {
    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(VALID_OPML));
    expect(screen.getByText("Confirm")).toBeTruthy();

    act(() => { screen.getByText("Cancel").click(); });

    expect(screen.queryByText("Confirm")).toBeNull();
    expect(mockAddSource).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  Import flow — duplicates                                           */
/* ------------------------------------------------------------------ */

describe("import flow — all duplicates", () => {
  it("shows info notification when all feeds already exist", async () => {
    mockSources = [
      makeSrc({ id: "rss:https://a.com/feed", feedUrl: "https://a.com/feed" }),
      makeSrc({ id: "rss:https://b.com/feed", feedUrl: "https://b.com/feed" }),
      makeSrc({ id: "rss:https://c.com/feed", feedUrl: "https://c.com/feed" }),
    ];

    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(VALID_OPML));

    expect(mockAddNotification).toHaveBeenCalledWith("No new feeds found", "info");
    expect(screen.queryByText("Confirm")).toBeNull();
  });

  it("only shows new feeds count, excluding existing ones", async () => {
    // 1 of 3 feeds already exists
    mockSources = [
      makeSrc({ id: "rss:https://a.com/feed", feedUrl: "https://a.com/feed" }),
    ];

    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(VALID_OPML));

    expect(screen.getByText("Import 2 new feeds?")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Import flow — invalid file                                         */
/* ------------------------------------------------------------------ */

describe("import flow — invalid input", () => {
  it("shows info notification for invalid OPML", async () => {
    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(INVALID_OPML));

    expect(mockAddNotification).toHaveBeenCalledWith("No new feeds found", "info");
    expect(screen.queryByText("Confirm")).toBeNull();
  });

  it("shows info notification for empty file", async () => {
    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(""));

    expect(mockAddNotification).toHaveBeenCalledWith("No new feeds found", "info");
  });

  it("handles OPML with no feeds gracefully", async () => {
    const noFeedsOpml = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="Empty folder"/>
    </body></opml>`;

    render(<OpmlImportExport />);
    await simulateFileSelect(createFile(noFeedsOpml));

    expect(mockAddNotification).toHaveBeenCalledWith("No new feeds found", "info");
  });
});

/* ------------------------------------------------------------------ */
/*  Import flow — FileReader error                                     */
/* ------------------------------------------------------------------ */

describe("import flow — FileReader error", () => {
  let origFileReader: typeof FileReader;

  beforeEach(() => {
    origFileReader = globalThis.FileReader;
    class FailingFileReader {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      result: string | null = null;
      readAsText() { setTimeout(() => { this.onerror?.(); }, 0); }
    }
    globalThis.FileReader = FailingFileReader as unknown as typeof FileReader;
  });

  afterEach(() => { globalThis.FileReader = origFileReader; });

  it("shows error notification when FileReader fails", async () => {
    render(<OpmlImportExport />);
    fireEvent.change(getFileInput(), { target: { files: [createFile(VALID_OPML)] } });

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith("Failed to read file", "error");
    });
    expect(screen.queryByText("Confirm")).toBeNull();
  });

  it("resets file input on FileReader error", async () => {
    render(<OpmlImportExport />);
    const input = getFileInput();
    fireEvent.change(input, { target: { files: [createFile(VALID_OPML)] } });

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith("Failed to read file", "error");
    });
    expect(input.value).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  File input reset                                                   */
/* ------------------------------------------------------------------ */

describe("file input reset", () => {
  it("resets file input after successful parse", async () => {
    render(<OpmlImportExport />);
    const input = getFileInput();
    await simulateFileSelect(createFile(VALID_OPML));

    expect(input.value).toBe("");
  });

  it("resets file input after failed parse", async () => {
    render(<OpmlImportExport />);
    const input = getFileInput();
    await simulateFileSelect(createFile(INVALID_OPML));

    expect(input.value).toBe("");
  });

  it("allows re-selecting the same file", async () => {
    render(<OpmlImportExport />);

    await simulateFileSelect(createFile(VALID_OPML));
    act(() => { screen.getByText("Cancel").click(); });

    // Select the same file again — should work because input was reset
    await simulateFileSelect(createFile(VALID_OPML));
    expect(screen.getByText("Import 3 new feeds?")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Demo mode                                                          */
/* ------------------------------------------------------------------ */

describe("demo mode", () => {
  beforeEach(() => { mockDemoMode = true; });

  it("disables import button in demo mode", () => {
    render(<OpmlImportExport />);
    expect((screen.getByText("Import OPML") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not disable export button in demo mode", () => {
    mockSources = [makeSrc()];
    render(<OpmlImportExport />);
    expect((screen.getByText("Export OPML") as HTMLButtonElement).disabled).toBe(false);
  });
});
