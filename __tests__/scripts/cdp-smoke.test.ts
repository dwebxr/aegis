jest.mock("@/lib/d2a/cdpFacilitator", () => ({
  createCdpFacilitatorConfig: jest.fn(),
}));

import { HTTPFacilitatorClient } from "@x402/core/server";
import { runCdpSmoke } from "@/scripts/cdp-smoke";

describe("runCdpSmoke", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("asserts v2 exact support for Base Sepolia and Base mainnet", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      kinds: [
        { x402Version: 2, scheme: "exact", network: "eip155:84532" },
        { x402Version: 2, scheme: "exact", network: "eip155:8453" },
      ],
      extensions: [],
      signers: {},
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await runCdpSmoke(new HTTPFacilitatorClient({ url: "https://cdp.test" }));

    expect(result.kinds).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://cdp.test/supported",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fails when one required kind is absent", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
      extensions: [],
      signers: {},
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(runCdpSmoke(new HTTPFacilitatorClient({ url: "https://cdp.test" })))
      .rejects.toThrow("eip155:8453");
  });
});
