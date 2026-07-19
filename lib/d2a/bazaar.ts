import type { RouteConfig } from "@x402/core/server";
import {
  declareDiscoveryExtension,
  type DeclareDiscoveryExtensionInput,
} from "@x402/extensions/bazaar";

type BazaarRouteMetadata = Required<Pick<
  RouteConfig,
  "description" | "mimeType" | "serviceName" | "extensions"
>>;

const scoreDiscoveryConfig = {
  input: { url: "https://example.com/article" },
  inputSchema: {
    properties: {
      url: {
        type: "string",
        format: "uri",
        pattern: "^https?://",
        maxLength: 2048,
        description: "HTTP(S) URL of the article to extract and score.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  output: {
    example: {
      url: "https://example.com/article",
      title: "Example article",
      engine: "claude",
      cached: false,
      score: {
        originality: 8,
        insight: 7,
        credibility: 8,
        composite: 7.8,
        verdict: "quality",
        reason: "Dense, well-supported analysis.",
        topics: ["technology"],
        vSignal: 8,
        cContext: 7,
        lSlop: 2,
      },
    },
  },
} satisfies DeclareDiscoveryExtensionInput;

const briefingDiscoveryConfig = {
  input: { limit: "5" },
  inputSchema: {
    properties: {
      principal: {
        type: "string",
        description: "Optional Internet Computer principal for a contributor-specific briefing.",
      },
      since: {
        type: "string",
        format: "date-time",
        description: "Optional ISO 8601 lower bound for briefing generation time.",
      },
      limit: {
        type: "string",
        pattern: "^[0-9]+$",
        description: "Optional maximum number of items or contributors to return.",
      },
      offset: {
        type: "string",
        pattern: "^[0-9]+$",
        description: "Optional zero-based pagination offset.",
      },
      topics: {
        type: "string",
        description: "Optional comma-separated topic filter using case-insensitive OR matching.",
      },
      preview: {
        type: "string",
        enum: ["true"],
        description: "Optional free redacted preview when the deployment enables the preview tier.",
      },
    },
    additionalProperties: false,
  },
  output: {
    example: {
      version: "1.0",
      type: "global",
      generatedAt: "2026-01-01T00:00:00.000Z",
      contributors: [],
    },
  },
} satisfies DeclareDiscoveryExtensionInput;

const briefingChangesDiscoveryConfig = {
  input: { since: "2026-01-01T00:00:00.000Z" },
  inputSchema: {
    properties: {
      since: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 timestamp; return additions from newer briefings.",
      },
      preview: {
        type: "string",
        enum: ["true"],
        description: "Optional free hash-only preview when the deployment enables the preview tier.",
      },
    },
    required: ["since"],
    additionalProperties: false,
  },
  output: {
    example: {
      since: "2026-01-01T00:00:00.000Z",
      checkedAt: "2026-01-02T00:00:00.000Z",
      changes: [],
    },
  },
} satisfies DeclareDiscoveryExtensionInput;

export const SCORE_BAZAAR_METADATA = {
  serviceName: "Aegis URL Quality Score",
  description: "Score a URL's content quality (V/C/L) with AI",
  mimeType: "application/json",
  extensions: declareDiscoveryExtension(scoreDiscoveryConfig),
} satisfies BazaarRouteMetadata;

export const BRIEFING_BAZAAR_METADATA = {
  serviceName: "Aegis Curated Briefing",
  description: "Aegis curated briefing — AI-scored content feed with V/C/L metrics",
  mimeType: "application/json",
  extensions: declareDiscoveryExtension(briefingDiscoveryConfig),
} satisfies BazaarRouteMetadata;

export const BRIEFING_CHANGES_BAZAAR_METADATA = {
  serviceName: "Aegis Briefing Changes",
  description: "Aegis briefing change feed — diffs since a given timestamp",
  mimeType: "application/json",
  extensions: declareDiscoveryExtension(briefingChangesDiscoveryConfig),
} satisfies BazaarRouteMetadata;
