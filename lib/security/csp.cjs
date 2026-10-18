// eslint-disable-next-line @typescript-eslint/no-require-imports -- Shared CommonJS module for Next config and Jest.
const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

/**
 * @param {string | undefined} phase
 * @returns {string}
 */
function buildContentSecurityPolicy(phase) {
  // Only the dev server needs eval for webpack output. NODE_ENV can be
  // explicitly set to development even during a production build or start.
  const devEval = phase === PHASE_DEVELOPMENT_SERVER ? " 'unsafe-eval'" : "";

  return `default-src 'self'; script-src 'self' 'unsafe-inline'${devEval} 'wasm-unsafe-eval' https://va.vercel-scripts.com https://browser.sentry-cdn.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; connect-src 'self' https: wss:; font-src 'self' https://fonts.gstatic.com; frame-src https://www.youtube.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
}

module.exports = { buildContentSecurityPolicy };
