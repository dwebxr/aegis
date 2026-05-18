#!/usr/bin/env bash
#
# One-shot: generate the push-server identity, print the env var and principal,
# and register that principal as a controller of aegis_backend.
#
# Run from the project root with the dfx admin identity that already controls
# the canister (typically the deploy identity). The script never writes the
# private key to disk — it goes straight to stdout for the operator to paste
# into Vercel.
#
# Usage:
#   NETWORK=ic scripts/add-push-server-controller.sh
#   NETWORK=local scripts/add-push-server-controller.sh   # smoke test locally
#
# After running:
#   1. Copy "PUSH_SERVER_PRIVATE_KEY=..." into Vercel env (sensitive).
#   2. Redeploy the Next app so the new env var is picked up.
#   3. The /api/push/token route can now read getPushSubscriptions for any
#      principal and verify endpoint ownership before minting tokens.

set -euo pipefail

DFX="${DFX:-$(command -v dfx || echo "/Users/masia02/Library/Application Support/org.dfinity.dfx/bin/dfx")}"
NETWORK="${NETWORK:-local}"
CANISTER="${CANISTER:-aegis_backend}"

# 1. Generate identity (in-memory; never written to disk).
read -r PRINCIPAL PRIVATE_KEY < <(node -e "
const { Ed25519KeyIdentity } = require('@dfinity/identity');
const id = Ed25519KeyIdentity.generate();
const { secretKey } = id.getKeyPair();
process.stdout.write(id.getPrincipal().toText() + ' ' + Buffer.from(secretKey).toString('base64') + '\n');
")

echo "Generated push-server identity:"
echo "  principal:  $PRINCIPAL"
echo
echo "Vercel env var (paste into the production project as sensitive):"
echo "  PUSH_SERVER_PRIVATE_KEY=$PRIVATE_KEY"
echo

# 2. Register as canister controller.
echo "Adding $PRINCIPAL as a controller of $CANISTER on $NETWORK..."
"$DFX" canister --network "$NETWORK" update-settings --add-controller "$PRINCIPAL" "$CANISTER"

# 3. Verify.
echo
echo "Updated controllers:"
"$DFX" canister --network "$NETWORK" info "$CANISTER" 2>&1 | grep -A20 "Controllers" | head -10

echo
echo "Done. Add the env var to Vercel and redeploy."
