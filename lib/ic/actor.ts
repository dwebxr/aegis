import { Actor, Identity } from "@dfinity/agent";
import { createAgent, ensureRootKey, getCanisterId } from "./agent";
import { idlFactory } from "./declarations";
import type { _SERVICE } from "./declarations";
import { errMsg } from "@/lib/utils/errors";
import { withTimeout } from "@/lib/utils/timeout";

/** Fetches root key (local dev) and syncs agent time with IC.
 *  Prevents certificate verification failures and signed-query clock drift. */
export async function createBackendActorAsync(identity?: Identity): Promise<_SERVICE> {
  const agent = createAgent(identity);
  await ensureRootKey(agent);
  try {
    await withTimeout(agent.syncTime(), 5000, "syncTime timeout");
  } catch (err) {
    console.error("[ic] syncTime failed:", errMsg(err));
  }
  return Actor.createActor<_SERVICE>(idlFactory, {
    agent,
    canisterId: getCanisterId(),
  });
}
