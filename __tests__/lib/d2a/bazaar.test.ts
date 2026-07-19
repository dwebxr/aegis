import type { FacilitatorClient } from "@x402/core/server";
import { x402ResourceServer } from "@x402/core/server";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type {
  DiscoveryExtension,
  QueryDiscoveryExtension,
} from "@x402/extensions/bazaar";
import {
  bazaarResourceServerExtension,
  validateDiscoveryExtension,
} from "@x402/extensions/bazaar";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402 } from "@x402/next";
import { NextRequest, NextResponse } from "next/server";
import {
  BRIEFING_BAZAAR_METADATA,
  BRIEFING_CHANGES_BAZAAR_METADATA,
  SCORE_BAZAAR_METADATA,
} from "@/lib/d2a/bazaar";

const NETWORK = "eip155:84532" as const;
const RECEIVER = "0x0000000000000000000000000000000000000001";

function isQueryDiscoveryExtension(
  extension: DiscoveryExtension,
): extension is QueryDiscoveryExtension {
  return extension.info.input.type === "http" && !("bodyType" in extension.info.input);
}

const facilitator: FacilitatorClient = {
  verify: jest.fn(),
  settle: jest.fn(),
  getSupported: jest.fn(async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
    extensions: [],
    signers: { [NETWORK]: ["0xfacilitator"] },
  })),
};

const cases = [
  {
    path: "/api/d2a/score?url=https://example.com/article",
    metadata: SCORE_BAZAAR_METADATA,
    requiredQueryParams: ["url"],
  },
  {
    path: "/api/d2a/briefing",
    metadata: BRIEFING_BAZAAR_METADATA,
    requiredQueryParams: [],
  },
  {
    path: "/api/d2a/briefing/changes?since=2026-01-01T00:00:00.000Z",
    metadata: BRIEFING_CHANGES_BAZAAR_METADATA,
    requiredQueryParams: ["since"],
  },
] as const;

describe("D2A Bazaar discovery declarations", () => {
  it("registers the Bazaar extension on the shared resource server", () => {
    const { resourceServer } = require("@/lib/d2a/x402Server") as
      typeof import("@/lib/d2a/x402Server");
    expect(resourceServer.hasExtension("bazaar")).toBe(true);
  });

  it.each(cases)(
    "puts enriched Bazaar metadata in the real wrapper's 402 for $path",
    async ({ path, metadata, requiredQueryParams }) => {
      const server = new x402ResourceServer(facilitator)
        .register(NETWORK, new ExactEvmScheme())
        .registerExtension(bazaarResourceServerExtension);
      const wrapped = withX402(
        async () => NextResponse.json({ ok: true }),
        {
          accepts: {
            scheme: "exact",
            price: "$0.01",
            network: NETWORK,
            payTo: RECEIVER,
          },
          ...metadata,
        },
        server,
      );

      const response = await wrapped(new NextRequest(`https://aegis-ai.xyz${path}`));
      expect(response.status).toBe(402);
      const header = response.headers.get("PAYMENT-REQUIRED");
      expect(header).toBeTruthy();
      const paymentRequired = decodePaymentRequiredHeader(header!);

      expect(paymentRequired.resource.serviceName).toBe(metadata.serviceName);
      expect(paymentRequired.resource.description).toBe(metadata.description);
      expect(paymentRequired.resource.mimeType).toBe("application/json");

      // This assignment intentionally compiles against the package's dist d.ts.
      const bazaar: DiscoveryExtension = paymentRequired.extensions?.bazaar as DiscoveryExtension;
      expect(bazaar).toBeDefined();
      expect(bazaar.info.input).toMatchObject({ type: "http", method: "GET" });
      expect(validateDiscoveryExtension(bazaar)).toEqual({ valid: true });
      if (!isQueryDiscoveryExtension(bazaar)) {
        throw new Error("Expected a query-based HTTP Bazaar declaration");
      }

      const inputSchema = bazaar.schema.properties.input;
      expect(inputSchema.required).toEqual(expect.arrayContaining(["type", "method"]));
      const queryParams = inputSchema.properties.queryParams;
      for (const requiredParam of requiredQueryParams) {
        expect(queryParams?.required).toContain(requiredParam);
      }
    },
  );
});
