import {
  encodeAbiParameters,
  encodeEventTopics,
  pad,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { verifySettlement, ZOS_IMPLEMENTATION_SLOT } from "@/scripts/verify-settlement";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const PAYER = "0x1111111111111111111111111111111111111111" as Address;
const PAY_TO = "0x2222222222222222222222222222222222222222" as Address;
const IMPLEMENTATION = "0x3333333333333333333333333333333333333333" as Address;
const TX = `0x${"4".repeat(64)}` as Hex;
const NONCE = `0x${"5".repeat(64)}` as Hex;
const BLOCK_HASH = `0x${"6".repeat(64)}` as Hex;
const AMOUNT = 20_000n;

const eventsAbi = parseAbi([
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function eventLog(
  eventName: "AuthorizationUsed" | "AuthorizationCanceled" | "Transfer",
  logIndex: number,
) {
  const args = eventName === "Transfer"
    ? { from: PAYER, to: PAY_TO }
    : { authorizer: PAYER, nonce: NONCE };
  return {
    address: USDC,
    topics: encodeEventTopics({ abi: eventsAbi, eventName, args }),
    data: eventName === "Transfer"
      ? encodeAbiParameters(parseAbiParameters("uint256"), [AMOUNT])
      : "0x",
    logIndex,
  } as TransactionReceipt["logs"][number];
}

function clientFor(logs: TransactionReceipt["logs"], options: {
  receiptBlock?: bigint;
  finalizedBlock?: bigint;
  finalizedTimestamp?: bigint;
  status?: TransactionReceipt["status"];
  upgrades?: unknown[];
  authorizationState?: boolean;
} = {}) {
  const receiptBlock = options.receiptBlock ?? 100n;
  const finalizedBlock = options.finalizedBlock ?? 200n;
  const receipt = {
    blockNumber: receiptBlock,
    blockHash: BLOCK_HASH,
    status: options.status ?? "success",
    logs,
  } as TransactionReceipt;
  return {
    getTransactionReceipt: jest.fn().mockResolvedValue(receipt),
    getBlock: jest.fn().mockImplementation(({ blockTag }: { blockTag?: string }) =>
      blockTag === "finalized"
        ? Promise.resolve({
          number: finalizedBlock,
          timestamp: options.finalizedTimestamp ?? 500n,
        })
        : Promise.resolve({ number: receiptBlock, hash: BLOCK_HASH })),
    getStorageAt: jest.fn().mockImplementation(({ slot }: { slot: Hex }) => {
      expect(slot).toBe(ZOS_IMPLEMENTATION_SLOT);
      return Promise.resolve(pad(IMPLEMENTATION, { size: 32 }));
    }),
    readContract: jest.fn().mockResolvedValue(options.authorizationState ?? true),
    getLogs: jest.fn().mockResolvedValue(options.upgrades ?? []),
  };
}

const input = {
  txHash: TX,
  payer: PAYER,
  payTo: PAY_TO,
  amount: AMOUNT,
  nonce: NONCE,
  validBefore: 400n,
  expectedImplementation: IMPLEMENTATION,
};

describe("verifySettlement", () => {
  it("classifies adjacent AuthorizationUsed and Transfer logs as settled", async () => {
    const client = clientFor([
      eventLog("AuthorizationUsed", 7),
      eventLog("Transfer", 8),
    ]);

    const result = await verifySettlement(client as never, input);

    expect(result).toEqual({
      status: "settled",
      evidence: expect.objectContaining({
        implementation: IMPLEMENTATION,
        implementationParentBlock: "99",
        authorizationLogIndex: 7,
        transferLogIndex: 8,
        compensationAllowed: false,
      }),
    });
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({
      fromBlock: 100n,
      toBlock: 100n,
    }));
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("requires the matching transfer to be immediately adjacent", async () => {
    const client = clientFor([
      eventLog("AuthorizationUsed", 7),
      eventLog("Transfer", 9),
    ]);

    await expect(verifySettlement(client as never, input)).resolves.toEqual({
      status: "needs-review",
      evidence: expect.objectContaining({ reason: "settlement-state-indeterminate" }),
    });
  });

  it("classifies cancellation without a target transfer as closed but not compensable", async () => {
    const client = clientFor([eventLog("AuthorizationCanceled", 3)]);

    await expect(verifySettlement(client as never, input)).resolves.toEqual({
      status: "closed-unpaid",
      evidence: expect.objectContaining({
        authorizationLogIndex: 3,
        compensationAllowed: false,
      }),
    });
  });

  it("allows compensation only after expiry with finalized authorizationState false", async () => {
    const client = clientFor([], {
      finalizedTimestamp: 400n,
      authorizationState: false,
    });

    const result = await verifySettlement(client as never, input);

    expect(result).toEqual({
      status: "closed-unpaid",
      evidence: expect.objectContaining({
        compensationAllowed: true,
        finalizedBlock: "200",
        receiptBlock: "100",
      }),
    });
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "authorizationState",
      blockNumber: 200n,
      args: [PAYER, NONCE],
    }));
  });

  it.each([
    ["receipt beyond finalized head", { receiptBlock: 201n, finalizedBlock: 200n }],
    ["an upgrade in the receipt block", { upgrades: [{}] }],
  ])("returns needs-review for %s", async (_label, options) => {
    const client = clientFor([], options);

    await expect(verifySettlement(client as never, input)).resolves.toEqual({
      status: "needs-review",
      evidence: expect.objectContaining({ compensationAllowed: false }),
    });
  });

  it("returns needs-review when the ZOS slot does not match the expected pin", async () => {
    const client = clientFor([]);

    const result = await verifySettlement(client as never, {
      ...input,
      expectedImplementation: "0x7777777777777777777777777777777777777777",
    });

    expect(result).toEqual({
      status: "needs-review",
      evidence: expect.objectContaining({
        implementation: IMPLEMENTATION,
        reason: "usdc-implementation-pin-mismatch",
      }),
    });
  });

  it("returns needs-review without making RPC calls when txHash is unknown", async () => {
    const client = clientFor([]);

    const result = await verifySettlement(client as never, { ...input, txHash: undefined });

    expect(result.evidence.reason).toBe("tx-hash-unknown");
    expect(client.getTransactionReceipt).not.toHaveBeenCalled();
  });
});
