import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, VerifyResponse } from "@x402/core/types";

/**
 * @x402/core 2.17.0 checks `isValid` by truthiness after facilitator verify.
 * Normalize the untrusted wire result so only the literal boolean true can
 * reach that check as valid.
 */
export function strictFacilitatorClient(client: FacilitatorClient): FacilitatorClient {
  return {
    async verify(
      paymentPayload: PaymentPayload,
      paymentRequirements: PaymentRequirements,
    ): Promise<VerifyResponse> {
      const result: unknown = await client.verify(paymentPayload, paymentRequirements);
      if (
        result !== null
        && typeof result === "object"
        && (result as { isValid?: unknown }).isValid === true
      ) {
        return result as VerifyResponse;
      }
      if (result !== null && typeof result === "object") {
        return {
          ...(result as Partial<VerifyResponse>),
          isValid: false,
          invalidReason: (result as Partial<VerifyResponse>).invalidReason
            || "invalid_facilitator_response",
        };
      }
      return { isValid: false, invalidReason: "invalid_facilitator_response" };
    },
    settle: (paymentPayload, paymentRequirements) =>
      client.settle(paymentPayload, paymentRequirements),
    getSupported: () => client.getSupported(),
  };
}
