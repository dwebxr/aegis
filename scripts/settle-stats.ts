import { readSettlementMetrics } from "@/lib/api/kv/reconcileJournal";

const WINDOW_SIZE = 20;
const ROLLBACK_MIN_SUCCESSES = 16;

export interface SettleStats {
  network: string;
  attempts: number;
  successes: number;
  successRate: number;
  windowComplete: boolean;
  rollback: boolean;
}

export function calculateSettleStats(network: string, members: string[]): SettleStats {
  const window = members.slice(-WINDOW_SIZE);
  const successes = window.filter((member) => member.split(":", 3)[1] === "success").length;
  return {
    network,
    attempts: window.length,
    successes,
    successRate: window.length === 0 ? 0 : successes / window.length,
    windowComplete: window.length === WINDOW_SIZE,
    rollback: window.length === WINDOW_SIZE && successes < ROLLBACK_MIN_SUCCESSES,
  };
}

export async function settlementStats(network: string): Promise<SettleStats> {
  const members = await readSettlementMetrics(network, WINDOW_SIZE);
  if (members === undefined) throw new Error("Settlement metrics KV is unavailable");
  return calculateSettleStats(network, members);
}

async function main(): Promise<void> {
  const networks = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ["eip155:84532", "eip155:8453"];
  const report = await Promise.all(networks.map(settlementStats));
  console.log(JSON.stringify(report, null, 2));
  if (report.some((entry) => entry.rollback)) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
