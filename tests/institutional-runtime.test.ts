import { describe, expect, it, vi } from "vitest";
import { UpbitReadOnlyAdapter } from "../lib/exchange/upbit";
import { assertReadOnlyExchangePath } from "../lib/exchange/types";
import { retryDelayMs, safeRuntimeError } from "../lib/runtime/job-queue";
import { readSecretBrokerConfig, resolveExchangeCredential } from "../lib/security/secret-broker";

describe("기관 런타임 안전 경계", () => {
  it("재시도 간격을 지수 증가시키되 15분으로 제한한다", () => {
    expect(retryDelayMs(1)).toBe(15_000);
    expect(retryDelayMs(2)).toBe(30_000);
    expect(retryDelayMs(6)).toBe(480_000);
    expect(retryDelayMs(10)).toBe(900_000);
    expect(retryDelayMs(99)).toBe(900_000);
  });

  it("런타임 오류에서 토큰과 긴 비밀값을 제거한다", () => {
    const error = safeRuntimeError(new Error(`authorization=secret-value token:${"a".repeat(80)}`));
    expect(error.message).not.toContain("secret-value");
    expect(error.message).not.toContain("a".repeat(80));
    expect(error.message).toContain("[REDACTED]");
  });

  it("KMS/Vault 브로커가 없거나 HTTPS가 아니면 안전하게 잠근다", () => {
    expect(readSecretBrokerConfig({})).toMatchObject({
      ready: false,
      missing: ["SECRET_BROKER_URL", "SECRET_BROKER_SERVICE_TOKEN"],
    });
    expect(() => readSecretBrokerConfig({
      SECRET_BROKER_URL: "http://vault.example.test",
      SECRET_BROKER_SERVICE_TOKEN: "service-token",
    })).toThrow(/HTTPS/);
  });

  it("비밀정보 브로커의 짧은 수명 자격증명과 계정 지문을 검증한다", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      accessKey: "access-key-1234",
      secretKey: "secret-key-value-1234567890",
      credentialFingerprint: "ab".repeat(16),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const config = readSecretBrokerConfig({
      SECRET_BROKER_URL: "https://vault.example.test",
      SECRET_BROKER_SERVICE_TOKEN: "service-token",
    });
    await expect(resolveExchangeCredential(config, {
      secretReference: "vault://blocktrade/upbit/read-only",
      institutionId: "inst-12345678",
      actorKey: "runtime-service@blocktrade.internal",
      requestId: "request-12345678",
      purpose: "read_only_reconciliation",
    }, fetcher)).resolves.toMatchObject({
      credentialFingerprint: "ab".repeat(16),
    });
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String((init.headers as Record<string, string>).Authorization)).toBe("Bearer service-token");
  });

  it("업비트 법인 계정 대사는 조회 API 세 개만 GET으로 호출한다", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const payload = path === "/v1/accounts"
        ? [{ currency: "KRW", balance: "1000000", locked: "0", avg_buy_price: "0" }]
        : [{
            uuid: path.endsWith("/open") ? "open-1" : "closed-1",
            market: "KRW-BTC",
            side: "bid",
            state: path.endsWith("/open") ? "wait" : "done",
            volume: "0.01",
            remaining_volume: path.endsWith("/open") ? "0.01" : "0",
            executed_volume: path.endsWith("/open") ? "0" : "0.01",
            paid_fee: path.endsWith("/open") ? "0" : "500",
            price: "100000000",
            created_at: "2026-07-24T00:00:00Z",
          }];
      expect(init?.method).toBe("GET");
      expect(String((init?.headers as Record<string, string>).Authorization)).toMatch(/^Bearer /);
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const adapter = new UpbitReadOnlyAdapter({
      apiBaseUrl: "https://api.upbit.com",
      accessKey: "access-key-1234",
      secretKey: "secret-key-value-1234567890",
    }, fetcher);
    const [accounts, open, closed] = await Promise.all([
      adapter.getAccounts("request-accounts-1234"),
      adapter.getOpenOrders("request-open-123456"),
      adapter.getClosedOrders("request-closed-1234"),
    ]);
    expect(accounts[0]?.currency).toBe("KRW");
    expect(open[0]?.state).toBe("open");
    expect(closed[0]?.state).toBe("filled");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(() => assertReadOnlyExchangePath("/v1/orders")).toThrow(/허용되지 않은/);
    expect(() => assertReadOnlyExchangePath("/v1/withdraws/coin")).toThrow(/blocked/);
  });
});
