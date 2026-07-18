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
const OTHER_IMPLEMENTATION = "0x7777777777777777777777777777777777777777" as Address;
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
  finalizedUpgrades?: unknown[];
  finalizedImplementation?: Address;
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
    getStorageAt: jest.fn().mockImplementation(({
      slot,
      blockNumber,
    }: { slot: Hex; blockNumber: bigint }) => {
      expect(slot).toBe(ZOS_IMPLEMENTATION_SLOT);
      const implementation = blockNumber === finalizedBlock
          || blockNumber === finalizedBlock - 1n
        ? options.finalizedImplementation ?? IMPLEMENTATION
        : IMPLEMENTATION;
      return Promise.resolve(pad(implementation, { size: 32 }));
    }),
    readContract: jest.fn().mockResolvedValue(options.authorizationState ?? true),
    getLogs: jest.fn().mockImplementation(({ fromBlock }: { fromBlock: bigint }) =>
      Promise.resolve(fromBlock === finalizedBlock
        ? options.finalizedUpgrades ?? []
        : options.upgrades ?? [])),
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
        finalizedImplementation: IMPLEMENTATION,
        finalizedImplementationParentBlock: "199",
        receiptBlock: "100",
      }),
    });
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "authorizationState",
      blockNumber: 200n,
      args: [PAYER, NONCE],
    }));
    expect(client.getStorageAt).toHaveBeenCalledWith(expect.objectContaining({
      blockNumber: 200n,
    }));
    expect(client.getStorageAt).toHaveBeenCalledWith(expect.objectContaining({
      blockNumber: 199n,
    }));
  });

  it("returns needs-review when the finalized state block has a different implementation", async () => {
    const client = clientFor([], {
      finalizedTimestamp: 400n,
      finalizedImplementation: OTHER_IMPLEMENTATION,
      authorizationState: false,
    });

    const result = await verifySettlement(client as never, input);

    expect(result).toEqual({
      status: "needs-review",
      evidence: expect.objectContaining({
        implementation: IMPLEMENTATION,
        finalizedImplementation: OTHER_IMPLEMENTATION,
        reason: "usdc-finalized-implementation-pin-mismatch",
      }),
    });
    expect(client.readContract).not.toHaveBeenCalled();
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

  it("allows expired and unused compensation without a receipt after pinning finalized state", async () => {
    const client = clientFor([], {
      finalizedTimestamp: 400n,
      authorizationState: false,
    });

    const result = await verifySettlement(client as never, { ...input, txHash: undefined });

    expect(result).toEqual({
      status: "closed-unpaid",
      evidence: expect.objectContaining({
        compensationAllowed: true,
        finalizedBlock: "200",
        finalizedImplementation: IMPLEMENTATION,
        finalizedImplementationParentBlock: "199",
        reason: "authorization-expired-and-unused-at-finalized-head",
      }),
    });
    expect(client.getTransactionReceipt).not.toHaveBeenCalled();
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      blockNumber: 200n,
    }));
  });

  it("rejects receipt-less compensation when the finalized implementation mismatches", async () => {
    const client = clientFor([], {
      finalizedTimestamp: 400n,
      finalizedImplementation: OTHER_IMPLEMENTATION,
      authorizationState: false,
    });

    const result = await verifySettlement(client as never, { ...input, txHash: undefined });

    expect(result).toEqual({
      status: "needs-review",
      evidence: expect.objectContaining({
        finalizedImplementation: OTHER_IMPLEMENTATION,
        reason: "usdc-finalized-implementation-pin-mismatch",
      }),
    });
    expect(client.getTransactionReceipt).not.toHaveBeenCalled();
    expect(client.readContract).not.toHaveBeenCalled();
  });
});
