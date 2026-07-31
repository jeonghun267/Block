export const SHADOW_ENGINE_VERSION = "bt-shadow-1.0.0";

export const SUPPORTED_SHADOW_MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-SOL", "KRW-XRP"] as const;
export const SUPPORTED_CANDLE_INTERVALS = [1, 3, 5, 10, 15, 30, 60, 240] as const;

export type ShadowMarket = (typeof SUPPORTED_SHADOW_MARKETS)[number];
export type ShadowSignalMetric = "return" | "drawdown";
export type ShadowSignalOperator = "gte" | "lte";

export type MarketCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
};

export type ShadowStrategySpec = {
  schemaVersion: 1;
  market: ShadowMarket;
  intervalMinutes: number;
  entry: {
    metric: ShadowSignalMetric;
    lookbackBars: number;
    operator: ShadowSignalOperator;
    thresholdBps: number;
  };
  allocationBps: number;
  takeProfitBps: number;
  stopLossBps: number;
  feeBps: number;
  slippageBps: number;
  startingCashMinor: number;
};

export type ShadowBacktestTrade = {
  side: "buy" | "sell";
  timestamp: string;
  priceMinor: number;
  quantity: string;
  notionalMinor: number;
  feeMinor: number;
  reason: string;
  realizedPnlMinor: number;
};

export type ShadowBacktestResult = {
  engineVersion: string;
  startingCashMinor: number;
  endingEquityMinor: number;
  totalReturnBps: number;
  maxDrawdownBps: number;
  tradeCount: number;
  winRateBps: number;
  feesMinor: number;
  trades: ShadowBacktestTrade[];
};

export type ShadowSignalEvaluation = {
  triggered: boolean;
  side: "buy" | "sell" | null;
  reason: "entry" | "take_profit" | "stop_loss" | "no_signal" | "insufficient_history";
  metricBps: number | null;
  thresholdBps: number | null;
  candleAt: string | null;
  signalKey: string | null;
};

export type ShadowRiskPolicy = {
  maxGrossExposurePct: number;
  maxAssetConcentrationPct: number;
  maxDailyLossPct: number;
  maxOrderKrw: number;
};

export type ShadowRiskResult = {
  allowed: boolean;
  codes: string[];
  projectedGrossExposurePct: number;
  projectedAssetConcentrationPct: number;
};

export type ShadowConsoleSnapshot = {
  safety: {
    mode: "shadow";
    externalOrdersAllowed: false;
    marketDataSource: "upbit_public_quotation";
    execution: "internal_simulator";
  };
  strategy: {
    id: string;
    name: string;
    version: number;
    status: string;
    contentHash: string;
    market: ShadowMarket;
    intervalMinutes: number;
  };
  riskPolicy: {
    id: string;
    version: number;
    maxGrossExposurePct: number;
    maxAssetConcentrationPct: number;
    maxDailyLossPct: number;
    maxOrderKrw: number;
  };
  deployment: {
    id: string;
    status: string;
    startingCashMinor: number;
    cashMinor: number;
    realizedPnlMinor: number;
    lastMarketPriceMinor: number;
    lastCandleAt: string | null;
    lastCycleAt: string | null;
    updatedAt: string;
  };
  position: {
    asset: string;
    quantity: string;
    costBasisMinor: number;
    marketValueMinor: number;
    unrealizedPnlMinor: number;
    realizedPnlMinor: number;
  };
  marketData: null | {
    snapshotId: string;
    provider: string;
    market: string;
    intervalMinutes: number;
    candleCount: number;
    startedAt: string;
    endedAt: string;
    fetchedAt: string;
    payloadHash: string;
    latestCloseMinor: number;
    ageSeconds: number;
  };
  backtest: null | {
    id: string;
    engineVersion: string;
    status: string;
    startingCashMinor: number;
    endingEquityMinor: number;
    totalReturnBps: number;
    maxDrawdownBps: number;
    tradeCount: number;
    winRateBps: number;
    feesMinor: number;
    createdAt: string;
  };
  lastCycle: null | {
    id: string;
    status: string;
    signal: ShadowSignalEvaluation;
    evidenceHash: string;
    completedAt: string;
  };
  recentOrders: Array<{
    id: string;
    clientOrderId: string;
    side: "buy" | "sell";
    quantity: string;
    priceMinor: number;
    notionalMinor: number;
    feeMinor: number;
    status: string;
    filledAt: string | null;
  }>;
  reconciliation: null | {
    id: string;
    status: string;
    intentCount: number;
    orderCount: number;
    fillCount: number;
    exceptionCount: number;
    evidenceHash: string;
    createdAt: string;
  };
  serverTime: string;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return value;
}

function integerInRange(value: unknown, min: number, max: number, label: string) {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} 범위를 확인해주세요.`);
  return number;
}

function validateMarket(value: unknown): ShadowMarket {
  if (typeof value !== "string" || !SUPPORTED_SHADOW_MARKETS.includes(value as ShadowMarket)) {
    throw new Error("Shadow 운용은 현재 KRW-BTC·ETH·SOL·XRP 현물만 지원합니다.");
  }
  return value as ShadowMarket;
}

export function validateShadowStrategySpec(value: unknown): ShadowStrategySpec {
  const input = record(value);
  if (!input || input.schemaVersion !== 1) throw new Error("지원하지 않는 Shadow 전략 명세입니다.");
  const entry = record(input.entry);
  if (!entry) throw new Error("Shadow 진입 조건이 없습니다.");
  const metric = entry.metric;
  const operator = entry.operator;
  if (metric !== "return" && metric !== "drawdown") throw new Error("Shadow 조건은 수익률 또는 낙폭이어야 합니다.");
  if (operator !== "gte" && operator !== "lte") throw new Error("Shadow 비교 연산자가 올바르지 않습니다.");
  const intervalMinutes = integerInRange(input.intervalMinutes, 1, 240, "캔들 주기");
  if (!SUPPORTED_CANDLE_INTERVALS.includes(intervalMinutes as (typeof SUPPORTED_CANDLE_INTERVALS)[number])) {
    throw new Error("지원하지 않는 업비트 캔들 주기입니다.");
  }
  const thresholdBps = integerInRange(entry.thresholdBps, -5_000, 5_000, "진입 임계값");
  if (thresholdBps === 0) throw new Error("진입 임계값은 0일 수 없습니다.");
  return {
    schemaVersion: 1,
    market: validateMarket(input.market),
    intervalMinutes,
    entry: {
      metric,
      lookbackBars: integerInRange(entry.lookbackBars, 1, 120, "관찰 구간"),
      operator,
      thresholdBps,
    },
    allocationBps: integerInRange(input.allocationBps, 100, 5_000, "주문 비중"),
    takeProfitBps: integerInRange(input.takeProfitBps, 10, 5_000, "익절 기준"),
    stopLossBps: integerInRange(input.stopLossBps, 10, 5_000, "손절 기준"),
    feeBps: integerInRange(input.feeBps, 0, 100, "수수료"),
    slippageBps: integerInRange(input.slippageBps, 0, 300, "슬리피지"),
    startingCashMinor: integerInRange(input.startingCashMinor, 100_000, 10_000_000_000, "시작 현금"),
  };
}

const WINDOW_MAP: Record<string, { intervalMinutes: number; lookbackBars: number }> = {
  "5m": { intervalMinutes: 5, lookbackBars: 1 },
  "15m": { intervalMinutes: 15, lookbackBars: 1 },
  "1h": { intervalMinutes: 60, lookbackBars: 1 },
  "4h": { intervalMinutes: 240, lookbackBars: 1 },
  "24h": { intervalMinutes: 240, lookbackBars: 6 },
  "7d": { intervalMinutes: 240, lookbackBars: 42 },
};

export function normalizeShadowStrategyDefinition(definition: unknown): ShadowStrategySpec {
  const root = record(definition);
  if (!root) throw new Error("전략 정의를 읽을 수 없습니다.");
  if (root.shadowSpec) return validateShadowStrategySpec(root.shadowSpec);
  const blocks = Array.isArray(root.blocks) ? root.blocks : [];
  const conditionBlock = blocks.map(record).find((block) => record(block?.config)?.type === "price_change");
  const actionBlock = blocks.map(record).find((block) => record(block?.config)?.type === "ratio_trade");
  const condition = record(conditionBlock?.config);
  const action = record(actionBlock?.config);
  if (!condition || !action) throw new Error("실행 가능한 가격 조건과 주문 비중 블록이 필요합니다.");
  if (condition.metric !== "return" && condition.metric !== "drawdown") {
    throw new Error("Shadow 1단계는 수익률·낙폭 조건만 실행합니다.");
  }
  if (action.side !== "buy") throw new Error("Shadow 1단계는 현물 매수 진입 전략만 지원합니다.");
  const asset = typeof condition.asset === "string" ? condition.asset : "";
  const window = typeof condition.window === "string" ? WINDOW_MAP[condition.window] : null;
  if (!window) throw new Error("지원하지 않는 관찰 기간입니다.");
  const thresholdPct = finiteNumber(condition.threshold, "가격 변화율");
  const down = condition.direction === "down";
  return validateShadowStrategySpec({
    schemaVersion: 1,
    market: `KRW-${asset}`,
    intervalMinutes: window.intervalMinutes,
    entry: {
      metric: condition.metric,
      lookbackBars: window.lookbackBars,
      operator: down ? "lte" : "gte",
      thresholdBps: Math.round(Math.abs(thresholdPct) * 100) * (down ? -1 : 1),
    },
    allocationBps: Math.round(finiteNumber(action.ratio, "거래 실행 비율") * 100),
    takeProfitBps: 300,
    stopLossBps: 200,
    feeBps: 5,
    slippageBps: 10,
    startingCashMinor: 100_000_000,
  });
}

function conditionMetric(candles: readonly MarketCandle[], index: number, spec: ShadowStrategySpec) {
  if (index < spec.entry.lookbackBars) return null;
  const current = candles[index];
  if (spec.entry.metric === "return") {
    const reference = candles[index - spec.entry.lookbackBars].close;
    return Math.round(((current.close / reference) - 1) * 10_000);
  }
  const start = Math.max(0, index - spec.entry.lookbackBars);
  const rollingHigh = Math.max(...candles.slice(start, index + 1).map((candle) => candle.high));
  return Math.round(((current.close / rollingHigh) - 1) * 10_000);
}

function conditionMatches(metricBps: number | null, spec: ShadowStrategySpec) {
  if (metricBps === null) return false;
  return spec.entry.operator === "gte" ? metricBps >= spec.entry.thresholdBps : metricBps <= spec.entry.thresholdBps;
}

function roundQuantity(value: number) {
  return Number(value.toFixed(12));
}

export function evaluateLatestShadowSignal(input: {
  candles: readonly MarketCandle[];
  spec: ShadowStrategySpec;
  positionQuantity: number;
  positionCostMinor: number;
}): ShadowSignalEvaluation {
  const { candles, spec } = input;
  if (candles.length <= spec.entry.lookbackBars) {
    return { triggered: false, side: null, reason: "insufficient_history", metricBps: null, thresholdBps: spec.entry.thresholdBps, candleAt: candles.at(-1)?.timestamp ?? null, signalKey: null };
  }
  const index = candles.length - 1;
  const current = candles[index];
  if (input.positionQuantity > 0 && input.positionCostMinor > 0) {
    const marketValue = input.positionQuantity * current.close;
    const positionReturnBps = Math.round(((marketValue / input.positionCostMinor) - 1) * 10_000);
    const reason = positionReturnBps >= spec.takeProfitBps ? "take_profit" : positionReturnBps <= -spec.stopLossBps ? "stop_loss" : "no_signal";
    const triggered = reason !== "no_signal";
    return {
      triggered,
      side: triggered ? "sell" : null,
      reason,
      metricBps: positionReturnBps,
      thresholdBps: reason === "stop_loss" ? -spec.stopLossBps : spec.takeProfitBps,
      candleAt: current.timestamp,
      signalKey: triggered ? `${spec.market}:${current.timestamp}:sell:${reason}` : null,
    };
  }
  const metricBps = conditionMetric(candles, index, spec);
  const previousMetricBps = conditionMetric(candles, index - 1, spec);
  const matched = conditionMatches(metricBps, spec);
  const crossed = matched && !conditionMatches(previousMetricBps, spec);
  return {
    triggered: crossed,
    side: crossed ? "buy" : null,
    reason: crossed ? "entry" : "no_signal",
    metricBps,
    thresholdBps: spec.entry.thresholdBps,
    candleAt: current.timestamp,
    signalKey: crossed ? `${spec.market}:${current.timestamp}:buy:entry` : null,
  };
}

export function runShadowBacktest(candles: readonly MarketCandle[], spec: ShadowStrategySpec): ShadowBacktestResult {
  if (candles.length <= spec.entry.lookbackBars + 1) throw new Error("백테스트에 필요한 캔들이 부족합니다.");
  let cash = spec.startingCashMinor;
  let quantity = 0;
  let costBasis = 0;
  let peakEquity = cash;
  let maxDrawdownBps = 0;
  let fees = 0;
  let wins = 0;
  let exits = 0;
  const trades: ShadowBacktestTrade[] = [];

  for (let index = spec.entry.lookbackBars; index < candles.length; index += 1) {
    const current = candles[index];
    if (quantity <= 0) {
      const metric = conditionMetric(candles, index, spec);
      const previousMetric = conditionMetric(candles, index - 1, spec);
      if (conditionMatches(metric, spec) && !conditionMatches(previousMetric, spec)) {
        const grossSpend = Math.floor(cash * spec.allocationBps / 10_000);
        const fee = Math.floor(grossSpend * spec.feeBps / 10_000);
        const purchaseValue = Math.max(0, grossSpend - fee);
        const fillPrice = Math.max(1, Math.round(current.close * (1 + spec.slippageBps / 10_000)));
        const bought = roundQuantity(purchaseValue / fillPrice);
        if (bought > 0 && grossSpend > 0) {
          cash -= grossSpend;
          quantity = bought;
          costBasis = grossSpend;
          fees += fee;
          trades.push({ side: "buy", timestamp: current.timestamp, priceMinor: fillPrice, quantity: bought.toFixed(12), notionalMinor: purchaseValue, feeMinor: fee, reason: "entry", realizedPnlMinor: 0 });
        }
      }
    } else {
      const markValue = quantity * current.close;
      const positionReturnBps = Math.round(((markValue / costBasis) - 1) * 10_000);
      const reason = positionReturnBps >= spec.takeProfitBps ? "take_profit" : positionReturnBps <= -spec.stopLossBps ? "stop_loss" : null;
      if (reason) {
        const fillPrice = Math.max(1, Math.round(current.close * (1 - spec.slippageBps / 10_000)));
        const grossProceeds = Math.floor(quantity * fillPrice);
        const fee = Math.floor(grossProceeds * spec.feeBps / 10_000);
        const netProceeds = grossProceeds - fee;
        const realizedPnl = netProceeds - costBasis;
        cash += netProceeds;
        fees += fee;
        exits += 1;
        if (realizedPnl > 0) wins += 1;
        trades.push({ side: "sell", timestamp: current.timestamp, priceMinor: fillPrice, quantity: quantity.toFixed(12), notionalMinor: grossProceeds, feeMinor: fee, reason, realizedPnlMinor: realizedPnl });
        quantity = 0;
        costBasis = 0;
      }
    }
    const equity = cash + quantity * current.close;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownBps = Math.min(maxDrawdownBps, Math.round(((equity / peakEquity) - 1) * 10_000));
  }

  const endingEquityMinor = Math.round(cash + quantity * candles.at(-1)!.close);
  return {
    engineVersion: SHADOW_ENGINE_VERSION,
    startingCashMinor: spec.startingCashMinor,
    endingEquityMinor,
    totalReturnBps: Math.round(((endingEquityMinor / spec.startingCashMinor) - 1) * 10_000),
    maxDrawdownBps,
    tradeCount: trades.length,
    winRateBps: exits ? Math.round(wins / exits * 10_000) : 0,
    feesMinor: fees,
    trades,
  };
}

export function evaluateShadowRisk(input: {
  strategyStatus: string;
  policy: ShadowRiskPolicy;
  startingCashMinor: number;
  cashMinor: number;
  currentPositionValueMinor: number;
  currentDailyLossBps: number;
  side: "buy" | "sell";
  orderNotionalMinor: number;
  dataAgeSeconds: number;
  maxDataAgeSeconds: number;
}): ShadowRiskResult {
  const blockers: string[] = [];
  if (!["approved", "paper", "shadow"].includes(input.strategyStatus)) blockers.push("strategy_not_approved");
  if (input.orderNotionalMinor <= 0) blockers.push("invalid_notional");
  if (input.dataAgeSeconds < 0 || input.dataAgeSeconds > input.maxDataAgeSeconds) blockers.push("market_data_stale");
  if (input.currentDailyLossBps >= Math.round(input.policy.maxDailyLossPct * 100)) blockers.push("daily_loss_limit");
  if (input.orderNotionalMinor > input.policy.maxOrderKrw) blockers.push("max_order_value");
  if (input.side === "buy" && input.orderNotionalMinor > input.cashMinor) blockers.push("insufficient_cash");
  if (input.side === "sell" && input.orderNotionalMinor > input.currentPositionValueMinor + 1) blockers.push("insufficient_position");
  const projectedValue = input.side === "buy"
    ? input.currentPositionValueMinor + input.orderNotionalMinor
    : Math.max(0, input.currentPositionValueMinor - input.orderNotionalMinor);
  const projectedGrossExposurePct = input.startingCashMinor > 0 ? projectedValue / input.startingCashMinor * 100 : 100;
  const projectedAssetConcentrationPct = projectedGrossExposurePct;
  if (projectedGrossExposurePct > input.policy.maxGrossExposurePct) blockers.push("gross_exposure_limit");
  if (projectedAssetConcentrationPct > input.policy.maxAssetConcentrationPct) blockers.push("asset_concentration_limit");
  return { allowed: blockers.length === 0, codes: blockers, projectedGrossExposurePct, projectedAssetConcentrationPct };
}

export function applyShadowFill(input: {
  side: "buy" | "sell";
  cashMinor: number;
  positionQuantity: number;
  positionCostMinor: number;
  referencePriceMinor: number;
  orderNotionalMinor: number;
  feeBps: number;
  slippageBps: number;
}) {
  const fillPriceMinor = Math.max(1, Math.round(input.referencePriceMinor * (1 + (input.side === "buy" ? 1 : -1) * input.slippageBps / 10_000)));
  if (input.side === "buy") {
    const feeMinor = Math.floor(input.orderNotionalMinor * input.feeBps / 10_000);
    const purchaseValue = Math.max(0, input.orderNotionalMinor - feeMinor);
    const quantity = roundQuantity(purchaseValue / fillPriceMinor);
    return {
      fillPriceMinor,
      feeMinor,
      fillNotionalMinor: purchaseValue,
      fillQuantity: quantity,
      cashMinor: input.cashMinor - input.orderNotionalMinor,
      positionQuantity: roundQuantity(input.positionQuantity + quantity),
      positionCostMinor: input.positionCostMinor + input.orderNotionalMinor,
      realizedPnlMinor: 0,
    };
  }
  const sellQuantity = Math.min(input.positionQuantity, roundQuantity(input.orderNotionalMinor / fillPriceMinor));
  const grossProceeds = Math.floor(sellQuantity * fillPriceMinor);
  const feeMinor = Math.floor(grossProceeds * input.feeBps / 10_000);
  const costReleased = input.positionQuantity > 0 ? Math.round(input.positionCostMinor * (sellQuantity / input.positionQuantity)) : 0;
  const realizedPnlMinor = grossProceeds - feeMinor - costReleased;
  return {
    fillPriceMinor,
    feeMinor,
    fillNotionalMinor: grossProceeds,
    fillQuantity: sellQuantity,
    cashMinor: input.cashMinor + grossProceeds - feeMinor,
    positionQuantity: roundQuantity(Math.max(0, input.positionQuantity - sellQuantity)),
    positionCostMinor: Math.max(0, input.positionCostMinor - costReleased),
    realizedPnlMinor,
  };
}
