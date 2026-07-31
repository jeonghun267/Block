import { describe, expect, it } from "vitest";
import {
  applyShadowFill,
  evaluateLatestShadowSignal,
  evaluateShadowRisk,
  normalizeShadowStrategyDefinition,
  runShadowBacktest,
  type MarketCandle,
  type ShadowStrategySpec,
} from "../lib/shadow";

const spec: ShadowStrategySpec = {
  schemaVersion: 1,
  market: "KRW-BTC",
  intervalMinutes: 240,
  entry: { metric: "drawdown", lookbackBars: 3, operator: "lte", thresholdBps: -150 },
  allocationBps: 2_000,
  takeProfitBps: 250,
  stopLossBps: 200,
  feeBps: 5,
  slippageBps: 10,
  startingCashMinor: 100_000_000,
};

function candles(prices: number[]): MarketCandle[] {
  return prices.map((close, index) => ({
    timestamp: new Date(Date.UTC(2026, 6, 1, index * 4)).toISOString(),
    open: close,
    high: close,
    low: close,
    close,
    volume: 10,
    quoteVolume: close * 10,
  }));
}

describe("실제 시세 기반 섀도 엔진", () => {
  it("전략 빌더 블록을 실행 가능한 현물 섀도 명세로 정규화한다", () => {
    const normalized = normalizeShadowStrategyDefinition({
      schemaVersion: 1,
      blocks: [
        { kind: "condition", config: { type: "price_change", metric: "return", asset: "ETH", direction: "down", threshold: 2.5, window: "4h" } },
        { kind: "action", config: { type: "ratio_trade", side: "buy", ratio: 10, basis: "available_cash" } },
      ],
    });
    expect(normalized).toMatchObject({ market: "KRW-ETH", intervalMinutes: 240, allocationBps: 1_000 });
    expect(normalized.entry).toMatchObject({ metric: "return", operator: "lte", thresholdBps: -250 });
  });

  it("같은 캔들 표본으로 진입·청산과 비용을 재현한다", () => {
    const result = runShadowBacktest(candles([100, 100, 100, 100, 98, 101, 100, 98, 101]), spec);
    expect(result.tradeCount).toBeGreaterThanOrEqual(2);
    expect(result.trades[0]).toMatchObject({ side: "buy", reason: "entry" });
    expect(result.trades[1]).toMatchObject({ side: "sell", reason: "take_profit" });
    expect(result.feesMinor).toBeGreaterThan(0);
    expect(Number.isInteger(result.totalReturnBps)).toBe(true);
  });

  it("최신 캔들의 임계값 교차에서만 새 진입 신호를 만든다", () => {
    const signal = evaluateLatestShadowSignal({ candles: candles([100, 100, 100, 100, 98]), spec, positionQuantity: 0, positionCostMinor: 0 });
    expect(signal).toMatchObject({ triggered: true, side: "buy", reason: "entry", metricBps: -200 });
    expect(signal.signalKey).toContain("KRW-BTC");
  });

  it("승인 상태·시세 신선도·손실·주문금액·익스포저를 서버에서 함께 판정한다", () => {
    const policy = { maxGrossExposurePct: 80, maxAssetConcentrationPct: 40, maxDailyLossPct: 3, maxOrderKrw: 100_000_000 };
    expect(evaluateShadowRisk({ strategyStatus: "paper", policy, startingCashMinor: 100_000_000, cashMinor: 100_000_000, currentPositionValueMinor: 0, currentDailyLossBps: 0, side: "buy", orderNotionalMinor: 20_000_000, dataAgeSeconds: 120, maxDataAgeSeconds: 1_000 }).allowed).toBe(true);
    const blocked = evaluateShadowRisk({ strategyStatus: "draft", policy, startingCashMinor: 100_000_000, cashMinor: 100_000_000, currentPositionValueMinor: 0, currentDailyLossBps: 350, side: "buy", orderNotionalMinor: 110_000_000, dataAgeSeconds: 2_000, maxDataAgeSeconds: 1_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.codes).toEqual(expect.arrayContaining(["strategy_not_approved", "market_data_stale", "daily_loss_limit", "max_order_value"]));
  });

  it("허용된 주문도 거래소 대신 내부 포트폴리오에만 반영한다", () => {
    const fill = applyShadowFill({ side: "buy", cashMinor: 100_000_000, positionQuantity: 0, positionCostMinor: 0, referencePriceMinor: 100_000_000, orderNotionalMinor: 20_000_000, feeBps: 5, slippageBps: 10 });
    expect(fill.cashMinor).toBe(80_000_000);
    expect(fill.positionQuantity).toBeGreaterThan(0);
    expect(fill.feeMinor).toBe(10_000);
  });
});
