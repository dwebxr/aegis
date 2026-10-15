import { evaluate } from "@/scripts/audit-guard-lib.cjs";
import clean from "./fixtures/audit-guard/clean.json";
import braces from "./fixtures/audit-guard/braces-chain.json";
import otherHigh from "./fixtures/audit-guard/other-high.json";
import mixedRoots from "./fixtures/audit-guard/jest-mixed-roots.json";
import allowlist from "@/scripts/audit-allowlist.json";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const input = () => ({ full: braces, prod: clean, allowlist, today: "2026-10-15" });
const finding = (via: unknown[]) => ({ severity: "high", via });

describe("audit guard advisory policy", () => {
  it("fails every production high, even the allowlisted GHSA", () => {
    const result = evaluate({ ...input(), prod: braces });
    expect(result.exitCode).toBe(1);
    expect(result.failures.join("\n")).toMatch(/production findings cannot be allowlisted/);
  });

  it("accepts the dev-only chain with GHSA and expiry warnings", () => {
    const result = evaluate(input());
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.join("\n")).toMatch(/fast-glob via braces GHSA-vfj7-8cjw-p6xm until 2026-12-31/);
  });

  it("accepts a package reaching allowlisted high braces and unlisted moderate sprintf-js", () => {
    const result = evaluate({ ...input(), full: mixedRoots });
    expect(result).toMatchObject({ status: "pass", exitCode: 0, failures: [] });
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.join("\n")).toMatch(/accepted jest via braces GHSA-vfj7-8cjw-p6xm until 2026-12-31/);
    expect(result.warnings.join("\n")).not.toMatch(/sprintf-js/);
    expect(result.summaries?.full.moderate).toBe(2);
  });

  it.each(["high", "critical"])("rejects a package also reaching an unlisted %s root", severity => {
    const full = { vulnerabilities: {
      ...structuredClone(mixedRoots.vulnerabilities),
      ...structuredClone(otherHigh.vulnerabilities),
    } };
    full.vulnerabilities.axios.severity = severity;
    full.vulnerabilities.axios.via[0].severity = severity;
    full.vulnerabilities.jest.via.push("axios");
    const result = evaluate({ ...input(), full });
    expect(result.exitCode).toBe(1);
    expect(result.failures.join("\n")).toMatch(/full: jest: GHSA-44g4-m2mj-wpvx \(axios\) is not allowlisted/);
    expect(result.warnings.join("\n")).not.toMatch(/accepted jest /);
  });

  it("rejects unexplained high severity when a package has only moderate roots", () => {
    const full = structuredClone(mixedRoots);
    full.vulnerabilities.jest.via = ["argparse"];
    const result = evaluate({ ...input(), full });
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(["full: jest: unexplained severity: empty high/critical root advisory set"]);
  });

  it("includes the expiry day, but fails explicitly after it", () => {
    expect(evaluate({ ...input(), today: "2026-12-31" }).exitCode).toBe(0);
    const result = evaluate({ ...input(), today: "2027-01-01" });
    expect(result.exitCode).toBe(1);
    expect(result.failures.join("\n")).toMatch(/expired 2026-12-31/);
  });

  it("rejects non-allowlisted dev high and critical findings", () => {
    for (const severity of ["high", "critical"]) {
      const full = structuredClone(otherHigh);
      full.vulnerabilities.axios.severity = severity;
      expect(evaluate({ ...input(), full }).exitCode).toBe(1);
    }
  });

  it("resolves cycles with an advisory root without recursion overflow", () => {
    const full = structuredClone(braces);
    full.vulnerabilities.braces.via.push("fast-glob" as never);
    expect(evaluate({ ...input(), full }).exitCode).toBe(0);
  });

  it("rejects cycles without an advisory root", () => {
    const full = { vulnerabilities: { a: finding(["b"]), b: finding(["a"]) } };
    const result = evaluate({ ...input(), full });
    expect(result.exitCode).toBe(1);
    expect(result.failures.join("\n")).toMatch(/unexplained severity: empty high\/critical root advisory set/);
  });

  it("rejects missing references even alongside an allowed advisory", () => {
    const full = structuredClone(braces);
    full.vulnerabilities.micromatch.via.push("missing");
    const result = evaluate({ ...input(), full });
    expect(result.exitCode).toBe(1);
    expect(result.failures.join("\n")).toMatch(/missing referenced package missing/);
  });

  it("rejects an empty root set", () => {
    expect(evaluate({ ...input(), full: { vulnerabilities: { empty: finding([]) } } }).exitCode).toBe(1);
  });

  it("requires the advisory name and allowlist package to match", () => {
    const full = structuredClone(braces);
    full.vulnerabilities.braces.via[0].name = "other-package";
    expect(evaluate({ ...input(), full }).exitCode).toBe(1);
  });

  it.each(["moderate", "low", "info"])("ignores unlisted %s roots alongside an allowlisted high root", severity => {
    const full = structuredClone(braces);
    full.vulnerabilities.braces.via.push({ ...otherHigh.vulnerabilities.axios.via[0], severity, title: "Another advisory" });
    expect(evaluate({ ...input(), full }).exitCode).toBe(0);
  });

  it("does not match a GHSA embedded in an unrelated URL", () => {
    const full = structuredClone(braces);
    full.vulnerabilities.braces.via[0].url = "https://example.com/GHSA-vfj7-8cjw-p6xm";
    expect(evaluate({ ...input(), full }).exitCode).toBe(1);
  });

  it.each(["", " ", "not JSON", "{", JSON.stringify({ error: { code: "ENOTFOUND" } }),
    JSON.stringify({ error: {}, vulnerabilities: {} }), "{}", "null", "[]",
    JSON.stringify({ vulnerabilities: [] }), JSON.stringify({ vulnerabilities: { bad: {} } }),
  ])("cannot audit invalid output %p in either tree", bad => {
    for (const tree of ["full", "prod"]) {
      expect(evaluate({ ...input(), [tree]: bad })).toMatchObject({ status: "cannot-audit", exitCode: 2 });
    }
  });

  it("cannot audit an invalid allowlist or calendar date", () => {
    expect(evaluate({ ...input(), allowlist: {} }).exitCode).toBe(2);
    expect(evaluate({ ...input(), today: "2026-02-31" }).exitCode).toBe(2);
    expect(evaluate({ ...input(), allowlist: [{ ...allowlist[0], expires: "later" }] }).exitCode).toBe(2);
  });

  it("passes an empty valid report and reports moderate/low counts", () => {
    expect(evaluate({ ...input(), full: clean }).exitCode).toBe(0);
    const result = evaluate({ ...input(), prod: { vulnerabilities: { minor: { severity: "moderate", via: [] } } } });
    expect(result.exitCode).toBe(0);
    expect(result.summaries?.prod.moderate).toBe(1);
  });
});

describe("audit guard shell exit codes (fake npm, no network)", () => {
  it.each([
    [1, JSON.stringify(clean), 0],
    [1, JSON.stringify(otherHigh), 1],
    [1, '{"error":{"code":"ENOTFOUND"}}', 2],
    [2, JSON.stringify(clean), 2],
  ])("preserves shell exit-code policy (case %#)", (npmStatus, output, expected) => {
    const dir = mkdtempSync(join(tmpdir(), "aegis-audit-test-"));
    try {
      writeFileSync(join(dir, "report.json"), output);
      writeFileSync(join(dir, "npm"), `#!/bin/sh\ncat "$AUDIT_FIXTURE"\nexit ${npmStatus}\n`, { mode: 0o755 });
      const result = spawnSync("bash", ["scripts/audit-guard.sh"], {
        cwd: process.cwd(), encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, AUDIT_FIXTURE: join(dir, "report.json") },
      });
      expect({ code: result.status, error: result.error }).toEqual({ code: expected, error: undefined });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
