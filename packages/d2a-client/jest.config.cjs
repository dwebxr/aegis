/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json", useESM: false }],
    "^.+\\.(m?js)$": ["babel-jest", { presets: [["@babel/preset-env", { targets: { node: "current" } }]] }],
  },
  // nostr-tools and @noble/hashes ship ESM-only — let babel-jest transform them.
  transformIgnorePatterns: ["/node_modules/(?!(nostr-tools|@noble|@scure)/)"],
  moduleNameMapper: {
    "^nostr-tools/pure$": "<rootDir>/node_modules/nostr-tools/lib/cjs/pure.js",
    "^nostr-tools/pool$": "<rootDir>/node_modules/nostr-tools/lib/cjs/pool.js",
    "^nostr-tools/nip44$": "<rootDir>/node_modules/nostr-tools/lib/cjs/nip44.js",
    "^nostr-tools/filter$": "<rootDir>/node_modules/nostr-tools/lib/cjs/filter.js",
  },
};
