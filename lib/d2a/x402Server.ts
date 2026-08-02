import { x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import {
  onAfterSettle,
  onAfterVerify,
  onBeforeSettle,
  onSettleFailure,
} from "@/lib/d2a/settlementJournal";
import { strictFacilitatorClient } from "@/lib/d2a/strictFacilitatorClient";
import { createCdpFacilitatorConfig } from "@/lib/d2a/cdpFacilitator";

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL?.trim() || "https://x402.org/facilitator";

// Defined in x402Env.ts (dependency-free) and re-exported here so the free
// discovery routes can read them without pulling in this module's payment
// stack. Paid routes keep importing them from here unchanged.
export { X402_NETWORK, X402_PRICE, X402_SCORE_PRICE, X402_RECEIVER } from "./x402Env";
import { X402_NETWORK } from "./x402Env";

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
  .registerExtension(bazaarResourceServerExtension)
  .onAfterVerify(onAfterVerify)
  .onBeforeSettle(onBeforeSettle)
  .onAfterSettle(onAfterSettle)
  .onSettleFailure(onSettleFailure);
