// @aegis/d2a-client — SDK for the D2A v1.0 protocol.
// Spec: https://github.com/dwebxr/aegis/blob/main/docs/D2A_PROTOCOL.md

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

// SDK_VERSION is independent of D2A_PROTOCOL_VERSION (semver vs wire format).
export const SDK_VERSION = "0.1.0";
export const D2A_PROTOCOL_VERSION = "1.0";
