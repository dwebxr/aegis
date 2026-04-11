/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "@testing-library/jest-dom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NotificationToast } from "@/components/ui/NotificationToast";
import type { Notification } from "@/hooks/useNotifications";

const wrap = (el: React.ReactElement) => renderToStaticMarkup(el);

afterEach(() => cleanup());

const make = (over: Partial<Notification> = {}): Notification => ({
  id: 1,
  text: "Hello",
  type: "info",
  ...over,
});

describe("NotificationToast — static rendering", () => {
  it("renders nothing when notifications array is empty", () => {
    const html = wrap(<NotificationToast notifications={[]} />);
    expect(html).not.toContain("Hello");
    expect(html).not.toContain("role=\"alert\"");
  });

  it("renders each notification with role=alert", () => {
    const html = wrap(
      <NotificationToast
        notifications={[
          make({ id: 1, text: "Saved!", type: "success" }),
          make({ id: 2, text: "Oops", type: "error" }),
          make({ id: 3, text: "FYI", type: "info" }),
        ]}
      />,
    );
    expect(html).toContain("Saved!");
    expect(html).toContain("Oops");
    expect(html).toContain("FYI");
    expect(html.match(/role="alert"/g)).toHaveLength(3);
  });

  it("applies success styling for success type", () => {
    const html = wrap(<NotificationToast notifications={[make({ type: "success", text: "S" })]} />);
    expect(html).toContain("text-emerald-400");
  });

  it("applies error styling for error type", () => {
    const html = wrap(<NotificationToast notifications={[make({ type: "error", text: "E" })]} />);
    expect(html).toContain("text-red-400");
  });

  it("applies info styling for info type", () => {
    const html = wrap(<NotificationToast notifications={[make({ type: "info", text: "I" })]} />);
    expect(html).toContain("text-sky-400");
  });

  it("falls back to info styling for unknown type", () => {
    const html = wrap(
      <NotificationToast notifications={[make({ type: "weird" as unknown as Notification["type"], text: "?" })]} />,
    );
    expect(html).toContain("text-sky-400");
  });

  it("positions toasts above the mobile nav when mobile=true", () => {
    const html = wrap(<NotificationToast mobile notifications={[make()]} />);
    expect(html).toContain("bottom-[84px]");
    expect(html).not.toContain("bottom-5 right-5");
  });

  it("positions toasts at desktop bottom-right when mobile=false", () => {
    const html = wrap(<NotificationToast notifications={[make()]} />);
    expect(html).toContain("bottom-5 right-5");
  });

  it("does not render dismiss button when onDismiss is undefined", () => {
    const html = wrap(<NotificationToast notifications={[make()]} />);
    expect(html).not.toContain("Dismiss notification");
  });

  it("renders dismiss button with aria-label when onDismiss provided", () => {
    const html = wrap(<NotificationToast notifications={[make()]} onDismiss={() => {}} />);
    expect(html).toContain('aria-label="Dismiss notification"');
  });
});

describe("NotificationToast — interaction", () => {
  it("calls onDismiss with the notification id when dismiss button clicked", () => {
    const onDismiss = jest.fn();
    render(
      <NotificationToast
        notifications={[make({ id: 42, text: "Click me" })]}
        onDismiss={onDismiss}
      />,
    );
    const btn = screen.getByLabelText("Dismiss notification");
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(42);
  });

  it("dismiss button per notification fires with correct id", () => {
    const onDismiss = jest.fn();
    render(
      <NotificationToast
        notifications={[
          make({ id: 1, text: "first" }),
          make({ id: 2, text: "second" }),
        ]}
        onDismiss={onDismiss}
      />,
    );
    const buttons = screen.getAllByLabelText("Dismiss notification");
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(onDismiss).toHaveBeenCalledWith(2);
    fireEvent.click(buttons[0]);
    expect(onDismiss).toHaveBeenCalledWith(1);
  });
});
