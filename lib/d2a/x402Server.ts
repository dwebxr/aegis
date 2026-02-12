import { x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const FACILITATOR_URL = (process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator").trim();

export const X402_NETWORK = (process.env.X402_NETWORK || "eip155:84532").trim() as `${string}:${string}`;
export const X402_PRICE = (process.env.X402_PRICE || "$0.01").trim();
export const X402_RECEIVER = (process.env.X402_RECEIVER_ADDRESS || "").trim();

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

export const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(X402_NETWORK, new ExactEvmScheme());
