import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const script = pathToFileURL(join(root, "scripts/copy-mediapipe-wasm.mjs")).href;
const installedVersion = JSON.parse(readFileSync(join(root, "node_modules/@mediapipe/tasks-genai/package.json"), "utf8")).version;
const files = ["genai_wasm_internal.js", "genai_wasm_internal.wasm", "genai_wasm_nosimd_internal.js", "genai_wasm_nosimd_internal.wasm"];
const copy = "const { copyMediaPipeWasm } = await import(process.argv[1]); copyMediaPipeWasm(process.argv[2]);";

it("targets the installed version using the copy script's exported helper", () => {
  const target = execFileSync(process.execPath, ["--input-type=module", "-e",
    "const { getWasmTargetDir } = await import(process.argv[1]); console.log(getWasmTargetDir(process.argv[2], process.argv[3]));",
    script, root, installedVersion], { encoding: "utf8" }).trim();
  expect(target).toBe(join(root, `public/vendor/mediapipe/tasks-genai@${installedVersion}/wasm`));
});

it("copies only the four loader files, removes old versions, is idempotent, and fails on missing source", () => {
  const fixture = mkdtempSync(join(root, ".mediapipe-wasm-test-"));
  try {
    const pkg = join(fixture, "node_modules/@mediapipe/tasks-genai");
    mkdirSync(join(pkg, "wasm"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ version: installedVersion }));
    for (const file of [...files, "genai_wasm_module_internal.js"]) writeFileSync(join(pkg, "wasm", file), file);
    const vendor = join(fixture, "public/vendor/mediapipe");
    mkdirSync(join(vendor, "tasks-genai@0.1.0/wasm"), { recursive: true });
    for (let i = 0; i < 2; i++) {
      execFileSync(process.execPath, ["--input-type=module", "-e", copy, script, fixture]);
      expect(readdirSync(vendor)).toEqual([`tasks-genai@${installedVersion}`]);
      const target = join(vendor, `tasks-genai@${installedVersion}/wasm`);
      expect(readdirSync(target).sort()).toEqual([...files].sort());
      for (const file of files) expect(readFileSync(join(target, file), "utf8")).toBe(file);
    }
    rmSync(join(pkg, "wasm", files[0]));
    const failed = spawnSync(process.execPath, ["--input-type=module", "-e", copy, script, fixture], { encoding: "utf8" });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(`Missing MediaPipe wasm source: ${files[0]}`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
