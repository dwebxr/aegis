import { withSentryConfig } from "@sentry/nextjs";
import withSerwist from "@serwist/next";

/**
 * @type {import('next').NextConfig}
 *
 */
const nextConfig = {
  serverExternalPackages: ["ws"],
  env: {
    // Expose the Vercel build SHA to client code so the diagnostic panel
    // can show which build the user is running. Falls back to "local"
    // when the env var is not set (dev / non-Vercel build).
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://va.vercel-scripts.com https://browser.sentry-cdn.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; connect-src 'self' https: wss:; font-src 'self' https://fonts.gstatic.com; frame-src https://www.youtube.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
      };
    }

    return config;
  },
};

const withPWA = withSerwist({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  disable: process.env.NODE_ENV === "development",
});

export default withSentryConfig(withPWA(nextConfig), {
  silent: true,
  org: process.env.SENTRY_ORG || "",
  project: process.env.SENTRY_PROJECT || "",
  disableSourceMapUpload: !process.env.SENTRY_AUTH_TOKEN,
});
