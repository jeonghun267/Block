import { describe, expect, it } from "vitest";
import {
  buildProtectedStrategySummary,
  calculatePerformanceSettlement,
  containsExecutableRuleDetail,
  projectStrategySourceForViewer,
  redactExecutableRuleDetails,
} from "../lib/marketplace-license";

describe("marketplace performance fee", () => {
  it("charges 10% only on profit above the high-water mark and splits it 80/20", () => {
    expect(calculatePerformanceSettlement({
      cumulativeNetRealizedProfit: 1_500_000,
      previousHighWaterMark: 1_000_000,
    })).toEqual({
      eligibleProfit: 500_000,
      performanceFee: 50_000,
      creatorPayout: 40_000,
      platformPayout: 10_000,
      nextHighWaterMark: 1_500_000,
    });
  });

  it("does not charge during a loss or recovery below the prior peak", () => {
    expect(calculatePerformanceSettlement({
      cumulativeNetRealizedProfit: 700_000,
      previousHighWaterMark: 1_000_000,
    })).toMatchObject({
      eligibleProfit: 0,
      performanceFee: 0,
      creatorPayout: 0,
      platformPayout: 0,
      nextHighWaterMark: 1_000_000,
    });
  });

  it("charges only the new increment after recovery", () => {
    expect(calculatePerformanceSettlement({
      cumulativeNetRealizedProfit: 1_100_000,
      previousHighWaterMark: 1_000_000,
    }).performanceFee).toBe(10_000);
  });
});

describe("marketplace intellectual-property boundary", () => {
  it("builds a catalogue summary without executable thresholds", () => {
    const summary = buildProtectedStrategySummary("스윙", "ETH · 4시간 · RSI 30 이하 후 거래량 1.5배 회복");
    expect(summary).toBe("ETH · 스윙 · 서버 실행 전용");
    expect(summary).not.toMatch(/\d|%|RSI|배/u);
  });

  it("detects and redacts rule details from public descriptions", () => {
    const copy = "ETH RSI 30 이하, 거래량 1.5배와 4시간 종가를 확인하고 5% 손절";
    expect(containsExecutableRuleDetail(copy)).toBe(true);
    const redacted = redactExecutableRuleDetails(copy);
    expect(redacted).not.toMatch(/RSI\s*30|1\.5\s*배|4\s*시간|5\s*%/u);
  });

  it("never projects strategy blocks or exact thresholds to a buyer", () => {
    const protectedPayload = projectStrategySourceForViewer({
      name: "ETH RSI 30 반등 전략",
      category: "스윙",
      description: "ETH RSI 30 이하에서 진입하는 전략",
      conditionSummary: "ETH · 4시간 · RSI 30 이하",
      blocks: ["ETH 4시간 RSI 30 이하", "보유 현금 20% 매수"],
    }, false);
    expect(protectedPayload).toEqual({
      name: "ETH 비공개 지표 반등 전략",
      description: "ETH 비공개 지표 이하에서 진입하는 전략",
      conditionSummary: "ETH · 스윙 · 서버 실행 전용",
      blocks: [],
      visibility: "signal_only",
    });
    expect(JSON.stringify(protectedPayload)).not.toContain("4시간 RSI 30");
    expect(JSON.stringify(protectedPayload)).not.toContain("20% 매수");
  });
});
