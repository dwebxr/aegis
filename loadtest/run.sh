#!/usr/bin/env bash
#
# Wrapper around `k6 run loadtest/read-paths.k6.js` that:
#   - checks k6 is installed (with install instructions if not)
#   - validates BASE_URL is set or defaults to localhost
#   - prints a clear warning if pointing at production
#
# Not for CI use — load tests cost money + risk consuming rate-limit
# budget. Run from a developer machine against staging or against
# production during a planned exercise.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v k6 >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: k6 not found in PATH.

Install:
  macOS:  brew install k6
  Linux:  https://grafana.com/docs/k6/latest/set-up/install-k6/
  Docker: docker run -i grafana/k6 run - <loadtest/read-paths.k6.js
EOF
  exit 2
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"

case "$BASE_URL" in
  *aegis-ai.xyz*|*aegis.dwebxr.xyz*)
    echo "  ⚠  Targeting PRODUCTION ($BASE_URL)."
    echo "  ⚠  This will issue ~250-400 requests over 4-5 minutes against the live"
    echo "  ⚠  rate limiters. Stay below 25 concurrent VUs and confirm no real"
    echo "  ⚠  user activity is impacted. Press Ctrl+C in the next 5 seconds to abort."
    sleep 5
    ;;
esac

echo "k6 load test"
echo "  target:    $BASE_URL"
echo "  principal: ${AEGIS_FEED_PRINCIPAL:-<not set — feed e2e path skipped>}"
echo
exec k6 run loadtest/read-paths.k6.js
