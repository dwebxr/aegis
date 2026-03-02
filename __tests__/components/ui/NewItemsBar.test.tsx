import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewItemsBar } from "@/components/ui/NewItemsBar";

describe("NewItemsBar", () => {
  it("returns null when count is 0", () => {
    const html = renderToStaticMarkup(<NewItemsBar count={0} onFlush={jest.fn()} />);
    expect(html).toBe("");
  });

  it("renders singular 'article' for count=1", () => {
    const html = renderToStaticMarkup(<NewItemsBar count={1} onFlush={jest.fn()} />);
    expect(html).toContain("1 new article");
    expect(html).not.toContain("articles");
    expect(html).toContain("tap to show");
  });

  it("renders plural 'articles' for count > 1", () => {
    const html = renderToStaticMarkup(<NewItemsBar count={5} onFlush={jest.fn()} />);
    expect(html).toContain("5 new articles");
    expect(html).toContain("tap to show");
  });

  it("renders as a button with data-testid", () => {
    const html = renderToStaticMarkup(<NewItemsBar count={3} onFlush={jest.fn()} />);
    expect(html).toContain('data-testid="new-items-bar"');
    expect(html).toContain("<button");
  });

  it("renders correct text for large count", () => {
    const html = renderToStaticMarkup(<NewItemsBar count={100} onFlush={jest.fn()} />);
    expect(html).toContain("100 new articles");
  });

  it("applies animation style", () => {
    const html = renderToStaticMarkup(<NewItemsBar count={2} onFlush={jest.fn()} />);
    expect(html).toContain("slideDown");
  });
});
