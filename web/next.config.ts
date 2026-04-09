import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.dirname(fileURLToPath(import.meta.url));

const API_ORIGIN =
  process.env.API_URL?.replace(/\/+$/, "") || "https://api.aurelianflo.com";

const nextConfig: NextConfig = {
  turbopack: {
    root: WEB_ROOT,
  },
  async rewrites() {
    return [
      { source: "/icon.png", destination: "/aurelianflo-icon.png" },
      { source: "/api", destination: `${API_ORIGIN}/api` },
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
      { source: "/openapi.json", destination: `${API_ORIGIN}/openapi.json` },
      { source: "/openapi-full.json", destination: `${API_ORIGIN}/openapi-full.json` },
      { source: "/mcp", destination: `${API_ORIGIN}/mcp` },
      { source: "/mcp/:path*", destination: `${API_ORIGIN}/mcp/:path*` },
      { source: "/favicon.ico", destination: `${API_ORIGIN}/favicon.ico` },
    ];
  },
};

export default nextConfig;
