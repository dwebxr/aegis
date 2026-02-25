import { withSentryConfig } from "@sentry/nextjs";
import withSerwist from "@serwist/next";

/**
 * @type {import('next').NextConfig}
 *
 * SECURITY NOTE (Next.js 14 CVE mitigation):
 * GHSA-9g9p-9gw9-jx7f requires `images.remotePatterns` — not configured here.
 * GHSA-h25m-26qc-wcjf requires `"use server"` directives — none used in this project.
 * If either is added, upgrade Next.js immediately.
 */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["ws"],
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
