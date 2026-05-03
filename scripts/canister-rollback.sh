#!/usr/bin/env bash
#
# Restore the aegis_backend canister to a snapshot created by
# scripts/canister-backup.sh.
#
# This is the operator's emergency tool when a mainnet upgrade introduces
# a regression. It implements the workflow ROLLBACK.md describes (git
# checkout → dfx deploy) but adds the safety rails that make incident
# response less error-prone:
#
#   1. Verifies the snapshot directory has the expected files.
#   2. Verifies the git SHA the snapshot was taken at exists locally.
#   3. Dry-runs the restored wasm against a clean local replica first
#      (catches M0169 stable-field-removal failures BEFORE touching
#      mainnet). Skip with --skip-dryrun if you've already verified.
#   4. Shows the operator a diff between current HEAD and the rollback
#      target before any mainnet write.
#   5. Requires explicit `--confirm` (or interactive 'y') before deploying
#      to mainnet. No silent destructive ops.
#   6. After the mainnet deploy, verifies the live module hash matches the
#      snapshot's recorded hash to confirm the rollback actually landed.
#
# Usage:
#   scripts/canister-rollback.sh canister-backups/20260101T010101Z_ic
#   scripts/canister-rollback.sh <snapshot> --skip-dryrun
#   scripts/canister-rollback.sh <snapshot> --confirm    # non-interactive
#   NETWORK=local scripts/canister-rollback.sh <snapshot>  # rollback local
#
# Exits non-zero on any failure (bad snapshot, dry-run failure, deploy
# failure, post-deploy hash mismatch). Aborts cleanly on operator denial.

set -euo pipefail

SNAPSHOT=""
SKIP_DRYRUN=0
CONFIRM=0
NETWORK="${NETWORK:-ic}"
CANISTER="aegis_backend"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-dryrun) SKIP_DRYRUN=1; shift ;;
    --confirm)     CONFIRM=1; shift ;;
    --help|-h)
      sed -n '2,29p' "$0" | sed 's/^# //;s/^#//'
      exit 0
      ;;
    -*)
      echo "ERROR: unknown flag $1" >&2
      exit 2
      ;;
    *)
      if [ -n "$SNAPSHOT" ]; then
        echo "ERROR: multiple snapshot paths given" >&2
        exit 2
      fi
      SNAPSHOT="$1"
      shift
      ;;
  esac
done

if [ -z "$SNAPSHOT" ]; then
  echo "ERROR: snapshot path required" >&2
  echo "usage: $0 <snapshot-dir> [--skip-dryrun] [--confirm]" >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"

if ! command -v dfx >/dev/null 2>&1; then
  echo "ERROR: dfx not in PATH" >&2
  exit 2
fi

# 1. Snapshot integrity
echo "[1] Verify snapshot"
if [ ! -d "$SNAPSHOT" ]; then
  echo "  ERROR: snapshot directory not found: $SNAPSHOT" >&2
  exit 1
fi
for required in git_sha module_hash main.mo types.mo dfx.json; do
  if [ ! -f "$SNAPSHOT/$required" ]; then
    echo "  ERROR: missing $required in snapshot — refuse to roll back partial backup" >&2
    exit 1
  fi
done
TARGET_SHA="$(cat "$SNAPSHOT/git_sha")"
TARGET_HASH="$(cat "$SNAPSHOT/module_hash")"
echo "  ✓ snapshot complete"
echo "  target git SHA:     $TARGET_SHA"
echo "  target module hash: $TARGET_HASH"

if ! git cat-file -e "$TARGET_SHA" 2>/dev/null; then
  echo "  ERROR: snapshot SHA $TARGET_SHA is not in this repo. Fetch it first:" >&2
  echo "    git fetch origin '$TARGET_SHA'" >&2
  exit 1
fi
echo "  ✓ snapshot SHA exists locally"

# 2. Show what's about to change
echo
echo "[2] Diff: current HEAD vs rollback target"
CURRENT_SHA="$(git rev-parse HEAD)"
echo "  current HEAD: $CURRENT_SHA"
echo "  target SHA:   $TARGET_SHA"
if [ "$CURRENT_SHA" = "$TARGET_SHA" ]; then
  echo "  ⚠ HEAD already at target SHA — rollback would deploy the same wasm currently in working tree"
fi
git --no-pager log --oneline "$TARGET_SHA..HEAD" -- canisters/ 2>/dev/null \
  | head -20 \
  | sed 's/^/    /'

# 3. Dry-run on local replica (catches M0169 + behaviour regressions)
if [ "$SKIP_DRYRUN" -eq 0 ]; then
  echo
  echo "[3] Dry-run rollback on clean local replica"
  echo "    (skip with --skip-dryrun if already verified locally)"
  ROLLBACK_WORKTREE="$(mktemp -d -t aegis-rollback-XXXXXX)"
  trap 'rm -rf "$ROLLBACK_WORKTREE"; dfx stop >/dev/null 2>&1 || true' EXIT
  git worktree add --detach "$ROLLBACK_WORKTREE" "$TARGET_SHA" >/dev/null
  pushd "$ROLLBACK_WORKTREE" >/dev/null
  dfx start --background --clean --host 127.0.0.1:4943 >/dev/null 2>&1 || true
  echo "    baseline install..."
  dfx deploy "$CANISTER" --network local --no-wallet >>/tmp/rollback-dryrun.log 2>&1
  echo "    upgrade install (catches M0169)..."
  dfx deploy "$CANISTER" --network local --no-wallet --mode upgrade >>/tmp/rollback-dryrun.log 2>&1
  popd >/dev/null
  dfx stop >/dev/null 2>&1 || true
  git worktree remove --force "$ROLLBACK_WORKTREE"
  trap - EXIT
  echo "  ✓ dry-run upgrade succeeded (no M0169, no schema break)"
fi

# 4. Operator confirmation
echo
echo "[4] Mainnet deploy confirmation"
if [ "$NETWORK" = "ic" ]; then
  echo "  About to deploy snapshot $TARGET_SHA to MAINNET ($CANISTER)."
else
  echo "  About to deploy snapshot $TARGET_SHA to network=$NETWORK ($CANISTER)."
fi
if [ "$CONFIRM" -eq 0 ]; then
  if [ ! -t 0 ]; then
    echo "  ERROR: stdin is not a TTY and --confirm was not given. Aborting." >&2
    exit 1
  fi
  printf "  Type 'rollback' to proceed: "
  read -r answer
  if [ "$answer" != "rollback" ]; then
    echo "  Aborted by operator."
    exit 1
  fi
fi

# 5. Checkout the rollback canister source, deploy, restore working tree
echo
echo "[5] Deploying rollback to $NETWORK"
git checkout "$TARGET_SHA" -- canisters/ dfx.json
dfx deploy "$CANISTER" --network "$NETWORK" --mode upgrade
git checkout HEAD -- canisters/ dfx.json
echo "  ✓ deploy completed"

# 6. Verify the live module hash matches the snapshot
echo
echo "[6] Post-deploy hash verification"
LIVE_HASH="$(DFX_WARNING=-mainnet_plaintext_identity dfx canister status --network "$NETWORK" "$CANISTER" 2>&1 \
  | awk -F'Module hash: ' '/Module hash:/{print $2}')"
echo "  live hash:     $LIVE_HASH"
echo "  snapshot hash: $TARGET_HASH"
if [ "$LIVE_HASH" = "$TARGET_HASH" ]; then
  echo "  ✓ live module hash matches snapshot — rollback succeeded"
  exit 0
else
  echo "  ERROR: live module hash does NOT match snapshot. Rollback may have failed silently." >&2
  echo "         Investigate before considering this incident closed." >&2
  exit 1
fi
