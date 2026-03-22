// A2A Storage — IDL factory tests.
// Runs the real idlFactory function and verifies Offer/Receipt registration.

import { idlFactory } from "@/lib/ic/declarations";
import type { _SERVICE } from "@/lib/ic/declarations";

function getService() {
  const IDL = {
    Text: "Text", Nat: "Nat", Int: "Int", Bool: "Bool", Float64: "Float64",
    Null: "Null", Nat8: "Nat8", Principal: "Principal",
    Record: (f: Record<string, unknown>) => ({ _type: "Record", fields: f }),
    Variant: (f: Record<string, unknown>) => ({ _type: "Variant", fields: f }),
    Vec: (inner: unknown) => ({ _type: "Vec", inner }),
    Opt: (inner: unknown) => ({ _type: "Opt", inner }),
    Tuple: (...args: unknown[]) => ({ _type: "Tuple", args }),
    Func: (args: unknown[], ret: unknown[], mode: string[]) => ({ _type: "Func", args, ret, mode }),
    Service: (methods: Record<string, unknown>) => methods,
  };
  return idlFactory({ IDL }) as Record<string, { _type: string; args: unknown[]; ret: unknown[]; mode: string[] }>;
}

const service = getService();

describe("idlFactory — A2A methods", () => {
  it.each([
    ["put_offer", [], 1, []],
    ["get_offers", ["query"], 2, "Vec"],
    ["submit_receipt", [], 1, []],
    ["get_receipt", ["query"], 1, "Opt"],
    ["verify_payment_manual", [], 1, ["Bool"]],
    ["get_a2a_stats", ["query"], 0, "Record"],
  ] as const)("%s registered with correct mode and arity", (name, mode, argCount, retShape) => {
    const fn = service[name];
    expect(fn._type).toBe("Func");
    expect(fn.mode).toEqual(mode);
    expect(fn.args).toHaveLength(argCount);
    if (typeof retShape === "string") {
      expect((fn.ret[0] as { _type: string })._type).toBe(retShape);
    } else {
      expect(fn.ret).toEqual(retShape);
    }
  });
});

describe("idlFactory — Offer record", () => {
  it("has 9 fields with correct Candid types", () => {
    const { fields } = service.put_offer.args[0] as { fields: Record<string, string> };
    expect(fields).toEqual({
      id: "Text", contentHash: "Text", publisher: "Text", priceUSDC: "Nat",
      chain: "Text", vclScore: "Float64", title: "Text", description: "Text", createdAt: "Int",
    });
  });
});

describe("idlFactory — Receipt record", () => {
  it("has 6 fields with correct Candid types", () => {
    const { fields } = service.submit_receipt.args[0] as { fields: Record<string, string> };
    expect(fields).toEqual({
      txHash: "Text", chain: "Text", contentHash: "Text",
      payer: "Text", amount: "Nat", verified: "Bool",
    });
  });
});

describe("idlFactory — A2A stats record", () => {
  it("has offerCount and receiptCount as Nat", () => {
    const ret = service.get_a2a_stats.ret[0] as { _type: string; fields: Record<string, string> };
    expect(ret._type).toBe("Record");
    expect(ret.fields).toEqual({ offerCount: "Nat", receiptCount: "Nat" });
  });
});

// Compile-time: tsc fails if _SERVICE lacks these keys
type _A = _SERVICE["put_offer"];
type _B = _SERVICE["get_offers"];
type _C = _SERVICE["submit_receipt"];
type _D = _SERVICE["get_receipt"];
type _E = _SERVICE["verify_payment_manual"];
type _F = _SERVICE["get_a2a_stats"];
// Suppress unused warnings
void (0 as unknown as _A | _B | _C | _D | _E | _F);

describe("idlFactory — existing methods not broken", () => {
  it.each([
    ["getProfile", "query"], ["getEvaluation", "query"], ["getUserEvaluations", "query"],
    ["getUserAnalytics", "query"], ["getUserSourceConfigs", "query"],
    ["getUserSettings", "query"], ["getUserPreferences", "query"],
    ["getGlobalBriefingSummaries", "query"],
    ["saveEvaluation", "update"], ["updateEvaluation", "update"],
    ["batchSaveEvaluations", "update"], ["updateDisplayName", "update"],
    ["saveSourceConfig", "update"], ["deleteSourceConfig", "update"],
    ["saveUserSettings", "update"], ["saveUserPreferences", "update"],
  ])("%s still registered as %s", (method, type) => {
    expect(service[method]).toBeDefined();
    expect(service[method].mode).toEqual(type === "query" ? ["query"] : []);
  });
});
