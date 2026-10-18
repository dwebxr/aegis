/**
 * @param {string | undefined} nodeEnv
 * @returns {string}
 */
function buildContentSecurityPolicy(nodeEnv) {
  // Next sets NODE_ENV for `next dev`; webpack's dev output needs eval.
  // Only this exact value may relax the production policy.
  const devEval = nodeEnv === "development" ? " 'unsafe-eval'" : "";

  return `default-src 'self'; script-src 'self' 'unsafe-inline'${devEval} 'wasm-unsafe-eval' https://va.vercel-scripts.com https://browser.sentry-cdn.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; connect-src 'self' https: wss:; font-src 'self' https://fonts.gstatic.com; frame-src https://www.youtube.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
}

module.exports = { buildContentSecurityPolicy };
