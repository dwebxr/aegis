/**
 * @aegis/d2a-client — TypeScript SDK for the D2A v1.0 protocol.
 *
 * Public surface (versioned via npm semver):
 *  - Constants: every wire-format constant from the spec (Section 8 of
 *    docs/D2A_PROTOCOL.md).
 *  - Encryption: NIP-44 v2 wrappers.
 *  - Manifest: build / decode / diff content manifests.
 *  - Handshake: sendOffer / sendAccept / sendReject / deliverContent /
 *    sendComment + parseD2AMessage validator.
 *  - Discovery: broadcastPresence / discoverPeers / calculateResonance.
 *  - Types: D2AMessage union, payload shapes, AgentProfile, HandshakeState,
 *    ContentManifest, ResonancePrefs.
 *
 * Spec: https://github.com/dwebxr/aegis/blob/main/docs/D2A_PROTOCOL.md
 */

export * from "./protocol";
export * from "./types";
export { encryptMessage, decryptMessage } from "./encrypt";
export {
  buildManifest,
  decodeManifest,
  diffManifest,
  MANIFEST_MAX_ENTRIES,
  type ManifestableItem,
} from "./manifest";
export {
  sendOffer,
  sendAccept,
  sendReject,
  deliverContent,
  sendComment,
  parseD2AMessage,
  isHandshakeExpired,
  type PublishResult,
} from "./handshake";
export {
  broadcastPresence,
  discoverPeers,
  calculateResonance,
  type BroadcastPresenceOptions,
  type DiscoverPeersOptions,
} from "./discovery";

/** SDK semantic version. Independent of the D2A wire-format version. */
export const SDK_VERSION = "0.1.0";
/** D2A wire-format version this SDK speaks. */
export const D2A_PROTOCOL_VERSION = "1.0";
