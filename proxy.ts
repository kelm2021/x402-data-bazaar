import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const API_HOST = "api.aurelianflo.com";

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").split(",")[0].trim().toLowerCase();

  if (host === API_HOST && request.nextUrl.pathname === "/") {
    const destination = request.nextUrl.clone();
    destination.pathname = "/api";
    destination.searchParams.set("format", "json");
    return NextResponse.rewrite(destination);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
