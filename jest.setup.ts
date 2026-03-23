// Suppress noisy console output from error-path tests.
// Individual tests can still spy on console methods to verify calls
// since jest.spyOn replaces the implementation and takes precedence.
const noop = () => {};
console.warn = noop;
console.error = noop;
console.debug = noop;

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
