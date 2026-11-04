/**
 * Files Next's output tracing misses for the @x402/next paid routes.
 *
 * @x402/next 2.17.0 (`dist/esm/index.js:324-352`, `withX402FromHTTPServer`)
 * runs `import(/* webpackIgnore: true *\/ "@x402/extensions/bazaar")` on the
 * first paid request of each instance, to call `validateBazaarRouteExtensions`.
 * Because of `webpackIgnore`, that is a native Node import from
 * `.next/server/chunks/`. It is not in webpack's module graph, so Next does not
 * trace it, and on Vercel it failed on every cold start with
 * `Failed to load bazaar extension: ... ERR_MODULE_NOT_FOUND`. The 402 itself
 * was never affected: lib/d2a/x402Server.ts registers the bazaar extension on
 * the bundled resource server, so this import only runs the validator.
 *
 * The globs cover the native ESM closure of `@x402/extensions/bazaar`. The
 * bundled payment code is unchanged; this only adds files to the functions.
 * The validator loads its own copy of @x402/core. It only uses pure functions
 * from it and does not touch the bundled payment code.
 *
 * __tests__/build/x402TraceIncludes.test.ts traces that closure with Next's
 * nft and fails if a file falls outside these globs. Run it after any @x402
 * bump. The trace follows both the `import` and `require` conditions, so the
 * `.cjs` entries are required by the test even though the native import only
 * loads the ESM side.
 *
 * Next matches these keys with `picomatch(key, { contains: true })`, so
 * "/api/d2a/briefing" also matches /api/d2a/briefing/changes and
 * /api/d2a/briefing-jpyc. That is harmless: the jpyc function just carries
 * about 1 MB (191 files) of unused files.
 */

/** Routes that create a paid handler with @x402/next. */
const X402_NEXT_ROUTES = ["/api/d2a/briefing", "/api/d2a/briefing/changes", "/api/d2a/score"];

/** Relative to the project root, which is where Next expands them. */
const X402_BAZAAR_TRACE_GLOBS = [
  "./node_modules/@x402/extensions/package.json",
  "./node_modules/@x402/extensions/dist/esm/**/*.mjs",
  "./node_modules/@x402/core/package.json",
  "./node_modules/@x402/core/dist/esm/**/*.mjs",
  "./node_modules/@x402/core/node_modules/zod/{package.json,index.js,index.cjs,v3/**/*.{js,cjs}}",
  "./node_modules/ajv/package.json",
  "./node_modules/ajv/dist/**/*.{js,json}",
  "./node_modules/fast-deep-equal/{package.json,index.js}",
  "./node_modules/fast-uri/{package.json,index.js,lib/**/*.js}",
  "./node_modules/json-schema-traverse/{package.json,index.js}",
];

/** @returns {Record<string, string[]>} value for next.config `outputFileTracingIncludes` */
function x402BazaarTraceIncludes() {
  return Object.fromEntries(X402_NEXT_ROUTES.map((route) => [route, [...X402_BAZAAR_TRACE_GLOBS]]));
}

module.exports = { X402_NEXT_ROUTES, X402_BAZAAR_TRACE_GLOBS, x402BazaarTraceIncludes };
