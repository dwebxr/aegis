import "server-only";
import { Ed25519KeyIdentity } from "@dfinity/identity";

/**
 * Server-controller identity loaded from PUSH_SERVER_PRIVATE_KEY.
 *
 * The environment variable holds the 32-byte Ed25519 secret in base64.
 * The resulting principal must be registered as a canister controller
 * (see scripts/add-server-controller.sh) so it can call gated query
 * methods like getPushSubscriptions on behalf of any user.
 *
 * Generation (one-time, run locally):
 *   node -e "import('@dfinity/identity').then(({Ed25519KeyIdentity}) => { \
 *     const id = Ed25519KeyIdentity.generate(); \
 *     const {secretKey} = id.getKeyPair(); \
 *     console.log('PRIVATE_KEY_B64=' + Buffer.from(secretKey).toString('base64')); \
 *     console.log('PRINCIPAL=' + id.getPrincipal().toText()); \
 *   })"
 *
 * Then:
 *   1. dfx canister --network ic update-settings --add-controller <PRINCIPAL> aegis_backend
 *   2. vercel env add PUSH_SERVER_PRIVATE_KEY <PRIVATE_KEY_B64>
 *   3. Redeploy.
 */
export function getServerIdentity(): Ed25519KeyIdentity {
  const raw = process.env.PUSH_SERVER_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error(
      "PUSH_SERVER_PRIVATE_KEY is not configured — server cannot verify push " +
        "subscription ownership. See lib/ic/serverIdentity.ts for setup instructions.",
    );
  }
  // @dfinity/identity's Ed25519KeyIdentity.fromSecretKey expects the full 64-byte
  // key (32-byte secret seed concatenated with 32-byte public key). Accept either
  // form: 32-byte seed (which we derive the full key from via generate) or 64-byte.
  let secretBytes: Uint8Array;
  try {
    secretBytes = new Uint8Array(Buffer.from(raw, "base64"));
  } catch (err) {
    throw new Error(`PUSH_SERVER_PRIVATE_KEY is not valid base64: ${(err as Error).message}`);
  }
  if (secretBytes.length === 64) {
    return Ed25519KeyIdentity.fromSecretKey(secretBytes);
  }
  if (secretBytes.length === 32) {
    // 32-byte seed: derive full key via @noble/ed25519. Easier: use generate from seed.
    return Ed25519KeyIdentity.generate(secretBytes);
  }
  throw new Error(
    `PUSH_SERVER_PRIVATE_KEY must decode to 32 or 64 bytes; got ${secretBytes.length}.`,
  );
}
