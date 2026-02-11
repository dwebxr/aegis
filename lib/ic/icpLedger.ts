import { Actor, Identity } from "@dfinity/agent";
import { createAgent } from "./agent";
import { errMsg } from "@/lib/utils/errors";

const ICP_LEDGER_CANISTER_ID = "ryjl3-tyaaa-aaaaa-aaaba-cai";

// Minimal ICRC-1/2 IDL for balance, fee, approve, and allowance
/* eslint-disable @typescript-eslint/no-explicit-any */
const icpLedgerIdlFactory = ({ IDL }: { IDL: any }) => {
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const TransferArg = IDL.Record({
    from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    to: Account,
    amount: IDL.Nat,
    fee: IDL.Opt(IDL.Nat),
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
  });

  const TransferError = IDL.Variant({
    BadFee: IDL.Record({ expected_fee: IDL.Nat }),
    BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    TemporarilyUnavailable: IDL.Null,
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  });

  const ApproveArgs = IDL.Record({
    from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    spender: Account,
    amount: IDL.Nat,
    expected_allowance: IDL.Opt(IDL.Nat),
    expires_at: IDL.Opt(IDL.Nat64),
    fee: IDL.Opt(IDL.Nat),
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
  });

  const ApproveError = IDL.Variant({
    BadFee: IDL.Record({ expected_fee: IDL.Nat }),
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    AllowanceChanged: IDL.Record({ current_allowance: IDL.Nat }),
    Expired: IDL.Record({ ledger_time: IDL.Nat64 }),
    TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    TemporarilyUnavailable: IDL.Null,
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  });

  const AllowanceArgs = IDL.Record({
    account: Account,
    spender: Account,
  });

  const Allowance = IDL.Record({
    allowance: IDL.Nat,
    expires_at: IDL.Opt(IDL.Nat64),
  });

  return IDL.Service({
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc1_fee: IDL.Func([], [IDL.Nat], ["query"]),
    icrc1_transfer: IDL.Func([TransferArg], [IDL.Variant({ Ok: IDL.Nat, Err: TransferError })], []),
    icrc2_approve: IDL.Func([ApproveArgs], [IDL.Variant({ Ok: IDL.Nat, Err: ApproveError })], []),
    icrc2_allowance: IDL.Func([AllowanceArgs], [Allowance], ["query"]),
  });
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ICPLedgerActor {
  icrc1_balance_of: (account: { owner: import("@dfinity/principal").Principal; subaccount: [] }) => Promise<bigint>;
  icrc1_fee: () => Promise<bigint>;
  icrc2_approve: (args: {
    from_subaccount: [];
    spender: { owner: import("@dfinity/principal").Principal; subaccount: [] };
    amount: bigint;
    expected_allowance: [];
    expires_at: [];
    fee: [];
    memo: [];
    created_at_time: [];
  }) => Promise<{ Ok: bigint } | { Err: Record<string, unknown> }>;
  icrc2_allowance: (args: {
    account: { owner: import("@dfinity/principal").Principal; subaccount: [] };
    spender: { owner: import("@dfinity/principal").Principal; subaccount: [] };
  }) => Promise<{ allowance: bigint; expires_at: [] | [bigint] }>;
}

export async function createICPLedgerActorAsync(identity: Identity): Promise<ICPLedgerActor> {
  const agent = createAgent(identity);
  try {
    await agent.syncTime();
  } catch (err) {
    console.warn("[ic] ledger syncTime failed:", errMsg(err));
  }
  return Actor.createActor<ICPLedgerActor>(icpLedgerIdlFactory, {
    agent,
    canisterId: ICP_LEDGER_CANISTER_ID,
  });
}

export const ICP_FEE = BigInt(10_000); // 0.0001 ICP
export const MIN_STAKE = BigInt(100_000); // 0.001 ICP
export const MAX_STAKE = BigInt(100_000_000); // 1.0 ICP
export const E8S = BigInt(100_000_000); // 1 ICP in e8s

export function formatICP(e8s: bigint): string {
  const whole = e8s / E8S;
  const frac = e8s % E8S;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "") || "0";
  return `${whole}.${fracStr}`;
}
