import { Actor, Identity } from "@dfinity/agent";
import { createAgent, getCanisterId } from "./agent";
import { idlFactory } from "./declarations";
import type { _SERVICE } from "./declarations";
import { errMsg } from "@/lib/utils/errors";

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
    console.warn("[ic] syncTime failed (clock drift possible):", errMsg(err));
  }
  return Actor.createActor<_SERVICE>(idlFactory, {
    agent,
    canisterId: getCanisterId(),
  });
}
