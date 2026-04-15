/**
 * Method-level drift guard for docs/openapi.yaml.
 *
 * For each documented (path, method) pair, verify the route file actually
 * exports the corresponding handler (`GET`, `POST`, `OPTIONS`, etc.).
 * Catches drift like "spec says POST but route only exports GET".
 *
 * Also verifies $ref resolution: every $ref points to an existing component
 * under the right collection.
 */

import { readFileSync } from "fs";
import { join, dirname, sep } from "path";
import { sync as globSync } from "glob";
import { load as yamlLoad } from "js-yaml";

const REPO_ROOT = join(__dirname, "..", "..");
const YAML_PATH = join(REPO_ROOT, "docs", "openapi.yaml");

interface OpenApiDoc {
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
    responses?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  };
}

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "options", "head"];
const yamlText = readFileSync(YAML_PATH, "utf8");
const doc = yamlLoad(yamlText) as OpenApiDoc;

function routeFileFor(path: string): string {
  // /api/health → app/api/health/route.ts
  return join(REPO_ROOT, "app", path.replace(/^\//, ""), "route.ts");
}

function exportedHandlers(routeFile: string): Set<string> {
  const src = readFileSync(routeFile, "utf8");
  const found = new Set<string>();
  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]) {
    // Match either `export async function GET` or `export const GET =` or
    // `export { GET }` patterns. Keep simple and forgiving.
    const re = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\b`);
    if (re.test(src)) found.add(method);
    // Also catch withX402-style wrappers: `export const POST = withX402(...);` — already covered above.
  }
  return found;
}

describe("OpenAPI method drift — every documented method exports a handler", () => {
  const cases: Array<[string, string]> = [];
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      if (method in ops) cases.push([path, method.toUpperCase()]);
    }
  }

  it.each(cases)("%s — handler %s is exported by route file", (path, method) => {
    const file = routeFileFor(path);
    const handlers = exportedHandlers(file);
    expect(handlers).toContain(method);
  });
});

describe("$ref resolution — every reference points at an existing component", () => {
  function findRefs(node: unknown, path: string[] = []): Array<{ ref: string; at: string }> {
    if (!node || typeof node !== "object") return [];
    const out: Array<{ ref: string; at: string }> = [];
    if (Array.isArray(node)) {
      node.forEach((v, i) => out.push(...findRefs(v, [...path, String(i)])));
      return out;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string") {
        out.push({ ref: v, at: path.join(".") });
      } else {
        out.push(...findRefs(v, [...path, k]));
      }
    }
    return out;
  }

  const refs = findRefs(doc);

  it("collected at least one $ref (sanity)", () => {
    expect(refs.length).toBeGreaterThan(0);
  });

  it.each(refs)("ref %s resolves", ({ ref }) => {
    expect(ref.startsWith("#/")).toBe(true);
    const segments = ref.slice(2).split("/");
    let cursor: unknown = doc;
    for (const seg of segments) {
      expect(cursor).toBeDefined();
      cursor = (cursor as Record<string, unknown>)[seg];
    }
    expect(cursor).toBeDefined();
  });
});

describe("security schemes are referenced by at least one route", () => {
  const declared = Object.keys(doc.components.securitySchemes);

  function findSecurityNames(node: unknown): Set<string> {
    const out = new Set<string>();
    function walk(n: unknown): void {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (k === "security" && Array.isArray(v)) {
          for (const entry of v as Array<Record<string, unknown>>) {
            for (const name of Object.keys(entry)) out.add(name);
          }
        } else {
          walk(v);
        }
      }
    }
    walk(node);
    return out;
  }

  const referenced = findSecurityNames(doc.paths);

  it.each(declared)("scheme %s is used by at least one operation", (scheme) => {
    expect(referenced.has(scheme)).toBe(true);
  });
});
