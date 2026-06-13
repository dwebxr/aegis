#!/usr/bin/env bash
# Local-replica financial-flow tests for the staking system (PR-B).
#
# Verifies the publishWithStake #pending state machine, collision guard,
# transfer-failure rollback, submit_receipt ownership, and an install->upgrade
# state-intact check — all against a mock ICRC ledger so no real ICP moves.
#
# Usage: scripts/canister-stake-test.sh   (starts a clean local replica)
set -uo pipefail

DFX="${DFX:-dfx}"
pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }
# assert_contains <description> <haystack> <needle>
assert_contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 — got: $2";; esac; }

echo "== Starting clean local replica =="
"$DFX" stop >/dev/null 2>&1 || true
"$DFX" start --clean --background >/dev/null 2>&1
trap '"$DFX" stop >/dev/null 2>&1 || true' EXIT

echo "== Deploying aegis_backend + mock_ledger =="
"$DFX" deploy aegis_backend >/dev/null 2>&1 || { echo "deploy aegis_backend failed"; exit 1; }
"$DFX" deploy mock_ledger  >/dev/null 2>&1 || { echo "deploy mock_ledger failed"; exit 1; }
MOCK=$("$DFX" canister id mock_ledger)
echo "  mock_ledger = $MOCK"

# Point the backend's financial flows at the mock ledger.
"$DFX" canister call aegis_backend setTestLedger "(principal \"$MOCK\")" >/dev/null 2>&1
"$DFX" canister call mock_ledger reset >/dev/null 2>&1

# Identities: owner publishes, voter would validate.
"$DFX" identity new staketest_owner --disable-encryption >/dev/null 2>&1 || true
"$DFX" identity use staketest_owner >/dev/null 2>&1

SIGNAL='record { id="sig-aaa"; owner=principal "aaaaa-aa"; text="hello"; nostrEventId=null; nostrPubkey=null; scores=record { originality=5:nat8; insight=5:nat8; credibility=5:nat8; compositeScore=5.0:float64 }; verdict=variant { quality }; topics=vec { "t" }; createdAt=0:int }'

echo "== Scenario 1: successful publish leaves the stake #active =="
"$DFX" canister call mock_ledger setFailTransfers '(false)' >/dev/null 2>&1
R=$("$DFX" canister call aegis_backend publishWithStake "($SIGNAL, 100000:nat)" 2>&1)
assert_contains "publishWithStake succeeds" "$R" "ok"
S=$("$DFX" canister call aegis_backend getSignalStake '("sig-aaa")' 2>&1)
assert_contains "stake is #active after deposit clears" "$S" "active"
TF=$("$DFX" canister call mock_ledger getTransferFromCount 2>&1)
assert_contains "exactly one deposit transfer_from" "$TF" "1"

echo "== Scenario 2: collision guard rejects a duplicate signal id =="
R=$("$DFX" canister call aegis_backend publishWithStake "($SIGNAL, 100000:nat)" 2>&1)
assert_contains "duplicate id rejected" "$R" "already exists"

echo "== Scenario 3: transfer-failure rolls back (no orphan stake) =="
"$DFX" canister call mock_ledger setFailTransfers '(true)' >/dev/null 2>&1
SIGNAL2=${SIGNAL/sig-aaa/sig-bbb}
R=$("$DFX" canister call aegis_backend publishWithStake "($SIGNAL2, 100000:nat)" 2>&1)
assert_contains "publish fails when deposit fails" "$R" "err"
S=$("$DFX" canister call aegis_backend getSignalStake '("sig-bbb")' 2>&1)
assert_contains "no stake left after rollback" "$S" "null"

echo "== Scenario 4: submit_receipt ownership (other principal cannot overwrite) =="
"$DFX" canister call aegis_backend submit_receipt '(record { txHash="0xtx"; chain="base"; contentHash="h"; payer="0xAlice"; amount=1:nat; verified=false })' >/dev/null 2>&1
"$DFX" identity new staketest_other --disable-encryption >/dev/null 2>&1 || true
"$DFX" identity use staketest_other >/dev/null 2>&1
"$DFX" canister call aegis_backend submit_receipt '(record { txHash="0xtx"; chain="base"; contentHash="h"; payer="0xBob"; amount=1:nat; verified=false })' >/dev/null 2>&1
G=$("$DFX" canister call aegis_backend get_receipt '("0xtx")' 2>&1)
assert_contains "receipt payer unchanged by a different submitter" "$G" "0xAlice"
"$DFX" identity use staketest_owner >/dev/null 2>&1

echo "== Scenario 5: install -> upgrade keeps stake state intact =="
"$DFX" deploy aegis_backend --mode upgrade >/dev/null 2>&1 || bad "upgrade deploy failed"
# Ledger override is transient — re-point after upgrade.
"$DFX" canister call aegis_backend setTestLedger "(principal \"$MOCK\")" >/dev/null 2>&1
S=$("$DFX" canister call aegis_backend getSignalStake '("sig-aaa")' 2>&1)
assert_contains "sig-aaa stake survives upgrade as #active" "$S" "active"

echo
echo "== Result: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
