/**
 * Typed test-mock factories.
 *
 * Each factory takes a partial of the target shape and returns it widened
 * to the full type. Callers get autocomplete inside the partial AND full
 * type-checking at the consumer call site, without sprinkling `as any`
 * across test files.
 */

import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile, AuthorTrust } from "@/lib/preferences/types";
import type { AgentState, ActivityLogEntry } from "@/lib/agent/types";
import type { _SERVICE } from "@/lib/ic/declarations/aegis_backend.did";
import type { WoTGraph } from "@/lib/wot/types";

interface AgentManagerCallbacksLike {
  onNewContent: (item: ContentItem) => void;
  getContent: () => ContentItem[];
  getPrefs: () => UserPreferenceProfile;
  onStateChange: (state: AgentState) => void;
  onD2AMatchComplete?: (senderPk: string, senderPrincipalId: string | undefined, contentHash: string, fee: number) => void | Promise<void>;
  onComment?: (msg: unknown, senderPk: string) => void;
}

export function mockAgentCallbacks(
  overrides: Partial<AgentManagerCallbacksLike> = {},
): AgentManagerCallbacksLike {
  return {
    onNewContent: jest.fn(),
    getContent: jest.fn(() => []),
    getPrefs: jest.fn(() => ({
      version: 1,
      principalId: "test",
      topicAffinities: {},
      authorTrust: {} as Record<string, AuthorTrust>,
      calibration: { qualityThreshold: 4 },
      recentTopics: [],
      totalValidated: 0,
      totalFlagged: 0,
      lastUpdated: Date.now(),
    })),
    onStateChange: jest.fn(),
    ...overrides,
  };
}

/** Minimal valid WoTGraph for tests that only check graph presence. */
export function mockWoTGraph(overrides: Partial<WoTGraph> = {}): WoTGraph {
  return {
    userPubkey: "test-user",
    nodes: new Map(),
    maxHops: 2,
    builtAt: Date.now(),
    ...overrides,
  };
}

export function mockAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    isActive: false,
    myPubkey: null,
    peers: [],
    activeHandshakes: [],
    receivedItems: 0,
    sentItems: 0,
    d2aMatchCount: 0,
    consecutiveErrors: 0,
    activityLog: [] as ActivityLogEntry[],
    ...overrides,
  };
}

/**
 * Partial mock of the IC backend actor. Tests typically only stub the
 * actor methods they exercise with jest.fn() — which lacks the
 * `ActorMethod.withOptions` member. The helper accepts any stub shape and
 * widens it to the full `_SERVICE` interface so callers typed on the real
 * Candid-generated interface accept it.
 */
export function mockBackendActor(stubs: Record<string, unknown>): _SERVICE {
  return stubs as unknown as _SERVICE;
}

interface HttpAgentLike {
  fetchRootKey: jest.Mock;
}

export function mockHttpAgent(overrides: Partial<HttpAgentLike> = {}): HttpAgentLike {
  return {
    fetchRootKey: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
