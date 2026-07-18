import {
  readSettlementMetrics,
  readVerificationMetrics,
} from "@/lib/api/kv/reconcileJournal";

const WINDOW_SIZE = 20;
const ROLLBACK_MIN_SUCCESSES = 16;

export interface SettleStats {
  network: string;
  attempts: number;
  successes: number;
  successRate: number;
  windowComplete: boolean;
  rollback: boolean;
  verification: {
    attempts: number;
    failures: number;
    failureRate: number;
  };
}

export function calculateSettleStats(
  network: string,
  members: string[],
  verifyMembers: string[] = [],
): SettleStats {
  const window = members.slice(-WINDOW_SIZE);
  const successes = window.filter((member) => member.split(":", 3)[1] === "success").length;
  const verifyWindow = verifyMembers.slice(-WINDOW_SIZE);
  const verifyFailures = verifyWindow
    .filter((member) => member.split(":", 3)[1] === "failure").length;
  return {
    network,
    attempts: window.length,
    successes,
    successRate: window.length === 0 ? 0 : successes / window.length,
    windowComplete: window.length === WINDOW_SIZE,
    rollback: window.length === WINDOW_SIZE && successes < ROLLBACK_MIN_SUCCESSES,
    verification: {
      attempts: verifyWindow.length,
      failures: verifyFailures,
      failureRate: verifyWindow.length === 0 ? 0 : verifyFailures / verifyWindow.length,
    },
  };
}

export async function settlementStats(network: string): Promise<SettleStats> {
  const [members, verifyMembers] = await Promise.all([
    readSettlementMetrics(network, WINDOW_SIZE),
    readVerificationMetrics(network, WINDOW_SIZE),
  ]);
  if (members === undefined || verifyMembers === undefined) {
    throw new Error("Settlement metrics KV is unavailable");
  }
  return calculateSettleStats(network, members, verifyMembers);
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
