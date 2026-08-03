/**
 * x402 configuration values, with no dependencies.
 *
 * These four strings are all that the free discovery routes (/api/d2a/info,
 * /api/d2a/health) need, but reading them from x402Server.ts dragged the whole
 * payment stack — @x402/next, the EVM scheme, the bazaar extension, the
 * settlement journal, the CDP facilitator — into those routes' module graph, to
 * be evaluated on every cold start for two strings.
 *
 * x402Server.ts re-exports these, so paid routes are unaffected and there is
 * still exactly one definition of each value. The fail-fast configuration
 * validation stays in x402Server.ts: it guards settlement, and a free discovery
 * route must keep answering even when the paid configuration is unusable.
 */

export const X402_NETWORK = (process.env.X402_NETWORK?.trim() || "eip155:84532") as `${string}:${string}`;
export const X402_PRICE = process.env.X402_PRICE?.trim() || "$0.01";
export const X402_SCORE_PRICE = process.env.X402_SCORE_PRICE?.trim() || "$0.02";
export const X402_RECEIVER = process.env.X402_RECEIVER_ADDRESS?.trim() || "";
