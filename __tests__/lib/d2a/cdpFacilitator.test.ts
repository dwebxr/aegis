const generateJwt = jest.fn<Promise<string>, [Record<string, unknown>]>();

jest.mock("@coinbase/cdp-sdk/auth", () => ({ generateJwt }));

import {
  CDP_FACILITATOR_URL,
  createCdpFacilitatorConfig,
} from "@/lib/d2a/cdpFacilitator";

describe("createCdpFacilitatorConfig", () => {
  beforeEach(() => {
    generateJwt.mockReset();
    generateJwt
      .mockResolvedValueOnce("verify-jwt")
      .mockResolvedValueOnce("settle-jwt")
      .mockResolvedValueOnce("supported-jwt");
  });

  it("creates one endpoint-bound JWT for each auth header map entry", async () => {
    const config = createCdpFacilitatorConfig(" key-id ", " key-secret ");
    const headers = await config.createAuthHeaders?.();

    expect(config.url).toBe(CDP_FACILITATOR_URL);
    expect(headers).toEqual({
      verify: { Authorization: "Bearer verify-jwt" },
      settle: { Authorization: "Bearer settle-jwt" },
      supported: { Authorization: "Bearer supported-jwt" },
    });
    expect(generateJwt.mock.calls.map(([options]) => options)).toEqual([
      expect.objectContaining({
        apiKeyId: "key-id",
        apiKeySecret: "key-secret",
        requestMethod: "POST",
        requestHost: "api.cdp.coinbase.com",
        requestPath: "/platform/v2/x402/verify",
      }),
      expect.objectContaining({ requestMethod: "POST", requestPath: "/platform/v2/x402/settle" }),
      expect.objectContaining({ requestMethod: "GET", requestPath: "/platform/v2/x402/supported" }),
    ]);
  });

  it("rejects blank credentials", () => {
    expect(() => createCdpFacilitatorConfig(" ", "secret"))
      .toThrow("Both CDP API key ID and secret are required");
  });
});
