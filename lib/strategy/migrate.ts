import type { CandleInterval, PriceConditionV1, PriceMetric, ReferenceKind, StrategyV1 } from "./schema";

export type LegacyConditionConfig = {
  id?: string;
  label?: string;
  metric?: string;
  reference?: string;
  percent?: number;
  threshold?: number;
  timeframe?: string;
  lookback?: number;
  operator?: string;
  trigger?: string;
  confirmationBars?: number;
  cooldownBars?: number;
};

export type LegacyCondition = string | LegacyConditionConfig;

export interface LegacyStrategyConfig {
  id?: string;
  name?: string;
  timezone?: string;
  timeZone?: string;
  match?: string;
  conditions?: LegacyCondition[];
  blocks?: LegacyCondition[];
}

const METRIC_ALIASES: Record<string, PriceMetric> = {
  return: "return", price_change: "return", 수익률: "return",
  drawdown: "drawdown", mdd: "drawdown", 낙폭: "drawdown",
  rebound: "rebound", 반등: "rebound",
  ma_deviation: "ma_deviation", ma: "ma_deviation", 이동평균: "ma_deviation",
  volume_change: "volume_change", volume: "volume_change", 거래량: "volume_change",
  position_pnl: "position_pnl", pnl: "position_pnl", 손익: "position_pnl",
};

const DEFAULT_REFERENCE: Record<PriceMetric, { kind: ReferenceKind; priceField: PriceConditionV1["reference"]["priceField"] }> = {
  return: { kind: "window_open", priceField: "open" },
  drawdown: { kind: "rolling_peak", priceField: "high" },
  rebound: { kind: "rolling_low", priceField: "low" },
  ma_deviation: { kind: "moving_average", priceField: "close" },
  volume_change: { kind: "previous_candle_volume", priceField: "volume" },
  position_pnl: { kind: "position_entry", priceField: "close" },
};

function slug(value: string): string {
  const ascii = value.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return ascii || "condition";
}

function metricFrom(label: string, configured?: string): PriceMetric {
  const alias = configured ? METRIC_ALIASES[configured.toLowerCase()] : undefined;
  if (alias) return alias;
  if (/거래량|volume/i.test(label)) return "volume_change";
  if (/이동평균|\bma\b/i.test(label)) return "ma_deviation";
  if (/포지션|손익|손절|익절|pnl/i.test(label)) return "position_pnl";
  if (/고점|낙폭|drawdown|mdd/i.test(label)) return "drawdown";
  if (/저점|반등|rebound/i.test(label)) return "rebound";
  return "return";
}

function periodFrom(value: string | undefined, label: string): { interval: CandleInterval; lookbackPeriods: number } {
  const source = value ?? label;
  const match = source.match(/(\d+(?:\.\d+)?)\s*(분|시간|일|주|m|h|d)/i);
  if (!match) return { interval: "1h", lookbackPeriods: 4 };
  const amount = Math.max(1, Math.round(Number(match[1])));
  const unit = match[2].toLowerCase();
  if (unit === "분" || unit === "m") return amount % 15 === 0 ? { interval: "15m", lookbackPeriods: amount / 15 } : { interval: "1m", lookbackPeriods: amount };
  if (unit === "시간" || unit === "h") return amount % 4 === 0 ? { interval: "4h", lookbackPeriods: amount / 4 } : { interval: "1h", lookbackPeriods: amount };
  return { interval: "1d", lookbackPeriods: unit === "주" ? amount * 7 : amount };
}

function configuredReference(metric: PriceMetric, value?: string): typeof DEFAULT_REFERENCE[PriceMetric] {
  if (value && ["window_open", "previous_close", "moving_average", "position_entry", "rolling_peak", "rolling_low", "previous_candle_volume", "rolling_average_volume"].includes(value)) {
    return { kind: value as ReferenceKind, priceField: value.includes("volume") ? "volume" : value === "rolling_peak" ? "high" : value === "rolling_low" ? "low" : value === "window_open" ? "open" : "close" };
  }
  return DEFAULT_REFERENCE[metric];
}

export function migrateLegacyCondition(input: LegacyCondition, index = 0): PriceConditionV1 {
  const config = typeof input === "string" ? { label: input } : input;
  const label = config.label ?? "가격 변화 조건";
  const metric = metricFrom(label, config.metric);
  const parsedPct = label.match(/(-?\d+(?:\.\d+)?)\s*%/);
  let thresholdPct = config.threshold ?? config.percent ?? (parsedPct ? Number(parsedPct[1]) : 0);
  const below = /하향|하락|이하|손실|손절|below|lte/i.test(`${label} ${config.operator ?? ""}`);
  if (below && thresholdPct > 0 && metric === "position_pnl") thresholdPct *= -1;
  const cross = /돌파|교차|cross/i.test(`${label} ${config.trigger ?? ""}`);
  const period = periodFrom(config.timeframe, label);
  const reference = configuredReference(metric, config.reference);
  const confirmationBars = Math.max(1, Math.round(config.confirmationBars ?? 1));
  const cooldownBars = Math.max(1, Math.round(config.cooldownBars ?? 1));
  return {
    schemaVersion: 1,
    type: "price_condition",
    id: config.id ? slug(config.id) : `${slug(label)}-${index + 1}`,
    metric,
    reference: { ...reference, interval: period.interval, lookbackPeriods: Math.max(1, Math.round(config.lookback ?? period.lookbackPeriods)) },
    trigger: cross
      ? { kind: "cross", direction: below ? "below" : "above", thresholdPct }
      : { kind: "level", operator: below ? "lte" : "gte", thresholdPct },
    confirmation: { minimumHits: confirmationBars, windowBars: confirmationBars, closedBarsOnly: true },
    missingData: { mode: "fail_closed" },
    repeat: config.cooldownBars ? { mode: "cooldown", cooldownBars, resetOnOpposite: false } : { mode: "once_per_bar" },
  };
}

export function migrateLegacyStrategy(input: LegacyStrategyConfig): StrategyV1 {
  const conditions = input.conditions ?? input.blocks ?? [];
  return {
    schemaVersion: 1,
    id: slug(input.id ?? input.name ?? "migrated-strategy"),
    name: input.name?.trim() || "이전 전략",
    timeZone: input.timeZone ?? input.timezone ?? "Asia/Seoul",
    match: input.match === "any" || input.match === "or" ? "any" : "all",
    conditions: conditions.map(migrateLegacyCondition),
  };
}
