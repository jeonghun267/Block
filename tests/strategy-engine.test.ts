import { describe, expect, it } from "vitest";
import {
  diagnoseStrategy,
  evaluatePercentCondition,
  migrateLegacyCondition,
  migrateLegacyStrategy,
  percentChange,
  validateBacktestConfigV1,
  validatePriceConditionV1,
  validateStrategyV1,
  type BacktestConfigV1,
  type PriceConditionV1,
  type StrategyV1,
} from "../lib/strategy";

function condition(overrides: Partial<PriceConditionV1> = {}): PriceConditionV1 {
  return {
    schemaVersion: 1,
    type: "price_condition",
    id: "return-up",
    metric: "return",
    reference: { kind: "window_open", interval: "1h", lookbackPeriods: 4, priceField: "open" },
    trigger: { kind: "level", operator: "gte", thresholdPct: 2.5 },
    confirmation: { minimumHits: 1, windowBars: 1, closedBarsOnly: true },
    missingData: { mode: "fail_closed" },
    repeat: { mode: "once_per_bar" },
    ...overrides,
  };
}

function strategy(conditions: PriceConditionV1[], match: "all" | "any" = "all"): StrategyV1 {
  return { schemaVersion: 1, id: "eth-strategy", name: "ETH 전략", timeZone: "Asia/Seoul", match, conditions };
}

const validBacktest: BacktestConfigV1 = {
  schemaVersion: 1,
  period: { from: "2025-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z", timeZone: "Asia/Seoul" },
  marketData: { interval: "1h", missingCandles: "forward_fill", maxForwardFillBars: 2 },
  costs: { makerFeeBps: 5, takerFeeBps: 10, slippage: { model: "fixed_bps", bps: 8 } },
  split: { method: "chronological", inSampleRatio: 0.7, minimumOutOfSampleBars: 500 },
  execution: { initialCapital: 3_000_000, quoteCurrency: "KRW", orderType: "market", fillPolicy: "next_open", warmupBars: 200 },
};

describe("strategy schema v1", () => {
  it("requires every percentage interpretation field", () => {
    expect(validatePriceConditionV1(condition()).success).toBe(true);
    const invalid = { ...condition(), reference: { kind: "rolling_peak", interval: "1h", lookbackPeriods: 4, priceField: "high" } };
    const result = validatePriceConditionV1(invalid);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((item) => item.code === "incompatible_reference")).toBe(true);
  });

  it("validates IANA timezone and strategy contents at runtime", () => {
    expect(validateStrategyV1(strategy([condition()])).success).toBe(true);
    const result = validateStrategyV1({ ...strategy([condition()]), timeZone: "Seoulish/Now" });
    expect(result.success).toBe(false);
  });
});

describe("legacy migration", () => {
  it("migrates Korean labels into explicit cross conditions", () => {
    const migrated = migrateLegacyCondition("ETH가 최근 4시간 시가 대비 2.5% 상향 돌파하면");
    expect(migrated.metric).toBe("return");
    expect(migrated.reference).toMatchObject({ kind: "window_open", interval: "4h", lookbackPeriods: 1 });
    expect(migrated.trigger).toEqual({ kind: "cross", direction: "above", thresholdPct: 2.5 });
    expect(validatePriceConditionV1(migrated).success).toBe(true);
  });

  it("migrates legacy config and preserves risk semantics", () => {
    const migrated = migrateLegacyStrategy({ name: "손절 전략", blocks: [{ label: "포지션 손실 5% 이하", confirmationBars: 2, cooldownBars: 4 }] });
    expect(migrated.conditions[0].metric).toBe("position_pnl");
    expect(migrated.conditions[0].trigger).toMatchObject({ kind: "level", operator: "lte", thresholdPct: -5 });
    expect(migrated.conditions[0].repeat).toMatchObject({ mode: "cooldown", cooldownBars: 4 });
  });
});

describe("strategy diagnostics", () => {
  it("finds duplicates and impossible all-conditions", () => {
    const base = condition();
    const duplicate = { ...base, id: "duplicate" };
    const upper = condition({ id: "upper", trigger: { kind: "level", operator: "lte", thresholdPct: 1 } });
    const result = diagnoseStrategy(strategy([base, duplicate, upper]));
    expect(result.map((item) => item.code)).toContain("duplicate_condition");
    expect(result.map((item) => item.code)).toContain("contradictory_conditions");
  });

  it("finds any-branches subsumed by a wider percentage condition", () => {
    const wide = condition({ id: "wide", trigger: { kind: "level", operator: "gte", thresholdPct: 2 } });
    const narrow = condition({ id: "narrow", trigger: { kind: "level", operator: "gte", thresholdPct: 5 } });
    expect(diagnoseStrategy(strategy([wide, narrow], "any"))).toContainEqual(expect.objectContaining({ code: "unreachable_condition", conditionIds: ["wide", "narrow"] }));
  });
});

describe("deterministic percentage evaluator", () => {
  it("calculates signed percentages without clock or mutation", () => {
    expect(percentChange(102.5, 100)).toBe(2.5);
    const samples = [{ barIndex: 20, observed: 102.5, reference: 100, closed: true }] as const;
    const before = JSON.stringify(samples);
    expect(evaluatePercentCondition(condition(), samples)).toEqual({ matched: true, triggered: true, metricPct: 2.5, hits: 1, reason: "triggered" });
    expect(JSON.stringify(samples)).toBe(before);
  });

  it("distinguishes level and crossing triggers", () => {
    const crossing = condition({ trigger: { kind: "cross", direction: "above", thresholdPct: 2.5 }, confirmation: { minimumHits: 1, windowBars: 2, closedBarsOnly: true } });
    const samples = [
      { barIndex: 1, observed: 102, reference: 100, closed: true },
      { barIndex: 2, observed: 102.5, reference: 100, closed: true },
    ];
    expect(evaluatePercentCondition(crossing, samples).triggered).toBe(true);
    expect(evaluatePercentCondition(crossing, [{ ...samples[0], observed: 103 }, { ...samples[1], observed: 104 }]).triggered).toBe(false);
  });

  it("applies missing-data, confirmation and repeat policies", () => {
    const guarded = condition({
      confirmation: { minimumHits: 2, windowBars: 3, closedBarsOnly: true },
      missingData: { mode: "carry_forward", maxCarryBars: 1 },
      repeat: { mode: "cooldown", cooldownBars: 2, resetOnOpposite: false },
    });
    const samples = [
      { barIndex: 10, observed: 103, reference: 100, closed: true },
      { barIndex: 11, observed: null, reference: null, closed: true },
      { barIndex: 12, observed: 104, reference: 100, closed: true },
    ];
    expect(evaluatePercentCondition(guarded, samples, { hasTriggered: true, lastTriggeredBar: 10 })).toMatchObject({ matched: true, triggered: false, hits: 3, reason: "repeat_blocked" });
  });
});

describe("realistic backtest configuration", () => {
  it("requires costs, missing-candle policy, timezone and chronological out-of-sample split", () => {
    expect(validateBacktestConfigV1(validBacktest).success).toBe(true);
    const result = validateBacktestConfigV1({
      ...validBacktest,
      period: { ...validBacktest.period, timeZone: "invalid-zone" },
      costs: { ...validBacktest.costs, takerFeeBps: -1 },
      split: { ...validBacktest.split, inSampleRatio: 1 },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(new Set(result.issues.map((item) => item.code))).toEqual(expect.objectContaining(new Set(["timezone", "range"])));
  });
});
