import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // nostr-tools is a peer dep — never bundle it.
  external: ["nostr-tools"],
  target: "es2022",
});
