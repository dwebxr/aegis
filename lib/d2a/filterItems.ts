import { createHash } from "crypto";
import type { D2ABriefingItem, D2ABriefingResponse } from "./types";

interface BriefingFilterParams {
  since?: string;
  limit: number;
  offset: number;
  topics?: string[];
}

interface PaginatedBriefingResponse extends Omit<D2ABriefingResponse, "items"> {
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  items: D2ABriefingItem[];
}

export function parseFilterParams(searchParams: URLSearchParams): BriefingFilterParams {
  const sinceRaw = searchParams.get("since");
  const limitRaw = searchParams.get("limit");
  const offsetRaw = searchParams.get("offset");
  const topicsRaw = searchParams.get("topics");

  const parsedLimit = limitRaw !== null ? parseInt(limitRaw, 10) : NaN;
  const limit = isNaN(parsedLimit) ? 50 : Math.min(100, Math.max(1, parsedLimit));
  const parsedOffset = offsetRaw !== null ? parseInt(offsetRaw, 10) : NaN;
  const offset = isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset);

  let since: string | undefined;
  if (sinceRaw) {
    const d = new Date(sinceRaw);
    if (!isNaN(d.getTime())) since = d.toISOString();
  }

  const topics = topicsRaw
    ? topicsRaw.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
    : undefined;

  return { since, limit, offset, topics };
}

export function filterAndPaginate(
  briefing: D2ABriefingResponse,
  params: BriefingFilterParams,
): PaginatedBriefingResponse {
  let items = briefing.items;

  // Filter by since: compares against the briefing's generatedAt timestamp (not per-item).
  // If the briefing was generated before `since`, all items are excluded.
  // Items within a briefing don't carry individual timestamps.
  if (params.since) {
    const sinceTs = new Date(params.since).getTime();
    const briefingTs = new Date(briefing.generatedAt).getTime();
    if (briefingTs < sinceTs) {
      items = [];
    }
  }

  if (params.topics && params.topics.length > 0) {
    const topicSet = new Set(params.topics);
    items = items.filter(item =>
      item.topics.some(t => topicSet.has(t.toLowerCase())),
    );
  }

  const total = items.length;
  const paged = items.slice(params.offset, params.offset + params.limit);

  return {
    version: briefing.version,
    generatedAt: briefing.generatedAt,
    source: briefing.source,
    sourceUrl: briefing.sourceUrl,
    summary: briefing.summary,
    serendipityPick: briefing.serendipityPick,
    meta: briefing.meta,
    pagination: {
      offset: params.offset,
      limit: params.limit,
      total,
      hasMore: params.offset + params.limit < total,
    },
    items: paged,
  };
}

export function truncateForPreview(
  items: D2ABriefingItem[],
  maxLength = 200,
): D2ABriefingItem[] {
  return items.map(item => ({
    ...item,
    content: item.content.length > maxLength
      ? item.content.slice(0, maxLength) + "..."
      : item.content,
  }));
}

export function applyPreview(
  response: PaginatedBriefingResponse,
  maxLength = 200,
): PaginatedBriefingResponse {
  return {
    ...response,
    items: truncateForPreview(response.items, maxLength),
    serendipityPick: response.serendipityPick
      ? truncateForPreview([response.serendipityPick], maxLength)[0]
      : null,
  };
}

/** Uses \0 separator to prevent title/sourceUrl boundary collisions */
export function itemHash(title: string, sourceUrl: string): string {
  return createHash("sha256")
    .update(`${title}\0${sourceUrl}`)
    .digest("hex");
}
