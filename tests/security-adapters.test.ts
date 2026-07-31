import { describe, expect, it, vi } from "vitest";
import { DemoExchangeAdapter, MINIMUM_EXCHANGE_PERMISSION_POLICY, UpbitExchangeAdapter, assertSafeExchangePath, signUpbitJwt } from "../lib/exchange";
import { readExchangeRuntimeConfig, toPublicExchangeStatus } from "../lib/security/config";
import { requireTrustedIdentity, TrustedIdentityError } from "../lib/security/identity";
import { EdgeRateLimiter, fingerprintRequest, getRequestContext } from "../lib/security/request";

describe("exchange environment configuration", () => {
  it("stays in demo until credentials and every operator gate are present", () => {
    const demo = readExchangeRuntimeConfig({ NODE_ENV: "production" });
    expect(toPublicExchangeStatus(demo)).toMatchObject({
      mode: "demo",
      ready: true,
      liveReady: false,
      missing: ["UPBIT_ACCESS_KEY", "UPBIT_SECRET_KEY"],
      withdrawalsAllowed: false,
    });

    const keysOnly = readExchangeRuntimeConfig({
      NODE_ENV: "production",
      UPBIT_ACCESS_KEY: "access-value",
      UPBIT_SECRET_KEY: "secret-value",
    });
    expect(keysOnly.mode).toBe("demo");
    expect(keysOnly.liveBlockers).toEqual(["operator_switch", "approved_account"]);

    const live = readExchangeRuntimeConfig({
      APP_ENV: "production",
      EXCHANGE_MODE: "auto",
      UPBIT_ACCESS_KEY: "access-value",
      UPBIT_SECRET_KEY: "secret-value",
      LIVE_TRADING_ENABLED: "true",
      LIVE_TRADING_ACCOUNT_ID: "upbit-approved-1",
    });
    const publicStatus = JSON.stringify(toPublicExchangeStatus(live));
    expect(live.mode).toBe("live");
    expect(publicStatus).not.toContain("access-value");
    expect(publicStatus).not.toContain("secret-value");
  });

  it("fails closed when environment metadata is missing and rejects an incomplete forced live mode", () => {
    const config = readExchangeRuntimeConfig({});
    expect(config.runtimeEnvironment).toBe("production");
    expect(config.allowDemoIdentity).toBe(false);
    expect(() => readExchangeRuntimeConfig({ EXCHANGE_MODE:"live", UPBIT_ACCESS_KEY:"a", UPBIT_SECRET_KEY:"b" })).toThrow(/operator switch/);
  });

  it("does not permit a custom API host", () => {
    expect(() => readExchangeRuntimeConfig({ UPBIT_API_BASE_URL: "https://example.com" })).toThrow(/approved Upbit/);
  });
});

describe("trusted identity boundary", () => {
  it("rejects the demo fallback in production", () => {
    const config = readExchangeRuntimeConfig({ NODE_ENV: "production", ALLOW_DEMO_IDENTITY: "true" });
    expect(() => requireTrustedIdentity(new Request("https://app.test"), config)).toThrow(TrustedIdentityError);
  });

  it("accepts an identity from the configured trusted platform header", () => {
    const config = readExchangeRuntimeConfig({ NODE_ENV: "production" });
    const request = new Request("https://app.test", { headers: { "oai-authenticated-user-email": "User@Example.com" } });
    expect(requireTrustedIdentity(request, config).subject).toBe("user@example.com");
  });
});

describe("exchange adapters", () => {
  it("keeps demo orders idempotent", async () => {
    const adapter = new DemoExchangeAdapter();
    const input = {
      market: "KRW-BTC",
      side: "buy" as const,
      volume: "0.001",
      price: "100000000",
      idempotencyKey: "strategy-1-signal-100",
      requestId: "request-00000001",
    };
    const first = await adapter.placeLimitOrder(input);
    const second = await adapter.placeLimitOrder(input);
    expect(second.id).toBe(first.id);
  });

  it("signs live Upbit calls only through a live adapter without exposing keys in errors", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { name: "invalid_query_payload" } }), { status: 400 })) as unknown as typeof fetch;
    const config = readExchangeRuntimeConfig({
      NODE_ENV: "production",
      EXCHANGE_MODE: "live",
      UPBIT_ACCESS_KEY: "test-access-key",
      UPBIT_SECRET_KEY: "test-secret-key",
      LIVE_TRADING_ENABLED: "true",
      LIVE_TRADING_ACCOUNT_ID: "upbit-approved-1",
    });
    const adapter = new UpbitExchangeAdapter(config, fetcher);
    await expect(adapter.getAccounts("request-00000001")).rejects.toThrow("status 400");
    const requestInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(String((requestInit.headers as Record<string, string>).Authorization)).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    expect(() => new UpbitExchangeAdapter(readExchangeRuntimeConfig({ EXCHANGE_MODE: "demo" }), fetcher)).toThrow(/not ready/);
  });

  it("uses Web Crypto JWT signing and blocks withdrawal paths", async () => {
    const token = await signUpbitJwt("access", "secret", "market=KRW-BTC", "fixed-nonce");
    expect(token.split(".")).toHaveLength(3);
    expect(MINIMUM_EXCHANGE_PERMISSION_POLICY.withdrawals).toBe(false);
    expect(() => assertSafeExchangePath("/v1/withdraws/coin")).toThrow(/blocked/);
  });
});

describe("request safety primitives", () => {
  it("requires valid idempotency keys when requested", () => {
    expect(() => getRequestContext(new Request("https://app.test"), { requireIdempotency: true })).toThrow(/required/);
    const context = getRequestContext(new Request("https://app.test", {
      headers: { "idempotency-key": "strategy-1-signal-100" },
    }), { requireIdempotency: true });
    expect(context.idempotencyKey).toBe("strategy-1-signal-100");
  });

  it("creates stable fingerprints and applies a bounded rate limit", async () => {
    await expect(fingerprintRequest("post", "/orders", { b: 2, a: 1 })).resolves.toBe(
      await fingerprintRequest("POST", "/orders", { a: 1, b: 2 }),
    );
    const limiter = new EdgeRateLimiter();
    expect(limiter.take("user", 2, 1_000, 100).allowed).toBe(true);
    expect(limiter.take("user", 2, 1_000, 100).allowed).toBe(true);
    expect(limiter.take("user", 2, 1_000, 100).allowed).toBe(false);
    expect(limiter.take("user", 2, 1_000, 1_101).allowed).toBe(true);
  });
});
