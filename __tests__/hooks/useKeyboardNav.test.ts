/**
 * @jest-environment jsdom
 */

/**
 * Behavioral tests for useKeyboardNav hook — uses createRoot + act to render
 * the hook, dispatches real KeyboardEvents on document, and verifies callbacks.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";

// Enable act environment
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type HookOpts = Parameters<typeof useKeyboardNav>[0];

// Minimal component that exposes hook output via data attribute
function TestHarness(props: HookOpts) {
  const { focusedId } = useKeyboardNav(props);
  return React.createElement("div", { "data-focused": focusedId ?? "" });
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount(props: HookOpts) {
  act(() => { root.render(React.createElement(TestHarness, props)); });
}

function press(key: string, opts: KeyboardEventInit = {}) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
  });
}

function focused(): string {
  return container.querySelector("[data-focused]")?.getAttribute("data-focused") || "";
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  // Create mock card elements with scrollIntoView
  for (const id of ["a", "b", "c"]) {
    const el = document.createElement("div");
    el.id = `card-${id}`;
    el.scrollIntoView = jest.fn();
    document.body.appendChild(el);
  }
});

afterEach(() => {
  act(() => { root.unmount(); });
  document.body.innerHTML = "";
});

describe("useKeyboardNav — j/k navigation", () => {
  const defaults: HookOpts = {
    items: ["a", "b", "c"],
    expandedId: null,
    onExpand: jest.fn(),
    onValidate: jest.fn(),
    onFlag: jest.fn(),
    onOpenPalette: jest.fn(),
    enabled: true,
  };

  beforeEach(() => jest.clearAllMocks());

  it("j focuses next item starting from first", () => {
    mount(defaults);
    press("j");
    expect(focused()).toBe("a");
  });

  it("j advances through items sequentially", () => {
    mount(defaults);
    press("j"); // a
    press("j"); // b
    expect(focused()).toBe("b");
    press("j"); // c
    expect(focused()).toBe("c");
  });

  it("j clamps at last item", () => {
    mount(defaults);
    press("j"); press("j"); press("j"); // at c
    press("j"); // still c
    expect(focused()).toBe("c");
  });

  it("k moves to previous item", () => {
    mount(defaults);
    press("j"); press("j"); // at b
    press("k");
    expect(focused()).toBe("a");
  });

  it("k clamps at first item", () => {
    mount(defaults);
    press("j"); // at a (index 0)
    press("k"); // still a
    expect(focused()).toBe("a");
  });

  it("scrolls focused card into view", () => {
    mount(defaults);
    press("j"); // focus "a"
    const card = document.getElementById("card-a")!;
    expect(card.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });
});

describe("useKeyboardNav — expand/collapse", () => {
  const make = (overrides: Partial<HookOpts> = {}): HookOpts => ({
    items: ["a", "b", "c"],
    expandedId: null,
    onExpand: jest.fn(),
    onValidate: jest.fn(),
    onFlag: jest.fn(),
    onOpenPalette: jest.fn(),
    enabled: true,
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it("Enter calls onExpand with focused item id", () => {
    const opts = make();
    mount(opts);
    press("j"); // focus "a"
    press("Enter");
    expect(opts.onExpand).toHaveBeenCalledWith("a");
  });

  it("l key calls onExpand with focused item id", () => {
    const opts = make();
    mount(opts);
    press("j"); // focus "a"
    press("l");
    expect(opts.onExpand).toHaveBeenCalledWith("a");
  });

  it("Enter toggles collapse when item is already expanded", () => {
    const opts = make({ expandedId: "a" });
    mount(opts);
    press("j"); // focus "a" (same as expanded)
    press("Enter");
    expect(opts.onExpand).toHaveBeenCalledWith(null);
  });

  it("h collapses when expandedId is set", () => {
    const opts = make({ expandedId: "b" });
    mount(opts);
    press("h");
    expect(opts.onExpand).toHaveBeenCalledWith(null);
  });

  it("h does nothing when nothing is expanded", () => {
    const opts = make({ expandedId: null });
    mount(opts);
    press("h");
    expect(opts.onExpand).not.toHaveBeenCalled();
  });

  it("Escape collapses when expandedId is set", () => {
    const opts = make({ expandedId: "c" });
    mount(opts);
    press("Escape");
    expect(opts.onExpand).toHaveBeenCalledWith(null);
  });

  it("Escape does nothing when nothing is expanded", () => {
    const opts = make({ expandedId: null });
    mount(opts);
    press("Escape");
    expect(opts.onExpand).not.toHaveBeenCalled();
  });
});

describe("useKeyboardNav — validate/flag actions", () => {
  const make = (overrides: Partial<HookOpts> = {}): HookOpts => ({
    items: ["a", "b", "c"],
    expandedId: null,
    onExpand: jest.fn(),
    onValidate: jest.fn(),
    onFlag: jest.fn(),
    onOpenPalette: jest.fn(),
    enabled: true,
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it("v key calls onValidate with focused item id", () => {
    const opts = make();
    mount(opts);
    press("j"); // focus "a"
    press("v");
    expect(opts.onValidate).toHaveBeenCalledWith("a");
  });

  it("f key calls onFlag with focused item id", () => {
    const opts = make();
    mount(opts);
    press("j"); press("j"); // focus "b"
    press("f");
    expect(opts.onFlag).toHaveBeenCalledWith("b");
  });

  it("v/f do nothing when no item is focused", () => {
    const opts = make();
    mount(opts);
    // No j press — indexRef is -1, no item focused
    press("v");
    press("f");
    expect(opts.onValidate).not.toHaveBeenCalled();
    expect(opts.onFlag).not.toHaveBeenCalled();
  });
});

describe("useKeyboardNav — command palette", () => {
  const make = (overrides: Partial<HookOpts> = {}): HookOpts => ({
    items: ["a", "b", "c"],
    expandedId: null,
    onExpand: jest.fn(),
    onValidate: jest.fn(),
    onFlag: jest.fn(),
    onOpenPalette: jest.fn(),
    enabled: true,
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it("Cmd+K opens palette", () => {
    const opts = make();
    mount(opts);
    press("k", { metaKey: true });
    expect(opts.onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+K opens palette", () => {
    const opts = make();
    mount(opts);
    press("k", { ctrlKey: true });
    expect(opts.onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("plain k does not open palette (navigates instead)", () => {
    const opts = make();
    mount(opts);
    press("j"); // focus a
    press("j"); // focus b
    press("k"); // should navigate up, not open palette
    expect(opts.onOpenPalette).not.toHaveBeenCalled();
    expect(focused()).toBe("a");
  });
});

describe("useKeyboardNav — o key (open URL)", () => {
  const make = (overrides: Partial<HookOpts> = {}): HookOpts => ({
    items: ["a", "b", "c"],
    expandedId: null,
    onExpand: jest.fn(),
    onValidate: jest.fn(),
    onFlag: jest.fn(),
    onOpenPalette: jest.fn(),
    enabled: true,
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it("opens source link in new tab when card has a target=_blank link", () => {
    const card = document.getElementById("card-a")!;
    const link = document.createElement("a");
    link.target = "_blank";
    link.href = "https://example.com/article";
    card.appendChild(link);

    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    mount(make());
    press("j"); // focus "a"
    press("o");
    expect(openSpy).toHaveBeenCalledWith("https://example.com/article", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("opens data-source-url when attribute is present (collapsed card)", () => {
    const card = document.getElementById("card-a")!;
    card.setAttribute("data-source-url", "https://example.com/data-attr");

    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    mount(make());
    press("j"); // focus "a"
    press("o");
    expect(openSpy).toHaveBeenCalledWith("https://example.com/data-attr", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("data-source-url takes precedence over a[target=_blank] link", () => {
    const card = document.getElementById("card-a")!;
    card.setAttribute("data-source-url", "https://primary.com");
    const link = document.createElement("a");
    link.target = "_blank";
    link.href = "https://fallback.com";
    card.appendChild(link);

    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    mount(make());
    press("j"); // focus "a"
    press("o");
    expect(openSpy).toHaveBeenCalledWith("https://primary.com", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("does nothing when card has no target=_blank link", () => {
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    mount(make());
    press("j"); // focus "a"
    press("o");
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe("useKeyboardNav — disabled / input element", () => {
  const make = (overrides: Partial<HookOpts> = {}): HookOpts => ({
    items: ["a", "b", "c"],
    expandedId: null,
    onExpand: jest.fn(),
    onValidate: jest.fn(),
    onFlag: jest.fn(),
    onOpenPalette: jest.fn(),
    enabled: true,
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it("ignores all keys when enabled is false", () => {
    const opts = make({ enabled: false });
    mount(opts);
    press("j");
    press("v");
    press("k", { metaKey: true });
    expect(focused()).toBe("");
    expect(opts.onValidate).not.toHaveBeenCalled();
    expect(opts.onOpenPalette).not.toHaveBeenCalled();
  });

  it("ignores keys when an input element is focused", () => {
    const opts = make();
    mount(opts);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("j");
    expect(focused()).toBe("");
  });

  it("ignores keys when a textarea is focused", () => {
    const opts = make();
    mount(opts);
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    press("j");
    expect(focused()).toBe("");
  });

  it("ignores keys when a select is focused", () => {
    const opts = make();
    mount(opts);
    const sel = document.createElement("select");
    document.body.appendChild(sel);
    sel.focus();
    press("j");
    expect(focused()).toBe("");
  });
});

describe("useKeyboardNav — empty items", () => {
  it("does nothing when items array is empty", () => {
    const opts: HookOpts = {
      items: [],
      expandedId: null,
      onExpand: jest.fn(),
      onValidate: jest.fn(),
      onFlag: jest.fn(),
      onOpenPalette: jest.fn(),
      enabled: true,
    };
    mount(opts);
    press("j");
    press("v");
    expect(focused()).toBe("");
    expect(opts.onValidate).not.toHaveBeenCalled();
  });
});
