// Suppress noisy console output from error-path tests.
// Individual tests can still spy on console methods to verify calls
// since jest.spyOn replaces the implementation and takes precedence.
const noop = () => {};
console.warn = noop;
console.error = noop;
console.debug = noop;

// server-only throws when imported outside an RSC/server context; in jest we
// exercise the same files from a node-like environment where that guard is a
// false positive. Stub it to a no-op.
jest.mock("server-only", () => ({}));

// Default-mock DNS resolution. safeFetch's SSRF preflight (preCheckHost) calls
// node:dns/promises.lookup on the target host; with the real resolver, fetch
// suites that exercise routes (discover-feed, ogimage, rss, ...) do real DNS and
// become slow + flaky under CI load (the discover-feed rate-limit test timed out
// at 5s; the suite ran 15s). Resolve any host to a public IP so the preflight
// passes instantly and the mocked fetch takes over — no real network. Suites that
// assert specific DNS behaviour (safeFetch-dns, fetch-url-ssrf) declare their own
// jest.mock("node:dns/promises", ...), which overrides this default per file.
jest.mock("node:dns/promises", () => ({
  __esModule: true,
  lookup: jest.fn(async (_hostname: string, opts?: { all?: boolean }) => {
    const record = { address: "8.8.8.8", family: 4 };
    return opts && opts.all ? [record] : record;
  }),
}));

// Mock our Tooltip wrapper so tests don't need TooltipProvider.
// Tooltip content renders as hidden span (preserves aria-label testing).
jest.mock("@/components/ui/tooltip", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const Fragment = React.Fragment;
  return {
    __esModule: true,
    TooltipProvider: ({ children }: { children?: React.ReactNode }) => React.createElement(Fragment, null, children),
    Tooltip: ({ children }: { children?: React.ReactNode }) => React.createElement(Fragment, null, children),
    TooltipTrigger: ({ children, asChild }: { children?: React.ReactNode; asChild?: boolean }) =>
      asChild ? React.createElement(Fragment, null, children) : React.createElement("span", null, children),
    TooltipContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("span", { "data-slot": "tooltip-content", style: { display: "none" } }, children),
  };
});
