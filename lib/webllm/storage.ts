const STORAGE_KEY = "aegis-webllm-enabled";

export function isWebLLMEnabled(): boolean {
  if (typeof globalThis.localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setWebLLMEnabled(enabled: boolean): void {
  if (typeof globalThis.localStorage === "undefined") return;
  if (enabled) {
    localStorage.setItem(STORAGE_KEY, "true");
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
