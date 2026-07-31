import {
  CANDLE_INTERVALS,
  PRICE_METRICS,
  REFERENCE_KINDS,
  type BacktestConfigV1,
  type PriceConditionV1,
  type PriceMetric,
  type ReferenceKind,
  type StrategyV1,
} from "./schema";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; value: T; issues: [] }
  | { success: false; issues: ValidationIssue[] };

const REFERENCE_COMPATIBILITY: Record<PriceMetric, readonly ReferenceKind[]> = {
  return: ["window_open", "previous_close"],
  drawdown: ["rolling_peak"],
  rebound: ["rolling_low"],
  ma_deviation: ["moving_average"],
  volume_change: ["previous_candle_volume", "rolling_average_volume"],
  position_pnl: ["position_entry"],
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integerIn(value: unknown, min: number, max: number): value is number {
  return finite(value) && Number.isInteger(value) && value >= min && value <= max;
}

function stringIn<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function issue(issues: ValidationIssue[], path: string, code: string, message: string) {
  issues.push({ path, code, message });
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function validateCondition(value: unknown, path: string, issues: ValidationIssue[]): value is PriceConditionV1 {
  if (!record(value)) {
    issue(issues, path, "type", "조건은 객체여야 합니다.");
    return false;
  }
  if (value.schemaVersion !== 1) issue(issues, `${path}.schemaVersion`, "schema_version", "지원하는 조건 스키마 버전은 1입니다.");
  if (value.type !== "price_condition") issue(issues, `${path}.type`, "literal", "price_condition만 지원합니다.");
  if (typeof value.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id)) issue(issues, `${path}.id`, "id", "조건 ID 형식이 올바르지 않습니다.");
  if (!stringIn(value.metric, PRICE_METRICS)) issue(issues, `${path}.metric`, "metric", "지원하지 않는 퍼센트 지표입니다.");

  if (!record(value.reference)) {
    issue(issues, `${path}.reference`, "type", "비교 기준이 필요합니다.");
  } else {
    if (!stringIn(value.reference.kind, REFERENCE_KINDS)) issue(issues, `${path}.reference.kind`, "reference", "지원하지 않는 비교 기준입니다.");
    if (!stringIn(value.reference.interval, CANDLE_INTERVALS)) issue(issues, `${path}.reference.interval`, "interval", "지원하지 않는 캔들 간격입니다.");
    if (!integerIn(value.reference.lookbackPeriods, 1, 100_000)) issue(issues, `${path}.reference.lookbackPeriods`, "range", "조회 기간은 1~100000개 캔들이어야 합니다.");
    if (!stringIn(value.reference.priceField, ["open", "high", "low", "close", "volume"] as const)) issue(issues, `${path}.reference.priceField`, "price_field", "지원하지 않는 가격 필드입니다.");
    if (stringIn(value.metric, PRICE_METRICS) && stringIn(value.reference.kind, REFERENCE_KINDS) && !REFERENCE_COMPATIBILITY[value.metric].includes(value.reference.kind)) {
      issue(issues, `${path}.reference.kind`, "incompatible_reference", `${value.metric} 지표와 ${value.reference.kind} 기준은 함께 사용할 수 없습니다.`);
    }
  }

  if (!record(value.trigger) || !stringIn(value.trigger.kind, ["level", "cross"] as const)) {
    issue(issues, `${path}.trigger`, "trigger", "level 또는 cross 트리거가 필요합니다.");
  } else if (value.trigger.kind === "level") {
    if (!stringIn(value.trigger.operator, ["gte", "lte"] as const)) issue(issues, `${path}.trigger.operator`, "operator", "level 연산자는 gte 또는 lte여야 합니다.");
    if (!finite(value.trigger.thresholdPct) || Math.abs(value.trigger.thresholdPct) > 10_000) issue(issues, `${path}.trigger.thresholdPct`, "range", "기준 퍼센트는 -10000~10000 범위여야 합니다.");
  } else {
    if (!stringIn(value.trigger.direction, ["above", "below"] as const)) issue(issues, `${path}.trigger.direction`, "direction", "cross 방향은 above 또는 below여야 합니다.");
    if (!finite(value.trigger.thresholdPct) || Math.abs(value.trigger.thresholdPct) > 10_000) issue(issues, `${path}.trigger.thresholdPct`, "range", "기준 퍼센트는 -10000~10000 범위여야 합니다.");
  }

  if (!record(value.confirmation)) {
    issue(issues, `${path}.confirmation`, "type", "확정 규칙이 필요합니다.");
  } else {
    if (!integerIn(value.confirmation.minimumHits, 1, 10_000)) issue(issues, `${path}.confirmation.minimumHits`, "range", "최소 충족 횟수는 1 이상이어야 합니다.");
    if (!integerIn(value.confirmation.windowBars, 1, 10_000)) issue(issues, `${path}.confirmation.windowBars`, "range", "확정 구간은 1 이상이어야 합니다.");
    if (finite(value.confirmation.minimumHits) && finite(value.confirmation.windowBars) && value.confirmation.minimumHits > value.confirmation.windowBars) issue(issues, `${path}.confirmation.minimumHits`, "confirmation_impossible", "최소 충족 횟수는 확정 구간보다 클 수 없습니다.");
    if (typeof value.confirmation.closedBarsOnly !== "boolean") issue(issues, `${path}.confirmation.closedBarsOnly`, "type", "종가 확정 여부가 필요합니다.");
  }

  if (!record(value.missingData) || !stringIn(value.missingData.mode, ["skip", "fail_closed", "carry_forward"] as const)) {
    issue(issues, `${path}.missingData`, "missing_data", "결측 데이터 처리 규칙이 필요합니다.");
  } else if (value.missingData.mode === "carry_forward" && !integerIn(value.missingData.maxCarryBars, 1, 1_000)) {
    issue(issues, `${path}.missingData.maxCarryBars`, "range", "전방 채움 한도는 1 이상이어야 합니다.");
  }

  if (!record(value.repeat) || !stringIn(value.repeat.mode, ["once", "once_per_bar", "cooldown"] as const)) {
    issue(issues, `${path}.repeat`, "repeat", "반복 실행 규칙이 필요합니다.");
  } else if (value.repeat.mode === "cooldown") {
    if (!integerIn(value.repeat.cooldownBars, 1, 100_000)) issue(issues, `${path}.repeat.cooldownBars`, "range", "재실행 대기 캔들은 1 이상이어야 합니다.");
    if (typeof value.repeat.resetOnOpposite !== "boolean") issue(issues, `${path}.repeat.resetOnOpposite`, "type", "반대 신호 초기화 여부가 필요합니다.");
  }
  return issues.length === 0;
}

export function validatePriceConditionV1(input: unknown): ValidationResult<PriceConditionV1> {
  const issues: ValidationIssue[] = [];
  validateCondition(input, "$", issues);
  return issues.length ? { success: false, issues } : { success: true, value: input as PriceConditionV1, issues: [] };
}

export function validateStrategyV1(input: unknown): ValidationResult<StrategyV1> {
  const issues: ValidationIssue[] = [];
  if (!record(input)) return { success: false, issues: [{ path: "$", code: "type", message: "전략은 객체여야 합니다." }] };
  if (input.schemaVersion !== 1) issue(issues, "$.schemaVersion", "schema_version", "지원하는 전략 스키마 버전은 1입니다.");
  if (typeof input.id !== "string" || input.id.length === 0) issue(issues, "$.id", "required", "전략 ID가 필요합니다.");
  if (typeof input.name !== "string" || input.name.trim().length === 0) issue(issues, "$.name", "required", "전략 이름이 필요합니다.");
  if (!validTimeZone(input.timeZone)) issue(issues, "$.timeZone", "timezone", "유효한 IANA 시간대가 필요합니다.");
  if (!stringIn(input.match, ["all", "any"] as const)) issue(issues, "$.match", "match", "조건 결합 방식은 all 또는 any여야 합니다.");
  if (!Array.isArray(input.conditions) || input.conditions.length === 0) issue(issues, "$.conditions", "required", "퍼센트 조건이 하나 이상 필요합니다.");
  else input.conditions.forEach((condition, index) => validateCondition(condition, `$.conditions[${index}]`, issues));
  return issues.length ? { success: false, issues } : { success: true, value: input as unknown as StrategyV1, issues: [] };
}

export function validateBacktestConfigV1(input: unknown): ValidationResult<BacktestConfigV1> {
  const issues: ValidationIssue[] = [];
  if (!record(input)) return { success: false, issues: [{ path: "$", code: "type", message: "백테스트 설정은 객체여야 합니다." }] };
  if (input.schemaVersion !== 1) issue(issues, "$.schemaVersion", "schema_version", "지원하는 백테스트 스키마 버전은 1입니다.");
  if (!record(input.period)) issue(issues, "$.period", "required", "백테스트 기간이 필요합니다.");
  else {
    const from = typeof input.period.from === "string" ? Date.parse(input.period.from) : NaN;
    const to = typeof input.period.to === "string" ? Date.parse(input.period.to) : NaN;
    if (!Number.isFinite(from)) issue(issues, "$.period.from", "datetime", "유효한 ISO 시작 시각이 필요합니다.");
    if (!Number.isFinite(to)) issue(issues, "$.period.to", "datetime", "유효한 ISO 종료 시각이 필요합니다.");
    if (Number.isFinite(from) && Number.isFinite(to) && from >= to) issue(issues, "$.period", "period_order", "종료 시각은 시작 시각보다 뒤여야 합니다.");
    if (!validTimeZone(input.period.timeZone)) issue(issues, "$.period.timeZone", "timezone", "유효한 IANA 시간대가 필요합니다.");
  }
  if (!record(input.marketData)) issue(issues, "$.marketData", "required", "시장 데이터 규칙이 필요합니다.");
  else {
    if (!stringIn(input.marketData.interval, CANDLE_INTERVALS)) issue(issues, "$.marketData.interval", "interval", "지원하지 않는 캔들 간격입니다.");
    if (!stringIn(input.marketData.missingCandles, ["reject", "skip", "forward_fill"] as const)) issue(issues, "$.marketData.missingCandles", "missing_candles", "결측 캔들 규칙이 필요합니다.");
    if (!integerIn(input.marketData.maxForwardFillBars, 0, 1_000)) issue(issues, "$.marketData.maxForwardFillBars", "range", "전방 채움 한도는 0 이상이어야 합니다.");
    if (input.marketData.missingCandles === "forward_fill" && input.marketData.maxForwardFillBars === 0) issue(issues, "$.marketData.maxForwardFillBars", "forward_fill_disabled", "전방 채움을 선택하면 한도가 1 이상이어야 합니다.");
  }
  if (!record(input.costs)) issue(issues, "$.costs", "required", "수수료와 슬리피지 설정이 필요합니다.");
  else {
    for (const key of ["makerFeeBps", "takerFeeBps"] as const) if (!finite(input.costs[key]) || input.costs[key] < 0 || input.costs[key] > 1_000) issue(issues, `$.costs.${key}`, "range", "수수료는 0~1000 bps 범위여야 합니다.");
    if (!record(input.costs.slippage) || !stringIn(input.costs.slippage.model, ["fixed_bps", "volume_impact"] as const)) issue(issues, "$.costs.slippage", "slippage", "슬리피지 모델이 필요합니다.");
    else if (input.costs.slippage.model === "fixed_bps") {
      if (!finite(input.costs.slippage.bps) || input.costs.slippage.bps < 0 || input.costs.slippage.bps > 10_000) issue(issues, "$.costs.slippage.bps", "range", "고정 슬리피지는 0~10000 bps 범위여야 합니다.");
    } else {
      for (const key of ["baseBps", "impactBpsPerPctVolume", "maxBps"] as const) if (!finite(input.costs.slippage[key]) || input.costs.slippage[key] < 0) issue(issues, `$.costs.slippage.${key}`, "range", "거래량 영향 슬리피지는 0 이상이어야 합니다.");
      if (finite(input.costs.slippage.baseBps) && finite(input.costs.slippage.maxBps) && input.costs.slippage.baseBps > input.costs.slippage.maxBps) issue(issues, "$.costs.slippage.maxBps", "range", "최대 슬리피지는 기본 슬리피지보다 작을 수 없습니다.");
    }
  }
  if (!record(input.split)) issue(issues, "$.split", "required", "표본내·표본외 분리 설정이 필요합니다.");
  else {
    if (input.split.method !== "chronological") issue(issues, "$.split.method", "split", "시계열 백테스트는 시간순 분리만 지원합니다.");
    if (!finite(input.split.inSampleRatio) || input.split.inSampleRatio < 0.5 || input.split.inSampleRatio > 0.95) issue(issues, "$.split.inSampleRatio", "range", "표본내 비율은 0.5~0.95 범위여야 합니다.");
    if (!integerIn(input.split.minimumOutOfSampleBars, 30, 10_000_000)) issue(issues, "$.split.minimumOutOfSampleBars", "range", "표본외 구간은 최소 30개 캔들이어야 합니다.");
  }
  if (!record(input.execution)) issue(issues, "$.execution", "required", "체결 시뮬레이션 설정이 필요합니다.");
  else {
    if (!finite(input.execution.initialCapital) || input.execution.initialCapital <= 0) issue(issues, "$.execution.initialCapital", "range", "초기 자본은 0보다 커야 합니다.");
    if (typeof input.execution.quoteCurrency !== "string" || !/^[A-Z]{3,10}$/.test(input.execution.quoteCurrency)) issue(issues, "$.execution.quoteCurrency", "currency", "기준 통화 코드는 대문자 3~10자여야 합니다.");
    if (!stringIn(input.execution.orderType, ["market", "limit"] as const)) issue(issues, "$.execution.orderType", "order_type", "주문 유형이 필요합니다.");
    if (!stringIn(input.execution.fillPolicy, ["next_open", "next_close", "limit_touch"] as const)) issue(issues, "$.execution.fillPolicy", "fill_policy", "체결 가격 규칙이 필요합니다.");
    if (input.execution.orderType === "market" && input.execution.fillPolicy === "limit_touch") issue(issues, "$.execution.fillPolicy", "incompatible_fill", "시장가 주문은 limit_touch를 사용할 수 없습니다.");
    if (!integerIn(input.execution.warmupBars, 0, 1_000_000)) issue(issues, "$.execution.warmupBars", "range", "워밍업 캔들 수는 0 이상이어야 합니다.");
  }
  return issues.length ? { success: false, issues } : { success: true, value: input as unknown as BacktestConfigV1, issues: [] };
}
