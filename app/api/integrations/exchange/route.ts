import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { readExchangeRuntimeConfig, SafeConfigError, toPublicExchangeStatus } from "../../../../lib/security/config";
import { requireTrustedIdentity, TrustedIdentityError } from "../../../../lib/security/identity";
import { EdgeRateLimiter, getRequestContext, rateLimitHeaders } from "../../../../lib/security/request";
import { createExchangeAdapter } from "../../../../lib/exchange";

export const runtime = "edge";

const limiter = new EdgeRateLimiter();
const BASE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
};

export async function GET(request: Request) {
  const context = getRequestContext(request);
  try {
    const config = readExchangeRuntimeConfig(env as unknown as Record<string, unknown>);
    const identity = requireTrustedIdentity(request, config);
    const rateLimit = limiter.take(`integration-status:${identity.subject}`, 30, 60_000);
    const headers = {
      ...BASE_HEADERS,
      ...rateLimitHeaders(rateLimit),
      "X-Request-ID": context.requestId,
    };
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Too many requests", requestId: context.requestId }, { status: 429, headers });
    }

    return NextResponse.json({
      ...toPublicExchangeStatus(config),
      capabilities: {
        accounts: true,
        marketData: true,
        placeOrders: false,
        cancelOrders: false,
        withdrawals: false,
      },
      executionBoundary: "internal_strategy_executor",
      requestId: context.requestId,
    }, { headers });
  } catch (error) {
    const status = error instanceof TrustedIdentityError ? error.status : error instanceof SafeConfigError ? 503 : 500;
    const message = error instanceof TrustedIdentityError
      ? "Authentication required"
      : error instanceof SafeConfigError
        ? "Exchange integration is not configured safely"
        : "Integration status is unavailable";
    return NextResponse.json(
      { error: message, requestId: context.requestId },
      { status, headers: { ...BASE_HEADERS, "X-Request-ID": context.requestId } },
    );
  }
}

export async function POST(request: Request) {
  const context = getRequestContext(request);
  try {
    const config = readExchangeRuntimeConfig(env as unknown as Record<string, unknown>);
    const identity = requireTrustedIdentity(request, config);
    const rateLimit = limiter.take(`exchange-command:${identity.subject}`, 10, 60_000);
    const headers = { ...BASE_HEADERS, ...rateLimitHeaders(rateLimit), "X-Request-ID":context.requestId };
    if (!rateLimit.allowed) return NextResponse.json({ error:"Too many requests", requestId:context.requestId }, { status:429, headers });
    const raw = await request.text();
    if (raw.length > 4_000) return NextResponse.json({ error:"Request is too large", requestId:context.requestId }, { status:413, headers });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw) as Record<string, unknown>; }
    catch { return NextResponse.json({ error:"Invalid JSON", requestId:context.requestId }, { status:400, headers }); }

    const adapter = createExchangeAdapter(config);
    if (body.action === "accounts") {
      if (config.mode === "live") {
        return NextResponse.json({ error:"A user-specific exchange vault is required for live account access", requestId:context.requestId }, { status:403, headers });
      }
      const accounts = await adapter.getAccounts(context.requestId);
      return NextResponse.json({ mode:config.mode, accounts, requestId:context.requestId }, { headers });
    }
    if (body.action === "place_limit_order" || body.action === "cancel_order") {
      return NextResponse.json({ error:"Exchange orders are accepted only from the internal guarded executor", requestId:context.requestId }, { status:403, headers });
    }
    return NextResponse.json({ error:"Unsupported exchange command", requestId:context.requestId }, { status:400, headers });
  } catch (error) {
    const status = error instanceof TrustedIdentityError ? 401 : error instanceof SafeConfigError ? 503 : 502;
    const message = error instanceof TrustedIdentityError ? "Authentication required" : error instanceof SafeConfigError ? "Exchange integration is not configured safely" : "Exchange command failed";
    return NextResponse.json({ error:message, requestId:context.requestId }, { status, headers:{ ...BASE_HEADERS, "X-Request-ID":context.requestId } });
  }
}
