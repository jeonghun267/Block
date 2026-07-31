export const STRATEGY_COPILOT_SCHEMA_VERSION = 1 as const;

export type CopilotBlockKind = "condition" | "action" | "notice" | "risk";
export type CopilotAsset = "BTC" | "ETH" | "SOL" | "XRP";
export type CopilotWindow = "5m" | "15m" | "1h" | "4h" | "24h" | "7d";

export type CopilotPriceConfig = {
  type: "price_change";
  metric: "return" | "drawdown" | "rebound" | "ma_deviation" | "volume_change" | "position_pnl";
  asset: CopilotAsset;
  direction: "up" | "down";
  threshold: number;
  window: CopilotWindow;
  reference: "window_open" | "previous_close" | "average_buy" | "rolling_high" | "rolling_low" | "vwap";
  priceSource: "last_trade" | "candle_close" | "candle_high" | "candle_low";
  trigger: "cross" | "level";
  confirmation: "realtime" | "candle_close" | "two_closes";
  missingData: "skip" | "carry_forward";
  repeat: "once" | "once_per_candle" | "cooldown_30m" | "cooldown_4h";
};

export type CopilotRatioConfig = {
  type: "ratio_trade";
  side: "buy" | "sell";
  ratio: number;
  basis: "available_cash" | "holding_asset";
};

export type CopilotBlockDraft = {
  id: string;
  kind: CopilotBlockKind;
  label: string;
  config?: CopilotPriceConfig | CopilotRatioConfig;
};

export type CopilotFinding = {
  severity: "info" | "warning" | "blocker";
  code: string;
  message: string;
};

export type StrategyCopilotDraft = {
  schemaVersion: typeof STRATEGY_COPILOT_SCHEMA_VERSION;
  title: string;
  summary: string;
  blocks: CopilotBlockDraft[];
  assumptions: string[];
  questions: string[];
  findings: CopilotFinding[];
  confidence: "low" | "medium" | "high";
};

export type StrategyCopilotResponse = {
  draft: StrategyCopilotDraft;
  generationMode: "rules" | "openai";
  providerReady: boolean;
  auditRecorded: boolean;
  model: string | null;
  requestId: string;
  notice: string;
};

const ASSET_NAMES: Array<[RegExp, CopilotAsset]> = [
  [/(?:비트코인|\bBTC\b)/iu, "BTC"],
  [/(?:이더리움|\bETH\b)/iu, "ETH"],
  [/(?:솔라나|\bSOL\b)/iu, "SOL"],
  [/(?:리플|\bXRP\b)/iu, "XRP"],
];

const ALLOWED_KINDS = new Set<CopilotBlockKind>(["condition", "action", "notice", "risk"]);
const ALLOWED_ASSETS = new Set<CopilotAsset>(["BTC", "ETH", "SOL", "XRP"]);
const ALLOWED_WINDOWS = new Set<CopilotWindow>(["5m", "15m", "1h", "4h", "24h", "7d"]);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function findAsset(text: string): CopilotAsset {
  return ASSET_NAMES.find(([pattern]) => pattern.test(text))?.[1] ?? "BTC";
}

function findWindow(text: string): { value: CopilotWindow; assumed: boolean } {
  const match = text.match(/(5|15|30)\s*분|(1|2|4|6|12|24)\s*시간|(1|7)\s*일/iu);
  if (!match) return { value: "4h", assumed: true };
  if (match[1]) return { value: Number(match[1]) <= 5 ? "5m" : "15m", assumed: Number(match[1]) === 30 };
  if (match[2]) {
    const hours = Number(match[2]);
    if (hours <= 1) return { value: "1h", assumed: false };
    if (hours <= 6) return { value: "4h", assumed: hours !== 4 };
    return { value: "24h", assumed: hours !== 24 };
  }
  return Number(match[3]) >= 7 ? { value: "7d", assumed: false } : { value: "24h", assumed: false };
}

function percentCandidates(text: string) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/gu)].map((match) => ({ value: Number(match[1]), index: match.index ?? 0 }));
}

function nearestPercent(text: string, terms: string[], fallback: number) {
  const candidates = percentCandidates(text);
  if (candidates.length === 0) return { value: fallback, assumed: true };
  const termIndex = terms.map((term) => text.indexOf(term)).find((index) => index >= 0) ?? 0;
  const nearest = [...candidates].sort((left, right) => Math.abs(left.index - termIndex) - Math.abs(right.index - termIndex))[0];
  return { value: nearest.value, assumed: false };
}

function conditionLabel(config: CopilotPriceConfig) {
  const window = { "5m": "최근 5분", "15m": "최근 15분", "1h": "최근 1시간", "4h": "최근 4시간", "24h": "최근 24시간", "7d": "최근 7일" }[config.window];
  if (config.metric === "drawdown") return `${config.asset} ${window} 고점 대비 낙폭이 ${config.threshold}%를 넘으면`;
  if (config.metric === "rebound") return `${config.asset} ${window} 저점 대비 ${config.threshold}% 이상 반등하면`;
  if (config.metric === "volume_change") return `${config.asset} ${window} 평균 대비 거래량이 ${config.threshold}% 증가하면`;
  if (config.metric === "position_pnl") return `${config.asset} 평균 매수가 대비 손익률이 ${config.direction === "down" ? "-" : "+"}${config.threshold}%에 도달하면`;
  return `${config.asset}가 ${window} 시가 대비 ${config.threshold}% ${config.direction === "up" ? "상향" : "하향"} 돌파하면`;
}

function titleFor(config: CopilotPriceConfig, action: CopilotRatioConfig) {
  const condition = config.metric === "drawdown" ? "낙폭" : config.metric === "rebound" ? "반등" : config.metric === "volume_change" ? "거래량" : "가격 변동";
  return `${config.asset} ${condition} ${action.side === "buy" ? "매수" : "매도"} 전략`;
}

export function normalizeCopilotInput(value: unknown) {
  if (typeof value !== "string") throw new Error("전략 설명을 입력해주세요.");
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length < 8) throw new Error("조건과 실행 내용을 8자 이상 입력해주세요.");
  if (normalized.length > 2_000) throw new Error("전략 설명은 2,000자 이하로 입력해주세요.");
  return normalized;
}

export function generateRuleBasedStrategyDraft(rawInput: unknown): StrategyCopilotDraft {
  const input = normalizeCopilotInput(rawInput);
  const asset = findAsset(input);
  const window = findWindow(input);
  const isDrawdown = /(?:고점|최고가).{0,18}(?:하락|낙폭|빠지|내리)|(?:하락|낙폭).{0,18}(?:고점|최고가)/u.test(input);
  const isRebound = /(?:저점|최저가).{0,18}(?:반등|상승|오르)|(?:반등).{0,18}(?:저점|최저가)/u.test(input);
  const isVolume = /거래량/u.test(input);
  const isPositionPnl = /(?:평균\s*매수가|매입가|포지션).{0,20}(?:손익|수익|손실|하락|상승)/u.test(input);
  const direction: CopilotPriceConfig["direction"] = isDrawdown || /(?:하락|아래|이하|내리|손실)/u.test(input) ? "down" : "up";
  const conditionPercent = nearestPercent(input, isVolume ? ["거래량"] : isDrawdown ? ["고점", "낙폭"] : isRebound ? ["저점", "반등"] : ["가격", "상승", "하락"], isVolume ? 150 : 3);
  const metric: CopilotPriceConfig["metric"] = isDrawdown ? "drawdown" : isRebound ? "rebound" : isVolume ? "volume_change" : isPositionPnl ? "position_pnl" : "return";
  const reference: CopilotPriceConfig["reference"] = metric === "drawdown" ? "rolling_high" : metric === "rebound" ? "rolling_low" : metric === "position_pnl" ? "average_buy" : metric === "volume_change" ? "vwap" : /직전\s*종가/u.test(input) ? "previous_close" : "window_open";
  const conditionConfig: CopilotPriceConfig = {
    type: "price_change",
    metric,
    asset,
    direction,
    threshold: clamp(conditionPercent.value, 0.1, metric === "volume_change" ? 1_000 : 100),
    window: window.value,
    reference,
    priceSource: /실시간|즉시/u.test(input) ? "last_trade" : "candle_close",
    trigger: /유지|동안/u.test(input) ? "level" : "cross",
    confirmation: /두\s*(?:개|번)|2\s*(?:개|번)|연속/u.test(input) ? "two_closes" : /실시간|즉시/u.test(input) ? "realtime" : "candle_close",
    missingData: "skip",
    repeat: /한\s*번만|최초\s*1회/u.test(input) ? "once" : /4\s*시간.{0,8}(?:대기|쿨다운)/u.test(input) ? "cooldown_4h" : /30\s*분.{0,8}(?:대기|쿨다운)/u.test(input) ? "cooldown_30m" : "once_per_candle",
  };

  const side: CopilotRatioConfig["side"] = /매도|청산/u.test(input) && !/매수/u.test(input) ? "sell" : /매수/u.test(input) ? "buy" : direction === "down" ? "buy" : "sell";
  const actionMatch = input.match(/(?:현금|잔고|보유(?:\s*자산)?|수량|자산|비중).{0,24}?(\d+(?:\.\d+)?)\s*%\s*(?:만큼|만|를|을)?\s*(매수|매도|청산)/u)
    ?? input.match(/(\d+(?:\.\d+)?)\s*%\s*(?:만큼|만|를|을)?.{0,12}(매수|매도|청산)/u);
  const actionRatio = actionMatch ? Number(actionMatch[1]) : 10;
  const actionSide: CopilotRatioConfig["side"] = actionMatch ? (actionMatch[2] === "매수" ? "buy" : "sell") : side;
  const actionConfig: CopilotRatioConfig = {
    type: "ratio_trade",
    side: actionSide,
    ratio: clamp(actionRatio, 1, 100),
    basis: actionSide === "buy" ? "available_cash" : "holding_asset",
  };

  const blocks: CopilotBlockDraft[] = [
    { id: "condition-1", kind: "condition", label: conditionLabel(conditionConfig), config: conditionConfig },
    { id: "action-1", kind: "action", label: `${actionConfig.basis === "available_cash" ? "사용 가능 원화" : "보유 자산"}의 ${actionConfig.ratio}% ${actionConfig.side === "buy" ? "매수" : "매도"}`, config: actionConfig },
  ];
  const assumptions: string[] = [];
  const questions: string[] = [];
  const findings: CopilotFinding[] = [];

  if (window.assumed) assumptions.push("지원되는 캔들 간격에 맞춰 관찰 기간을 조정했습니다.");
  if (conditionPercent.assumed) {
    assumptions.push(`조건 임계값을 ${conditionConfig.threshold}%로 임시 설정했습니다.`);
    questions.push("조건이 발동할 정확한 변화율을 확인해주세요.");
  }
  if (!actionMatch) {
    assumptions.push(`실행 비중을 ${actionConfig.ratio}%로 임시 설정했습니다.`);
    questions.push("한 번에 매수·매도할 자산 비중을 확인해주세요.");
  }

  const stopLoss = input.match(/손절.{0,10}?(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%.{0,10}?손절/u);
  if (stopLoss) {
    const threshold = clamp(Number(stopLoss[1] ?? stopLoss[2]), 0.1, 100);
    blocks.push({ id: "risk-stop-1", kind: "risk", label: `평균 매수가 대비 ${threshold}% 손실 시 포지션 중단` });
  } else {
    findings.push({ severity: "warning", code: "missing_stop_loss", message: "단일 포지션 손실 한도가 없어 승인 전 추가 검토가 필요합니다." });
  }

  const dailyLoss = input.match(/(?:일일|하루).{0,12}?(?:손실|손절).{0,8}?(\d+(?:\.\d+)?)\s*%/u);
  if (dailyLoss) blocks.push({ id: "risk-daily-1", kind: "risk", label: `일일 손실 ${clamp(Number(dailyLoss[1]), 0.1, 20)}% 도달 시 전략 중단` });
  else findings.push({ severity: "warning", code: "missing_daily_loss_limit", message: "일일 손실 한도가 지정되지 않았습니다." });

  if (/알림|통지|메시지/u.test(input)) blocks.push({ id: "notice-1", kind: "notice", label: "조건 발동·주문 상태 앱 알림" });
  if (actionConfig.ratio > 25) findings.push({ severity: "warning", code: "high_order_ratio", message: "단일 실행 비중이 25%를 초과해 집중 위험 검토가 필요합니다." });
  if (["5m", "15m"].includes(conditionConfig.window)) findings.push({ severity: "warning", code: "short_interval", message: "짧은 관찰 주기는 수수료·슬리피지와 주문 빈도 한도를 추가 검증해야 합니다." });
  if (/레버리지|선물|마진|공매도|숏/u.test(input)) findings.push({ severity: "blocker", code: "unsupported_leverage", message: "레버리지·파생상품·공매도는 현재 승인 범위 밖이므로 초안을 실행할 수 없습니다." });
  if (/수익\s*보장|무조건\s*수익|절대\s*손실/u.test(input)) findings.push({ severity: "blocker", code: "prohibited_claim", message: "수익 보장 또는 무손실 전제는 전략 요구사항으로 사용할 수 없습니다." });
  if (!findings.some((item) => item.severity === "blocker")) findings.unshift({ severity: "info", code: "human_review_required", message: "AI·규칙 생성 초안은 백테스트와 독립 승인 전에는 운영할 수 없습니다." });

  return {
    schemaVersion: STRATEGY_COPILOT_SCHEMA_VERSION,
    title: titleFor(conditionConfig, actionConfig),
    summary: `${conditionLabel(conditionConfig)} ${actionConfig.ratio}% ${actionConfig.side === "buy" ? "매수" : "매도"}하는 모의 전략 초안입니다.`,
    blocks,
    assumptions,
    questions,
    findings,
    confidence: findings.some((item) => item.severity === "blocker") || questions.length > 1 ? "low" : questions.length === 1 || findings.some((item) => item.severity === "warning") ? "medium" : "high",
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCopilotDraft(value: unknown): StrategyCopilotDraft {
  if (!object(value) || value.schemaVersion !== STRATEGY_COPILOT_SCHEMA_VERSION) throw new Error("지원하지 않는 AI 전략 형식입니다.");
  if (typeof value.title !== "string" || value.title.trim().length < 3 || value.title.length > 80) throw new Error("AI 전략 이름이 올바르지 않습니다.");
  if (typeof value.summary !== "string" || value.summary.trim().length < 8 || value.summary.length > 500) throw new Error("AI 전략 요약이 올바르지 않습니다.");
  if (!Array.isArray(value.blocks) || value.blocks.length < 2 || value.blocks.length > 20) throw new Error("AI 전략 블록은 2~20개여야 합니다.");

  const blocks = value.blocks.map((candidate, index): CopilotBlockDraft => {
    if (!object(candidate) || typeof candidate.id !== "string" || typeof candidate.label !== "string" || candidate.label.trim().length < 2 || candidate.label.length > 180 || !ALLOWED_KINDS.has(candidate.kind as CopilotBlockKind)) throw new Error(`AI 전략 ${index + 1}번 블록이 올바르지 않습니다.`);
    const kind = candidate.kind as CopilotBlockKind;
    let config: CopilotBlockDraft["config"];
    if (candidate.config !== undefined && candidate.config !== null) {
      if (!object(candidate.config)) throw new Error(`AI 전략 ${index + 1}번 설정이 올바르지 않습니다.`);
      if (candidate.config.type === "price_change") {
        if (!ALLOWED_ASSETS.has(candidate.config.asset as CopilotAsset) || !ALLOWED_WINDOWS.has(candidate.config.window as CopilotWindow) || typeof candidate.config.threshold !== "number" || !Number.isFinite(candidate.config.threshold) || candidate.config.threshold < 0.1 || candidate.config.threshold > 1_000) throw new Error(`AI 전략 ${index + 1}번 가격 조건이 허용 범위를 벗어났습니다.`);
        config = candidate.config as CopilotPriceConfig;
      } else if (candidate.config.type === "ratio_trade") {
        if ((candidate.config.side !== "buy" && candidate.config.side !== "sell") || typeof candidate.config.ratio !== "number" || !Number.isInteger(candidate.config.ratio) || candidate.config.ratio < 1 || candidate.config.ratio > 100) throw new Error(`AI 전략 ${index + 1}번 실행 비율이 허용 범위를 벗어났습니다.`);
        config = candidate.config as CopilotRatioConfig;
      } else throw new Error(`AI 전략 ${index + 1}번 설정 유형을 지원하지 않습니다.`);
    }
    return { id: candidate.id.slice(0, 80), kind, label: candidate.label.trim(), ...(config ? { config } : {}) };
  });

  const arrays = ["assumptions", "questions"] as const;
  for (const key of arrays) if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "string" || item.length > 300)) throw new Error(`AI 전략 ${key} 형식이 올바르지 않습니다.`);
  if (!Array.isArray(value.findings) || value.findings.length > 20) throw new Error("AI 전략 점검 결과가 올바르지 않습니다.");
  const findings = value.findings.map((candidate): CopilotFinding => {
    if (!object(candidate) || !["info", "warning", "blocker"].includes(String(candidate.severity)) || typeof candidate.code !== "string" || typeof candidate.message !== "string") throw new Error("AI 전략 점검 항목이 올바르지 않습니다.");
    return { severity: candidate.severity as CopilotFinding["severity"], code: candidate.code.slice(0, 80), message: candidate.message.slice(0, 300) };
  });
  const confidence = ["low", "medium", "high"].includes(String(value.confidence)) ? value.confidence as StrategyCopilotDraft["confidence"] : "low";
  return { schemaVersion: 1, title: value.title.trim(), summary: value.summary.trim(), blocks, assumptions: value.assumptions as string[], questions: value.questions as string[], findings, confidence };
}

export const STRATEGY_COPILOT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "title", "summary", "blocks", "assumptions", "questions", "findings", "confidence"],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    title: { type: "string", minLength: 3, maxLength: 80 },
    summary: { type: "string", minLength: 8, maxLength: 500 },
    blocks: {
      type: "array", minItems: 2, maxItems: 20,
      items: {
        type: "object", additionalProperties: false, required: ["id", "kind", "label", "config"],
        properties: {
          id: { type: "string", maxLength: 80 },
          kind: { type: "string", enum: ["condition", "action", "notice", "risk"] },
          label: { type: "string", minLength: 2, maxLength: 180 },
          config: {
            anyOf: [
              {
                type: "object", additionalProperties: false,
                required: ["type", "metric", "asset", "direction", "threshold", "window", "reference", "priceSource", "trigger", "confirmation", "missingData", "repeat"],
                properties: {
                  type: { const: "price_change" }, metric: { enum: ["return", "drawdown", "rebound", "ma_deviation", "volume_change", "position_pnl"] }, asset: { enum: ["BTC", "ETH", "SOL", "XRP"] }, direction: { enum: ["up", "down"] }, threshold: { type: "number", minimum: 0.1, maximum: 1_000 }, window: { enum: ["5m", "15m", "1h", "4h", "24h", "7d"] }, reference: { enum: ["window_open", "previous_close", "average_buy", "rolling_high", "rolling_low", "vwap"] }, priceSource: { enum: ["last_trade", "candle_close", "candle_high", "candle_low"] }, trigger: { enum: ["cross", "level"] }, confirmation: { enum: ["realtime", "candle_close", "two_closes"] }, missingData: { enum: ["skip", "carry_forward"] }, repeat: { enum: ["once", "once_per_candle", "cooldown_30m", "cooldown_4h"] },
                },
              },
              {
                type: "object", additionalProperties: false,
                required: ["type", "side", "ratio", "basis"],
                properties: { type: { const: "ratio_trade" }, side: { enum: ["buy", "sell"] }, ratio: { type: "integer", minimum: 1, maximum: 100 }, basis: { enum: ["available_cash", "holding_asset"] } },
              },
              { type: "null" },
            ],
          },
        },
      },
    },
    assumptions: { type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } },
    questions: { type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } },
    findings: {
      type: "array", maxItems: 20,
      items: { type: "object", additionalProperties: false, required: ["severity", "code", "message"], properties: { severity: { enum: ["info", "warning", "blocker"] }, code: { type: "string", maxLength: 80 }, message: { type: "string", maxLength: 300 } } },
    },
    confidence: { enum: ["low", "medium", "high"] },
  },
} as const;
