import { generateKeyPairSync, verify } from "node:crypto";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { CDP_FACILITATOR_URL, createCdpFacilitatorConfig } from "@/lib/d2a/cdpFacilitator";

// No SDK mock and no facilitator calls: only local signing with a throwaway key.
describe("CDP facilitator auth — real SDK", () => {
  it("signs verifiable JWTs bound to each facilitator method, host and path", async () => {
    expect(jest.isMockFunction(generateJwt)).toBe(false);
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const apiKeyId = "organizations/test/apiKeys/throwaway";
    const apiKeySecret = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const config = createCdpFacilitatorConfig(apiKeyId, apiKeySecret);
    const headers = await config.createAuthHeaders!();
    const base = new URL(CDP_FACILITATOR_URL);

    for (const [endpoint, method] of [["verify", "POST"], ["settle", "POST"], ["supported", "GET"]] as const) {
      const token = headers[endpoint].Authorization.replace(/^Bearer /, "");
      const [encodedHeader, encodedPayload, signature] = token.split(".");
      expect(verify("sha256", Buffer.from(`${encodedHeader}.${encodedPayload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
      expect(JSON.parse(Buffer.from(encodedHeader, "base64url").toString())).toMatchObject({
        alg: "ES256", kid: apiKeyId, typ: "JWT",
      });
      const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
      expect(claims).toMatchObject({
        iss: "cdp", sub: apiKeyId,
        uris: [`${method} ${base.host}${base.pathname}/${endpoint}`],
      });
      expect(claims.exp - claims.nbf).toBe(120);
    }
  });
});
