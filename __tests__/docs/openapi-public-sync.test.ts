/**
 * Drift guard: /openapi.yaml is served from public/openapi.yaml, but the
 * maintained source of truth is docs/openapi.yaml. They diverged silently for
 * three months once (public/ was frozen at 2026-04-15 while docs/ gained the
 * JPYC endpoint, x402 fields, etc.) — generated clients saw a stale contract.
 * There is no build-time sync step, so this test IS the sync enforcement:
 * `cp docs/openapi.yaml public/openapi.yaml` whenever the spec changes.
 */
import { readFileSync } from "fs";
import { join } from "path";

it("public/openapi.yaml is byte-identical to docs/openapi.yaml", () => {
  const root = join(__dirname, "..", "..");
  const docs = readFileSync(join(root, "docs", "openapi.yaml"), "utf8");
  const served = readFileSync(join(root, "public", "openapi.yaml"), "utf8");
  expect(served).toBe(docs);
});
