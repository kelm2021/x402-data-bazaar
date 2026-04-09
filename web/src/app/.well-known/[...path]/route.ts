import { NextRequest, NextResponse } from "next/server";

const API_ORIGIN =
  process.env.API_URL?.replace(/\/+$/, "") || "https://api.aurelianflo.com";

function buildDestination(pathSegments: string[], request: NextRequest) {
  const path = pathSegments.map(encodeURIComponent).join("/");
  const url = new URL(`${API_ORIGIN}/.well-known/${path}`);
  url.search = request.nextUrl.search;
  return url;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const upstream = await fetch(buildDestination(path, request), {
    headers: {
      accept: request.headers.get("accept") ?? "application/json",
    },
    cache: "no-store",
  });

  const body = await upstream.arrayBuffer();
  const response = new NextResponse(body, { status: upstream.status });

  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    response.headers.set("content-type", contentType);
  }

  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) {
    response.headers.set("cache-control", cacheControl);
  }

  return response;
}
