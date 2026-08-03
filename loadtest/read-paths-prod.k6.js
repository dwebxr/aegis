// Production-safe variant of read-paths.k6.js.
//
// The full scenario ramps to 25 VUs over 4.5 minutes: ~9,700 requests and
// ~5,600 function invocations, roughly 200-260 CPU seconds. On a free Vercel
// plan shared with a live payment service that is about a day's whole Active
// CPU budget, so the full run belongs on staging.
//
// This variant keeps every assertion and threshold from the full scenario and
// changes only the load profile: 3 VUs for 60 seconds, ~2 orders of magnitude
// cheaper, still enough to catch a broken route or a latency regression.
//
// Run (via loadtest/run.sh, which selects this file automatically for
// production hosts):
//   LOADTEST_ALLOW_PROD=1 BASE_URL=https://aegis-ai.xyz loadtest/run.sh

export { default } from "./read-paths.k6.js";
import { options as fullOptions } from "./read-paths.k6.js";

export const options = {
  ...fullOptions,
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: 3,
      duration: "60s",
    },
  },
};
