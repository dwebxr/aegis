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
