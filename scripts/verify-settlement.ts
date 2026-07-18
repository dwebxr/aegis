import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
  type Transport,
  type TransactionReceipt,
} from "viem";
import { base, baseSepolia } from "viem/chains";

export const BASE_USDC_PROXY = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
export const BASE_SEPOLIA_USDC_PROXY = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
export const BASE_USDC_IMPLEMENTATION = getAddress(
  "0x2Ce6311ddAE708829bc0784C967b7d77D19FD779",
);
export const BASE_SEPOLIA_USDC_IMPLEMENTATION = getAddress(
  "0xd74Cc5d436923b8bA2c179b4bcA2841D8A52C5B5",
);
export const ZOS_IMPLEMENTATION_SLOT = keccak256(
  stringToHex("org.zeppelinos.proxy.implementation"),
);

const authorizationAbi = parseAbi([
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);
const upgradedEvent = parseAbi(["event Upgraded(address indexed implementation)"])[0];

export type SettlementStatus = "settled" | "closed-unpaid" | "needs-review";
export type SettlementNetwork = "eip155:8453" | "eip155:84532";

const NETWORK_CONFIG = {
  "eip155:8453": {
    chain: base,
    rpcUrl: "https://mainnet.base.org",
    usdc: BASE_USDC_PROXY,
    expectedImplementation: BASE_USDC_IMPLEMENTATION,
  },
  "eip155:84532": {
    chain: baseSepolia,
    rpcUrl: "https://sepolia.base.org",
    usdc: BASE_SEPOLIA_USDC_PROXY,
    expectedImplementation: BASE_SEPOLIA_USDC_IMPLEMENTATION,
  },
} as const;

type SupportedBaseChain = typeof base | typeof baseSepolia;
type SupportedPublicClient = PublicClient<Transport, SupportedBaseChain>;

export interface VerifySettlementInput {
  txHash?: Hex;
  payer: Address;
  payTo: Address;
  amount: bigint;
  nonce: Hex;
  validBefore: bigint;
  usdc?: Address;
  network?: SettlementNetwork;
  expectedImplementation?: Address;
}

export interface SettlementEvidence {
  receiptBlock?: string;
  finalizedBlock?: string;
  receiptBlockHash?: Hex;
  implementation?: Address;
  implementationParentBlock?: string;
  authorizationLogIndex?: number;
  transferLogIndex?: number;
  compensationAllowed: boolean;
  reason: string;
}

export interface VerifySettlementResult {
  status: SettlementStatus;
  evidence: SettlementEvidence;
}

function needsReview(reason: string, evidence: Partial<SettlementEvidence> = {}): VerifySettlementResult {
  return {
    status: "needs-review",
    evidence: { compensationAllowed: false, reason, ...evidence },
  };
}

function addressFromStorage(value: Hex | undefined): Address | null {
  if (!value || value === "0x" || !/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  const raw = `0x${value.slice(-40)}` as Address;
  if (/^0x0{40}$/i.test(raw)) return null;
  return getAddress(raw);
}

function sameAddress(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

interface DecodedReceiptEvents {
  used: Array<{ authorizer: Address; nonce: Hex; logIndex: number }>;
  canceled: Array<{ authorizer: Address; nonce: Hex; logIndex: number }>;
  transfers: Array<{ from: Address; to: Address; value: bigint; logIndex: number }>;
}

function decodeReceiptEvents(receipt: TransactionReceipt, usdc: Address): DecodedReceiptEvents {
  const events: DecodedReceiptEvents = { used: [], canceled: [], transfers: [] };
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, usdc) || log.logIndex == null) continue;
    try {
      const decoded = decodeEventLog({ abi: authorizationAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "AuthorizationUsed") {
        events.used.push({
          authorizer: decoded.args.authorizer,
          nonce: decoded.args.nonce,
          logIndex: log.logIndex,
        });
      } else if (decoded.eventName === "AuthorizationCanceled") {
        events.canceled.push({
          authorizer: decoded.args.authorizer,
          nonce: decoded.args.nonce,
          logIndex: log.logIndex,
        });
      } else if (decoded.eventName === "Transfer") {
        events.transfers.push({
          from: decoded.args.from,
          to: decoded.args.to,
          value: decoded.args.value,
          logIndex: log.logIndex,
        });
      }
    } catch {
      // A USDC receipt contains events outside this deliberately small ABI.
    }
  }
  return events;
}

async function pinnedImplementation(
  client: SupportedPublicClient,
  usdc: Address,
  blockNumber: bigint,
): Promise<{ implementation: Address; parentBlock: bigint } | null> {
  if (blockNumber === 0n) return null;
  const parentBlock = blockNumber - 1n;
  const [receiptSlot, parentSlot, upgrades] = await Promise.all([
    client.getStorageAt({ address: usdc, slot: ZOS_IMPLEMENTATION_SLOT, blockNumber }),
    client.getStorageAt({ address: usdc, slot: ZOS_IMPLEMENTATION_SLOT, blockNumber: parentBlock }),
    client.getLogs({ address: usdc, event: upgradedEvent, fromBlock: blockNumber, toBlock: blockNumber }),
  ]);
  if (upgrades.length > 0) return null;

  // FiatTokenProxy.implementation() is protected by ifAdmin; a non-admin RPC
  // caller falls through to the implementation and reverts. The ZOS storage
  // slot is therefore the sole read-only source for this implementation pin.
  const implementations = [
    addressFromStorage(receiptSlot),
    addressFromStorage(parentSlot),
  ];
  if (implementations.some((value) => value === null)) return null;
  const [implementation] = implementations as Address[];
  if (!implementations.every((value) => value === implementation)) return null;
  return { implementation, parentBlock };
}

export async function verifySettlement(
  client: SupportedPublicClient,
  input: VerifySettlementInput,
): Promise<VerifySettlementResult> {
  if (!input.txHash) return needsReview("tx-hash-unknown");

  try {
    const network = input.network ?? "eip155:8453";
    const networkConfig = NETWORK_CONFIG[network];
    const usdc = getAddress(input.usdc ?? networkConfig.usdc);
    const expectedImplementation = getAddress(
      input.expectedImplementation ?? networkConfig.expectedImplementation,
    );
    const payer = getAddress(input.payer);
    const payTo = getAddress(input.payTo);
    const [receipt, finalizedBlock] = await Promise.all([
      client.getTransactionReceipt({ hash: input.txHash }),
      client.getBlock({ blockTag: "finalized" }),
    ]);
    const baseEvidence: Partial<SettlementEvidence> = {
      receiptBlock: receipt.blockNumber.toString(),
      finalizedBlock: finalizedBlock.number.toString(),
      receiptBlockHash: receipt.blockHash,
    };
    if (receipt.blockNumber > finalizedBlock.number) {
      return needsReview("receipt-not-finalized", baseEvidence);
    }

    const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (canonicalBlock.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      return needsReview("receipt-not-canonical", baseEvidence);
    }

    const pin = await pinnedImplementation(client, usdc, receipt.blockNumber);
    if (!pin) return needsReview("usdc-implementation-not-pinned", baseEvidence);
    const evidence: Partial<SettlementEvidence> = {
      ...baseEvidence,
      implementation: pin.implementation,
      implementationParentBlock: pin.parentBlock.toString(),
    };
    if (!sameAddress(pin.implementation, expectedImplementation)) {
      return needsReview("usdc-implementation-pin-mismatch", evidence);
    }

    const events = decodeReceiptEvents(receipt, usdc);
    const targetTransfers = events.transfers.filter((event) =>
      sameAddress(event.from, payer)
      && sameAddress(event.to, payTo)
      && event.value === input.amount);
    const authorization = events.used.find((event) =>
      sameAddress(event.authorizer, payer)
      && event.nonce.toLowerCase() === input.nonce.toLowerCase());
    const adjacentTransfer = authorization
      ? targetTransfers.find((event) => event.logIndex === authorization.logIndex + 1)
      : undefined;

    if (receipt.status === "success" && authorization && adjacentTransfer) {
      return {
        status: "settled",
        evidence: {
          ...evidence,
          authorizationLogIndex: authorization.logIndex,
          transferLogIndex: adjacentTransfer.logIndex,
          compensationAllowed: false,
          reason: "authorization-used-and-adjacent-transfer",
        },
      };
    }

    const canceled = events.canceled.find((event) =>
      sameAddress(event.authorizer, payer)
      && event.nonce.toLowerCase() === input.nonce.toLowerCase());
    if (canceled && targetTransfers.length === 0) {
      return {
        status: "closed-unpaid",
        evidence: {
          ...evidence,
          authorizationLogIndex: canceled.logIndex,
          compensationAllowed: false,
          reason: "authorization-canceled-without-transfer",
        },
      };
    }

    const finalizedTimestamp = finalizedBlock.timestamp;
    if (finalizedTimestamp >= input.validBefore && targetTransfers.length === 0) {
      const authorizationState = await client.readContract({
        address: usdc,
        abi: authorizationAbi,
        functionName: "authorizationState",
        args: [payer, input.nonce],
        blockNumber: finalizedBlock.number,
      });
      if (authorizationState === false) {
        return {
          status: "closed-unpaid",
          evidence: {
            ...evidence,
            compensationAllowed: true,
            reason: "authorization-expired-and-unused-at-finalized-head",
          },
        };
      }
    }

    return needsReview("settlement-state-indeterminate", evidence);
  } catch (error) {
    return needsReview(
      `rpc-or-decode-error:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function args(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument: ${key}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

async function main(): Promise<void> {
  const options = args(process.argv.slice(2));
  for (const required of ["payer", "pay-to", "amount", "nonce", "valid-before"] as const) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  const network = options.network ?? "eip155:8453";
  if (!(network in NETWORK_CONFIG)) {
    throw new Error("--network must be eip155:8453 or eip155:84532");
  }
  const networkConfig = NETWORK_CONFIG[network as SettlementNetwork];
  const client = createPublicClient({
    chain: networkConfig.chain,
    transport: http(options["rpc-url"] || process.env.BASE_RPC_URL || networkConfig.rpcUrl),
  });
  const result = await verifySettlement(client, {
    txHash: options.tx as Hex | undefined,
    payer: options.payer as Address,
    payTo: options["pay-to"] as Address,
    amount: BigInt(options.amount),
    nonce: options.nonce as Hex,
    validBefore: BigInt(options["valid-before"]),
    network: network as SettlementNetwork,
    expectedImplementation: options["expected-impl"]
      ? getAddress(options["expected-impl"])
      : networkConfig.expectedImplementation,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "needs-review") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
