import { Actor, Identity } from "@dfinity/agent";
import { createAgent, getCanisterId } from "./agent";
import { idlFactory } from "./declarations";
import type { _SERVICE } from "./declarations";

export function createBackendActor(identity?: Identity): _SERVICE {
  const agent = createAgent(identity);
  return Actor.createActor<_SERVICE>(idlFactory, {
    agent,
    canisterId: getCanisterId(),
  });
}

/** Async version: syncs agent time with IC before returning actor.
 *  Prevents signed-query failures from client clock drift. */
export async function createBackendActorAsync(identity?: Identity): Promise<_SERVICE> {
  const agent = createAgent(identity);
  try {
    await agent.syncTime();
  } catch (err) {
    console.warn("[ic] syncTime failed (clock drift possible):", err instanceof Error ? err.message : "unknown");
  }
  return Actor.createActor<_SERVICE>(idlFactory, {
    agent,
    canisterId: getCanisterId(),
  });
}
