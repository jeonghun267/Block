export const DEFAULT_PROFIT_SHARE_PCT = 10;
export const CREATOR_FEE_SPLIT_PCT = 80;
export const PLATFORM_FEE_SPLIT_PCT = 20;

export type PerformanceSettlementInput = {
  cumulativeNetRealizedProfit: number;
  previousHighWaterMark: number;
  profitSharePct?: number;
};

export type PerformanceSettlement = {
  eligibleProfit: number;
  performanceFee: number;
  creatorPayout: number;
  platformPayout: number;
  nextHighWaterMark: number;
};

function integerAmount(value: number, label: string) {
  if (!Number.isFinite(value)) throw new RangeError(`${label}은 유효한 숫자여야 합니다`);
  return Math.trunc(value);
}

/**
 * Calculates a high-water-mark performance fee in the currency's smallest unit.
 * Loss recovery is never charged and only profit above the previous peak is eligible.
 */
export function calculatePerformanceSettlement(input: PerformanceSettlementInput): PerformanceSettlement {
  const cumulativeProfit = integerAmount(input.cumulativeNetRealizedProfit, "누적 실현손익");
  const previousHighWaterMark = Math.max(0, integerAmount(input.previousHighWaterMark, "최고수익기준선"));
  const profitSharePct = input.profitSharePct ?? DEFAULT_PROFIT_SHARE_PCT;
  if (!Number.isFinite(profitSharePct) || profitSharePct < 0 || profitSharePct > 100) {
    throw new RangeError("성과보수율은 0~100%여야 합니다");
  }

  const eligibleProfit = Math.max(0, cumulativeProfit - previousHighWaterMark);
  const performanceFee = Math.floor(eligibleProfit * profitSharePct / 100);
  const creatorPayout = Math.floor(performanceFee * CREATOR_FEE_SPLIT_PCT / 100);
  const platformPayout = performanceFee - creatorPayout;

  return {
    eligibleProfit,
    performanceFee,
    creatorPayout,
    platformPayout,
    nextHighWaterMark: Math.max(previousHighWaterMark, cumulativeProfit),
  };
}

/** Public catalogue copy that never contains thresholds, timing rules or executable logic. */
export function buildProtectedStrategySummary(category: string, exactSummary: string) {
  const asset = exactSummary.match(/\b(BTC|ETH|SOL|XRP)\b/u)?.[1] ?? "가상자산";
  const safeCategory = category.trim().slice(0, 20) || "조건형";
  return `${asset} · ${safeCategory} · 서버 실행 전용`;
}

export function containsExecutableRuleDetail(value: string) {
  return /%|\bRSI\s*\d|\d+(?:\.\d+)?\s*배|\d+\s*(?:분|시간|일)/iu.test(value);
}

export function redactExecutableRuleDetails(value: string) {
  return value
    .replace(/\bRSI\s*\d+(?:\.\d+)?/giu, "비공개 지표")
    .replace(/\d+(?:\.\d+)?\s*%/gu, "비공개 기준")
    .replace(/\d+(?:\.\d+)?\s*배/gu, "비공개 배수")
    .replace(/\d+\s*(?:분|시간|일)/gu, "비공개 주기");
}

export function projectStrategySourceForViewer(input: {
  name: string;
  category: string;
  description: string;
  conditionSummary: string;
  blocks: string[];
}, isOwner: boolean) {
  if (isOwner) {
    return {
      name: input.name,
      description: input.description,
      conditionSummary: input.conditionSummary,
      blocks: input.blocks,
      visibility: "signal_only" as const,
    };
  }
  return {
    name: redactExecutableRuleDetails(input.name),
    description: redactExecutableRuleDetails(input.description),
    conditionSummary: buildProtectedStrategySummary(input.category, input.conditionSummary),
    blocks: [] as string[],
    visibility: "signal_only" as const,
  };
}
