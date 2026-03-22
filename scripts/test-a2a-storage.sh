#!/usr/bin/env bash
# A2A Storage integration test — real Motoko code paths via dfx canister call.
# Prereq: dfx start --background && dfx deploy aegis_backend
# Usage:  ./scripts/test-a2a-storage.sh [--network local|ic]
set -euo pipefail

NETWORK="${1:---network local}"
DFX="/Users/masia02/Library/Application Support/org.dfinity.dfx/bin/dfx"
PASS=0 FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

assert_contains() {
  if echo "$2" | grep -q "$3"; then green "  PASS: $1"; PASS=$((PASS+1))
  else red "  FAIL: $1 — expected '$3'"; echo "    $2"; FAIL=$((FAIL+1)); fi
}

call() { "$DFX" canister call $NETWORK aegis_backend "$@" 2>&1; }

echo "=== A2A Storage Integration Tests ==="

echo "1. empty store"
OUT=$(call get_offers '(10 : nat, 0 : nat)')
assert_contains "get_offers returns vec {}" "$OUT" "vec {}"

echo "2. put_offer"
call put_offer '(record { id="test-offer-1"; contentHash="sha256-test"; publisher="npub1test"; priceUSDC=1000000:nat; chain="base"; vclScore=8.5:float64; title="Test Offer"; description="Desc"; createdAt=1711100000000000000:int })' > /dev/null
green "  PASS: put_offer succeeded"; PASS=$((PASS+1))

echo "3. get_offers retrieves it"
OUT=$(call get_offers '(10 : nat, 0 : nat)')
assert_contains "id present" "$OUT" "test-offer-1"
assert_contains "title present" "$OUT" "Test Offer"

echo "4. second offer (earlier timestamp)"
call put_offer '(record { id="test-offer-2"; contentHash="sha256-old"; publisher="npub1other"; priceUSDC=0:nat; chain="solana"; vclScore=3.0:float64; title="Old Offer"; description="Earlier"; createdAt=1700000000000000000:int })' > /dev/null

echo "5. pagination: limit=1 → newest"
OUT=$(call get_offers '(1 : nat, 0 : nat)')
assert_contains "newest first" "$OUT" "test-offer-1"

echo "6. pagination: offset=1 → older"
OUT=$(call get_offers '(1 : nat, 1 : nat)')
assert_contains "second item" "$OUT" "test-offer-2"

echo "7. offset beyond total → empty"
OUT=$(call get_offers '(10 : nat, 100 : nat)')
assert_contains "empty vec" "$OUT" "vec {}"

echo "8. submit_receipt (verified=true sent, should be forced false)"
call submit_receipt '(record { txHash="0xabc"; chain="base"; contentHash="sha256-test"; payer="0xpayer"; amount=1000000:nat; verified=true })' > /dev/null

echo "9. get_receipt: verified forced false"
OUT=$(call get_receipt '("0xabc")')
assert_contains "found" "$OUT" "0xabc"
assert_contains "verified=false" "$OUT" "verified = false"

echo "10. get_receipt: non-existent → null"
OUT=$(call get_receipt '("0xnope")')
assert_contains "null" "$OUT" "null"

echo "11. verify_payment_manual: existing"
OUT=$(call verify_payment_manual '("0xabc")')
assert_contains "true" "$OUT" "true"

echo "12. receipt now verified=true"
OUT=$(call get_receipt '("0xabc")')
assert_contains "verified=true" "$OUT" "verified = true"

echo "13. verify non-existent → false"
OUT=$(call verify_payment_manual '("0xnope")')
assert_contains "false" "$OUT" "false"

echo "14. verify idempotent"
OUT=$(call verify_payment_manual '("0xabc")')
assert_contains "still true" "$OUT" "true"

echo "15. 10KB at limit"
T=$(printf 'A%.0s' $(seq 1 5000)); D=$(printf 'B%.0s' $(seq 1 5000))
call put_offer "(record { id=\"lim\"; contentHash=\"h\"; publisher=\"p\"; priceUSDC=0:nat; chain=\"icp\"; vclScore=5.0:float64; title=\"$T\"; description=\"$D\"; createdAt=0:int })" > /dev/null
green "  PASS: 10KB accepted"; PASS=$((PASS+1))

echo "16. 10KB+1 traps"
D2=$(printf 'C%.0s' $(seq 1 5001))
OUT=$(call put_offer "(record { id=\"over\"; contentHash=\"h\"; publisher=\"p\"; priceUSDC=0:nat; chain=\"icp\"; vclScore=5.0:float64; title=\"$T\"; description=\"$D2\"; createdAt=0:int })" 2>&1 || true)
assert_contains "traps" "$OUT" "exceeds 10KB"

echo "17. get_a2a_stats"
OUT=$(call get_a2a_stats '()')
assert_contains "offerCount present" "$OUT" "offerCount"
assert_contains "receiptCount present" "$OUT" "receiptCount"

echo "18. re-submit verified receipt is rejected (stays verified)"
call submit_receipt '(record { txHash="0xabc"; chain="solana"; contentHash="sha256-tampered"; payer="0xattacker"; amount=0:nat; verified=false })' > /dev/null
OUT=$(call get_receipt '("0xabc")')
assert_contains "still verified=true" "$OUT" "verified = true"
assert_contains "original chain preserved" "$OUT" 'chain = "base"'
assert_contains "original payer preserved" "$OUT" 'payer = "0xpayer"'

echo "19. verify_payment_manual rejects anonymous caller"
# dfx canister call with --identity anonymous uses the anonymous principal
OUT=$("$DFX" canister call $NETWORK aegis_backend verify_payment_manual '("0xabc")' --identity anonymous 2>&1 || true)
assert_contains "anonymous rejected (false)" "$OUT" "false"
# Confirm receipt is still verified (anonymous didn't flip it)
OUT=$(call get_receipt '("0xabc")')
assert_contains "still verified after anon attempt" "$OUT" "verified = true"

echo "20. upsert: same ID overwrites"
call put_offer '(record { id="test-offer-1"; contentHash="sha256-v2"; publisher="npub1test"; priceUSDC=2000000:nat; chain="base"; vclScore=9.0:float64; title="Updated"; description="New desc"; createdAt=1711200000000000000:int })' > /dev/null
OUT=$(call get_offers '(10 : nat, 0 : nat)')
assert_contains "updated title" "$OUT" "Updated"
assert_contains "updated hash" "$OUT" "sha256-v2"

echo ""
echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" -gt 0 ] && { red "FAILED"; exit 1; } || green "ALL PASSED"
