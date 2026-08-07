import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // CORS lockdown for the API surface. Browser cross-origin requests must come
  // from an allowed origin (same-origin or NEXT_PUBLIC_APP_ORIGIN). Requests
  // with no Origin header (server-to-server, e.g. the Kleinschmidt EDI gateway)
  // are allowed — they're gated by HMAC + IP allowlist instead.
  if (request.nextUrl.pathname.startsWith("/api")) {
    const cors = handleCors(request);
    if (cors) return cors;
  }
  return updateSession(request);
}

function allowedOrigins(request: NextRequest): Set<string> {
  const set = new Set<string>([request.nextUrl.origin]);
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (configured) set.add(configured.replace(/\/$/, ""));
  return set;
}

function handleCors(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null; // non-browser (server-to-server) — allowed here
  const allowed = allowedOrigins(request);
  if (!allowed.has(origin)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-EDI-Signature, X-Org-Id",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }
  return null; // same/allowed origin — proceed
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
