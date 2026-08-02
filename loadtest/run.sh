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
SCRIPT="loadtest/read-paths.k6.js"

case "$BASE_URL" in
  *aegis-ai.xyz*|*aegis.dwebxr.xyz*)
    # The full scenario is a staging exercise, not a production one. Measured
    # against the current build it issues roughly 9,700 requests and ~5,600
    # function invocations — about 200-260 CPU seconds, which is close to a
    # whole day of this deployment's normal Vercel Active CPU on a free plan
    # shared with a live payment service. An earlier version of this warning
    # said "~250-400 requests" and gave a five-second Ctrl+C window; both were
    # off by more than an order of magnitude, so the full run is now opt-in and
    # production defaults to the small scenario.
    if [ "${LOADTEST_ALLOW_PROD:-}" != "1" ]; then
      cat >&2 <<EOF
ERROR: refusing to load-test PRODUCTION ($BASE_URL) without an explicit opt-in.

  The full scenario costs ~9,700 requests / ~5,600 function invocations /
  ~200-260 CPU seconds — roughly one day of this project's Active CPU budget,
  on a plan shared with the live payment service.

  Against production, run the small scenario instead:
      BASE_URL=$BASE_URL loadtest/run.sh          # after setting the opt-in below
  It is 3 VUs for 60s. To run it:
      LOADTEST_ALLOW_PROD=1 BASE_URL=$BASE_URL loadtest/run.sh

  To run the FULL scenario (staging only):
      BASE_URL=https://<staging-host> loadtest/run.sh
EOF
      exit 3
    fi
    SCRIPT="loadtest/read-paths-prod.k6.js"
    echo "  ⚠  Targeting PRODUCTION ($BASE_URL) with the reduced scenario (3 VUs × 60s)."
    ;;
esac

echo "k6 load test"
echo "  target:    $BASE_URL"
echo "  scenario:  $SCRIPT"
echo "  principal: ${AEGIS_FEED_PRINCIPAL:-<not set — feed e2e path skipped>}"
echo
exec k6 run "$SCRIPT"
