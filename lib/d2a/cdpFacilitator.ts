import type { FacilitatorConfig } from "@x402/core/server";

export const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

const CDP_HOST = "api.cdp.coinbase.com";
const CDP_BASE_PATH = "/platform/v2/x402";

const AUTH_PATHS = {
  verify: `${CDP_BASE_PATH}/verify`,
  settle: `${CDP_BASE_PATH}/settle`,
  supported: `${CDP_BASE_PATH}/supported`,
} as const;

type AuthEndpoint = keyof typeof AUTH_PATHS;

export function createCdpFacilitatorConfig(
  apiKeyId: string,
  apiKeySecret: string,
): FacilitatorConfig {
  const keyId = apiKeyId.trim();
  const keySecret = apiKeySecret.trim();
  if (!keyId || !keySecret) {
    throw new Error("Both CDP API key ID and secret are required");
  }

  return {
    url: CDP_FACILITATOR_URL,
    async createAuthHeaders() {
      const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
      const entries = await Promise.all(
        (Object.keys(AUTH_PATHS) as AuthEndpoint[]).map(async (endpoint) => {
          const jwt = await generateJwt({
            apiKeyId: keyId,
            apiKeySecret: keySecret,
            requestMethod: endpoint === "supported" ? "GET" : "POST",
            requestHost: CDP_HOST,
            requestPath: AUTH_PATHS[endpoint],
          });
          return [endpoint, { Authorization: `Bearer ${jwt}` }] as const;
        }),
      );
      const byEndpoint = Object.fromEntries(entries);
      return {
        verify: byEndpoint.verify,
        settle: byEndpoint.settle,
        supported: byEndpoint.supported,
      };
    },
  };
}
