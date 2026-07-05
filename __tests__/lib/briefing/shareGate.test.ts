/**
 * Gate matrix for briefing-share restore — this logic is the exact site of the
 * original incident (the dormancy restore block purged every briefing opt-in),
 * so all four flag combinations are pinned here.
 */
import { resolveBriefingShareRestore } from "@/lib/briefing/shareGate";

const DORMANT_PUBLISH_ON = { d2aSubsystemEnabled: false, briefingPublishEnabled: true };
const DORMANT_PUBLISH_OFF = { d2aSubsystemEnabled: false, briefingPublishEnabled: false };
const D2A_ON_PUBLISH_ON = { d2aSubsystemEnabled: true, briefingPublishEnabled: true };
const D2A_ON_PUBLISH_OFF = { d2aSubsystemEnabled: true, briefingPublishEnabled: false };

describe("resolveBriefingShareRestore", () => {
  it("production config (D2A dormant, publish on): restores opt-in, NEVER purges", () => {
    expect(resolveBriefingShareRestore(true, DORMANT_PUBLISH_ON)).toEqual({
      briefingShareEnabled: true,
      writeDormancyOptOut: false,
    });
    expect(resolveBriefingShareRestore(false, DORMANT_PUBLISH_ON)).toEqual({
      briefingShareEnabled: false,
      writeDormancyOptOut: false,
    });
  });

  it("full dormancy (both off): opt-in ignored AND proactively purged on-chain", () => {
    expect(resolveBriefingShareRestore(true, DORMANT_PUBLISH_OFF)).toEqual({
      briefingShareEnabled: false,
      writeDormancyOptOut: true,
    });
    expect(resolveBriefingShareRestore(false, DORMANT_PUBLISH_OFF)).toEqual({
      briefingShareEnabled: false,
      writeDormancyOptOut: false, // already opted out — nothing to purge
    });
  });

  it("D2A revived: purge never fires regardless of publish gate", () => {
    expect(resolveBriefingShareRestore(true, D2A_ON_PUBLISH_ON).writeDormancyOptOut).toBe(false);
    expect(resolveBriefingShareRestore(true, D2A_ON_PUBLISH_OFF).writeDormancyOptOut).toBe(false);
    // publish gate still controls the client share state independently
    expect(resolveBriefingShareRestore(true, D2A_ON_PUBLISH_ON).briefingShareEnabled).toBe(true);
    expect(resolveBriefingShareRestore(true, D2A_ON_PUBLISH_OFF).briefingShareEnabled).toBe(false);
  });

  it("uses the real production flags by default (dormant D2A + publishing enabled)", () => {
    // Locks the shipped constants: restore follows icD2A, dormancy purge disabled.
    expect(resolveBriefingShareRestore(true)).toEqual({
      briefingShareEnabled: true,
      writeDormancyOptOut: false,
    });
  });
});
