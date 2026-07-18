import { x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  onAfterSettle,
  onAfterVerify,
  onBeforeSettle,
  onSettleFailure,
} from "@/lib/d2a/settlementJournal";
import { strictFacilitatorClient } from "@/lib/d2a/strictFacilitatorClient";
import { createCdpFacilitatorConfig } from "@/lib/d2a/cdpFacilitator";

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL?.trim() || "https://x402.org/facilitator";

export const X402_NETWORK = (process.env.X402_NETWORK?.trim() || "eip155:84532") as `${string}:${string}`;
export const X402_PRICE = process.env.X402_PRICE?.trim() || "$0.01";
export const X402_SCORE_PRICE = process.env.X402_SCORE_PRICE?.trim() || "$0.02";
export const X402_RECEIVER = process.env.X402_RECEIVER_ADDRESS?.trim() || "";

const cdpApiKeyId = process.env.CDP_API_KEY_ID?.trim() || "";
const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET?.trim() || "";
const hasCdpApiKeyId = cdpApiKeyId.length > 0;
const hasCdpApiKeySecret = cdpApiKeySecret.length > 0;

if (hasCdpApiKeyId !== hasCdpApiKeySecret) {
  throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET must be configured together");
}
if (X402_NETWORK === "eip155:8453" && !hasCdpApiKeyId) {
  throw new Error("Base mainnet requires CDP_API_KEY_ID and CDP_API_KEY_SECRET");
}

function facilitatorConfig() {
  if (hasCdpApiKeyId && hasCdpApiKeySecret) {
    return createCdpFacilitatorConfig(cdpApiKeyId, cdpApiKeySecret);
  }
  return { url: FACILITATOR_URL };
}

const facilitatorClient = strictFacilitatorClient(
  new HTTPFacilitatorClient(facilitatorConfig()),
);

export const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(X402_NETWORK, new ExactEvmScheme())
  .onAfterVerify(onAfterVerify)
  .onBeforeSettle(onBeforeSettle)
  .onAfterSettle(onAfterSettle)
  .onSettleFailure(onSettleFailure);
