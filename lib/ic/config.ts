// Keep this file free of @dfinity/agent imports — health routes depend on it being lightweight.
export const isLocal = typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export function getHost(): string {
  return (process.env.NEXT_PUBLIC_IC_HOST || (isLocal ? "http://127.0.0.1:4943" : "https://icp-api.io")).trim();
}

export function getInternetIdentityUrl(): string {
  // Non-local default is id.ai — II's PRIMARY origin. A non-primary origin
  // (identity.internetcomputer.org, identity.ic0.app) makes II's popup redirect
  // to id.ai, after which AuthClient's event.origin filter drops the messages and
  // login fails. Production sets NEXT_PUBLIC_INTERNET_IDENTITY_URL=https://id.ai;
  // this keeps the env-unset fallback (preview/CI/contributors) on the same origin.
  return (process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL || (isLocal ? "http://127.0.0.1:4943/?canisterId=rdmx6-jaaaa-aaaaa-aaadq-cai" : "https://id.ai")).trim();
}

export function getCanisterId(): string {
  return (process.env.NEXT_PUBLIC_CANISTER_ID || "rluf3-eiaaa-aaaam-qgjuq-cai").trim();
}

export function getDerivationOrigin(): string | undefined {
  if (isLocal) return undefined;
  return `https://${getCanisterId()}.icp0.io`;
}
