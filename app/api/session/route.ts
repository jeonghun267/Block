import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { readExchangeRuntimeConfig } from "../../../lib/security/config";
import { requireTrustedIdentity, TrustedIdentityError } from "../../../lib/security/identity";
import { getRequestContext } from "../../../lib/security/request";

export const runtime = "edge";

function displayName(request: Request, subject: string): string {
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  if (encoded && encoding === "percent-encoded-utf-8") {
    try {
      const decoded = decodeURIComponent(encoded).trim();
      if (decoded.length >= 1 && decoded.length <= 80) return decoded;
    } catch {
      // Fall through to a non-sensitive subject-derived label.
    }
  }
  return subject.split("@")[0] || "기관 사용자";
}

export async function GET(request: Request) {
  const requestId = getRequestContext(request).requestId;
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    "X-Request-ID": requestId,
  };
  try {
    const config = readExchangeRuntimeConfig(env as unknown as Record<string, unknown>);
    const identity = requireTrustedIdentity(request, config);
    return NextResponse.json({
      authenticated: true,
      user: { displayName: displayName(request, identity.subject) },
      assurance: {
        provider: identity.source === "oai-authenticated-user-email" ? "sign_in_with_chatgpt" : identity.source,
        productionIdentity: identity.source !== "development-demo",
      },
      requestId,
    }, { headers });
  } catch (error) {
    if (error instanceof TrustedIdentityError) {
      return NextResponse.json({ authenticated: false, requestId }, { status: 401, headers });
    }
    console.error(JSON.stringify({ level: "error", event: "session_status_failed", requestId, errorType: error instanceof Error ? error.name : "RuntimeError" }));
    return NextResponse.json({ authenticated: false, requestId }, { status: 503, headers });
  }
}
