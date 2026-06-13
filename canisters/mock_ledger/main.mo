import Ledger "../aegis_backend/ledger";

// TEST-ONLY mock ICRC-1/2 ledger. Lets the staking test harness drive deterministic
// transfer outcomes and count how many transfers the backend attempted, without
// touching real ICP. Deployed only on the local replica — never on mainnet.
//
// Its public surface is a width-supertype of Ledger.LedgerActor (it has every
// ledger method plus test hooks), so it is assignable to aegis_backend's
// `setTestLedger(l : Ledger.LedgerActor)`.
persistent actor MockLedger {
  var failTransfers : Bool = false; // when true, all transfers return an error
  var balance : Nat = 0;            // value returned by icrc1_balance_of
  var transferCount : Nat = 0;      // icrc1_transfer call count (refunds/payouts)
  var transferFromCount : Nat = 0;  // icrc2_transfer_from call count (deposits)
  var blockIndex : Nat = 0;

  // ── Test hooks ──
  public func setFailTransfers(v : Bool) : async () { failTransfers := v };
  public func setBalance(v : Nat) : async () { balance := v };
  public func reset() : async () { failTransfers := false; transferCount := 0; transferFromCount := 0 };
  public query func getTransferCount() : async Nat { transferCount };
  public query func getTransferFromCount() : async Nat { transferFromCount };

  // ── Ledger.LedgerActor surface ──
  public query func icrc1_balance_of(_ : Ledger.Account) : async Nat { balance };
  public query func icrc1_fee() : async Nat { 10_000 };

  public func icrc1_transfer(_args : Ledger.TransferArgs) : async Ledger.TransferResult {
    transferCount += 1;
    if (failTransfers) { #Err(#TemporarilyUnavailable) } else { blockIndex += 1; #Ok(blockIndex) };
  };

  public func icrc2_approve(_args : Ledger.ApproveArgs) : async Ledger.ApproveResult {
    blockIndex += 1; #Ok(blockIndex);
  };

  public func icrc2_transfer_from(_args : Ledger.TransferFromArgs) : async Ledger.TransferFromResult {
    transferFromCount += 1;
    if (failTransfers) { #Err(#InsufficientAllowance({ allowance = 0 })) } else { blockIndex += 1; #Ok(blockIndex) };
  };

  public query func icrc2_allowance(_args : Ledger.AllowanceArgs) : async Ledger.Allowance {
    { allowance = 1_000_000_000; expires_at = null };
  };
};
