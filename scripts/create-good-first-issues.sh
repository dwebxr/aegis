#!/usr/bin/env bash
# Create the curated "good first issue" tickets on the Aegis GitHub repo.
#
# Idempotent: skips any ticket whose exact title is already an OPEN issue.
# Requires: `gh` CLI authenticated to dwebxr/aegis with `repo` scope, and the
# `good first issue` label (already present in the repo as of 2026-04-15).
#
# Source of truth for ticket bodies: .github/good-first-issues.md
# This script extracts each ticket's body from that file by H2 anchor.
#
# Usage:
#   scripts/create-good-first-issues.sh                 # create all 10 missing
#   scripts/create-good-first-issues.sh --dry-run       # print what would be created
#   scripts/create-good-first-issues.sh --only 1,3,7    # subset by ticket number

set -euo pipefail

REPO="dwebxr/aegis"
CATALOG="$(dirname "$0")/../.github/good-first-issues.md"
LABEL="good first issue"

if [[ ! -f "$CATALOG" ]]; then
  echo "error: catalog not found at $CATALOG" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI required (https://cli.github.com/)" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh CLI not authenticated. Run: gh auth login" >&2
  exit 1
fi

DRY_RUN=0
ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Each entry: "<num>|<title>"  (title must match the catalog H2 verbatim, minus the leading number)
TICKETS=(
  "1|Add LICENSE file (MIT)"
  "2|Deduplicate Anthropic API call across 3 routes"
  "3|Extract shared BYOK header parser"
  "4|Consolidate ThemeMode literal union to use shared type"
  "5|Drop unused export from social icon components"
  "6|Fix or remove the stale S4 Cross-Valid placeholder in IncineratorTab"
  "7|Document swSrc in next.config.mjs"
  "8|Add validatedLocalStorage helper and migrate one consumer"
  "9|Replace as any test mocks with typed factories"
  "10|Add SECURITY.md policy file"
)

# Fetch existing OPEN issue titles once (faster than per-ticket query).
# Stored newline-separated; matched with grep -Fx for exact-line equality.
EXISTING_TITLES="$(gh issue list -R "$REPO" --state open --limit 200 --json title --jq '.[].title')"

extract_body() {
  local num="$1"
  awk -v num="$num" '
    /^## [0-9]+\. / {
      if (capturing) { exit }
      n = $2 + 0
      if (n == num) { capturing = 1; next }
    }
    capturing { print }
  ' "$CATALOG" | sed '/^---$/,$d' | awk 'NF{p=1} p'
}

should_create() {
  local target="$1"
  local num="$2"
  if [[ -n "$ONLY" ]]; then
    [[ ",$ONLY," == *",$num,"* ]] || return 1
  fi
  if printf "%s\n" "$EXISTING_TITLES" | grep -Fxq "$target"; then
    return 1
  fi
  return 0
}

CREATED=0
SKIPPED=0
for entry in "${TICKETS[@]}"; do
  num="${entry%%|*}"
  title="${entry#*|}"

  if ! should_create "$title" "$num"; then
    echo "skip  #${num}  ${title}  (already open or filtered out)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  body="$(extract_body "$num")"
  if [[ -z "$body" ]]; then
    echo "warn  #${num}  ${title}  (body empty — catalog out of sync?)" >&2
    continue
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "would create  #${num}  ${title}  ($(echo "$body" | wc -l | tr -d ' ') lines)"
    CREATED=$((CREATED + 1))
    continue
  fi

  url="$(gh issue create -R "$REPO" \
    --title "$title" \
    --label "$LABEL" \
    --body "$body")"
  echo "created  #${num}  ${title}  ${url}"
  CREATED=$((CREATED + 1))
done

echo
echo "summary: created=${CREATED} skipped=${SKIPPED}"
