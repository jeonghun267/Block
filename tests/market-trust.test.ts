import { describe, expect, it } from "vitest";
import { assessStrategyTrust, validateDistributionTerms, type StrategyPerformanceEvidence } from "../lib/market-trust";
import { DemoPaymentAdapter, calculateSettlement, getLivePaymentReadiness, getMarketplaceCommerceReadiness } from "../lib/payment";

const metrics = {
  netReturnPct: 12.4,
  maxDrawdownPct: 6.2,
  tradeCount: 120,
  liveDays: 200,
  dataFreshnessMinutes: 10,
  sampleSize: 140,
  asOf: "2026-07-14T00:00:00.000Z",
};

function verifiedEvidence(overrides: Partial<StrategyPerformanceEvidence> = {}): StrategyPerformanceEvidence {
  return {
    selfReported: {
      source: "self_reported",
      metrics: { ...metrics, netReturnPct: 13 },
      declaredAt: "2026-07-14T00:00:00.000Z",
      declarationId: "decl-1",
    },
    verified: {
      source: "verified_live",
      metrics,
      verificationRunId: "verification-1",
      verifiedAt: "2026-07-14T00:01:00.000Z",
      verifierId: "exchange-connector",
    },
    cohort: { includesInactiveStrategies: true, includesDelistedStrategies: true },
    ...overrides,
  };
}

describe("strategy market trust", () => {
  it("uses verified metrics instead of an inflated self report", () => {
    const evidence = verifiedEvidence({
      selfReported: {
        source: "self_reported",
        metrics: { ...metrics, netReturnPct: 99, maxDrawdownPct: 1 },
        declaredAt: "2026-07-14T00:00:00.000Z",
        declarationId: "decl-2",
      },
    });
    const result = assessStrategyTrust(evidence);
    expect(result.evaluatedMetrics?.netReturnPct).toBe(12.4);
    expect(result.basis).toBe("verified_live");
    expect(result.warnings.map((warning) => warning.code)).toContain("reported_verified_gap");
  });

  it("awards evidence quality without rewarding high return", () => {
    const first = assessStrategyTrust(verifiedEvidence());
    const second = assessStrategyTrust(verifiedEvidence({
      verified: { ...verifiedEvidence().verified!, metrics: { ...metrics, netReturnPct: 80 } },
      selfReported: undefined,
    }));
    expect(first.score).toBe(100);
    expect(second.score).toBe(100);
    expect(first.grade).toBe("A");
  });

  it("caps self-reported evidence and reports sample and survivorship risks", () => {
    const result = assessStrategyTrust({
      selfReported: {
        source: "self_reported",
        metrics: { ...metrics, tradeCount: 8, liveDays: 12, sampleSize: 8, dataFreshnessMinutes: 3000 },
        declaredAt: "2026-07-14T00:00:00.000Z",
        declarationId: "decl-3",
      },
    });
    expect(result.grade).toBe("UNVERIFIED");
    expect(result.score).toBeLessThanOrEqual(15);
    expect(result.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "self_report_only",
      "stale_data",
      "insufficient_trades",
      "insufficient_live_days",
      "small_sample",
      "survivorship_bias_risk",
    ]));
  });

  it("enforces signal-only and replication disclosure metadata", () => {
    expect(validateDistributionTerms({
      visibility: "subscriber_details",
      licenseMode: "signal_only",
      exposesExactRules: true,
      redistributionAllowed: false,
      signalDelaySeconds: 0,
      termsVersion: "v1",
    }).valid).toBe(false);
    expect(validateDistributionTerms({
      visibility: "subscriber_details",
      licenseMode: "replication",
      exposesExactRules: true,
      redistributionAllowed: false,
      signalDelaySeconds: 0,
      termsVersion: "v1",
    }).valid).toBe(true);
  });
});

describe("payment and settlement readiness", () => {
  it("supports deterministic demo checkout and refunds", async () => {
    const adapter = new DemoPaymentAdapter();
    expect(adapter.readiness().ready).toBe(true);
    await expect(adapter.createCheckout({
      requestId: "request-123",
      buyerId: "buyer-1",
      strategyId: "strategy-1",
      amount: 9900,
      currency: "KRW",
      returnUrl: "https://example.test/complete",
    })).resolves.toMatchObject({ status: "confirmed", provider: "demo" });
    await expect(adapter.refund({ requestId: "refund-123", paymentId: "pay-1", amount: 9900, reason: "테스트" })).resolves.toMatchObject({ status: "refunded" });
  });

  it("reports key presence without exposing secret values", () => {
    const secret = "never-return-this-secret";
    const readiness = getLivePaymentReadiness({
      PAYMENT_PROVIDER: "future-provider",
      PAYMENT_PUBLIC_KEY: "pk-test",
      PAYMENT_SECRET_KEY: secret,
      PAYMENT_WEBHOOK_SECRET: "webhook-secret",
      PAYMENT_ADAPTER_IMPLEMENTED: "true",
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.keyPresence.PAYMENT_SECRET_KEY).toBe(true);
    expect(JSON.stringify(readiness)).not.toContain(secret);
  });

  it("keeps KYC, review, tax and payout readiness as live blockers", () => {
    const readiness = getMarketplaceCommerceReadiness({ PAYMENT_MODE: "live" });
    expect(readiness.demoReady).toBe(true);
    expect(readiness.liveReady).toBe(false);
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining(["kyc", "regulatory_review", "tax_profile", "payout_account"]));
    expect(readiness.blockers.every((blocker) => blocker.liveBlocking)).toBe(true);
  });

  it("calculates fees, refunds and held settlement net amounts", () => {
    expect(calculateSettlement({
      grossAmount: 10_000,
      refundedAmount: 2_000,
      currency: "KRW",
      status: "on_hold",
      holdReasons: ["refund_window"],
      policy: { platformFeeBps: 2000, paymentFeeBps: 300, fixedPaymentFee: 100 },
    })).toEqual({
      grossAmount: 10_000,
      refundedAmount: 2_000,
      platformFee: 1_600,
      paymentFee: 340,
      creatorNetAmount: 6_060,
      currency: "KRW",
      status: "on_hold",
      holdReasons: ["refund_window"],
    });
  });
});
