/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
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
};
