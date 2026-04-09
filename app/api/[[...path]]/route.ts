import { proxyToBackend } from "../../../lib/next-backend-proxy";

export const runtime = "nodejs";

async function handler(request: Request) {
  return proxyToBackend(request);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
