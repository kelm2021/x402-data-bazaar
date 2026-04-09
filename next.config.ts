import type { NextConfig } from "next";
import path from "node:path";

const backendTraceIncludes = [
  "./app.js",
  "./assets/favicon.png",
  "./apps/finance-workflows/**/*",
  "./apps/generic-parameter-simulator/**/*",
  "./apps/restricted-party-screen/**/*",
  "./apps/sports-workflows/**/*",
  "./apps/vendor-entity-brief/**/*",
  "./apps/vendor-workflows/**/*",
  "./business-dashboard.js",
  "./lib/aurelianflo-mcp-bridge.js",
  "./lib/aurelianflo-profile.js",
  "./lib/aurelianflo-surface.js",
  "./lib/facilitator-loader.js",
  "./lib/merc-trust-enforcement.js",
  "./lib/payment-required-compat.js",
  "./lib/sim-compatible.js",
  "./metrics.js",
  "./routes/*.js",
  "./routes/auto-local/**/*",
  "./routes/generated-catalog.json",
  "./well-known-x402-aurelian.json",
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname),
  async rewrites() {
    return [
      { source: "/icon.png", destination: "/aurelianflo-icon.png" },
    ];
  },
  serverExternalPackages: [
    "@resvg/resvg-js",
    "@resvg/resvg-js-win32-x64-msvc",
    "@sparticuz/chromium",
    "@sparticuz/chromium-min",
    "docx",
    "exceljs",
    "pdfkit",
    "playwright",
    "playwright-core",
  ],
  outputFileTracingIncludes: {
    "/api/[[...path]]": backendTraceIncludes,
    "/mcp/[[...path]]": backendTraceIncludes,
    "/.well-known/[[...path]]": backendTraceIncludes,
    "/well-known/[[...path]]": backendTraceIncludes,
    "/openapi.json": backendTraceIncludes,
    "/openapi-full.json": backendTraceIncludes,
    "/integrations/payments-mcp": backendTraceIncludes,
  },
};

export default nextConfig;
