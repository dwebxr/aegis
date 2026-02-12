import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "@/lib/ic/declarations/idlFactory";
import type { _SERVICE } from "@/lib/ic/declarations/aegis_backend.did";
import type { D2ABriefingResponse } from "./types";

const CANISTER_ID = (process.env.NEXT_PUBLIC_CANISTER_ID || "rluf3-eiaaa-aaaam-qgjuq-cai").trim();
const IC_HOST = (process.env.NEXT_PUBLIC_IC_HOST || "https://icp-api.io").trim();

export async function getLatestBriefing(principalText?: string): Promise<D2ABriefingResponse | null> {
  if (!principalText) return null;

  const agent = await HttpAgent.create({ host: IC_HOST });
  const actor = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: CANISTER_ID });
  const p = Principal.fromText(principalText);
  const result = await actor.getLatestBriefing(p);

  if (result.length === 0) return null;
  try {
    return JSON.parse(result[0]) as D2ABriefingResponse;
  } catch {
    return null;
  }
}
