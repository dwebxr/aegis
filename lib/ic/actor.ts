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
