const STORAGE_KEY = "aegis-user-api-key";

export function getUserApiKey(): string | null {
  if (typeof globalThis.localStorage === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn("[apiKey] localStorage read failed:", err);
    return null;
  }
}

export function setUserApiKey(key: string): boolean {
  if (!key.startsWith("sk-ant-")) {
    throw new Error("Invalid API key format: must start with sk-ant-");
  }
  if (typeof globalThis.localStorage === "undefined") return false;
  try {
    localStorage.setItem(STORAGE_KEY, key);
    return true;
  } catch (err) {
    console.warn("[apiKey] Failed to save key (quota?):", err);
    return false;
  }
}

export function clearUserApiKey(): boolean {
  if (typeof globalThis.localStorage === "undefined") return false;
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (err) {
    console.warn("[apiKey] Failed to clear key:", err);
    return false;
  }
}

export function maskApiKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}
