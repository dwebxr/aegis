import { Actor, Identity } from "@dfinity/agent";
import { createAgent, ensureRootKey, getCanisterId } from "./agent";
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

/** Async version: fetches root key (local dev) and syncs agent time with IC.
 *  Prevents certificate verification failures and signed-query clock drift. */
export async function createBackendActorAsync(identity?: Identity): Promise<_SERVICE> {
  const agent = createAgent(identity);
  await ensureRootKey(agent);
  try {
    await agent.syncTime();
  } catch (err) {
    console.error("[ic] syncTime failed — IC calls may fail with certificate errors:", errMsg(err));
  }
  return Actor.createActor<_SERVICE>(idlFactory, {
    agent,
    canisterId: getCanisterId(),
  });
}
