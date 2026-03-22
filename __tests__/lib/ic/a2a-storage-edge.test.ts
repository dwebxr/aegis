// A2A Storage — size guard boundary tests.
// Documents the canister's 10KB (title + description) trap contract.

import type { Offer } from "@/lib/ic/declarations";

const MAX_OFFER_TEXT = 10_000;

function isOfferWithinSizeLimit(offer: Pick<Offer, "title" | "description">): boolean {
  return offer.title.length + offer.description.length <= MAX_OFFER_TEXT;
}

describe("Offer — 10KB size guard contract", () => {
  it("accepts at exactly 10,000 chars", () => {
    expect(isOfferWithinSizeLimit({ title: "T".repeat(3_000), description: "D".repeat(7_000) })).toBe(true);
  });

  it("rejects at 10,001 chars", () => {
    expect(isOfferWithinSizeLimit({ title: "T".repeat(3_000), description: "D".repeat(7_001) })).toBe(false);
  });

  it("accepts empty title + empty description", () => {
    expect(isOfferWithinSizeLimit({ title: "", description: "" })).toBe(true);
  });

  // JS string.length counts UTF-16 code units; Motoko Text.size counts Unicode scalars.
  // Emoji like 🎯 = 2 in JS, 1 in Motoko → JS overestimates, which is safe (conservative).
  it("JS length overestimates emoji — safe for client-side pre-check", () => {
    const jsLen = "🎯".length;  // 2 (surrogate pair)
    expect(jsLen).toBe(2);
    // Client rejecting at JS-length 10K will never exceed Motoko's 10K scalar limit
  });
});
