/**
 * Shared WebGPU detection helper.
 *
 * Both /lib/webllm/engine.ts and /lib/mediapipe/engine.ts had identical copies
 * of `isWebGPUAvailable`. This helper centralizes the check so future browser
 * support quirks (e.g. iOS Safari guards) can be patched in one place.
 *
 * Note: each engine still has its own `isWebGPUUsable` because the side-effect
 * contracts differ (mediapipe emits status on every branch; webllm only on
 * success). Don't try to unify those without changing the test fixtures.
 */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
