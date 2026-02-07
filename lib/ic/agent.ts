import { HttpAgent, Identity } from "@dfinity/agent";

const isLocal = typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export function getHost(): string {
  return process.env.NEXT_PUBLIC_IC_HOST || (isLocal ? "http://127.0.0.1:4943" : "https://icp-api.io");
}

export function getInternetIdentityUrl(): string {
  return process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL || (isLocal ? "http://127.0.0.1:4943/?canisterId=rdmx6-jaaaa-aaaaa-aaadq-cai" : "https://identity.ic0.app");
}

export function getCanisterId(): string {
  return process.env.NEXT_PUBLIC_CANISTER_ID || "rluf3-eiaaa-aaaam-qgjuq-cai";
}

export function createAgent(identity?: Identity): HttpAgent {
  const agent = HttpAgent.createSync({
    host: getHost(),
    identity,
  });

  if (isLocal) {
    agent.fetchRootKey().catch(console.error);
  }

  return agent;
}
