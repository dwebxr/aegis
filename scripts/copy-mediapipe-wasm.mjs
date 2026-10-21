import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function getWasmTargetDir(root, version) {
  return join(root, "public/vendor/mediapipe", `tasks-genai@${version}`, "wasm");
}

export function copyMediaPipeWasm(root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const packageDir = join(root, "node_modules/@mediapipe/tasks-genai");
  const { version } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  // forGenAiTasks(basePath, false) selects the SIMD or non-SIMD pair.
  const files = [
    "genai_wasm_internal.js",
    "genai_wasm_internal.wasm",
    "genai_wasm_nosimd_internal.js",
    "genai_wasm_nosimd_internal.wasm",
  ];
  for (const file of files) {
    if (!existsSync(join(packageDir, "wasm", file))) {
      throw new Error(`Missing MediaPipe wasm source: ${file}`);
    }
  }

  const target = getWasmTargetDir(root, version);
  const vendorDir = dirname(dirname(target));
  mkdirSync(vendorDir, { recursive: true });
  for (const entry of readdirSync(vendorDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("tasks-genai@") && entry.name !== `tasks-genai@${version}`) {
      rmSync(join(vendorDir, entry.name), { recursive: true, force: true });
    }
  }
  mkdirSync(target, { recursive: true });
  for (const file of files) copyFileSync(join(packageDir, "wasm", file), join(target, file));
  console.log(`Copied ${files.length} MediaPipe wasm files to ${target}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    copyMediaPipeWasm();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}
