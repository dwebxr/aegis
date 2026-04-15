#!/usr/bin/env bash
# Fail when `npm audit` reports any HIGH or CRITICAL severity vulnerability.
#
# Run before deploy:
#   scripts/audit-guard.sh
#
# Accepted moderate vulnerabilities (e.g. dompurify in @scalar/api-reference-react)
# are documented in PRE_DEPLOY.md "Known accepted limitations". A moderate→high
# escalation MUST trip this script and force a re-evaluation.

set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not on PATH" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq required (brew install jq)" >&2
  exit 2
fi

# Capture audit output. npm audit exits non-zero when vulns exist; we want to
# read the JSON regardless of exit code.
audit_json=$(npm audit --json 2>/dev/null || true)

if [ -z "$audit_json" ]; then
  echo "error: npm audit produced no output" >&2
  exit 2
fi

high_count=$(echo "$audit_json" | jq '[.vulnerabilities | to_entries[] | select(.value.severity == "high" or .value.severity == "critical")] | length')

if [ "$high_count" -eq 0 ]; then
  echo "audit-guard: PASS — 0 high/critical vulnerabilities"
  moderate_count=$(echo "$audit_json" | jq '[.vulnerabilities | to_entries[] | select(.value.severity == "moderate")] | length')
  echo "audit-guard: $moderate_count moderate (review against PRE_DEPLOY.md accepted list)"
  exit 0
fi

echo "audit-guard: FAIL — $high_count high/critical vulnerabilities"
echo
echo "$audit_json" | jq -r '.vulnerabilities | to_entries[] | select(.value.severity == "high" or .value.severity == "critical") | "  \(.key): \(.value.severity) — \(.value.via[0].title // .value.via[0])"'
echo
echo "Either patch the dependency, or add a documented exception to"
echo "PRE_DEPLOY.md 'Known accepted limitations' if the attack vector is"
echo "verified unreachable, then revisit this guard's exclusion list."
exit 1
