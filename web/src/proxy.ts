import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LEGACY_UI_HOST = "x402.aurelianflo.com";
const PRIMARY_UI_HOST = "aurelianflo.com";

export function proxy(request: NextRequest) {
  if (request.headers.get("host") !== LEGACY_UI_HOST) {
    return NextResponse.next();
  }

  const destination = request.nextUrl.clone();
  destination.protocol = "https";
  destination.host = PRIMARY_UI_HOST;

  return NextResponse.redirect(destination, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
