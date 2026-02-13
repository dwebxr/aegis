import { HttpAgent, Identity } from "@dfinity/agent";
export { getHost, getInternetIdentityUrl, getCanisterId, getDerivationOrigin, isLocal } from "./config";
import { getHost, isLocal } from "./config";

export function createAgent(identity?: Identity): HttpAgent {
  return HttpAgent.createSync({
    host: getHost(),
    identity,
  });
}

/** Await this in async callers to ensure the agent has the root key for local dev. */
export async function ensureRootKey(agent: HttpAgent): Promise<void> {
  if (isLocal) {
    await agent.fetchRootKey();
  }
}
