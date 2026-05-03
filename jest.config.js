/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.[jt]sx?$": ["ts-jest", {
      tsconfig: {
        module: "commonjs",
        moduleResolution: "node",
        jsx: "react-jsx",
        esModuleInterop: true,
        allowJs: true,
        strict: true,
        paths: { "@/*": ["./*"] },
      },
    }],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(@noble|nostr-tools|@scure|uuid|@extractus)/)",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/.claude/", "/.next/", "/e2e/"],
  collectCoverageFrom: [
    "lib/**/*.{ts,tsx}",
    "app/**/*.{ts,tsx}",
    "contexts/**/*.{ts,tsx}",
    "hooks/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "!**/*.d.ts",
    "!lib/ic/declarations/**",
    "!**/node_modules/**",
  ],
  // Thresholds set ~2 points below current measured coverage so routine
  // variance doesn't break CI but a real regression does. Globals are
  // pulled down by UI (components, app/page.tsx) which is e2e-tested in
  // Playwright rather than jest; `./lib/` is held to a stricter bar
  // because that's the business-logic core where regressions hurt most.
  coverageThreshold: {
    global: {
      statements: 73,
      branches: 67,
      functions: 66,
      lines: 75,
    },
    "./lib/": {
      statements: 90,
      branches: 80,
      functions: 88,
      lines: 92,
    },
  },
  forceExit: true,
};
