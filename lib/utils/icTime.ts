export const NS_PER_MS = 1_000_000n;

export function msToNs(ms: number): bigint {
  return BigInt(Math.round(ms)) * NS_PER_MS;
}

export function nsToMs(ns: bigint): number {
  return Number(ns / NS_PER_MS);
}

export function nowNs(): bigint {
  return BigInt(Date.now()) * NS_PER_MS;
}
