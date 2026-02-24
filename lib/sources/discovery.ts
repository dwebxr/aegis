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
  } catch {
    return {};
  }
}

function saveDomainValidations(data: Record<string, DomainValidation>): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // QuotaExceededError
  }
}

/** Track a validated item's source URL domain. */
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
    existingFeedUrls.map(url => {
      try { return normalizeDomain(new URL(url).hostname); }
      catch { return ""; }
    }).filter(Boolean),
  );

  return Object.values(data).filter(d =>
    d.count >= THRESHOLD &&
    !d.dismissed &&
    !existingDomains.has(d.domain),
  );
}

/** Dismiss a domain suggestion permanently. */
export function dismissSuggestion(domain: string): void {
  const data = loadDomainValidations();
  if (data[domain]) {
    data[domain].dismissed = true;
    saveDomainValidations(data);
  }
}

/** Attempt to discover an RSS feed for a domain via the API endpoint. */
export async function discoverFeed(domain: string): Promise<string | null> {
  try {
    const resp = await fetch(`/api/fetch/discover-feed?url=${encodeURIComponent(`https://${domain}`)}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.feedUrl && typeof data.feedUrl === "string") {
      // Cache the discovered feed URL
      const validations = loadDomainValidations();
      if (validations[domain]) {
        validations[domain].feedUrl = data.feedUrl;
        saveDomainValidations(validations);
      }
      return data.feedUrl;
    }
    return null;
  } catch {
    return null;
  }
}
