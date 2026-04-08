import { proxyToBackend } from "../../../lib/next-backend-proxy";
import { buildDocumentArtifact } from "../../../routes/auto-local/doc-artifacts";

export const runtime = "nodejs";

const DIRECT_DOCUMENT_PATHS = new Set([
  "/api/tools/report/generate",
  "/api/tools/report/pdf/generate",
]);

async function maybeHandleDirectDocumentRoute(request: Request) {
  if (request.method !== "POST") {
    return null;
  }

  const url = new URL(request.url);
  if (!DIRECT_DOCUMENT_PATHS.has(url.pathname)) {
    return null;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        success: false,
        error: "invalid_json",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const payload = await buildDocumentArtifact({
    path: url.pathname,
    endpoint: `${request.method} ${url.pathname}`,
    body,
  });

  return Response.json(payload, { status: payload.success ? 200 : 400 });
}

async function handler(request: Request) {
  const directResponse = await maybeHandleDirectDocumentRoute(request);
  if (directResponse) {
    return directResponse;
  }

  return proxyToBackend(request);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
