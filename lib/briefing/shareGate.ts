import { BRIEFING_PUBLISH_ENABLED, D2A_SUBSYSTEM_ENABLED } from "@/lib/agent/config";

/** Gate flags injected as parameters so every branch is unit-testable without
 *  module reloads; production callers use the real constants via the default. */
export interface ShareGateFlags {
  d2aSubsystemEnabled: boolean;
  briefingPublishEnabled: boolean;
}

const REAL_FLAGS: ShareGateFlags = {
  d2aSubsystemEnabled: D2A_SUBSYSTEM_ENABLED,
  briefingPublishEnabled: BRIEFING_PUBLISH_ENABLED,
};

export interface RestoreDecision {
  /** Client briefing-share state to restore from the on-chain d2aEnabled flag.
   *
   *  Consent note: restoring icD2A=true as "briefing sharing on" is NOT a
   *  consent re-interpretation in practice — the 2026-07 dormancy proactively
   *  wrote d2aEnabled=false for every previously-opted-in user (verified:
   *  canister briefing count is 0), so any icD2A=true encountered after this
   *  ships can only have been set through the new explicit briefing-sharing
   *  toggle (or a deliberate direct canister call by the user themselves). */
  briefingShareEnabled: boolean;
  /** Write d2aEnabled=false on-chain (canister purges the public briefing).
   *  Only while BOTH gates are off — the original dormancy cleanup. When
   *  briefing publishing is enabled this must NOT fire, or it would fight the
   *  new toggle by re-purging every opt-in on the next load. */
  writeDormancyOptOut: boolean;
}

export function resolveBriefingShareRestore(
  icD2A: boolean,
  flags: ShareGateFlags = REAL_FLAGS,
): RestoreDecision {
  return {
    briefingShareEnabled: flags.briefingPublishEnabled && icD2A,
    writeDormancyOptOut: !flags.d2aSubsystemEnabled && !flags.briefingPublishEnabled && icD2A,
  };
}

// Durable opt-OUT intent. When the user turns sharing off but the canister
// write fails (d2aEnabled stays true on-chain), a plain restore on the next
// load would flip sharing back ON and silently resume publishing. This flag
// records the un-acknowledged opt-out so restore honors it and retries the
// canister write; it is cleared once any write (off OR a fresh opt-in)
// succeeds.
const PENDING_SHARE_OFF_KEY = "aegis-briefing-share-pending-off";

export function hasPendingShareOff(): boolean {
  if (typeof globalThis.localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PENDING_SHARE_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPendingShareOff(pending: boolean): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    if (pending) localStorage.setItem(PENDING_SHARE_OFF_KEY, "1");
    else localStorage.removeItem(PENDING_SHARE_OFF_KEY);
  } catch {
    // Private-mode storage failures degrade to the old behavior (restore
    // follows the on-chain flag) — publishing only resumes for opted-in data.
  }
}
