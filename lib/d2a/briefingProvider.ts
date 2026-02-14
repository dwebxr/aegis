import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "@/lib/ic/declarations/idlFactory";
import { getCanisterId, getHost } from "@/lib/ic/agent";
import type { _SERVICE } from "@/lib/ic/declarations/aegis_backend.did";
import type { D2ABriefingResponse } from "./types";

export async function getLatestBriefing(principalText?: string): Promise<D2ABriefingResponse | null> {
  if (!principalText) return null;

  const agent = await HttpAgent.create({ host: getHost() });
  const actor = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: getCanisterId() });
  const p = Principal.fromText(principalText);
  const result = await actor.getLatestBriefing(p);

  if (result.length === 0) return null;
  try {
    return JSON.parse(result[0]) as D2ABriefingResponse;
  } catch (err) {
    console.warn("[briefingProvider] Failed to parse briefing JSON:", err);
    return null;
  }
}
