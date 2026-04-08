import { proxyToBackend } from "../../../lib/next-backend-proxy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return proxyToBackend(request);
}
