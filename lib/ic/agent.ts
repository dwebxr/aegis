import { HttpAgent, Identity } from "@dfinity/agent";

const isLocal = typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export function getHost(): string {
  return (process.env.NEXT_PUBLIC_IC_HOST || (isLocal ? "http://127.0.0.1:4943" : "https://icp-api.io")).trim();
}

export function getInternetIdentityUrl(): string {
  return (process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL || (isLocal ? "http://127.0.0.1:4943/?canisterId=rdmx6-jaaaa-aaaaa-aaadq-cai" : "https://identity.ic0.app")).trim();
}

export function getCanisterId(): string {
  return (process.env.NEXT_PUBLIC_CANISTER_ID || "rluf3-eiaaa-aaaam-qgjuq-cai").trim();
}

export function getDerivationOrigin(): string | undefined {
  if (isLocal) return undefined;
  return `https://${getCanisterId()}.icp0.io`;
}

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
