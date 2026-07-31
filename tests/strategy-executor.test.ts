import { describe, expect, it } from "vitest";
import { DemoExchangeAdapter } from "../lib/exchange";
import type { OperationSettings } from "../lib/operations";
import { executeStrategySignal } from "../lib/runtime/strategy-executor";
import type { PriceConditionV1 } from "../lib/strategy";

const condition: PriceConditionV1 = {
  schemaVersion: 1,
  type: "price_condition",
  id: "price-up-2",
  metric: "return",
  reference: { kind: "window_open", interval: "4h", lookbackPeriods: 1, priceField: "close" },
  trigger: { kind: "level", operator: "gte", thresholdPct: 2 },
  confirmation: { minimumHits: 1, windowBars: 1, closedBarsOnly: true },
  missingData: { mode: "fail_closed" },
  repeat: { mode: "once_per_bar" },
};

const settings: OperationSettings = {
  mode: "paper",
  exchangeStatus: "connected",
  emergencyStatus: "normal",
  dailyLossLimit: 3,
  currentLoss: 0,
  lastHeartbeatAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

const baseInput = {
  ownerId: "user@example.com",
  strategyId: "strategy-1",
  signalId: "signal-9",
  condition,
  settings,
  adapter: new DemoExchangeAdapter(),
  reauthenticated: false,
  order: { market: "KRW-ETH", side: "sell" as const, volume: "0.1", price: "5000000" },
  requestId: "request-1",
};

describe("전략 실행 오케스트레이터", () => {
  it("조건이 맞을 때 안전 게이트를 거쳐 모의 주문을 한 번 제출한다", async () => {
    const result = await executeStrategySignal({
      ...baseInput,
      samples: [{ barIndex: 10, observed: 102.5, reference: 100, closed: true }],
    });
    expect(result.status).toBe("submitted");
    expect(result.order?.state).toBe("queued");
    expect(result.idempotencyKey).toMatch(/^bt-/);
  });

  it("조건이 맞지 않으면 거래소 호출 전에 건너뛴다", async () => {
    const result = await executeStrategySignal({
      ...baseInput,
      samples: [{ barIndex: 10, observed: 101, reference: 100, closed: true }],
    });
    expect(result.status).toBe("skipped");
    expect(result.order).toBeNull();
  });

  it("실거래 설정과 모의 어댑터 조합 및 재인증 누락을 함께 차단한다", async () => {
    const result = await executeStrategySignal({
      ...baseInput,
      settings: { ...settings, mode: "live" },
      samples: [{ barIndex: 10, observed: 102.5, reference: 100, closed: true }],
      reauthenticated: false,
      now: Date.parse("2026-07-14T00:00:30.000Z"),
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual(["adapter_mode_mismatch", "reauthentication_required"]);
  });
});
