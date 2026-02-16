const STORAGE_KEY = "aegis-user-api-key";

export function getUserApiKey(): string | null {
  if (typeof globalThis.localStorage === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setUserApiKey(key: string): void {
  if (!key.startsWith("sk-ant-")) {
    throw new Error("Invalid API key format: must start with sk-ant-");
  }
  if (typeof globalThis.localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, key);
}

export function clearUserApiKey(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function maskApiKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}
