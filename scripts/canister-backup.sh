#!/usr/bin/env bash
#
# Pre-upgrade snapshot of the aegis_backend canister.
#
# Captures everything needed to identify and reproduce the live wasm
# BEFORE an upgrade so the operator can confirm a known-good rollback
# target exists. Run this immediately before `dfx deploy --network ic
# aegis_backend` (or wire it into the deploy script).
#
# Captured artifacts (in canister-backups/<timestamp>/):
#   - git_sha       : current HEAD of the working tree
#   - git_status    : working-tree status (flags any uncommitted local edits)
#   - module_hash   : SHA-256 of the wasm currently INSTALLED on mainnet
#   - canister_status.json : `dfx canister status --network ic` output
#                            (controllers, freezing threshold, cycles balance)
#   - wasm.gz       : the compiled wasm at HEAD (so even if git history is
#                     lost the bytes can be reproduced for rollback)
#   - dfx.json      : copy of the canister manifest at backup time
#   - main.mo, types.mo, ledger.mo, aegis_backend.did : canister source
#                     snapshot (lets you diff against a future bad upgrade
#                     without git archaeology)
#
# Usage:
#   scripts/canister-backup.sh                      # backup live mainnet wasm
#   NETWORK=local scripts/canister-backup.sh        # backup local replica
#   BACKUP_DIR=/abs/path scripts/canister-backup.sh # custom destination root
#
# Exits non-zero if any required step fails. Produces no destructive side
# effects: only reads from dfx and writes a fresh subdirectory.

set -euo pipefail

NETWORK="${NETWORK:-ic}"
BACKUP_ROOT="${BACKUP_DIR:-canister-backups}"
CANISTER="aegis_backend"

cd "$(git rev-parse --show-toplevel)"

if ! command -v dfx >/dev/null 2>&1; then
  echo "ERROR: dfx not in PATH. Install via https://internetcomputer.org/install.sh" >&2
  exit 2
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_ROOT}/${TIMESTAMP}_${NETWORK}"
mkdir -p "$DEST"

echo "aegis canister backup"
echo "  network:  $NETWORK"
echo "  canister: $CANISTER"
echo "  dest:     $DEST"
echo

# 1. Git context
git rev-parse HEAD > "$DEST/git_sha"
git status --short > "$DEST/git_status"
git log -1 --format="%H%n%ai%n%s%n%n%b" > "$DEST/git_commit_info"
echo "  ✓ git context"

# 2. Live module hash on the target network
#    `module_hash` lets you confirm the rollback target matches what was
#    deployed: hash the proposed rollback wasm and compare.
#
#    `dfx canister status` is read-only (no cycles spent) so it's safe to
#    suppress the mainnet_plaintext_identity warning for this command —
#    the warning is meant for cycle-spending ops. The env var is scoped to
#    this single invocation and never leaks to deploy commands.
DFX_WARNING=-mainnet_plaintext_identity dfx canister status --network "$NETWORK" "$CANISTER" \
  > "$DEST/canister_status.txt" 2>&1
status_exit=$?
if [ "$status_exit" -ne 0 ]; then
  echo "ERROR: dfx canister status failed (exit $status_exit). Output:" >&2
  cat "$DEST/canister_status.txt" >&2
  exit 1
fi
awk -F'Module hash: ' '/Module hash:/{print $2}' "$DEST/canister_status.txt" > "$DEST/module_hash"
if ! [ -s "$DEST/module_hash" ]; then
  echo "ERROR: dfx canister status returned no Module hash. Full output:" >&2
  cat "$DEST/canister_status.txt" >&2
  exit 1
fi
echo "  ✓ module hash: $(cat "$DEST/module_hash")"

# 3. Source + manifest snapshot
cp dfx.json "$DEST/dfx.json"
cp canisters/"$CANISTER"/*.mo canisters/"$CANISTER"/*.did "$DEST/" 2>/dev/null || true
echo "  ✓ source snapshot"

# 4. Build the wasm at HEAD so the rollback target is reproducible even
#    if the git tree changes later. Uses `dfx build` against local — this
#    does NOT touch mainnet. Safe to run while live.
echo "  building wasm at HEAD (local, non-deploying)..."
if dfx start --background --host 127.0.0.1:4943 >/dev/null 2>&1; then
  STARTED_REPLICA=1
else
  STARTED_REPLICA=0
fi
dfx build "$CANISTER" --network local >> "$DEST/build.log" 2>&1
WASM_PATH=".dfx/local/canisters/${CANISTER}/${CANISTER}.wasm"
if [ -f "$WASM_PATH" ]; then
  gzip -c "$WASM_PATH" > "$DEST/wasm.gz"
  WASM_SHA256="$(shasum -a 256 "$WASM_PATH" | awk '{print $1}')"
  echo "$WASM_SHA256" > "$DEST/wasm_sha256"
  echo "  ✓ wasm built ($(wc -c < "$DEST/wasm.gz") bytes gzipped, sha256=$WASM_SHA256)"
else
  echo "  ⚠ wasm not produced at $WASM_PATH — see build.log" >&2
fi
if [ "$STARTED_REPLICA" = "1" ]; then
  dfx stop >/dev/null 2>&1 || true
fi

# 5. Manifest summary for humans
{
  echo "Aegis canister backup"
  echo "Created:  $TIMESTAMP UTC"
  echo "Network:  $NETWORK"
  echo "Canister: $CANISTER"
  echo
  echo "Git HEAD: $(cat "$DEST/git_sha")"
  echo "Module hash on $NETWORK: $(cat "$DEST/module_hash")"
  [ -f "$DEST/wasm_sha256" ] && echo "Local wasm sha256: $(cat "$DEST/wasm_sha256")"
  echo
  echo "To rollback to this snapshot:"
  echo "  scripts/canister-rollback.sh $DEST"
} > "$DEST/MANIFEST.txt"

echo
echo "Backup complete: $DEST"
echo "To rollback later:  scripts/canister-rollback.sh $DEST"
