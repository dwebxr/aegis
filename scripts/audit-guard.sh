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
audit_status=0
node "$script_dir/audit-guard-lib.cjs" "$audit_dir/full.json" "$audit_dir/prod.json" "$script_dir/audit-allowlist.json" "$full_status" "$prod_status" || audit_status=$?
if (( audit_status == 2 )); then
  for tree in full prod; do
    if [[ -s "$audit_dir/$tree.err" ]]; then
      echo "audit-guard: npm stderr ($tree):" >&2
      cat "$audit_dir/$tree.err" >&2
    fi
  done
fi
exit "$audit_status"
