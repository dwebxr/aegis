// D2A subsystem master switch.
//
// OFF pending the D2A security redesign. The current D2A Nostr identity key is
// derived from the (public) IC principal, so it is recoverable by anyone — which
// breaks impersonation resistance and NIP-44 message confidentiality — and the
// delivery/payment path lacks handshake binding + idempotency. Until that is
// redesigned (key rotation off the public principal, handleDelivery accepted-offer
// binding, idempotent/pending payment accounting), the whole subsystem stays dark.
//
// While false, the client never starts the AgentManager (no presence broadcast,
// no discovery, no offer/accept/deliver processing), never sends D2A comments, and
// never pre-approves the ICP payment allowance. The canister enforces the payment
// half independently via its `d2aPaymentsEnabled` kill switch (default OFF).
//
// Re-enabling requires the redesign and is a deliberate code change — see
// .claude/security-review-plan.md ("D2A subsystem redesign" project).
export const D2A_SUBSYSTEM_ENABLED = false;

// On-chain briefing publishing — DECOUPLED from the D2A dormancy above.
//
// Publishing writes the caller's OWN briefing snapshot to their own canister
// record via the authenticated `saveLatestBriefing` call: no AgentManager, no
// Nostr presence/discovery/handshake/deliver, no comments, no ICP allowance,
// and no dependency on the compromised principal-derived Nostr key (only the
// public pk is embedded as metadata; the call itself is plain IC auth). The
// canister-side `UserSettings.d2aEnabled` field gates it per-user and is, in
// practice, a briefing-sharing-only flag (its only canister uses are
// saveLatestBriefing / the two public briefing reads / the purge-on-false).
//
// This is a CLIENT-DEFAULT gate, not a kill switch: an authenticated user
// calling saveUserSettings(d2aEnabled=true) + saveLatestBriefing directly can
// always publish their own briefing — that exposes only their own data and has
// been possible by design since before the dormancy. Flipping this to false
// stops the app's automatic publishing and hides the opt-in toggle.
export const BRIEFING_PUBLISH_ENABLED = true;
