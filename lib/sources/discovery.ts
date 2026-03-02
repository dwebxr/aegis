/**
 * Source auto-discovery: track validated domains and suggest RSS feeds.
 * localStorage-based. Suggests domains with >= THRESHOLD validated items.
 */

const STORAGE_KEY = "aegis-domain-validations";
const THRESHOLD = 3;

export interface DomainValidation {
  domain: string;
  count: number;
  lastValidatedAt: number;
  feedUrl?: string;
  dismissed: boolean;
}

function normalizeDomain(hostname: string): string {
  return hostname.replace(/^www\./, "").toLowerCase();
}

function extractDomain(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    if (!url.hostname || url.protocol === "javascript:") return null;
    return normalizeDomain(url.hostname);
  } catch {
    return null;
  }
}

function loadDomainValidations(): Record<string, DomainValidation> {
  if (typeof globalThis.localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, DomainValidation>;
  } catch (err) {
    console.warn("[discovery] Corrupted domain validation data:", err);
    return {};
  }
}

function saveDomainValidations(data: Record<string, DomainValidation>): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("[discovery] Failed to save domain validations:", err);
  }
}

export function trackDomainValidation(sourceUrl?: string): void {
  if (!sourceUrl) return;
  const domain = extractDomain(sourceUrl);
  if (!domain) return;

  const data = loadDomainValidations();
  const existing = data[domain] || { domain, count: 0, lastValidatedAt: 0, dismissed: false };
  existing.count++;
  existing.lastValidatedAt = Date.now();
  data[domain] = existing;
  saveDomainValidations(data);
}

/** Get domains that meet the suggestion threshold, excluding dismissed and already-subscribed. */
export function getSuggestions(existingFeedUrls: string[]): DomainValidation[] {
  const data = loadDomainValidations();
  const existingDomains = new Set(
    existingFeedUrls
      .map(url => extractDomain(url))
      .filter((d): d is string => d !== null),
  );

  return Object.values(data).filter(d =>
    d.count >= THRESHOLD &&
    !d.dismissed &&
    !existingDomains.has(d.domain),
  );
}

export function dismissSuggestion(domain: string): void {
  const data = loadDomainValidations();
  if (data[domain]) {
    data[domain].dismissed = true;
    saveDomainValidations(data);
  }
}

export async function discoverFeed(domain: string): Promise<string | null> {
  try {
    const resp = await fetch("/api/fetch/discover-feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://${domain}` }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const feedUrl = data.feeds?.[0]?.url;
    if (feedUrl && typeof feedUrl === "string") {
      const validations = loadDomainValidations();
      if (validations[domain]) {
        validations[domain].feedUrl = feedUrl;
        saveDomainValidations(validations);
      }
      return feedUrl;
    }
    return null;
  } catch (err) {
    console.warn("[discovery] Feed discovery failed for", domain, err);
    return null;
  }
}
