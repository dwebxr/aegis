const DISCOVERY_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const PAGE_LIMIT = 1000;

const TARGETS = [
  "https://aegis-ai.xyz/api/d2a/score",
  "https://aegis-ai.xyz/api/d2a/briefing",
  "https://aegis-ai.xyz/api/d2a/briefing/changes",
] as const;

interface DiscoveryItem {
  resource: string;
}

interface DiscoveryResponse {
  items: DiscoveryItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

function isDiscoveryResponse(value: unknown): value is DiscoveryResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DiscoveryResponse>;
  return Array.isArray(candidate.items)
    && candidate.items.every((item) =>
      !!item && typeof item === "object" && typeof item.resource === "string")
    && !!candidate.pagination
    && typeof candidate.pagination.limit === "number"
    && typeof candidate.pagination.offset === "number"
    && typeof candidate.pagination.total === "number";
}

function endpointIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    const pathname = url.pathname.length > 1
      ? url.pathname.replace(/\/$/, "")
      : url.pathname;
    return `${url.protocol}//${url.host.toLowerCase()}${pathname}`;
  } catch {
    return null;
  }
}

export async function fetchBazaarResources(
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveryItem[]> {
  const items: DiscoveryItem[] = [];
  let offset = 0;

  for (;;) {
    const url = new URL(DISCOVERY_URL);
    url.searchParams.set("type", "http");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));

    const response = await fetchImpl(url, {
      headers: { "User-Agent": "aegis-bazaar-check/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`CDP discovery request failed: HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isDiscoveryResponse(payload)) {
      throw new Error("CDP discovery response has an unexpected shape");
    }

    items.push(...payload.items);
    const nextOffset = payload.pagination.offset + payload.pagination.limit;
    if (payload.items.length === 0 || nextOffset >= payload.pagination.total) break;
    if (nextOffset <= offset) {
      throw new Error("CDP discovery pagination did not advance");
    }
    offset = nextOffset;
  }

  return items;
}

export interface BazaarCheckResult {
  target: typeof TARGETS[number];
  listed: boolean;
  resource?: string;
}

export async function checkBazaarListings(
  fetchImpl: typeof fetch = fetch,
): Promise<BazaarCheckResult[]> {
  const resources = await fetchBazaarResources(fetchImpl);
  return TARGETS.map((target) => {
    const identity = endpointIdentity(target);
    const match = resources.find((item) => endpointIdentity(item.resource) === identity);
    return {
      target,
      listed: match !== undefined,
      ...(match ? { resource: match.resource } : {}),
    };
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--strict");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown.join(", ")}`);
  }

  const strict = args.includes("--strict");
  const results = await checkBazaarListings();
  for (const result of results) {
    console.log(`${result.target}: ${result.listed ? "listed" : "not-listed"}`);
  }
  if (strict && results.some((result) => !result.listed)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
