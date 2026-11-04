import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  X402_BAZAAR_TRACE_GLOBS,
  X402_NEXT_ROUTES,
  x402BazaarTraceIncludes,
} from "@/lib/build/x402TraceIncludes.cjs";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURE = path.join(__dirname, "fixtures/x402-bazaar-import.mjs");

// These are Next internals: the tracer and glob Next uses for
// outputFileTracingIncludes (next/dist/build/collect-build-traces.js) and its
// app-route name normalizer. If a Next upgrade moves them, fail with a pointer
// instead of a bare MODULE_NOT_FOUND.
function nextInternal<T>(id: string): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(id) as T;
  } catch (err) {
    throw new Error(
      `${id} is not available in this Next.js version. Check how next/dist/build/collect-build-traces.js ` +
        `traces files and expands outputFileTracingIncludes, then update this guard. (${(err as Error).message})`,
    );
  }
}

type NodeFileTrace = (
  files: string[],
  opts: { base: string },
) => Promise<{ fileList: Set<string>; warnings: Set<Error> }>;
type GlobSync = (pattern: string, opts: { cwd: string; nodir: boolean; dot: boolean }) => string[];

const { nodeFileTrace } = nextInternal<{ nodeFileTrace: NodeFileTrace }>("next/dist/compiled/@vercel/nft");
const globSync = nextInternal<{ sync: GlobSync }>("next/dist/compiled/glob").sync;
const { normalizeAppPath } = nextInternal<{ normalizeAppPath: (p: string) => string }>(
  "next/dist/shared/lib/router/utils/app-paths",
);

/** Expand the globs exactly as Next does (cwd = project root, nodir, dot). */
function expandIncludes(): Set<string> {
  const files = new Set<string>();
  for (const pattern of X402_BAZAAR_TRACE_GLOBS) {
    for (const f of globSync(pattern, { cwd: ROOT, nodir: true, dot: true })) files.add(path.normalize(f));
  }
  return files;
}

// next.config.mjs does not set pageExtensions, so Next's default applies.
const ROUTE_FILE = /^route\.(tsx|ts|jsx|js)$/;

function listRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    // `_folder` is a private folder in the App Router and never becomes a route.
    if (entry.isDirectory()) return entry.name.startsWith("_") ? [] : listRouteFiles(full);
    return ROUTE_FILE.test(entry.name) ? [full] : [];
  });
}

const { config: tsconfigJson } = ts.readConfigFile(path.join(ROOT, "tsconfig.json"), ts.sys.readFile);
const { options: compilerOptions } = ts.parseJsonConfigFileContent(tsconfigJson, ts.sys, ROOT);

/**
 * Every module specifier in a file: import / export ... from (including
 * `export * as ns from`, which ts.preProcessFile skips), import = require,
 * import(), require() and import("...") types.
 */
function moduleSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (ts.isStringLiteralLike(node.moduleReference.expression)) specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        specifiers.push(node.arguments[0].text);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

const DECLARATION_FILE = /\.d\.(ts|mts|cts)$/;
const IMPLEMENTATION_EXTENSIONS: Record<string, string[]> = {
  ts: [".js", ".jsx", ".mjs", ".cjs"],
  mts: [".mjs"],
  cts: [".cjs"],
};

/** TypeScript resolves to a declaration file when one sits next to the JS; follow the JS instead. */
function runtimeFile(resolved: string): string | null {
  const match = DECLARATION_FILE.exec(resolved);
  if (!match) return resolved;
  const base = resolved.slice(0, -match[0].length);
  return IMPLEMENTATION_EXTENSIONS[match[1]].map((ext) => base + ext).find((f) => fs.existsSync(f)) ?? null;
}

// A route needs the includes when it ends up calling @x402/next, which is what
// runs the native import. Follow the route's own imports, re-exports and
// dynamic imports through the repo (tsconfig paths included) so a route that
// reaches @x402/next through a helper or another route is still caught.
// Type-only imports are followed too; over-matching only makes the list
// demand an extra route. Only static specifiers are seen: import() of a
// template with substitutions is missed, a locally shadowed `require` is
// over-matched, and when helper.jsx, helper.js and helper.d.ts sit together
// the .js is followed.
function reachesX402Next(entry: string): boolean {
  const pending = [entry];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of moduleSpecifiers(file)) {
      if (specifier === "@x402/next" || specifier.startsWith("@x402/next/")) return true;
      const resolved = ts.resolveModuleName(specifier, file, compilerOptions, ts.sys).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) continue;
      const target = runtimeFile(path.resolve(resolved.resolvedFileName));
      if (!target || !target.startsWith(ROOT + path.sep) || target.includes(`${path.sep}node_modules${path.sep}`)) continue;
      pending.push(target);
    }
  }
  return false;
}

describe("x402 bazaar output tracing includes", () => {
  it("covers every file in the native import closure of @x402/extensions/bazaar", async () => {
    const { fileList, warnings } = await nodeFileTrace([FIXTURE], { base: ROOT });
    const traced = [...fileList].filter((f) => f.startsWith("node_modules/"));

    // A dependency nft cannot resolve would be missing from the function too.
    expect([...warnings].map((w) => w.message)).toEqual([]);

    // Sanity: the bare specifier resolved through the package's exports.
    expect(traced).toEqual(
      expect.arrayContaining([
        "node_modules/@x402/extensions/package.json",
        "node_modules/@x402/extensions/dist/esm/bazaar/index.mjs",
      ]),
    );

    const included = expandIncludes();
    expect(traced.filter((f) => !included.has(path.normalize(f)))).toEqual([]);
  });

  it("has no glob that matches nothing", () => {
    for (const pattern of X402_BAZAAR_TRACE_GLOBS) {
      expect({ pattern, matches: globSync(pattern, { cwd: ROOT, nodir: true, dot: true }).length > 0 }).toEqual({
        pattern,
        matches: true,
      });
    }
  });

  it("lists exactly the app routes that reach @x402/next", () => {
    const appDir = path.join(ROOT, "app");
    const routes = listRouteFiles(appDir)
      .filter(reachesX402Next)
      .map((file) => {
        const rel = path.relative(appDir, file).split(path.sep).join("/");
        return normalizeAppPath(`/${rel.replace(/\.(tsx|ts|jsx|js)$/, "")}`);
      })
      .sort();

    expect(routes).toEqual([...X402_NEXT_ROUTES].sort());
  });

  it("applies the same globs to every route", () => {
    const includes = x402BazaarTraceIncludes();
    expect(Object.keys(includes).sort()).toEqual([...X402_NEXT_ROUTES].sort());
    for (const globs of Object.values(includes)) expect(globs).toEqual(X402_BAZAAR_TRACE_GLOBS);
  });
});
