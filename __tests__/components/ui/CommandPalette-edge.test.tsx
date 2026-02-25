/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { createRoot } from "react-dom/client";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act } = require("react-dom/test-utils");
import { CommandPalette } from "@/components/ui/CommandPalette";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("CommandPalette — edge cases and boundary conditions", () => {
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

  function pressKeyOnInput(key: string) {
    const input = getInput()!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  }

  it("ArrowDown cannot go below last item", () => {
    const action1 = jest.fn();
    const action2 = jest.fn();
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [
      { label: "First", action: action1 },
      { label: "Second", action: action2 },
    ]});

    // Press ArrowDown 5 times (more than items count)
    for (let i = 0; i < 5; i++) pressKeyOnInput("ArrowDown");
    pressKeyOnInput("Enter");

    // Should still be on last item (Second)
    expect(action2).toHaveBeenCalledTimes(1);
    expect(action1).not.toHaveBeenCalled();
  });

  it("ArrowUp cannot go above first item", () => {
    const action1 = jest.fn();
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [
      { label: "First", action: action1 },
      { label: "Second", action: jest.fn() },
    ]});

    // Press ArrowUp 3 times at index 0
    for (let i = 0; i < 3; i++) pressKeyOnInput("ArrowUp");
    pressKeyOnInput("Enter");

    expect(action1).toHaveBeenCalledTimes(1);
  });

  it("Enter on empty filtered list does nothing", () => {
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [
      { label: "Alpha", action: jest.fn() },
    ]});

    // Type query that matches nothing
    const input = getInput()!;
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value"
      )!.set!;
      nativeSetter.call(input, "zzzzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    pressKeyOnInput("Enter");
    // onClose should NOT be called since no command was selected
    expect(onClose).not.toHaveBeenCalled();
  });

  it("handles empty commands array", () => {
    render({ open: true, onClose: jest.fn(), commands: [] });
    expect(container.textContent).toContain("No matching commands");
  });

  it("handles single command", () => {
    const action = jest.fn();
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [{ label: "Only One", action }] });

    const buttons = getCommandButtons();
    expect(buttons.some(b => b.textContent === "Only One")).toBe(true);

    pressKeyOnInput("Enter");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("case-insensitive filtering", () => {
    render({ open: true, onClose: jest.fn(), commands: [
      { label: "Go to Feed", action: jest.fn() },
      { label: "EXPORT CSV", action: jest.fn() },
    ]});

    const input = getInput()!;
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value"
      )!.set!;
      nativeSetter.call(input, "FEED");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const labels = getCommandButtons().map(b => b.textContent);
    expect(labels).toContain("Go to Feed");
    expect(labels).not.toContain("EXPORT CSV");
  });

  it("selectedIndex resets when query changes", () => {
    const actionA = jest.fn();
    const actionB = jest.fn();
    const onClose = jest.fn();
    render({ open: true, onClose, commands: [
      { label: "Apple", action: actionA },
      { label: "Banana", action: actionB },
    ]});

    // Move to second item
    pressKeyOnInput("ArrowDown");

    // Now filter to only Apple
    const input = getInput()!;
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value"
      )!.set!;
      nativeSetter.call(input, "apple");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Enter should select Apple (index reset to 0)
    pressKeyOnInput("Enter");
    expect(actionA).toHaveBeenCalledTimes(1);
    expect(actionB).not.toHaveBeenCalled();
  });

  it("many commands render correctly", () => {
    const commands = Array.from({ length: 50 }, (_, i) => ({
      label: `Command ${i}`,
      action: jest.fn(),
    }));
    render({ open: true, onClose: jest.fn(), commands });
    const buttons = getCommandButtons();
    expect(buttons.length).toBe(50);
  });
});
