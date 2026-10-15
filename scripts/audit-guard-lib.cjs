// The policy is pure: callers supply both audit reports and the UTC calendar day.
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const ghsaPattern = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
const severities = ["info", "low", "moderate", "high", "critical"];
const isHigh = finding => finding.severity === "high" || finding.severity === "critical";

function parseAudit(input, label) {
  if (typeof input === "string") {
    if (!input.trim()) throw new Error(`${label}: empty audit output`);
    try { input = JSON.parse(input); }
    catch { throw new Error(`${label}: audit output is not JSON`); }
  }
  if (!isRecord(input) || Object.hasOwn(input, "error")) {
    const details = isRecord(input) && isRecord(input.error)
      ? [input.error.code, input.error.summary].filter(value => typeof value === "string" && value).join(": ")
      : "";
    throw new Error(`${label}: npm error or invalid audit object${details ? ` — ${details}` : ""}`);
  }
  if (!Object.hasOwn(input, "vulnerabilities") || !isRecord(input.vulnerabilities)) {
    throw new Error(`${label}: missing or invalid vulnerabilities`);
  }
  for (const [name, finding] of Object.entries(input.vulnerabilities)) {
    if (!isRecord(finding) || !severities.includes(finding.severity) || !Array.isArray(finding.via)) {
      throw new Error(`${label}: invalid vulnerability entry ${name}`);
    }
  }
  return input.vulnerabilities;
}

function evaluate({ full, prod, allowlist, today }) {
  const warnings = [];
  const failures = [];
  let fullTree, prodTree;
  try {
    fullTree = parseAudit(full, "full");
    prodTree = parseAudit(prod, "prod");
    if (!isDate(today)) throw new Error("invalid audit date (expected YYYY-MM-DD)");
    if (!Array.isArray(allowlist) || allowlist.some(entry => !isRecord(entry)
      || typeof entry.ghsa !== "string" || !ghsaPattern.test(entry.ghsa)
      || typeof entry.package !== "string" || !entry.package.trim()
      || !isDate(entry.expires) || typeof entry.reason !== "string" || !entry.reason.trim())) {
      throw new Error("invalid audit allowlist");
    }
  } catch (error) {
    return { status: "cannot-audit", exitCode: 2, warnings, failures: [error.message] };
  }

  for (const entry of allowlist) {
    if (today > entry.expires) warnings.push(`allowlist: ${entry.ghsa} (${entry.package}) expired ${entry.expires}`);
  }
  for (const [name, finding] of Object.entries(prodTree)) {
    if (isHigh(finding)) failures.push(`prod: ${name} is ${finding.severity}; production findings cannot be allowlisted`);
  }

  for (const [name, finding] of Object.entries(fullTree)) {
    if (!isHigh(finding)) continue;
    const highRoots = new Map();
    const errors = new Set();
    const visited = new Set();
    function visit(packageName) {
      if (visited.has(packageName)) return; // Cycles cannot invent advisory roots.
      visited.add(packageName);
      if (!Object.hasOwn(fullTree, packageName)) {
        errors.add(`missing referenced package ${packageName}`);
        return;
      }
      for (const via of fullTree[packageName].via) {
        if (typeof via === "string") visit(via);
        else {
          const match = isRecord(via) && typeof via.url === "string"
            ? /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/.exec(via.url) : null;
          if (!match || typeof via.name !== "string" || !via.name) {
            errors.add("root advisory has no valid GHSA URL or package name");
          } else if (isHigh(via)) {
            // Lower-severity roots do not explain or block a high/critical finding.
            highRoots.set(`${via.name}:${match[1]}`, { ghsa: match[1], package: via.name });
          }
        }
      }
    }
    visit(name);
    if (highRoots.size === 0) errors.add("unexplained severity: empty high/critical root advisory set");
    const accepted = [];
    for (const root of highRoots.values()) {
      const entry = allowlist.find(item => item.ghsa === root.ghsa && item.package === root.package);
      if (!entry) errors.add(`${root.ghsa} (${root.package}) is not allowlisted (GHSA and package must match)`);
      else if (today > entry.expires) errors.add(`${root.ghsa} (${root.package}) expired ${entry.expires}`);
      else accepted.push(entry);
    }
    if (errors.size) {
      for (const error of errors) failures.push(`full: ${name}: ${error}`);
    } else {
      for (const entry of accepted) warnings.push(`full: accepted ${name} via ${entry.package} ${entry.ghsa} until ${entry.expires} — ${entry.reason}`);
    }
  }

  const summarize = tree => Object.fromEntries(severities.map(severity => [severity,
    Object.values(tree).filter(finding => finding.severity === severity).length]));
  return {
    status: failures.length ? "fail" : "pass",
    exitCode: failures.length ? 1 : 0,
    warnings, failures,
    summaries: { full: summarize(fullTree), prod: summarize(prodTree) },
  };
}

module.exports = { evaluate };

if (require.main === module) {
  try {
    const { readFileSync } = require("node:fs");
    const [fullPath, prodPath, allowlistPath, fullStatus = "0", prodStatus = "0"] = process.argv.slice(2);
    let result = evaluate({
      full: readFileSync(fullPath, "utf8"),
      prod: readFileSync(prodPath, "utf8"),
      allowlist: JSON.parse(readFileSync(allowlistPath, "utf8")),
      // Allowlist expiry uses the UTC calendar day, regardless of local timezone.
      today: new Date().toISOString().slice(0, 10),
    });
    if (Number(fullStatus) > 1 || Number(prodStatus) > 1) {
      result = {
        status: "cannot-audit", exitCode: 2, warnings: [],
        failures: [`npm exited full=${fullStatus} prod=${prodStatus}`, ...result.failures],
      };
    }
    for (const warning of result.warnings) console.log(`audit-guard: WARNING — ${warning}`);
    for (const failure of result.failures) console.error(`audit-guard: ${failure}`);
    console.log(`audit-guard: ${result.status === "cannot-audit" ? "CANNOT AUDIT" : result.status.toUpperCase()}`);
    if (result.summaries) console.log(`audit-guard: counts ${JSON.stringify(result.summaries)}`);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`audit-guard: CANNOT AUDIT — ${error.message}`);
    process.exitCode = 2;
  }
}
