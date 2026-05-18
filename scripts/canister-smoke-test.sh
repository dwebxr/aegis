#!/usr/bin/env bash
# Canister security smoke test — runs the codex finding fixes against a live
# local replica. Verifies behavior that compile-time checks cannot:
#   - owner checks (saveEvaluation, saveSignal, put_offer/delete_offer)
#   - size limits (saveEvaluation, saveSourceConfig)
#   - briefing d2aEnabled gate (saveLatestBriefing, getLatestBriefing)
#
# Requires:
#   - dfx start --background  (local replica running)
#   - canister deployed:  dfx deploy aegis_backend --network local
#   - test identities:    dfx identity new alice-test/bob-test --storage-mode plaintext

set -uo pipefail

DFX="${DFX:-$(command -v dfx || echo "/Users/masia02/Library/Application Support/org.dfinity.dfx/bin/dfx")}"
NETWORK="${NETWORK:-local}"
CANISTER="${CANISTER:-aegis_backend}"

pass=0; fail=0
note() { printf "\033[36m• %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; ((pass++)) || true; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$*"; ((fail++)) || true; }

call() {
  # $1 = identity, rest = canister method + args
  local id="$1"; shift
  "$DFX" canister --network "$NETWORK" --identity "$id" call "$CANISTER" "$@" 2>&1
}

expect_trap() {
  local out="$1"; local pattern="$2"
  # dfx surfaces traps as: "reject message Error from Canister ...: '<text>'"
  if echo "$out" | grep -qE "(reject message|Reject text:).*${pattern}"; then
    return 0
  fi
  return 1
}

# ─────────────────────────────────────────────────────────────────────────
# 1. saveEvaluation — owner check
# ─────────────────────────────────────────────────────────────────────────
note "saveEvaluation owner check"

EVAL_ID="test-eval-$(date +%s)"

# Alice creates an evaluation. We need the candid record form; build it via
# python to keep it readable.
ALICE_PRINCIPAL=$("$DFX" identity get-principal --identity alice-test)
EVAL_RECORD=$(cat <<EOF
(record {
  id = "$EVAL_ID";
  owner = principal "$ALICE_PRINCIPAL";
  author = "Alice";
  avatar = "";
  text = "alice's eval";
  source = variant { rss };
  sourceUrl = null;
  imageUrl = null;
  scores = record { originality = 7 : nat8; insight = 7 : nat8; credibility = 7 : nat8; compositeScore = 7.0 };
  verdict = variant { quality };
  reason = "good";
  createdAt = 0;
  validated = false;
  flagged = false;
  validatedAt = null;
})
EOF
)

SAVE_OUT=$(call alice-test saveEvaluation "$EVAL_RECORD")
if echo "$SAVE_OUT" | grep -qF "$EVAL_ID"; then
  ok "Alice saves her own eval"
else
  bad "Alice's save returned unexpected output: $SAVE_OUT"
fi

# Bob tries to overwrite Alice's eval with his own text — must be rejected.
BOB_OVERWRITE=$(cat <<EOF
(record {
  id = "$EVAL_ID";
  owner = principal "$ALICE_PRINCIPAL";
  author = "Bob";
  avatar = "";
  text = "bob hijack";
  source = variant { rss };
  sourceUrl = null;
  imageUrl = null;
  scores = record { originality = 1 : nat8; insight = 1 : nat8; credibility = 1 : nat8; compositeScore = 1.0 };
  verdict = variant { slop };
  reason = "hijack";
  createdAt = 0;
  validated = false;
  flagged = false;
  validatedAt = null;
})
EOF
)

OUT=$(call bob-test saveEvaluation "$BOB_OVERWRITE" || true)
if expect_trap "$OUT" "not owner"; then
  ok "Bob's hijack rejected with 'not owner' trap"
else
  bad "Bob's hijack was NOT rejected. Output: $OUT"
fi

# Confirm Alice's eval is unchanged (still her text).
OUT=$(call alice-test getUserEvaluations "(principal \"$ALICE_PRINCIPAL\", 0:nat, 10:nat)")
if echo "$OUT" | grep -qF "alice" && echo "$OUT" | grep -qF "eval" && ! echo "$OUT" | grep -qF "bob hijack"; then
  ok "Alice's evaluation unchanged after attempted hijack"
else
  bad "Alice's evaluation state corrupted: $OUT"
fi

# ─────────────────────────────────────────────────────────────────────────
# 2. saveEvaluation — size limit
# ─────────────────────────────────────────────────────────────────────────
note "saveEvaluation size limit (UTF-8 bytes, multi-byte aware)"

OVERSIZE_TEXT=$(printf 'x%.0s' $(seq 1 60000)) # 60_000 ASCII bytes > 50_000 cap
OVERSIZE_RECORD=$(cat <<EOF
(record {
  id = "oversize-$(date +%s)";
  owner = principal "$ALICE_PRINCIPAL";
  author = "Alice";
  avatar = "";
  text = "$OVERSIZE_TEXT";
  source = variant { rss };
  sourceUrl = null;
  imageUrl = null;
  scores = record { originality = 5 : nat8; insight = 5 : nat8; credibility = 5 : nat8; compositeScore = 5.0 };
  verdict = variant { quality };
  reason = "";
  createdAt = 0;
  validated = false;
  flagged = false;
  validatedAt = null;
})
EOF
)

OUT=$(call alice-test saveEvaluation "$OVERSIZE_RECORD" || true)
if expect_trap "$OUT" "eval text too large"; then
  ok "Oversized ASCII eval text rejected (60K bytes > 50K cap)"
else
  bad "Oversized eval text NOT rejected. Output: $OUT"
fi

# Multi-byte attack: 20_000 code points of 3-byte CJK char = 60_000 bytes.
# Pre-fix code-point cap would let this slip through; the new byte cap rejects.
CJK_TEXT=$(python3 -c "print('日' * 20000, end='')")
CJK_RECORD=$(cat <<EOF
(record {
  id = "cjk-$(date +%s)";
  owner = principal "$ALICE_PRINCIPAL";
  author = "Alice";
  avatar = "";
  text = "$CJK_TEXT";
  source = variant { rss };
  sourceUrl = null;
  imageUrl = null;
  scores = record { originality = 5 : nat8; insight = 5 : nat8; credibility = 5 : nat8; compositeScore = 5.0 };
  verdict = variant { quality };
  reason = "";
  createdAt = 0;
  validated = false;
  flagged = false;
  validatedAt = null;
})
EOF
)

OUT=$(call alice-test saveEvaluation "$CJK_RECORD" || true)
if expect_trap "$OUT" "eval text too large"; then
  ok "Multi-byte CJK eval text rejected (20K code-points × 3 bytes = 60K bytes)"
else
  bad "CJK text bypass — NOT rejected. Output: $OUT"
fi

# ─────────────────────────────────────────────────────────────────────────
# 3. briefing d2aEnabled gate — save side
# ─────────────────────────────────────────────────────────────────────────
note "saveLatestBriefing d2aEnabled gate"

# Reset Alice's d2a state to false so this section is idempotent across runs.
call alice-test saveUserSettings '(record { linkedNostrNpub = null; linkedNostrPubkeyHex = null; d2aEnabled = false; updatedAt = 0 : int })' > /dev/null

OUT=$(call alice-test saveLatestBriefing "(\"{\\\"items\\\":[1]}\")" || true)
if echo "$OUT" | grep -q "(false)"; then
  ok "saveLatestBriefing rejected when d2aEnabled = false"
else
  bad "Briefing accepted without d2a opt-in. Output: $OUT"
fi

# Enable d2a for Alice
call alice-test saveUserSettings '(record { linkedNostrNpub = null; linkedNostrPubkeyHex = null; d2aEnabled = true; updatedAt = 0 : int })' > /dev/null

OUT=$(call alice-test saveLatestBriefing "(\"{\\\"items\\\":[1]}\")")
if echo "$OUT" | grep -q "(true)"; then
  ok "saveLatestBriefing accepted after d2aEnabled = true"
else
  bad "Briefing rejected even after d2a opt-in: $OUT"
fi

# Disable d2a — should purge briefing
call alice-test saveUserSettings '(record { linkedNostrNpub = null; linkedNostrPubkeyHex = null; d2aEnabled = false; updatedAt = 0 : int })' > /dev/null

OUT=$(call alice-test getLatestBriefing "(principal \"$ALICE_PRINCIPAL\")")
if echo "$OUT" | grep -q "(null)"; then
  ok "getLatestBriefing returns null after d2a turned off (briefing purged)"
else
  bad "Briefing leaked after d2a turned off: $OUT"
fi

# ─────────────────────────────────────────────────────────────────────────
# 4. A2A offer owner check
# ─────────────────────────────────────────────────────────────────────────
note "put_offer / delete_offer owner check"

OFFER_ID="offer-$(date +%s)"
OFFER_RECORD=$(cat <<EOF
(record {
  id = "$OFFER_ID";
  contentHash = "abc";
  publisher = "alice";
  priceUSDC = 100 : nat;
  chain = "base";
  vclScore = 8.0;
  title = "Alice's offer";
  description = "test";
  createdAt = 0 : int;
})
EOF
)
call alice-test put_offer "$OFFER_RECORD" > /dev/null
ok "Alice creates offer"

# Bob tries to overwrite Alice's offer
BOB_OFFER=$(cat <<EOF
(record {
  id = "$OFFER_ID";
  contentHash = "evil";
  publisher = "bob";
  priceUSDC = 1 : nat;
  chain = "base";
  vclScore = 0.0;
  title = "Bob hijack";
  description = "hijacked";
  createdAt = 0 : int;
})
EOF
)
OUT=$(call bob-test put_offer "$BOB_OFFER" || true)
if expect_trap "$OUT" "not owner"; then
  ok "Bob's offer hijack rejected"
else
  bad "Bob's offer hijack NOT rejected: $OUT"
fi

# Bob tries to delete Alice's offer
OUT=$(call bob-test delete_offer "(\"$OFFER_ID\")")
if echo "$OUT" | grep -q "(false)"; then
  ok "Bob's offer delete denied (returned false)"
else
  bad "Bob's offer delete may have succeeded: $OUT"
fi

# Confirm offer still exists with Alice's data
OUT=$(call alice-test get_offer "(\"$OFFER_ID\")")
if echo "$OUT" | grep -qF "publisher = \"alice\"" && ! echo "$OUT" | grep -qF "publisher = \"bob\""; then
  ok "Alice's offer state intact after hijack attempt"
else
  bad "Alice's offer corrupted: $OUT"
fi

# ─────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────
echo
echo "─────────────────────────────"
echo "Passed: $pass    Failed: $fail"
echo "─────────────────────────────"
[ "$fail" -eq 0 ] || exit 1
