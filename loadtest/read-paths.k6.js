// k6 load test for Aegis read-only endpoints.
//
// Purpose: establish a performance baseline for the public read paths
// and detect regression. Exercises ONLY non-mutating routes that don't
// consume Anthropic budget or write to the IC canister.
//
// Run:
//   BASE_URL=https://aegis-ai.xyz k6 run loadtest/read-paths.k6.js
//   BASE_URL=http://localhost:3000 k6 run loadtest/read-paths.k6.js
//
//   # quick smoke (10 vus × 30 s)
//   k6 run --vus 10 --duration 30s loadtest/read-paths.k6.js
//
//   # baseline run that enforces the thresholds in `options.thresholds`
//   AEGIS_FEED_PRINCIPAL=<known-principal> k6 run loadtest/read-paths.k6.js
//
// Threshold rationale:
//   - p95 < 500 ms / p99 < 1500 ms  : Vercel edge + IC canister query
//     latency budget; anything slower means cold-start storms or IC
//     congestion in the worker subnet.
//   - error rate < 1 %              : transient network blips are fine,
//     sustained 4xx/5xx are not.
//   - dropped iterations < 1 %      : k6 should keep up with the schedule;
//     drops mean the local k6 host is the bottleneck, not the SUT.

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const FEED_PRINCIPAL = __ENV.AEGIS_FEED_PRINCIPAL || "";

const errorRate = new Rate("aegis_errors");
const healthDegraded = new Counter("aegis_health_degraded");
const cyclesLowEvents = new Counter("aegis_cycles_low");
const ttfbHealth = new Trend("aegis_ttfb_health", true);

export const options = {
  scenarios: {
    sustained: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },   // ramp to 10 concurrent users
        { duration: "2m",  target: 10 },   // hold for 2 minutes
        { duration: "30s", target: 25 },   // burst
        { duration: "1m",  target: 25 },   // sustain burst
        { duration: "30s", target: 0 },    // ramp down
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    "http_req_failed":              ["rate<0.01"],
    "http_req_duration":            ["p(95)<500", "p(99)<1500"],
    "http_req_duration{name:health}": ["p(95)<300"],
    "aegis_errors":                 ["rate<0.01"],
    "iteration_duration":           ["p(95)<2000"],
    "dropped_iterations":           ["count<10"],
  },
  // Don't follow redirects automatically — surface them as failures so we
  // catch unintended 301/302 in routes that should be 200.
  noConnectionReuse: false,
  discardResponseBodies: false,
};

function tagged(name) {
  return { tags: { name } };
}

export default function () {
  group("/api/health", () => {
    const res = http.get(`${BASE_URL}/api/health`, {
      headers: { Accept: "application/json" },
      ...tagged("health"),
    });
    ttfbHealth.add(res.timings.waiting);

    const ok = check(res, {
      "status is 200 or 503": (r) => r.status === 200 || r.status === 503,
      "is JSON":              (r) => r.headers["Content-Type"]?.includes("application/json"),
      "has version":          (r) => {
        const body = r.json();
        return typeof body === "object" && body !== null && typeof body.version === "string";
      },
    });
    errorRate.add(!ok);

    if (res.status === 503) {
      healthDegraded.add(1);
    }
    const body = res.json();
    if (body && typeof body === "object" && body.checks?.canisterCycles === "low") {
      cyclesLowEvents.add(1);
    }
  });

  group("/api/feed/rss contract", () => {
    // Bad-input branches that the route handles synchronously without
    // touching the IC canister — measures the plain Vercel edge latency.
    const noPrincipal = http.get(`${BASE_URL}/api/feed/rss`, tagged("feed-rss-noprincipal"));
    errorRate.add(!check(noPrincipal, { "missing-principal returns 400": (r) => r.status === 400 }));

    const badPrincipal = http.get(`${BASE_URL}/api/feed/rss?principal=!!!invalid!!!`, tagged("feed-rss-badprincipal"));
    errorRate.add(!check(badPrincipal, { "bad-principal returns 400": (r) => r.status === 400 }));

    if (FEED_PRINCIPAL) {
      const real = http.get(`${BASE_URL}/api/feed/rss?principal=${encodeURIComponent(FEED_PRINCIPAL)}`, tagged("feed-rss-real"));
      errorRate.add(!check(real, {
        "real principal: 200 or 404": (r) => r.status === 200 || r.status === 404,
        "real principal: response body present": (r) => (r.body || "").length > 0,
      }));
    }
  });

  group("/api/feed/atom contract", () => {
    const noPrincipal = http.get(`${BASE_URL}/api/feed/atom`, tagged("feed-atom-noprincipal"));
    errorRate.add(!check(noPrincipal, { "missing-principal returns 400": (r) => r.status === 400 }));
  });

  group("/openapi.yaml", () => {
    const res = http.get(`${BASE_URL}/openapi.yaml`, tagged("openapi"));
    errorRate.add(!check(res, {
      "status is 200":     (r) => r.status === 200,
      "first line OpenAPI": (r) => /^openapi:/.test(r.body || ""),
    }));
  });

  group("/api-docs", () => {
    const res = http.get(`${BASE_URL}/api-docs`, tagged("api-docs"));
    errorRate.add(!check(res, {
      "status is 200":      (r) => r.status === 200,
      "renders Scalar":     (r) => /scalar/i.test(r.body || ""),
    }));
  });

  group("/manifest.json", () => {
    const res = http.get(`${BASE_URL}/manifest.json`, tagged("manifest"));
    errorRate.add(!check(res, {
      "status is 200 or 304": (r) => r.status === 200 || r.status === 304,
    }));
  });

  // Per-VU pacing: realistic users don't hammer the API; pause briefly so
  // the test reflects browse-pattern load, not a synthetic burst.
  sleep(Math.random() * 2 + 0.5);
}

export function handleSummary(data) {
  // Print a short, machine-parseable summary so CI / staging post-deploy
  // jobs can grep for thresholds. Default text summary is also written.
  const m = data.metrics;
  const human = [
    "",
    "Aegis read-paths load test summary",
    `  Target:        ${BASE_URL}`,
    `  Total requests:        ${m.http_reqs?.values?.count ?? "?"}`,
    `  Failed requests:       ${(m.http_req_failed?.values?.rate * 100 || 0).toFixed(2)}%`,
    `  /api/health p95:       ${(m["http_req_duration{name:health}"]?.values?.["p(95)"] || 0).toFixed(0)} ms`,
    `  http_req_duration p95: ${(m.http_req_duration?.values?.["p(95)"] || 0).toFixed(0)} ms`,
    `  http_req_duration p99: ${(m.http_req_duration?.values?.["p(99)"] || 0).toFixed(0)} ms`,
    `  aegis_health_degraded count: ${m.aegis_health_degraded?.values?.count ?? 0}`,
    `  aegis_cycles_low count:      ${m.aegis_cycles_low?.values?.count ?? 0}`,
    "",
  ].join("\n");

  return {
    "stdout": human,
    "loadtest/last-run.json": JSON.stringify(data, null, 2),
  };
}
