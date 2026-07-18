import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import type { SupportedResponse } from "@x402/core/types";
import { createCdpFacilitatorConfig } from "@/lib/d2a/cdpFacilitator";

const REQUIRED_NETWORKS = ["eip155:84532", "eip155:8453"] as const;

export function assertRequiredCdpSupport(supported: SupportedResponse): void {
  for (const network of REQUIRED_NETWORKS) {
    const found = supported.kinds.some((kind) =>
      kind.x402Version === 2 && kind.scheme === "exact" && kind.network === network);
    if (!found) {
      throw new Error(`CDP facilitator does not advertise x402 v2 exact on ${network}`);
    }
  }
}

export async function runCdpSmoke(
  client: Pick<FacilitatorClient, "getSupported">,
): Promise<SupportedResponse> {
  const supported = await client.getSupported();
  assertRequiredCdpSupport(supported);
  return supported;
}

async function main(): Promise<void> {
  const apiKeyId = process.env.CDP_API_KEY_ID?.trim() || "";
  const apiKeySecret = process.env.CDP_API_KEY_SECRET?.trim() || "";
  if (!apiKeyId || !apiKeySecret) {
    throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET are required");
  }

  const client = new HTTPFacilitatorClient(
    createCdpFacilitatorConfig(apiKeyId, apiKeySecret),
  );
  const supported = await runCdpSmoke(client);
  console.log(JSON.stringify({
    ok: true,
    required: REQUIRED_NETWORKS,
    kinds: supported.kinds.filter((kind) =>
      kind.x402Version === 2
      && kind.scheme === "exact"
      && REQUIRED_NETWORKS.includes(kind.network as typeof REQUIRED_NETWORKS[number])),
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
