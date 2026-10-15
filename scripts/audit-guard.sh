#!/usr/bin/env bash
# Production high/critical findings always fail. Full-tree exceptions are
# advisory- and package-scoped, expiring entries in audit-allowlist.json.
set -euo pipefail

for tool in npm node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "audit-guard: CANNOT AUDIT — $tool not on PATH" >&2
    exit 2
  fi
done

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$script_dir/.."
audit_dir=$(mktemp -d) || exit 2
trap 'rm -rf "$audit_dir"' EXIT

# npm exits 1 for valid reports containing vulnerabilities. Preserve that report
# for evaluation; malformed/empty/error JSON is never treated as a clean audit.
full_status=0
prod_status=0
npm audit --json >"$audit_dir/full.json" 2>"$audit_dir/full.err" || full_status=$?
npm audit --omit=dev --json >"$audit_dir/prod.json" 2>"$audit_dir/prod.err" || prod_status=$?
if (( full_status > 1 || prod_status > 1 )); then
  echo "audit-guard: CANNOT AUDIT — npm exited full=$full_status prod=$prod_status" >&2
  exit 2
fi
node "$script_dir/audit-guard-lib.cjs" "$audit_dir/full.json" "$audit_dir/prod.json" "$script_dir/audit-allowlist.json"
