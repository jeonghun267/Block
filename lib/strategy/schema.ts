export const STRATEGY_SCHEMA_VERSION = 1 as const;

export const PRICE_METRICS = [
  "return",
  "drawdown",
  "rebound",
  "ma_deviation",
  "volume_change",
  "position_pnl",
] as const;

export type PriceMetric = (typeof PRICE_METRICS)[number];

export const CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export const REFERENCE_KINDS = [
  "window_open",
  "previous_close",
  "moving_average",
  "position_entry",
  "rolling_peak",
  "rolling_low",
  "previous_candle_volume",
  "rolling_average_volume",
] as const;

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export interface PriceReferenceV1 {
  kind: ReferenceKind;
  interval: CandleInterval;
  lookbackPeriods: number;
  priceField: "open" | "high" | "low" | "close" | "volume";
}

export type PercentTriggerV1 =
  | { kind: "level"; operator: "gte" | "lte"; thresholdPct: number }
  | { kind: "cross"; direction: "above" | "below"; thresholdPct: number };

export interface ConfirmationV1 {
  /** Number of matching observations required inside the window. */
  minimumHits: number;
  /** Rolling window size, including the current bar. */
  windowBars: number;
  /** Prevent an in-progress candle from confirming a live signal. */
  closedBarsOnly: boolean;
}

export type MissingDataPolicyV1 =
  | { mode: "skip" }
  | { mode: "fail_closed" }
  | { mode: "carry_forward"; maxCarryBars: number };

export type RepeatPolicyV1 =
  | { mode: "once" }
  | { mode: "once_per_bar" }
  | { mode: "cooldown"; cooldownBars: number; resetOnOpposite: boolean };

export interface PriceConditionV1 {
  schemaVersion: typeof STRATEGY_SCHEMA_VERSION;
  type: "price_condition";
  id: string;
  metric: PriceMetric;
  reference: PriceReferenceV1;
  trigger: PercentTriggerV1;
  confirmation: ConfirmationV1;
  missingData: MissingDataPolicyV1;
  repeat: RepeatPolicyV1;
}

export interface StrategyV1 {
  schemaVersion: typeof STRATEGY_SCHEMA_VERSION;
  id: string;
  name: string;
  timeZone: string;
  match: "all" | "any";
  conditions: PriceConditionV1[];
}

export interface BacktestConfigV1 {
  schemaVersion: typeof STRATEGY_SCHEMA_VERSION;
  period: {
    from: string;
    to: string;
    timeZone: string;
  };
  marketData: {
    interval: CandleInterval;
    missingCandles: "reject" | "skip" | "forward_fill";
    maxForwardFillBars: number;
  };
  costs: {
    makerFeeBps: number;
    takerFeeBps: number;
    slippage:
      | { model: "fixed_bps"; bps: number }
      | { model: "volume_impact"; baseBps: number; impactBpsPerPctVolume: number; maxBps: number };
  };
  split: {
    method: "chronological";
    inSampleRatio: number;
    minimumOutOfSampleBars: number;
  };
  execution: {
    initialCapital: number;
    quoteCurrency: string;
    orderType: "market" | "limit";
    fillPolicy: "next_open" | "next_close" | "limit_touch";
    warmupBars: number;
  };
}

export interface PercentSampleV1 {
  barIndex: number;
  observed: number | null;
  reference: number | null;
  closed: boolean;
}

export interface EvaluationStateV1 {
  hasTriggered: boolean;
  lastTriggeredBar: number | null;
}

export interface ConditionEvaluationV1 {
  matched: boolean;
  triggered: boolean;
  metricPct: number | null;
  hits: number;
  reason:
    | "triggered"
    | "condition_not_met"
    | "confirmation_pending"
    | "missing_data"
    | "open_candle"
    | "repeat_blocked";
}
