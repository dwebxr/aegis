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
import { Button, buttonVariants } from "@/components/ui/button";

afterEach(() => cleanup());
const wrap = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Button — variants", () => {
  it.each(["default", "destructive", "outline", "secondary", "ghost", "link"] as const)(
    "renders %s variant with data-variant attribute",
    (variant) => {
      const html = wrap(<Button variant={variant}>label</Button>);
      expect(html).toContain(`data-variant="${variant}"`);
      expect(html).toContain("label");
    },
  );

  it.each(["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const)(
    "renders %s size with data-size attribute",
    (size) => {
      const html = wrap(<Button size={size}>x</Button>);
      expect(html).toContain(`data-size="${size}"`);
    },
  );

  it("uses default variant and size when omitted", () => {
    const html = wrap(<Button>x</Button>);
    expect(html).toContain('data-variant="default"');
    expect(html).toContain('data-size="default"');
  });

  it("merges custom className with variant classes", () => {
    const html = wrap(<Button className="my-extra">x</Button>);
    expect(html).toContain("my-extra");
  });

  it("renders <button> by default and a Slot child element when asChild=true", () => {
    const buttonHtml = wrap(<Button>plain</Button>);
    expect(buttonHtml.startsWith("<button")).toBe(true);

    const slotHtml = wrap(
      <Button asChild>
        <a href="/x">link</a>
      </Button>,
    );
    expect(slotHtml.startsWith("<a")).toBe(true);
    expect(slotHtml).toContain('href="/x"');
    expect(slotHtml).toContain("link");
    expect(slotHtml).toContain('data-slot="button"');
  });

  it("forwards onClick when used as button", () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>click</Button>);
    fireEvent.click(screen.getByText("click"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respects disabled prop and prevents click handler", () => {
    const onClick = jest.fn();
    render(
      <Button disabled onClick={onClick}>
        nope
      </Button>,
    );
    const btn = screen.getByText("nope") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("buttonVariants helper", () => {
  it("returns a class string for each combination", () => {
    const cls = buttonVariants({ variant: "destructive", size: "lg" });
    expect(typeof cls).toBe("string");
    expect(cls).toContain("bg-destructive");
    expect(cls).toContain("h-10");
  });

  it("falls back to defaults when called with empty object", () => {
    const cls = buttonVariants({});
    expect(cls).toContain("bg-primary");
    expect(cls).toContain("h-9");
  });
});
