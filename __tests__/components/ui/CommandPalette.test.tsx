/**
 * @jest-environment jsdom
 */

// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act } = require("react-dom/test-utils");
import { CommandPalette } from "@/components/ui/CommandPalette";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("CommandPalette — static rendering", () => {
  const commands = [
    { label: "Go to Feed", action: jest.fn() },
    { label: "Go to Dashboard", action: jest.fn() },
    { label: "Filter: Quality", action: jest.fn() },
    { label: "Export CSV", action: jest.fn() },
  ];

  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <CommandPalette open={false} onClose={jest.fn()} commands={commands} />
    );
    expect(html).toBe("");
  });

  it("renders command list when open", () => {
    const html = renderToStaticMarkup(
      <CommandPalette open={true} onClose={jest.fn()} commands={commands} />
    );
    expect(html).toContain("Go to Feed");
    expect(html).toContain("Go to Dashboard");
    expect(html).toContain("Filter: Quality");
    expect(html).toContain("Export CSV");
  });

  it("renders search input placeholder", () => {
    const html = renderToStaticMarkup(
      <CommandPalette open={true} onClose={jest.fn()} commands={commands} />
    );
    expect(html).toContain("Type a command...");
  });

  it("renders ESC badge", () => {
    const html = renderToStaticMarkup(
      <CommandPalette open={true} onClose={jest.fn()} commands={commands} />
    );
    expect(html).toContain("ESC");
  });

  it("renders full width on mobile", () => {
    const html = renderToStaticMarkup(
      <CommandPalette open={true} onClose={jest.fn()} commands={commands} mobile />
    );
    expect(html).toContain("calc(100% - 32px)");
  });
});

describe("CommandPalette — interactive behavior", () => {
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
  });

  function render(props: React.ComponentProps<typeof CommandPalette>) {
    act(() => { root.render(<CommandPalette {...props} />); });
  }

  function getInput(): HTMLInputElement | null {
    return container.querySelector("input");
  }

  function getCommandButtons(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll("button"));
  }

  function typeInInput(value: string) {
    const input = getInput()!;
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value"
      )!.set!;
      nativeSetter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function pressKeyOnInput(key: string) {
    const input = getInput()!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  }

  it("filters commands based on typed query", () => {
    const commands = [
      { label: "Go to Feed", action: jest.fn() },
      { label: "Go to Dashboard", action: jest.fn() },
      { label: "Export CSV", action: jest.fn() },
    ];
    render({ open: true, onClose: jest.fn(), commands });

    typeInInput("export");

    const labels = getCommandButtons().map(b => b.textContent);
    expect(labels).toContain("Export CSV");
    expect(labels).not.toContain("Go to Feed");
    expect(labels).not.toContain("Go to Dashboard");
  });

  it("shows 'No matching commands' when filter matches nothing", () => {
    const commands = [{ label: "Go to Feed", action: jest.fn() }];
    render({ open: true, onClose: jest.fn(), commands });

    typeInInput("zzzznotfound");

    expect(container.textContent).toContain("No matching commands");
  });

  it("Escape key calls onClose", () => {
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [{ label: "Test", action: jest.fn() }] });

    pressKeyOnInput("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter key executes selected command and calls onClose", () => {
    const action = jest.fn();
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [
      { label: "First", action },
      { label: "Second", action: jest.fn() },
    ]});

    pressKeyOnInput("Enter");
    expect(action).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown + Enter selects and executes second command", () => {
    const firstAction = jest.fn();
    const secondAction = jest.fn();
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [
      { label: "First", action: firstAction },
      { label: "Second", action: secondAction },
    ]});

    pressKeyOnInput("ArrowDown");
    pressKeyOnInput("Enter");
    expect(firstAction).not.toHaveBeenCalled();
    expect(secondAction).toHaveBeenCalledTimes(1);
  });

  it("ArrowUp from second item returns to first", () => {
    const firstAction = jest.fn();
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [
      { label: "First", action: firstAction },
      { label: "Second", action: jest.fn() },
    ]});

    pressKeyOnInput("ArrowDown");
    pressKeyOnInput("ArrowUp");
    pressKeyOnInput("Enter");
    expect(firstAction).toHaveBeenCalledTimes(1);
  });

  it("clicking a command button executes it", () => {
    const action = jest.fn();
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [
      { label: "Click Me", action },
    ]});

    const button = getCommandButtons().find(b => b.textContent === "Click Me");
    expect(button).toBeTruthy();
    act(() => { button!.click(); });
    expect(action).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking backdrop calls onClose", () => {
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [{ label: "Test", action: jest.fn() }] });

    const backdrop = container.firstElementChild as HTMLDivElement;
    act(() => { backdrop.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking modal content does not call onClose", () => {
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [{ label: "Test", action: jest.fn() }] });

    const modal = container.firstElementChild?.firstElementChild as HTMLDivElement;
    act(() => { modal.click(); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets query and selection when re-opened", () => {
    const commands = [
      { label: "Alpha", action: jest.fn() },
      { label: "Beta", action: jest.fn() },
    ];
    const onClose = jest.fn();

    render({ open: true, onClose, commands });
    typeInInput("beta");
    expect(getCommandButtons().length).toBe(1);

    render({ open: false, onClose, commands });
    render({ open: true, onClose, commands });
    expect(getInput()!.value).toBe("");
    expect(getCommandButtons().length).toBe(2);
  });
});
