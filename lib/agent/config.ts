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
