/**
 * Drift guard for public/openapi.json, the x402 discovery document x402scan reads
 * from the origin. Unlike public/openapi.yaml it is not a copy of docs/openapi.yaml:
 * it lists only the paid route published for discovery and adds x-payment-info, so
 * these tests tie it to the route code as well as to the YAML.
 *
 * The USDC price lives in the OpenPay catalog and is read at runtime, so no test
 * can see the live value. The closest number in the repo is the rail's default
 * ceiling, which is raised when the listing price changes; pinning the document to
 * it makes that change fail here. A price cut needs a manual update.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { load as yamlLoad } from "js-yaml";

const REPO_ROOT = join(__dirname, "..", "..");
const PAID_PATH = "/api/d2a/briefing-jpyc";
const USDC_ATOMIC_PER_USD = 1_000_000;

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: unknown;
}

interface Operation {
  operationId: string;
  summary: string;
  parameters: Parameter[];
  responses: Record<string, {
    description: string;
    content?: Record<string, { schema?: unknown }>;
  }>;
  "x-payment-info": { price: { amount: string } };
}

interface OpenApiDoc {
  openapi: string;
  info: Record<string, unknown>;
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
}

function read(...segments: string[]): string {
  return readFileSync(join(REPO_ROOT, ...segments), "utf8");
}

const doc = JSON.parse(read("public", "openapi.json")) as OpenApiDoc;
const operation = doc.paths[PAID_PATH].get;

function collectRefs(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === "$ref" && typeof value === "string" ? [value] : collectRefs(value),
  );
}

describe("public/openapi.json", () => {
  it("has the top-level fields x402scan requires", () => {
    expect(doc.openapi).toBe("3.1.0");
    for (const field of ["title", "version", "description", "x-guidance"]) {
      expect(doc.info[field]).toEqual(expect.any(String));
      expect(doc.info[field]).not.toBe("");
    }
    expect(doc.servers).toEqual([{ url: "https://aegis-ai.xyz" }]);
  });

  it("publishes no contact email", () => {
    expect(doc.info).not.toHaveProperty("contact");
    expect(JSON.stringify(doc)).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });

  it("lists only the GET operation of the paid route, and the route exports GET", () => {
    expect(Object.keys(doc.paths)).toEqual([PAID_PATH]);
    expect(Object.keys(doc.paths[PAID_PATH])).toEqual(["get"]);
    expect(read("app", PAID_PATH, "route.ts")).toMatch(/export\s+const\s+GET\b/);
  });

  it("declares a fixed USD price over x402", () => {
    expect(operation["x-payment-info"]).toEqual({
      price: { mode: "fixed", currency: "USD", amount: "0.006" },
      protocols: [{ x402: {} }],
    });
  });

  it("keeps the price in step with the USDC rail's default ceiling", () => {
    const source = read("lib", "d2a", "openpayUsdc.ts");
    const ceiling = source.match(/OPENPAY_USDC_MAX_AMOUNT\?\.trim\(\) \|\| "(\d+)"/)?.[1];
    expect(ceiling).toBeDefined();
    const atomic = Number(operation["x-payment-info"].price.amount) * USDC_ATOMIC_PER_USD;
    expect(Math.round(atomic)).toBe(Number(ceiling));
  });

  it("documents every query parameter the handler reads, except preview", () => {
    // preview only works under X402_FREE_TIER_ENABLED, which is off in production,
    // where the parameter is ignored and the caller still gets the 402.
    const handled = new Set([
      read("lib", "d2a", "briefingHandler.ts"),
      read("lib", "d2a", "filterItems.ts"),
    ].flatMap(source => Array.from(source.matchAll(/searchParams\.get\("(\w+)"\)/g), m => m[1])));
    expect(handled).toContain("preview");
    handled.delete("preview");

    expect(operation.parameters.map(p => p.name).sort()).toEqual(Array.from(handled).sort());
    for (const parameter of operation.parameters) {
      expect(parameter.in).toBe("query");
      expect(parameter.required).toBe(false);
      expect(parameter.schema).toBeDefined();
    }
  });

  it("agrees with docs/openapi.yaml on the operation and its parameters", () => {
    const yaml = yamlLoad(read("docs", "openapi.yaml")) as OpenApiDoc;
    const documented = yaml.paths[PAID_PATH].get;
    expect(operation.operationId).toBe(documented.operationId);
    expect(operation.parameters.map(p => p.name).sort()).toEqual(
      documented.parameters.map(p => p.name).filter(name => name !== "preview").sort(),
    );
  });

  it("describes the 200 body and the 402 challenge", () => {
    expect(operation.responses["200"].content?.["application/json"].schema).toBeDefined();
    expect(operation.responses["402"].content?.["application/json"].schema).toBeDefined();
  });

  it("resolves every $ref", () => {
    const refs = collectRefs(doc);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      expect(doc.components.schemas).toHaveProperty(ref.split("/").pop() as string);
    }
  });
});
