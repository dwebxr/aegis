/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialIcon } from "@/components/icons";
import { SOCIAL_LINKS } from "@/lib/config";

describe("SocialIcon", () => {
  it("every SOCIAL_LINKS key renders an actual icon (not null)", () => {
    for (const link of SOCIAL_LINKS) {
      const html = renderToStaticMarkup(<SocialIcon name={link.key} s={20} />);
      expect(html).toContain("<svg");
    }
  });

  it("passes size prop through to SVG", () => {
    const html = renderToStaticMarkup(<SocialIcon name="discord" s={14} />);
    expect(html).toContain('width="14"');
    expect(html).toContain('height="14"');
  });

  it("renders nothing for unknown name", () => {
    const html = renderToStaticMarkup(<SocialIcon name="unknown" s={20} />);
    expect(html).toBe("");
  });
});
