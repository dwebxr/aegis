import { kvNamespace } from "./internal/factory";

const reconcileKV = kvNamespace("aegis:journal:");

function resolutionKey(hash: string, resolutionToken: string): string {
  return `${hash}:resolution:${resolutionToken}`;
}

export async function writeResolution(
  hash: string,
  resolutionToken: string,
  resolution: Record<string, unknown>,
): Promise<boolean | undefined> {
  const result = await reconcileKV.set(
    resolutionKey(hash, resolutionToken),
    resolution,
    { nx: true },
  );
  return result === undefined ? undefined : result === "OK";
}

export function readResolution<T>(
  hash: string,
  resolutionToken: string,
): Promise<T | null | undefined> {
  return reconcileKV.get<T>(resolutionKey(hash, resolutionToken));
}

export function readJournalReport<T extends unknown[]>(...keys: string[]): Promise<T | undefined> {
  return reconcileKV.mget<T>(...keys);
}
