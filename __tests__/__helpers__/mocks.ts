/**
 * Typed test-mock factories.
 *
 * Each factory takes a partial of the target shape and returns it widened
 * to the full type. Callers get autocomplete inside the partial AND full
 * type-checking at the consumer call site, without sprinkling `as any`
 * across test files.
 */

import type { _SERVICE } from "@/lib/ic/declarations/aegis_backend.did";
import type { WoTGraph } from "@/lib/wot/types";

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
