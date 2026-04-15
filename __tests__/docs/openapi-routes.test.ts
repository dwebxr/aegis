/**
 * Drift guard for docs/openapi.yaml.
 *
 * Asserts symmetric equality between:
 *   - filesystem: app/api/**\/route.ts paths
 *   - YAML: components.paths keys
 *
 * Adding a route without a YAML entry (or removing a route without
 * deleting the YAML entry) fails CI.
 */

import { readFileSync } from "fs";
import { join, dirname, sep } from "path";
import { sync as globSync } from "glob";
import { load as yamlLoad } from "js-yaml";

const REPO_ROOT = join(__dirname, "..", "..");
const ROUTES_GLOB = "app/api/**/route.ts";
const YAML_PATH = join(REPO_ROOT, "docs", "openapi.yaml");

interface OpenApiDoc {
  openapi: string;
  paths: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

function discoverFsRoutes(): string[] {
  const files = globSync(ROUTES_GLOB, { cwd: REPO_ROOT, absolute: false });
  // Each path: app/api/health/route.ts → /api/health
  // Each path: app/api/d2a/briefing/changes/route.ts → /api/d2a/briefing/changes
  return files.map(f => {
    const dir = dirname(f);                          // app/api/health
    return "/" + dir.split(sep).join("/");           // /app/api/health
  }).map(p => p.replace(/^\/app/, "")).sort();       // /api/health
}

function discoverYamlPaths(): string[] {
  const raw = readFileSync(YAML_PATH, "utf8");
  const doc = yamlLoad(raw) as OpenApiDoc;
  return Object.keys(doc.paths).sort();
}

describe("docs/openapi.yaml drift guard", () => {
  it("parses as a valid OpenAPI 3.1 document", () => {
    const raw = readFileSync(YAML_PATH, "utf8");
    const doc = yamlLoad(raw) as OpenApiDoc;
    expect(doc.openapi).toMatch(/^3\.1\./);
    expect(typeof doc.paths).toBe("object");
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
  });

  it("documents every filesystem route", () => {
    const fs = discoverFsRoutes();
    const yaml = discoverYamlPaths();
    const undocumented = fs.filter(p => !yaml.includes(p));
    expect(undocumented).toEqual([]);
  });

  it("does not document any nonexistent route", () => {
    const fs = discoverFsRoutes();
    const yaml = discoverYamlPaths();
    const orphaned = yaml.filter(p => !fs.includes(p));
    expect(orphaned).toEqual([]);
  });

  it("declares the three Aegis security schemes", () => {
    const raw = readFileSync(YAML_PATH, "utf8");
    const doc = yamlLoad(raw) as OpenApiDoc;
    const schemes = Object.keys(doc.components?.securitySchemes ?? {});
    expect(schemes).toEqual(expect.arrayContaining(["byokApiKey", "pushToken", "x402"]));
  });

  it("declares core reusable schemas", () => {
    const raw = readFileSync(YAML_PATH, "utf8");
    const doc = yamlLoad(raw) as OpenApiDoc;
    const schemas = Object.keys(doc.components?.schemas ?? {});
    expect(schemas).toEqual(
      expect.arrayContaining([
        "Verdict",
        "ScoreBreakdown",
        "AnalyzeResponse",
        "D2ABriefingResponse",
        "ErrorResponse",
      ]),
    );
  });
});
