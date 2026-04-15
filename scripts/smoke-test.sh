#!/usr/bin/env bash
#
# Production smoke test for https://aegis-ai.xyz.
#
# Runs a handful of read-only assertions against the deployed site:
# /api/health is reachable and reports required env vars configured,
# /api/translate enforces BYOK (hotfix 17 + LARP audit C1), and the
# static landing page loads. Every assertion prints a PASS / FAIL line
# and the script exits non-zero on any FAIL so it's composable with CI
# or post-deploy checks.
#
# Usage:
#   scripts/smoke-test.sh                  # hit production
#   BASE_URL=https://staging.example scripts/smoke-test.sh
#   scripts/smoke-test.sh --verbose        # print raw response bodies
#
# This script makes NO writes, creates NO records, and does NOT consume
# rate-limit budget beyond a few GET/POST requests. Safe to run from
# any machine at any time.

set -uo pipefail

BASE_URL="${BASE_URL:-https://aegis-ai.xyz}"
VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    --verbose|-v) VERBOSE=1 ;;
    --help|-h)
      sed -n '2,19p' "$0" | sed 's/^# //;s/^#//'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

PASS=0
FAIL=0

pass() {
  echo "  PASS  $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "  FAIL  $1"
  [ $# -ge 2 ] && echo "        $2"
  FAIL=$((FAIL + 1))
}

verbose() {
  [ "$VERBOSE" -eq 1 ] && echo "        $1"
  return 0
}

# Fetch helper: emits the HTTP status on stdout and the body on fd 3.
# Usage: status=$(http_get <url> 3>/tmp/body)
http_get() {
  local url="$1"
  shift
  curl -s -o /tmp/smoke-body -w "%{http_code}" "$@" "$url"
}

http_post() {
  local url="$1"
  shift
  curl -s -o /tmp/smoke-body -w "%{http_code}" -X POST "$@" "$url"
}

echo "aegis smoke test"
echo "target: $BASE_URL"
echo

# ----- 1. health endpoint -----
echo "[1] /api/health"
status=$(http_get "$BASE_URL/api/health" -H "Accept: application/json")
if [ "$status" = "200" ]; then
  pass "returns 200"
else
  fail "expected 200, got $status" "$(cat /tmp/smoke-body 2>/dev/null | head -c 200)"
fi

if command -v jq >/dev/null 2>&1; then
  body_status=$(jq -r '.status // empty' /tmp/smoke-body 2>/dev/null)
  if [ "$body_status" = "ok" ] || [ "$body_status" = "degraded" ]; then
    pass "body has .status=$body_status"
  else
    fail ".status missing or invalid" "got: $body_status"
  fi

  anthropic=$(jq -r '.checks.anthropicKey // empty' /tmp/smoke-body 2>/dev/null)
  if [ "$anthropic" = "configured" ]; then
    pass "anthropic key configured"
  else
    fail "anthropic key not configured" "checks.anthropicKey=$anthropic"
  fi

  ic_status=$(jq -r '.checks.icCanister // empty' /tmp/smoke-body 2>/dev/null)
  if [ "$ic_status" = "reachable" ]; then
    pass "IC canister reachable"
  else
    fail "IC canister not reachable" "checks.icCanister=$ic_status"
  fi

  version=$(jq -r '.version // empty' /tmp/smoke-body 2>/dev/null)
  if [ -n "$version" ] && [ "$version" != "null" ]; then
    pass "deployed version: $version"
  else
    fail "version field missing"
  fi
else
  echo "  SKIP  jq not installed — skipping body structure checks"
fi
echo

# ----- 2. /api/translate BYOK enforcement -----
# Hotfix 17 + LARP audit C1: operators' Anthropic key must NEVER serve
# anonymous translation requests. The route must return 401 when no
# sk-ant- key is present in the x-user-api-key header.
echo "[2] /api/translate BYOK enforcement"
status=$(http_post "$BASE_URL/api/translate" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"smoke test prompt"}')
if [ "$status" = "401" ]; then
  pass "anonymous request rejected with 401"
else
  fail "expected 401, got $status" "$(cat /tmp/smoke-body 2>/dev/null | head -c 200)"
fi

status=$(http_post "$BASE_URL/api/translate" \
  -H "Content-Type: application/json" \
  -H "x-user-api-key: " \
  -d '{"prompt":"smoke test prompt"}')
if [ "$status" = "401" ]; then
  pass "empty x-user-api-key rejected with 401"
else
  fail "expected 401 for empty key, got $status"
fi

status=$(http_post "$BASE_URL/api/translate" \
  -H "Content-Type: application/json" \
  -H "x-user-api-key: sk-openai-fake" \
  -d '{"prompt":"smoke test prompt"}')
if [ "$status" = "401" ]; then
  pass "non-Anthropic-prefixed key rejected with 401"
else
  fail "expected 401 for non-sk-ant key, got $status"
fi
echo

# ----- 3. landing page -----
echo "[3] /"
status=$(http_get "$BASE_URL/" -H "Accept: text/html")
if [ "$status" = "200" ]; then
  pass "landing page returns 200"
else
  fail "expected 200, got $status"
fi
echo

# ----- 4. PWA manifest -----
# Served from public/manifest.json; layout.tsx sets `manifest:
# "/manifest.json"` in its metadata export.
echo "[4] PWA manifest"
status=$(http_get "$BASE_URL/manifest.json")
if [ "$status" = "200" ] || [ "$status" = "304" ]; then
  pass "manifest reachable ($status)"
  if command -v jq >/dev/null 2>&1; then
    manifest_name=$(jq -r '.name // empty' /tmp/smoke-body 2>/dev/null)
    if [ -n "$manifest_name" ] && [ "$manifest_name" != "null" ]; then
      pass "manifest has .name=$manifest_name"
    else
      fail "manifest .name missing"
    fi
  fi
else
  fail "manifest not served" "status=$status"
fi
echo

# ----- 5. /api-docs + /openapi.yaml -----
echo "[5] /api-docs + /openapi.yaml"
status=$(http_get "$BASE_URL/api-docs")
if [ "$status" = "200" ]; then
  if grep -q "scalar" /tmp/smoke-body 2>/dev/null; then
    pass "/api-docs renders Scalar viewer"
  else
    fail "/api-docs returned 200 but Scalar marker not in body"
  fi
else
  fail "/api-docs not served" "status=$status"
fi
status=$(http_get "$BASE_URL/openapi.yaml")
if [ "$status" = "200" ]; then
  if head -1 /tmp/smoke-body | grep -q "openapi:"; then
    pass "/openapi.yaml served as YAML"
  else
    fail "/openapi.yaml first line not OpenAPI"
  fi
else
  fail "/openapi.yaml not served" "status=$status"
fi
echo

# ----- 6. /api/feed/{rss,atom} contract -----
# Without AEGIS_FEED_PRINCIPAL set, only the validation contract is exercised
# (400 / 404 paths). With AEGIS_FEED_PRINCIPAL=<known-principal>, also probes
# end-to-end IC briefing → RSS render.
echo "[6] /api/feed contract"
status=$(http_get "$BASE_URL/api/feed/rss")
if [ "$status" = "400" ]; then pass "rss missing-principal → 400"; else fail "rss missing-principal expected 400" "got $status"; fi
status=$(http_get "$BASE_URL/api/feed/rss?principal=!!!invalid!!!")
if [ "$status" = "400" ]; then pass "rss bad-principal → 400"; else fail "rss bad-principal expected 400" "got $status"; fi
status=$(http_get "$BASE_URL/api/feed/atom")
if [ "$status" = "400" ]; then pass "atom missing-principal → 400"; else fail "atom missing-principal expected 400" "got $status"; fi

if [ -n "${AEGIS_FEED_PRINCIPAL:-}" ]; then
  status=$(http_get "$BASE_URL/api/feed/rss?principal=$AEGIS_FEED_PRINCIPAL")
  if [ "$status" = "200" ]; then
    if head -1 /tmp/smoke-body | grep -q '<?xml'; then
      pass "rss real-IC e2e: principal $AEGIS_FEED_PRINCIPAL → valid XML"
    else
      fail "rss real-IC: 200 but body is not XML" "first line: $(head -1 /tmp/smoke-body)"
    fi
  elif [ "$status" = "404" ]; then
    pass "rss real-IC e2e: principal $AEGIS_FEED_PRINCIPAL → 404 (no briefing yet, contract OK)"
  else
    fail "rss real-IC: principal $AEGIS_FEED_PRINCIPAL unexpected" "status=$status"
  fi
else
  echo "  skip: real-IC e2e (set AEGIS_FEED_PRINCIPAL to enable)"
fi
echo

# ----- summary -----
echo "—"
echo "passed: $PASS"
echo "failed: $FAIL"
rm -f /tmp/smoke-body

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
