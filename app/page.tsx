"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_OPERATION_SNAPSHOT,
  type OperationCommandInput,
  type OperationSnapshot,
  type OrderRunStatus,
} from "../lib/operations";
import {
  DEFAULT_MARKETPLACE_SNAPSHOT,
  type MarketplaceCommandInput,
  type MarketplaceRisk,
  type MarketplaceSnapshot,
  type MarketplaceStrategy,
} from "../lib/marketplace";
import { loadOperationSnapshot, sendOperationCommand } from "../lib/client/operations-api";
import { requestStrategyDraft } from "../lib/client/strategy-copilot-api";
import { loadControlPlaneSnapshot, sendControlPlaneCommand } from "../lib/client/control-plane-api";
import { loadRuntimeStatus } from "../lib/client/runtime-api";
import { loadShadowSnapshot, runShadowCycle } from "../lib/client/shadow-api";
import { ROLE_LABELS, type ControlPlaneSnapshot } from "../lib/control-plane";
import type { RuntimeControlStatus } from "../lib/runtime/status";
import type { ShadowConsoleSnapshot } from "../lib/shadow";
import type { StrategyCopilotResponse } from "../lib/strategy-copilot";
import { diagnoseStrategy, migrateLegacyStrategy } from "../lib/strategy";
import { CREATOR_FEE_SPLIT_PCT, DEFAULT_PROFIT_SHARE_PCT, PLATFORM_FEE_SPLIT_PCT } from "../lib/marketplace-license";

type Screen =
  | "landing"
  | "login"
  | "terms"
  | "risk"
  | "signup"
  | "verify"
  | "api"
  | "dashboard"
  | "control"
  | "shadow"
  | "operations"
  | "builder"
  | "copilot"
  | "market"
  | "marketDetail"
  | "creator"
  | "backtest"
  | "execution"
  | "notifications"
  | "notificationDetail"
  | "transactions"
  | "library"
  | "postmortem"
  | "profile"
  | "billing"
  | "support"
  | "settings";

type PriceConditionConfig = {
  type: "price_change";
  metric: "return" | "drawdown" | "rebound" | "ma_deviation" | "volume_change" | "position_pnl";
  asset: "BTC" | "ETH" | "SOL" | "XRP";
  direction: "up" | "down";
  threshold: number;
  window: "5m" | "15m" | "1h" | "4h" | "24h" | "7d";
  reference: "window_open" | "previous_close" | "average_buy" | "rolling_high" | "rolling_low" | "vwap";
  priceSource: "last_trade" | "candle_close" | "candle_high" | "candle_low";
  trigger: "cross" | "level";
  confirmation: "realtime" | "candle_close" | "two_closes";
  missingData: "skip" | "carry_forward";
  repeat: "once" | "once_per_candle" | "cooldown_30m" | "cooldown_4h";
};
type RatioActionConfig = {
  type: "ratio_trade";
  side: "buy" | "sell";
  ratio: number;
  basis: "available_cash" | "holding_asset";
};
type RsiConditionConfig = {
  type: "rsi_condition";
  asset: "BTC" | "ETH" | "SOL" | "XRP";
  timeframe: "5m" | "15m" | "1h" | "4h" | "24h";
  period: number;
  operator: "lte" | "gte";
  threshold: number;
  confirmation: "realtime" | "candle_close" | "two_closes";
};
type TimeConditionConfig = {
  type: "time_condition";
  startTime: string;
  endTime: string;
  days: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
  timeZone: "Asia/Seoul" | "UTC";
};
type TradeActionConfig = {
  type: "trade_action";
  side: "buy" | "sell";
  sizeMode: "all" | "fixed_krw" | "ratio";
  ratio: number;
  amountKrw: number;
  orderType: "market" | "limit";
  limitOffsetPct: number;
};
type RebalanceActionConfig = {
  type: "rebalance_action";
  btcPct: number;
  ethPct: number;
  cashPct: number;
  driftPct: number;
  schedule: "daily" | "weekly" | "monthly";
};
type NotificationConfig = {
  type: "notification";
  channel: "app" | "email" | "kakao";
  priority: "info" | "warning" | "critical";
  cooldownMinutes: number;
  message: string;
};
type RiskActionConfig = {
  type: "risk_action";
  rule: "stop_loss" | "take_profit" | "reduce_position";
  threshold: number;
  reduceRatio: number;
  reference: "average_buy" | "rolling_high";
  cooldownMinutes: number;
};
type StrategyBlockConfig =
  | PriceConditionConfig
  | RatioActionConfig
  | RsiConditionConfig
  | TimeConditionConfig
  | TradeActionConfig
  | RebalanceActionConfig
  | NotificationConfig
  | RiskActionConfig;
type StrategyBlock = {
  id: number;
  kind: "condition" | "action" | "notice" | "risk";
  label: string;
  config?: StrategyBlockConfig;
  source?: "manual" | "ai";
};
type Profile = { nickname: string; email: string; bio: string; riskStyle: string };
type Plan = "Free" | "Pro" | "Gold";
const PLAN_LABELS: Record<Plan, string> = { Free:"무료", Pro:"프로", Gold:"골드" };
type NotificationItem = { id: string; category: string; title: string; body: string; time: string; icon: string; detail: string };
type ExchangeReadiness = { mode: "demo" | "live"; ready: boolean; liveReady: boolean; liveBlockers: string[]; missing: string[]; withdrawalsAllowed: false };
type CommerceReadiness = { demoReady: boolean; liveReady: boolean; payment: { mode: "demo" | "live"; provider: string; ready: boolean; missingEnvironmentKeys: string[] }; blockers: { code: string; satisfied: boolean; note: string }[] };

const NOTIFICATIONS: NotificationItem[] = [
  { id:"trade-buy", category:"체결", title:"DCA 비트코인 적립 — 매수 체결", body:"BTC 0.001개 · ₩42,300 매수 완료", time:"방금 전", icon:"체결", detail:"업비트에서 BTC 0.001개가 시장가로 체결되었습니다. 예상 슬리피지는 0.08%였고 실제 슬리피지는 0.04%입니다." },
  { id:"strategy-error", category:"전략 오류", title:"RSI 역추세 스윙 — API 응답 실패", body:"업비트 서버 일시 오류 · 1분 후 재시도", time:"5분 전", icon:"오류", detail:"거래소 API가 제한 시간 안에 응답하지 않아 주문을 만들지 않았습니다. 중복 주문 방지를 위해 재시도 전 상태를 다시 확인합니다." },
  { id:"price-eth", category:"가격", title:"ETH 가격 알림", body:"설정한 ₩3,500,000 도달 · +2.5% 상승", time:"12분 전", icon:"가격", detail:"ETH가 사용자가 지정한 기준가 ₩3,500,000에 도달했습니다. 이 알림 자체는 주문을 생성하지 않습니다." },
  { id:"trade-stop", category:"체결", title:"변동성 돌파 — 손절 매도 체결", body:"BTC 0.0008개 · ₩12,300 손실", time:"1시간 전", icon:"위험", detail:"설정한 손절률 3%에 도달하여 BTC 0.0008개가 매도되었습니다. 일일 손실 한도까지 1.2% 남았습니다." },
  { id:"backtest-done", category:"백테스팅", title:"백테스팅 완료", body:"ETH 급등 익절 전략 · 수익률 +18.4%", time:"3시간 전", icon:"검증", detail:"90일 구간 백테스트가 완료되었습니다. 총 수익률 +18.4%, 최대 낙폭 -7.3%, 승률 72.4%입니다." },
  { id:"api-expiry", category:"시스템", title:"업비트 API 키 갱신 안내", body:"API 키 만료 7일 전 · 재발급 권장", time:"어제", icon:"연동", detail:"API 연결 만료 예정일이 7일 남았습니다. 자동매매 중단을 방지하려면 출금 권한을 제외한 새 키로 교체하세요." },
];

const TRANSACTIONS = [
  { id:"T-250314-01", date:"2025.03.14 14:32", side:"매수", asset:"BTC", strategy:"DCA 비트코인 적립", amount:"0.001 BTC", price:"₩42,300", pnl:"—", status:"체결" },
  { id:"T-250314-02", date:"2025.03.14 12:10", side:"매도", asset:"ETH", strategy:"ETH 급등 익절", amount:"0.18 ETH", price:"₩632,400", pnl:"+₩48,200", status:"체결" },
  { id:"T-250313-01", date:"2025.03.13 18:05", side:"매도", asset:"BTC", strategy:"변동성 돌파", amount:"0.0008 BTC", price:"₩91,600", pnl:"-₩12,300", status:"체결" },
  { id:"T-250312-01", date:"2025.03.12 09:00", side:"매수", asset:"BTC", strategy:"DCA 비트코인 적립", amount:"0.001 BTC", price:"₩41,850", pnl:"—", status:"체결" },
  { id:"T-250311-01", date:"2025.03.11 16:42", side:"매도", asset:"ETH", strategy:"ETH 급등 익절", amount:"0.17 ETH", price:"₩598,100", pnl:"+₩31,500", status:"체결" },
  { id:"T-250309-01", date:"2025.03.09 10:20", side:"매수", asset:"ETH", strategy:"리밸런싱", amount:"0.22 ETH", price:"₩744,200", pnl:"—", status:"체결" },
];

const PRIMARY_NAV: { id: Screen; label: string }[] = [
  { id: "dashboard", label: "펀드 운용" },
  { id: "control", label: "리스크·통제" },
  { id: "shadow", label: "섀도 운용" },
  { id: "operations", label: "주문관리" },
  { id: "builder", label: "전략" },
  { id: "market", label: "전략 마켓" },
  { id: "backtest", label: "리서치" },
];

const SIDEBAR_NAV: { id: Screen; icon: string; label: string }[] = [
  { id: "dashboard", icon: "01", label: "펀드 현황" },
  { id: "control", icon: "02", label: "리스크·통제" },
  { id: "shadow", icon: "03", label: "섀도 운용" },
  { id: "operations", icon: "04", label: "주문·체결" },
  { id: "builder", icon: "05", label: "전략 등록부" },
  { id: "copilot", icon: "06", label: "AI 전략 코파일럿" },
  { id: "backtest", icon: "07", label: "리서치 랩" },
  { id: "notifications", icon: "08", label: "알림" },
  { id: "settings", icon: "09", label: "관리" },
  { id: "api", icon: "10", label: "외부 연동" },
];

const DEFAULT_PRICE_CONFIG: PriceConditionConfig = { type:"price_change", metric:"return", asset:"ETH", direction:"up", threshold:2.5, window:"4h", reference:"window_open", priceSource:"last_trade", trigger:"cross", confirmation:"candle_close", missingData:"skip", repeat:"once_per_candle" };
const DEFAULT_RATIO_CONFIG: RatioActionConfig = { type:"ratio_trade", side:"sell", ratio:30, basis:"holding_asset" };
const DEFAULT_RSI_CONFIG: RsiConditionConfig = { type:"rsi_condition", asset:"BTC", timeframe:"1h", period:14, operator:"lte", threshold:30, confirmation:"candle_close" };
const DEFAULT_TIME_CONFIG: TimeConditionConfig = { type:"time_condition", startTime:"09:00", endTime:"18:00", days:["mon","tue","wed","thu","fri"], timeZone:"Asia/Seoul" };
const DEFAULT_TRADE_CONFIG: TradeActionConfig = { type:"trade_action", side:"buy", sizeMode:"all", ratio:20, amountKrw:1_000_000, orderType:"market", limitOffsetPct:0.2 };
const DEFAULT_REBALANCE_CONFIG: RebalanceActionConfig = { type:"rebalance_action", btcPct:60, ethPct:30, cashPct:10, driftPct:5, schedule:"weekly" };
const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = { type:"notification", channel:"app", priority:"warning", cooldownMinutes:30, message:"전략 조건이 충족되었습니다." };
const DEFAULT_RISK_CONFIG: RiskActionConfig = { type:"risk_action", rule:"stop_loss", threshold:5, reduceRatio:100, reference:"average_buy", cooldownMinutes:240 };

function priceConditionLabel(config: PriceConditionConfig) {
  const window = { "5m":"최근 5분", "15m":"최근 15분", "1h":"최근 1시간", "4h":"최근 4시간", "24h":"최근 24시간", "7d":"최근 7일" }[config.window];
  const reference = { window_open:"시가", previous_close:"직전 종가", average_buy:"평균 매수가", rolling_high:"구간 최고가", rolling_low:"구간 최저가", vwap:"거래량 가중 평균가" }[config.reference];
  const trigger = config.trigger === "cross" ? (config.direction === "up" ? "상향 돌파하면" : "하향 돌파하면") : (config.direction === "up" ? "이상 유지하면" : "이하 유지하면");
  if (config.metric === "drawdown") return `${config.asset} ${window} 고점 대비 낙폭이 ${config.threshold}% ${config.trigger === "cross" ? "초과하면" : "이상 유지되면"}`;
  if (config.metric === "rebound") return `${config.asset} ${window} 저점 대비 반등률이 ${config.threshold}% ${config.trigger === "cross" ? "상향 돌파하면" : "이상 유지되면"}`;
  if (config.metric === "ma_deviation") return `${config.asset} ${window} 이동평균 괴리율이 ${config.threshold}% ${trigger}`;
  if (config.metric === "volume_change") return `${config.asset} ${window} 평균 대비 거래량 변화율이 ${config.threshold}% ${trigger}`;
  if (config.metric === "position_pnl") return `${config.asset} 포지션 손익률이 ${config.threshold}% ${trigger}`;
  return `${config.asset}가 ${window} ${reference} 대비 ${config.threshold}% ${trigger}`;
}

function ratioActionLabel(config: RatioActionConfig) {
  const basis = config.basis === "available_cash" ? "사용 가능 원화" : "보유 자산";
  return `${basis}의 ${config.ratio}% ${config.side === "buy" ? "매수" : "매도"}`;
}

function rsiConditionLabel(config: RsiConditionConfig) {
  const timeframe = { "5m":"5분", "15m":"15분", "1h":"1시간", "4h":"4시간", "24h":"24시간" }[config.timeframe];
  return `${config.asset} ${timeframe} RSI(${config.period})가 ${config.threshold} ${config.operator === "lte" ? "이하" : "이상"}일 때`;
}

function timeConditionLabel(config: TimeConditionConfig) {
  const dayLabels = { mon:"월", tue:"화", wed:"수", thu:"목", fri:"금", sat:"토", sun:"일" };
  const days = config.days.length === 5 && config.days.every((day) => !["sat","sun"].includes(day))
    ? "평일"
    : config.days.map((day) => dayLabels[day]).join("·");
  return `${days || "요일 미지정"} ${config.startTime}~${config.endTime}에만 실행`;
}

function tradeActionLabel(config: TradeActionConfig) {
  const side = config.side === "buy" ? "매수" : "매도";
  if (config.sizeMode === "all") return `사용 가능 수량 전량 ${side}`;
  if (config.sizeMode === "fixed_krw") return `₩${config.amountKrw.toLocaleString("ko-KR")} 금액 지정 ${side}`;
  return `${config.ratio}% 비율 ${side}`;
}

function rebalanceActionLabel(config: RebalanceActionConfig) {
  return `BTC ${config.btcPct}% · ETH ${config.ethPct}% · 현금 ${config.cashPct}% 리밸런싱`;
}

function notificationLabel(config: NotificationConfig) {
  const channel = { app:"앱", email:"이메일", kakao:"카카오톡" }[config.channel];
  return `${channel} 알림 · ${config.cooldownMinutes}분 중복 제한`;
}

function riskActionLabel(config: RiskActionConfig) {
  const rule = config.rule === "stop_loss" ? "손실" : config.rule === "take_profit" ? "수익" : "포지션 위험";
  return `${rule} ${config.threshold}% 도달 시 ${config.reduceRatio}% 매도`;
}

function strategyBlockLabel(config: StrategyBlockConfig) {
  if (config.type === "price_change") return priceConditionLabel(config);
  if (config.type === "ratio_trade") return ratioActionLabel(config);
  if (config.type === "rsi_condition") return rsiConditionLabel(config);
  if (config.type === "time_condition") return timeConditionLabel(config);
  if (config.type === "trade_action") return tradeActionLabel(config);
  if (config.type === "rebalance_action") return rebalanceActionLabel(config);
  if (config.type === "notification") return notificationLabel(config);
  return riskActionLabel(config);
}

function copyBlockConfig(config: StrategyBlockConfig): StrategyBlockConfig {
  if (config.type === "time_condition") return { ...config, days:[...config.days] };
  return { ...config };
}

function defaultConfigForBlock(block: Pick<StrategyBlock,"kind" | "label">): StrategyBlockConfig {
  const label = stripLegacyDecorators(block.label);
  if (block.kind === "notice" || label.includes("알림") || label.includes("이메일") || label.includes("카카오")) {
    const channel: NotificationConfig["channel"] = label.includes("이메일") ? "email" : label.includes("카카오") ? "kakao" : "app";
    return { ...DEFAULT_NOTIFICATION_CONFIG, channel };
  }
  if (label.includes("RSI")) return { ...DEFAULT_RSI_CONFIG };
  if (label.includes("시간") || /\d{1,2}:\d{2}/.test(label)) return { ...DEFAULT_TIME_CONFIG };
  if (label.includes("리밸런싱")) return { ...DEFAULT_REBALANCE_CONFIG };
  if (label.includes("손절") || label.includes("익절") || block.kind === "risk") {
    const threshold = Number(label.match(/([0-9]+(?:\.[0-9]+)?)%/)?.[1] || DEFAULT_RISK_CONFIG.threshold);
    return { ...DEFAULT_RISK_CONFIG, rule:label.includes("익절") ? "take_profit" : "stop_loss", threshold };
  }
  if (label.includes("전량") || label.includes("금액 지정")) {
    return {
      ...DEFAULT_TRADE_CONFIG,
      side:label.includes("매도") ? "sell" : "buy",
      sizeMode:label.includes("금액 지정") ? "fixed_krw" : "all",
    };
  }
  if (block.kind === "action") {
    const ratio = Number(label.match(/([0-9]+(?:\.[0-9]+)?)%/)?.[1] || DEFAULT_RATIO_CONFIG.ratio);
    return { ...DEFAULT_RATIO_CONFIG, side:label.includes("매수") ? "buy" : "sell", basis:label.includes("매수") ? "available_cash" : "holding_asset", ratio };
  }
  return { ...DEFAULT_PRICE_CONFIG };
}

function validateBlockConfiguration(block: StrategyBlock) {
  const config = block.config;
  if (!config) return ["세부 설정이 없습니다"];
  if (config.type === "price_change" && (config.threshold <= 0 || config.threshold > (config.metric === "volume_change" ? 1000 : 100))) return ["변화율 범위를 확인하세요"];
  if (config.type === "ratio_trade" && (config.ratio < 1 || config.ratio > 100)) return ["실행 비율은 1~100%여야 합니다"];
  if (config.type === "rsi_condition" && (config.period < 2 || config.period > 200 || config.threshold < 1 || config.threshold > 99)) return ["RSI 기간 또는 임계값 범위를 확인하세요"];
  if (config.type === "time_condition" && (config.days.length === 0 || config.startTime === config.endTime)) return ["요일을 하나 이상 선택하고 시작·종료 시간을 다르게 설정하세요"];
  if (config.type === "trade_action") {
    if (config.sizeMode === "ratio" && (config.ratio < 1 || config.ratio > 100)) return ["주문 비율은 1~100%여야 합니다"];
    if (config.sizeMode === "fixed_krw" && config.amountKrw < 5_000) return ["금액 지정 주문은 5,000원 이상이어야 합니다"];
  }
  if (config.type === "rebalance_action" && config.btcPct + config.ethPct + config.cashPct !== 100) return ["BTC·ETH·현금 목표 비중의 합계가 100%여야 합니다"];
  if (config.type === "notification" && config.message.trim().length < 4) return ["알림 문구를 4자 이상 입력하세요"];
  if (config.type === "risk_action" && (config.threshold <= 0 || config.threshold > 100 || config.reduceRatio < 1 || config.reduceRatio > 100)) return ["위험 임계값과 매도 비율을 확인하세요"];
  return [];
}

function stripLegacyDecorators(label: string) {
  return label.replace(/^[^0-9A-Za-z가-힣]+/u, "").trim();
}

const DEFAULT_BLOCKS: StrategyBlock[] = [
  { id: 1, kind: "condition", label: priceConditionLabel(DEFAULT_PRICE_CONFIG), config: DEFAULT_PRICE_CONFIG },
  { id: 2, kind: "action", label: ratioActionLabel(DEFAULT_RATIO_CONFIG), config: DEFAULT_RATIO_CONFIG },
  { id: 3, kind: "notice", label: notificationLabel(DEFAULT_NOTIFICATION_CONFIG), config: DEFAULT_NOTIFICATION_CONFIG },
];

function safeLoadBlocks(): StrategyBlock[] {
  if (typeof window === "undefined") return DEFAULT_BLOCKS;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem("bt-blocks-v2") || "null");
    if (!Array.isArray(parsed)) return DEFAULT_BLOCKS;
    const normalized = parsed.flatMap((item): StrategyBlock[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<StrategyBlock>;
      if (typeof candidate.id !== "number" || typeof candidate.label !== "string" || !["condition", "action", "notice", "risk"].includes(candidate.kind || "")) return [];
      if (candidate.config?.type === "price_change") {
        const config = { ...DEFAULT_PRICE_CONFIG, ...candidate.config } as PriceConditionConfig;
        return [{ ...candidate, config, label:priceConditionLabel(config) } as StrategyBlock];
      }
      if (candidate.config?.type === "ratio_trade") {
        const config = { ...DEFAULT_RATIO_CONFIG, ...candidate.config } as RatioActionConfig;
        return [{ ...candidate, config, label:ratioActionLabel(config) } as StrategyBlock];
      }
      if (candidate.config?.type === "rsi_condition") {
        const config = { ...DEFAULT_RSI_CONFIG, ...candidate.config } as RsiConditionConfig;
        return [{ ...candidate, config, label:rsiConditionLabel(config) } as StrategyBlock];
      }
      if (candidate.config?.type === "time_condition") {
        const config = { ...DEFAULT_TIME_CONFIG, ...candidate.config, days:[...(candidate.config.days || DEFAULT_TIME_CONFIG.days)] } as TimeConditionConfig;
        return [{ ...candidate, config, label:timeConditionLabel(config) } as StrategyBlock];
      }
      if (candidate.config?.type === "trade_action") {
        const config = { ...DEFAULT_TRADE_CONFIG, ...candidate.config } as TradeActionConfig;
        return [{ ...candidate, config, label:tradeActionLabel(config) } as StrategyBlock];
      }
      if (candidate.config?.type === "rebalance_action") {
        const config = { ...DEFAULT_REBALANCE_CONFIG, ...candidate.config } as RebalanceActionConfig;
        return [{ ...candidate, config, label:rebalanceActionLabel(config) } as StrategyBlock];
      }
      if (candidate.config?.type === "notification") {
        const config = { ...DEFAULT_NOTIFICATION_CONFIG, ...candidate.config } as NotificationConfig;
        return [{ ...candidate, config, label:notificationLabel(config) } as StrategyBlock];
      }
      if (candidate.config?.type === "risk_action") {
        const config = { ...DEFAULT_RISK_CONFIG, ...candidate.config } as RiskActionConfig;
        return [{ ...candidate, config, label:riskActionLabel(config) } as StrategyBlock];
      }
      if (candidate.kind === "condition" && candidate.label.includes("가격") && candidate.label.includes("%")) {
        const threshold = Number(candidate.label.match(/([0-9]+(?:\.[0-9]+)?)%/)?.[1] || DEFAULT_PRICE_CONFIG.threshold);
        const config: PriceConditionConfig = {
          ...DEFAULT_PRICE_CONFIG,
          asset: candidate.label.includes("비트코인") || candidate.label.includes("BTC") ? "BTC" : "ETH",
          direction: candidate.label.includes("하락") ? "down" : "up",
          threshold,
        };
        return [{ ...candidate, kind:"condition", label:priceConditionLabel(config), config } as StrategyBlock];
      }
      const legacy = { ...candidate, label:stripLegacyDecorators(candidate.label) } as StrategyBlock;
      const config = defaultConfigForBlock(legacy);
      return [{ ...legacy, config, label:strategyBlockLabel(config) }];
    });
    return normalized.length > 0 ? normalized : DEFAULT_BLOCKS;
  } catch {
    return DEFAULT_BLOCKS;
  }
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [dark, setDark] = useState(false);
  const [toast, setToast] = useState("");
  const [blocks, setBlocks] = useState<StrategyBlock[]>(safeLoadBlocks);
  const [connected, setConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [apiReturn, setApiReturn] = useState<Screen>("dashboard");
  const [profile, setProfile] = useState<Profile>({ nickname:"정훈", email:"zizo908@naver.com", bio:"데이터로 판단하는 장기 투자자", riskStyle:"중립형" });
  const [plan, setPlan] = useState<Plan>("Free");
  const [selectedNotification, setSelectedNotification] = useState("trade-buy");
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());
  const [marketplace, setMarketplace] = useState<MarketplaceSnapshot>(DEFAULT_MARKETPLACE_SNAPSHOT);
  const [selectedMarketId, setSelectedMarketId] = useState(DEFAULT_MARKETPLACE_SNAPSHOT.strategies[0].id);
  const [marketBusy, setMarketBusy] = useState("");

  useEffect(() => {
    try { localStorage.setItem("bt-blocks-v2", JSON.stringify(blocks)); } catch { /* storage can be unavailable */ }
  }, [blocks]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const controller = new AbortController();
    fetch("/api/session", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as { authenticated?: boolean; user?: { displayName?: string } };
        if (!response.ok || !payload.authenticated) return;
        setConnected(true);
        if (payload.user?.displayName) {
          setProfile((current) => ({ ...current, nickname: payload.user!.displayName! }));
        }
        if (new URLSearchParams(window.location.search).get("console") === "1") {
          setScreen("dashboard");
        }
      })
      .catch(() => {
        // Production remains fail-closed; the institutional console is not opened.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!["market", "marketDetail", "creator"].includes(screen)) return;
    let active = true;
    fetch("/api/marketplace", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("marketplace load failed");
        return response.json() as Promise<{ snapshot: MarketplaceSnapshot }>;
      })
      .then((payload) => { if (active && payload.snapshot?.strategies) setMarketplace(payload.snapshot); })
      .catch(() => {
        if (!active) return;
        setToast("전략 마켓은 예시 데이터로 표시 중입니다");
        window.setTimeout(() => setToast(""), 2200);
      });
    return () => { active = false; };
  }, [screen]);

  const go = (next: Screen) => {
    setScreen(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };
  const openApi = (returnTo: Screen) => {
    setApiReturn(returnTo);
    go("api");
  };
  const enterDemo = () => {
    setDemoMode(true);
    go("dashboard");
  };
  const openNotification = (id: string) => {
    setSelectedNotification(id);
    setReadNotifications((state) => new Set(state).add(id));
    go("notificationDetail");
  };
  const openMarket = (id: string) => {
    setSelectedMarketId(id);
    go("marketDetail");
  };
  const performMarket = async (input: MarketplaceCommandInput, message: string) => {
    setMarketBusy(input.action);
    try {
      const response = await fetch("/api/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...input, requestId: crypto.randomUUID() }),
      });
      const payload = await response.json() as { snapshot?: MarketplaceSnapshot; error?: string };
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "마켓 요청을 처리하지 못했습니다");
      setMarketplace(payload.snapshot);
      notify(message);
      return true;
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : "마켓 요청을 처리하지 못했습니다");
      return false;
    } finally {
      setMarketBusy("");
    }
  };

  if (screen === "landing") return <><Landing go={go} connected={connected} />{toast && <Toast message={toast} />}</>;
  if (screen === "login") return <><Login go={go} notify={notify} enterDemo={enterDemo} />{toast && <Toast message={toast} />}</>;
  if (screen === "terms") return <Terms go={go} />;
  if (screen === "risk") return <RiskDisclosure go={go} />;
  if (screen === "signup") return <Signup go={go} notify={notify} />;
  if (screen === "verify") return <><Verify go={go} notify={notify} />{toast && <Toast message={toast} />}</>;
  if (screen === "api") return <><ApiSetup go={go} notify={notify} backTo={apiReturn} />{toast && <Toast message={toast} />}</>;

  return <div className={dark ? "product dark" : "product"}>
    <AppHeader screen={screen} go={go} dark={dark} setDark={setDark} profile={profile} />
    <AppSidebar screen={screen} go={go} openApi={openApi} unreadCount={NOTIFICATIONS.slice(0, 2).filter((item) => !readNotifications.has(item.id)).length} />
    <main className="product-main">
      {screen === "dashboard" && <Dashboard go={go} connected={connected} demoMode={demoMode} enterDemo={enterDemo} openApi={openApi} />}
      {screen === "control" && <InstitutionalControlCenter go={go} />}
      {screen === "shadow" && <ShadowOperationCenter notify={notify} />}
      {screen === "operations" && <OperationsCenter go={go} notify={notify} />}
      {screen === "builder" && <Builder go={go} blocks={blocks} setBlocks={setBlocks} notify={notify} />}
      {screen === "copilot" && <StrategyCopilot go={go} setBlocks={setBlocks} notify={notify} />}
      {screen === "market" && <StrategyMarketplace snapshot={marketplace} plan={plan} openDetail={openMarket} go={go} />}
      {screen === "marketDetail" && <MarketplaceDetail strategy={marketplace.strategies.find((item) => item.id === selectedMarketId) || marketplace.strategies[0]} subscription={marketplace.subscriptions.find((item) => item.strategyId === selectedMarketId)} plan={plan} go={go} perform={performMarket} busy={marketBusy} />}
      {screen === "creator" && <CreatorStudio snapshot={marketplace} blocks={blocks} profile={profile} plan={plan} go={go} perform={performMarket} busy={marketBusy} />}
      {screen === "backtest" && <Backtest go={go} setBlocks={setBlocks} notify={notify} />}
      {screen === "execution" && <ExecutionReview go={go} notify={notify} />}
      {screen === "notifications" && <Notifications notify={notify} read={readNotifications} setRead={setReadNotifications} openDetail={openNotification} />}
      {screen === "notificationDetail" && <NotificationDetail itemId={selectedNotification} go={go} openApi={openApi} />}
      {screen === "transactions" && <TransactionHistory go={go} notify={notify} />}
      {screen === "library" && <StrategyLibrary go={go} setBlocks={setBlocks} notify={notify} />}
      {screen === "postmortem" && <Postmortem go={go} setBlocks={setBlocks} notify={notify} />}
      {screen === "profile" && <ProfileEdit profile={profile} setProfile={setProfile} go={go} notify={notify} />}
      {screen === "billing" && <Billing plan={plan} setPlan={setPlan} go={go} notify={notify} />}
      {screen === "support" && <Support go={go} notify={notify} />}
      {screen === "settings" && <Settings dark={dark} setDark={setDark} notify={notify} connected={connected} openApi={openApi} profile={profile} plan={plan} go={go} />}
    </main>
    <BottomNav screen={screen} go={go} />
    {toast && <Toast message={toast} />}
  </div>;
}

function Logo({ large = false }: { large?: boolean }) {
  return <div className={large ? "logo large" : "logo"}><span>BT</span>{!large && <strong>BlockTrade</strong>}</div>;
}

function Landing({ go, connected }: { go: (screen: Screen) => void; connected: boolean }) {
  const [section, setSection] = useState<"platform" | "controls" | "security">("platform");
  const [explorerOpen, setExplorerOpen] = useState(false);
  const publicTabs = [["platform", "플랫폼"], ["controls", "통제 체계"], ["security", "보안"]] as const;
  const sectionCopy = {
    platform: { eyebrow:"전략 수명주기", title:"대화에서 검증 가능한 전략 명세까지", description:"AI 대화, 구조화 블록과 전략 등록부를 하나의 통제된 작업 흐름으로 연결합니다." },
    controls: { eyebrow:"리스크·승인", title:"승인과 주문 전 위험검사를 한 화면에서", description:"작성자와 승인자를 분리하고 서버의 위험 정책으로 모든 운용 변경을 통제합니다." },
    security: { eyebrow:"보안·감사", title:"비밀정보 경계와 감사 증적을 함께 확인", description:"거래소 키, 실행 권한과 변경 불가능한 감사 기록의 경계를 명확하게 보여줍니다." },
  }[section];
  const openSection = (next: typeof section) => {
    setSection(next);
    setExplorerOpen(true);
    if (typeof window !== "undefined") window.setTimeout(() => document.getElementById("product-explorer")?.scrollIntoView?.({ behavior:"smooth", block:"start" }), 0);
  };
  return <main className="institutional-landing bt-public-site">
    <header className="bt-public-header">
      <Logo />
      <nav aria-label="공개 홈페이지 메뉴">
        {publicTabs.map(([id, label]) => <button type="button" aria-pressed={explorerOpen && section === id} className={explorerOpen && section === id ? "active" : ""} key={id} onClick={() => openSection(id)}>{label}</button>)}
      </nav>
      <button type="button" className="bt-public-login" onClick={() => go(connected ? "dashboard" : "login")}>{connected ? "기관 콘솔 열기" : "기관 전용 접속"}</button>
    </header>
    <section className="bt-public-hero bt-public-hero-minimal">
      <div className="bt-hero-copy">
        <span className="bt-kicker">기관용 가상자산 운용 인프라</span>
        <h1>전략부터 주문까지,<br />통제 가능한 하나의 시스템.</h1>
        <p>전략 설계, 독립 승인, 주문 전 위험검사와 체결 대사를 하나의 운영 흐름으로 연결합니다. 모든 변경과 실행은 검토 가능한 기록으로 남습니다.</p>
        <div className="bt-hero-actions">
          <button type="button" className="bt-primary-action" onClick={() => openSection("platform")}>제품 기능 보기 <span aria-hidden="true">→</span></button>
          <button type="button" className="bt-secondary-action" onClick={() => go("terms")}>기관용 콘솔 체험</button>
        </div>
        <p className="bt-hero-note">현재 공개 버전은 실제 주문 권한이 없는 모의 운영 환경입니다.</p>
      </div>
    </section>
    {explorerOpen && <section className="landing-product-explorer bt-product-stage" id="product-explorer">
      <header><div><span className="eyebrow">{sectionCopy.eyebrow}</span><h2>{sectionCopy.title}</h2><p>{sectionCopy.description}</p></div><div className="bt-product-header-actions"><nav aria-label="제품 화면 선택">{publicTabs.map(([id, label]) => <button type="button" aria-pressed={section === id} className={section === id ? "active" : ""} key={id} onClick={() => setSection(id)}>{label}</button>)}</nav><button type="button" className="bt-product-close" aria-label="제품 화면 닫기" onClick={() => setExplorerOpen(false)}>닫기</button></div></header>
      {section === "platform" && <div className="landing-tab-panel platform-tab" role="tabpanel" aria-label="플랫폼 화면">
        <section className="landing-chat-demo"><header><span>AI 전략 코파일럿</span><b>주문 실행 불가</b></header><div className="chat-request"><small>운용역</small><p>BTC가 최근 4시간 고점에서 5% 하락하면 현금 10%를 매수하고, 일일 손실 3%에서 중단해줘.</p></div><div className="chat-response"><small>구조화된 전략 초안</small>{["조건 · BTC 4시간 고점 대비 낙폭 5%","실행 · 사용 가능 원화의 10% 매수","위험 · 일일 손실 3%에서 전략 중단"].map((item,index) => <div key={item}><i>{String(index+1).padStart(2,"0")}</i><span>{item}</span></div>)}<footer><span>서버 검증 통과</span><b>사람의 승인 필요</b></footer></div></section>
        <aside className="landing-version-demo"><header><div><span>전략 등록부</span><strong>BTC 낙폭 매수 전략</strong></div><b>초안 v1</b></header><dl><div><dt>생성 방식</dt><dd>자연어 → 블록</dd></div><div><dt>조건 충돌</dt><dd className="good">없음</dd></div><div><dt>주문 권한</dt><dd className="blocked">차단</dd></div><div><dt>다음 단계</dt><dd>리스크 승인 요청</dd></div></dl><button type="button" onClick={() => go("terms")}>기관용 콘솔에서 만들기 →</button></aside>
      </div>}
      {section === "controls" && <div className="landing-tab-panel controls-tab" role="tabpanel" aria-label="통제 체계 화면">
        <section><header><div><span>2인 승인 대기열</span><strong>자기 승인 차단</strong></div><b>2건 대기</b></header>{[["시스템 캐리 v12","박지훈 제출","리스크 책임자"],["ETH 평균회귀 v7","김서윤 제출","준법 책임자"]].map((item,index) => <article key={item[0]}><i>{String(index+1).padStart(2,"0")}</i><div><strong>{item[0]}</strong><small>{item[1]}</small></div><span>{item[2]}</span><b>검토 대기</b></article>)}</section>
        <aside><header><span>주문 전 위험검사</span><b>정책 v6</b></header>{[["총 익스포저","62.4 / 80%","통과"],["단일 자산 집중도","31.2 / 40%","통과"],["거래소 집중도","58.0 / 65%","주의"],["일일 손실","0.7 / 3%","통과"]].map((item) => <div key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><b className={item[2] === "주의" ? "watch" : "pass"}>{item[2]}</b></div>)}</aside>
      </div>}
      {section === "security" && <div className="landing-tab-panel security-tab" role="tabpanel" aria-label="보안 화면">
        <section><header><span>비밀정보 경계</span><b>비수탁형</b></header>{[["거래소 키","브라우저 저장 금지","KMS 연결 전 잠금"],["출금 권한","허용하지 않음","서버 차단"],["주문 실행","공개 화면 접근 금지","내부 큐 전용"],["재인증","민감 변경 전 필수","연동 대기"]].map((item,index) => <article key={item[0]}><i>{String(index+1).padStart(2,"0")}</i><div><strong>{item[0]}</strong><small>{item[1]}</small></div><b>{item[2]}</b></article>)}</section>
        <aside><header><span>감사 원장</span><b>해시 체인</b></header>{[["11:31:44","위험검사","주문 의도 통과","9d1c…4af2"],["11:28:09","승인 요청","전략 v12 제출","46ac…83b0"],["11:24:17","대사 예외","ETH 시각 불일치","203f…fa12"]].map((item) => <div key={item[0]}><time>{item[0]}</time><span><strong>{item[1]}</strong><small>{item[2]}</small></span><code>{item[3]}</code></div>)}</aside>
      </div>}
    </section>}
    <section className="bt-control-principle">
      <div><span>운영 원칙</span><h2>실거래는 API 키가 아니라<br />통제 충족으로 열립니다.</h2></div>
      <ol><li><b>01</b>승인된 계정과 전략 버전</li><li><b>02</b>운용·리스크 담당자 독립 승인</li><li><b>03</b>모의·섀도 운용과 정상 대사</li><li><b>04</b>비상 중단과 재인증 검증</li></ol>
    </section>
    <footer className="institutional-footer bt-public-footer"><Logo /><p>현재 공개 버전은 기관 워크플로를 검증하는 모의 환경이며 실제 거래·수탁·수익 보장을 제공하지 않습니다.</p><a href="/mobile">모바일 통제 앱 →</a></footer>
  </main>;
}

function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="auth-screen"><div className="auth-accent" />{children}</main>;
}

function Login({ go, notify, enterDemo }: { go: (screen: Screen) => void; notify: (message: string) => void; enterDemo: () => void }) {
  if (process.env.NODE_ENV === "production") {
    return <InstitutionalSignIn go={go} />;
  }
  return <DevelopmentLogin go={go} notify={notify} enterDemo={enterDemo} />;
}

function InstitutionalSignIn({ go }: { go: (screen: Screen) => void }) {
  return <AuthLayout><section className="auth-card compact institutional-signin">
      <Logo large />
      <span className="auth-security-label">기관 인증</span>
      <h1>승인된 계정으로 접속</h1>
      <p>BlockTrade는 비밀번호를 직접 수집하지 않습니다. ChatGPT 계정 인증이 완료된 사용자만 기관 콘솔과 서버 원장에 접근할 수 있습니다.</p>
      <a className="btn primary wide" href="/signin-with-chatgpt?return_to=/?console=1">ChatGPT 계정으로 계속</a>
      <dl><div><dt>브라우저 비밀번호 저장</dt><dd>사용하지 않음</dd></div><div><dt>기관 데이터 접근</dt><dd>서버 권한 검사</dd></div><div><dt>실거래 권한</dt><dd>차단 유지</dd></div></dl>
      <button type="button" className="btn secondary wide" onClick={() => go("landing")}>공개 화면으로 돌아가기</button>
    </section></AuthLayout>;
}

function DevelopmentLogin({ go, notify, enterDemo }: { go: (screen: Screen) => void; notify: (message: string) => void; enterDemo: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      notify("이메일과 8자 이상 비밀번호를 확인해주세요");
      return;
    }
    setPassword("");
    notify("데모 계정으로 로그인했습니다");
    enterDemo();
  };
  return <AuthLayout><form className="auth-card compact" onSubmit={submit}>
    <Logo large />
    <h1>다시 오셨군요!</h1><p>계정에 로그인하세요</p>
    <label>이메일<input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" /></label>
    <label>비밀번호<button type="button" className="label-action" aria-label="비밀번호 찾기" onClick={() => notify("비밀번호 재설정 안내를 이메일로 보냈습니다")}>비밀번호 찾기</button><input aria-label="비밀번호" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" autoComplete="current-password" /></label>
    <button className="btn primary wide" type="submit">로그인</button>
    <div className="divider"><span>또는</span></div>
    <div className="social-row"><button type="button" className="btn secondary" onClick={() => { notify("카카오 데모 로그인 완료"); enterDemo(); }}>K　카카오로 로그인</button><button type="button" className="btn secondary" onClick={() => { notify("구글 데모 로그인 완료"); enterDemo(); }}>G　구글로 로그인</button></div>
    <p className="auth-switch">계정이 없으신가요? <button type="button" onClick={() => go("terms")}>회원가입</button></p>
  </form></AuthLayout>;
}

function Terms({ go }: { go: (screen: Screen) => void }) {
  const required = ["서비스 이용약관", "개인정보 처리방침", "투자 위험 고지", "전자금융거래 이용약관"];
  const optional = ["마케팅 정보 수신 동의", "제3자 정보 제공"];
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState("");
  const allRequired = required.every((item) => checked[item]);
  const toggleAll = () => {
    const next = ![...required, ...optional].every((item) => checked[item]);
    setChecked(Object.fromEntries([...required, ...optional].map((item) => [item, next])));
  };
  return <AuthLayout><section className="terms-card">
    <Logo large /><h1>시작하기 전 약관에 동의해주세요</h1><p>BlockTrade는 사용자 자산을 직접 보관하지 않으며,<br />거래소 API를 통해 매매를 자동화합니다</p>
    <button type="button" className="agreement all" aria-pressed={[...required, ...optional].every((item) => checked[item])} onClick={toggleAll}><Check checked={[...required, ...optional].every((item) => checked[item])} /><strong>전체 동의 (선택 항목 포함)</strong></button>
    <div className="agreement-list">
      {required.map((item) => <div className="agreement" key={item}><button type="button" className="agreement-check" aria-pressed={!!checked[item]} onClick={() => setChecked((state) => ({ ...state, [item]: !state[item] }))}><Check checked={!!checked[item]} /><span><strong>[필수] {item}</strong><small>{item.includes("위험") ? "필수 · 손실 가능성" : "필수"}</small></span></button><button type="button" className="agreement-view" onClick={() => setDetail(item)}>보기 ›</button></div>)}
      {optional.map((item) => <div className="agreement" key={item}><button type="button" className="agreement-check" aria-pressed={!!checked[item]} onClick={() => setChecked((state) => ({ ...state, [item]: !state[item] }))}><Check checked={!!checked[item]} /><span><strong>[선택] {item}</strong><small>선택</small></span></button><button type="button" className="agreement-view" onClick={() => setDetail(item)}>보기 ›</button></div>)}
    </div>
    {detail && <div className="terms-detail" role="dialog" aria-label={`${detail} 상세`}><strong>{detail}</strong><p>현재 프로토타입용 요약입니다. 실제 출시 전 법률 검토를 거친 전문과 시행일을 연결해야 합니다.</p><button type="button" onClick={() => setDetail("")}>닫기</button></div>}
    <button type="button" className="btn primary wide" disabled={!allRequired} onClick={() => go("risk")}>동의하고 시작하기 →</button>
  </section></AuthLayout>;
}

function Check({ checked }: { checked: boolean }) { return <i aria-hidden="true" className={checked ? "check checked" : "check"} />; }

function RiskDisclosure({ go }: { go: (screen: Screen) => void }) {
  const [understood, setUnderstood] = useState(false);
  const [phrase, setPhrase] = useState("");
  const risks = [
    ["01", "원금 손실 가능성", "가상자산은 가격 변동성이 매우 크며, 자동매매 결과 손실이 발생할 수 있어요."],
    ["02", "알고리즘 한계", "백테스팅은 과거 데이터 기반 시뮬레이션이며 미래 수익률을 보장하지 않아요."],
    ["03", "시스템 / 거래소 리스크", "API 응답 지연, 거래소 점검 등으로 의도치 않은 체결이 발생할 수 있어요."],
  ];
  return <AuthLayout><section className="risk-card">
    <header><span>위험</span><div><b>반드시 읽어주세요</b><h1>투자 손실 가능성 고지</h1></div></header>
    <div className="risk-list">{risks.map((risk) => <article key={risk[0]}><label>{risk[0]}</label><strong>{risk[1]}</strong><p>{risk[2]}</p></article>)}</div>
    <button type="button" className="understand" aria-pressed={understood} onClick={() => setUnderstood(!understood)}><Check checked={understood} /><span><strong>위 내용을 모두 이해했습니다</strong><small>(자필 입력 권장: ‘이해했습니다’)</small></span></button>
    <input className="risk-input" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="이해했습니다" aria-label="위험 고지 확인 문구" />
    <button type="button" className="btn primary wide" disabled={!understood || phrase.trim() !== "이해했습니다"} onClick={() => go("signup")}>동의하고 계속</button>
  </section></AuthLayout>;
}

function Signup({ go, notify }: { go: (screen: Screen) => void; notify: (message: string) => void }) {
  const [form, setForm] = useState({ nickname: "", email: "", password: "", confirm: "" });
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((state) => ({ ...state, [field]: event.target.value }));
  const valid = form.nickname.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(form.email) && form.password.length >= 8 && form.password === form.confirm;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) { notify("입력 내용을 다시 확인해주세요"); return; }
    setForm((state) => ({ ...state, password: "", confirm: "" }));
    go("verify");
  };
  return <AuthLayout><form className="auth-card signup-card" onSubmit={submit}>
    <Logo large /><h1>계정 만들기</h1><p>무료로 시작하세요</p>
    <label>닉네임<input value={form.nickname} onChange={set("nickname")} placeholder="트레이더 닉네임" autoComplete="nickname" /></label>
    <label>이메일<input type="email" value={form.email} onChange={set("email")} placeholder="name@example.com" autoComplete="email" /></label>
    <label>비밀번호<input aria-label="비밀번호" type="password" value={form.password} onChange={set("password")} placeholder="8자 이상 입력" autoComplete="new-password" /><small className={form.password.length >= 8 ? "valid-text" : ""}>{form.password.length}/8자 · 영문/숫자 조합 권장</small></label>
    <label>비밀번호 확인<input aria-label="비밀번호 확인" type="password" value={form.confirm} onChange={set("confirm")} placeholder="비밀번호를 다시 입력" autoComplete="new-password" /></label>
    <button className="btn primary wide" type="submit" disabled={!valid}>회원가입</button>
    <p className="auth-switch">이미 계정이 있으신가요? <button type="button" onClick={() => go("login")}>로그인</button></p>
  </form></AuthLayout>;
}

function Verify({ go, notify }: { go: (screen: Screen) => void; notify: (message: string) => void }) {
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [carrier, setCarrier] = useState("SKT");
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const canSend = name.trim().length >= 2 && /^\d{8}$/.test(birth) && phone.replace(/\D/g, "").length >= 10;
  const sendCode = () => {
    if (!canSend) return;
    setSent(true);
    notify("데모 인증번호 123456을 발송했습니다");
  };
  const complete = () => {
    if (code !== "123456") { notify("인증번호를 확인해주세요"); return; }
    setCode("");
    notify("본인 인증을 완료했습니다");
    go("dashboard");
  };
  return <AuthLayout><section className="verify-card">
    <h1>본인 인증</h1><p>금융 서비스 이용을 위해 실명 확인이 필요합니다</p>
    <div className="steps"><b>1 <span>기본 정보</span></b><i /><span>2　휴대폰 인증</span><i /><span>3　완료</span></div>
    <label>성명<input value={name} onChange={(event) => setName(event.target.value)} placeholder="이름 입력" autoComplete="name" /></label>
    <label>생년월일<input inputMode="numeric" value={birth} onChange={(event) => setBirth(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="생년월일 8자리" autoComplete="bday" /></label>
    <div className="secure-note"><b>보안</b><span><strong>민감정보 최소 수집</strong>이 화면은 주민등록번호를 받지 않습니다. 실서비스 KYC는 인증기관의 보안 화면에서 처리해야 합니다.</span></div>
    <label>통신사 선택<div className="carrier-row">{["SKT", "KT", "LG U+", "알뜰폰"].map((item) => <button type="button" className={carrier === item ? "selected" : ""} aria-pressed={carrier === item} key={item} onClick={() => setCarrier(item)}>{item}</button>)}</div></label>
    <label>휴대폰 번호<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9-]/g, ""))} placeholder="010-1234-5678" autoComplete="tel" /></label>
    {!sent && <button type="button" className="btn primary wide" disabled={!canSend} onClick={sendCode}>인증번호 받기</button>}
    {sent && <><label>인증번호<input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="데모 번호 123456" autoComplete="one-time-code" /></label><div className="verify-actions"><button type="button" className="btn secondary" onClick={sendCode}>재전송</button><button type="button" className="btn primary" disabled={code.length !== 6} onClick={complete}>인증 완료</button></div></>}
  </section></AuthLayout>;
}

function ApiSetup({ go, notify, backTo }: { go: (screen: Screen) => void; notify: (message: string) => void; backTo: Screen }) {
  const [accountLabel, setAccountLabel] = useState("");
  const [readiness, setReadiness] = useState<ExchangeReadiness | null>(null);
  useEffect(() => {
    if (typeof fetch !== "function") return;
    const controller = new AbortController();
    fetch("/api/integrations/exchange", { headers:{ Accept:"application/json" }, cache:"no-store", signal:controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<ExchangeReadiness> : null)
      .then((payload) => { if (payload?.mode) setReadiness(payload); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const finish = () => {
    if (accountLabel.trim().length < 3) { notify("법인 거래소 계정 이름을 3자 이상 입력해주세요"); return; }
    notify("보안 저장소 연동이 준비되면 관리자에게 읽기 전용 연결 요청이 전달됩니다. 이 화면에는 API 키를 입력하지 않습니다.");
  };
  return <main className="api-screen">
    <section className="api-card">
      <button type="button" className="back-link" onClick={() => go(backTo)}>← 뒤로</button>
      <h1>법인 거래소 읽기 전용 연결</h1><p>거래소 API 키는 이 화면에 입력하지 않습니다. 실제 연결은 서버 보안 저장소가 준비된 뒤, 승인된 관리자 절차로만 진행합니다.</p>
      <label>지원 준비 상태</label>
      <div className="exchange-row">{[["업비트","읽기 전용 대사","U",true],["빗썸","준비 중","B",false],["바이낸스","준비 중","BN",false]].map((item) => <button type="button" className={item[3] ? "selected" : "coming-soon"} aria-pressed={item[3] ? true : undefined} disabled={!item[3]} key={String(item[0])}><i>{item[2]}</i><strong>{item[0]}</strong><small>{item[1]}</small></button>)}</div>
      <label>연결 요청 정보</label>
      <div className="key-row"><span>1</span><label>법인 계정 이름<input value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} placeholder="예: BlockTrade 운영계정 01" autoComplete="off" /></label></div>
      <div className="key-row"><span>2</span><label>실제 키 등록 위치<input value="KMS 연동 후 열리는 별도 보안 등록창" readOnly aria-readonly="true" /></label></div>
      <div className="key-row"><span>3</span><label>필요 권한<input value="잔고 · 주문내역 · 체결내역 읽기 전용" readOnly aria-readonly="true" /></label></div>
      <div className="api-warning"><b>현재 차단</b><span><strong>지금은 API 키를 입력할 곳이 없습니다</strong>현재 버전에는 실제 KMS/Vault가 아직 연결되지 않아 키 보관소가 없습니다. KMS 연동이 끝난 뒤에만 별도 보안 등록창에서 API 키를 1회 입력하고, 서버 보안 저장소가 암호화해 보관합니다.</span></div>
      <div className={`integration-readiness ${readiness?.liveReady ? "live" : "demo"}`}><span>{readiness?.liveReady ? "준비" : "잠금"}</span><div><strong>{readiness?.liveReady ? "운영자 승인 게이트 충족" : "모의 운영으로 잠금됨"}</strong><p>{readiness?.liveReady ? "키·운영자 스위치·승인 계정이 확인됐습니다. 주문은 내부 안전 실행기만 요청할 수 있습니다." : `키 외에도 사용자별 보안 저장소, 운영자 승인, 승인 계정이 필요합니다. 현재 차단 조건 ${readiness?.liveBlockers?.length ?? 3}개.`}</p></div><b>외부 주문 차단</b></div>
      <button type="button" className="btn primary wide" onClick={finish}>읽기 전용 연결 준비 요청</button>
      <button type="button" className="text-link center" onClick={() => go(backTo)}>등록하지 않고 돌아가기</button>
    </section>
  </main>;
}

function AppHeader({ screen, go, dark, setDark, profile }: { screen: Screen; go: (screen: Screen) => void; dark: boolean; setDark: (value: boolean) => void; profile: Profile }) {
  return <header className="app-header institutional-header"><button type="button" className="header-logo" onClick={() => go("dashboard")} aria-label="대시보드로 이동"><Logo /></button><nav aria-label="웹 주요 메뉴">{PRIMARY_NAV.map((item) => <button type="button" className={screen === item.id ? "active" : ""} aria-label={item.id === "operations" ? "운영센터" : item.id === "builder" ? "전략 빌더" : item.id === "market" ? "전략 마켓" : undefined} aria-current={screen === item.id ? "page" : undefined} key={item.id} onClick={() => go(item.id)}>{item.label}</button>)}</nav><div className="header-actions"><span className="mode-chip">모의</span><button type="button" onClick={() => setDark(!dark)}>{dark ? "라이트" : "다크"}</button><button type="button" className={screen === "settings" ? "active" : ""} aria-label="설정" onClick={() => go("settings")}>관리</button><button type="button" className="user-chip" onClick={() => go("profile")} aria-label="프로필 편집">{profile.nickname.slice(0, 2)}</button></div></header>;
}

function AppSidebar({ screen, go, openApi, unreadCount }: { screen: Screen; go: (screen: Screen) => void; openApi: (returnTo: Screen) => void; unreadCount: number }) {
  const navigate = (next: Screen) => next === "api" ? openApi("dashboard") : go(next);
  return <aside className="app-sidebar institutional-sidebar"><label>투자 운용</label>{SIDEBAR_NAV.slice(0,5).map((item) => <button type="button" className={screen === item.id ? "active" : ""} aria-label={item.id === "builder" ? "전략 빌더" : undefined} key={item.id} onClick={() => navigate(item.id)}><i>{item.icon}</i>{item.label}</button>)}<label>감독·관리</label>{SIDEBAR_NAV.slice(5).map((item) => <button type="button" className={screen === item.id ? "active" : ""} aria-label={item.id === "notifications" ? "알림" : item.id === "settings" ? "설정" : undefined} key={item.id} onClick={() => navigate(item.id)}><i>{item.icon}</i>{item.label}{item.id === "notifications" && unreadCount > 0 && <em>{unreadCount}</em>}</button>)}</aside>;
}

function BottomNav({ screen, go }: { screen: Screen; go: (screen: Screen) => void }) {
  return <nav className="bottom-nav" aria-label="태블릿 주요 메뉴">{SIDEBAR_NAV.slice(0,5).map((item) => <button type="button" className={screen === item.id ? "active" : ""} aria-current={screen === item.id ? "page" : undefined} key={item.id} onClick={() => go(item.id)}><i>{item.icon}</i><span>{item.label.replace("자산 ", "")}</span></button>)}</nav>;
}

function PageTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <header className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>;
}

function Dashboard({ go, connected, demoMode, enterDemo, openApi }: { go: (screen: Screen) => void; connected: boolean; demoMode: boolean; enterDemo: () => void; openApi: (returnTo: Screen) => void }) {
  if (!connected && !demoMode) return <div className="product-page dashboard-page empty-dashboard">
    <PageTitle title="모의 운영을 시작할 준비가 됐어요" subtitle="전략을 만들고 예시 결과와 데모 상태 변화를 먼저 확인하세요" />
    <section className="onboarding-panel panel"><div className="onboarding-icon">BT</div><h2>안전한 순서로 시작해볼까요?</h2><p>전략 생성 → 예시 백테스트 → 모의 위험 설정 → 데모 운영 순서로 진행합니다.</p><ol><li><b>1</b><span><strong>전략 만들기</strong>코딩 없이 조건과 액션을 조립해요</span></li><li><b>2</b><span><strong>예시 결과 확인</strong>현재는 실제 시세 백테스트가 아닌 설계 화면이에요</span></li><li><b>3</b><span><strong>모의 운영</strong>실제 주문 없이 상태 변경과 안전 제어를 확인해요</span></li></ol><div className="onboarding-actions"><button type="button" className="btn primary" onClick={() => go("builder")}>첫 전략 만들기</button><button type="button" className="btn secondary" onClick={enterDemo}>예시 데이터 둘러보기</button><button type="button" className="text-link" onClick={() => openApi("dashboard")}>거래소 연결 준비 확인</button></div></section>
  </div>;
  return <div className="product-page dashboard-page institutional-dashboard">
    <PageTitle title="펀드 현황" subtitle="PAPER 펀드 · 실제 운용 판단에 사용할 수 없는 예시 데이터" action={<div className="inline-actions"><span className="asof-chip">샘플 기준 2026-07-25 11:32 UTC</span>{demoMode && <button type="button" className="btn secondary" onClick={() => openApi("dashboard")}>연동 준비도</button>}</div>} />
    <section className="data-provenance-strip" aria-label="모의 데이터 출처">
      <strong>PAPER · 의사결정 금지</strong>
      <dl><div><dt>출처</dt><dd>고정 샘플 스냅샷</dd></div><div><dt>계산</dt><dd>UI 검증용 모의 원장</dd></div><div><dt>대사</dt><dd>샘플 체결 11:30 UTC</dd></div></dl>
      <b>외부 주문 0건 · 실거래 전송 차단</b>
    </section>
    <section className="institutional-status-strip"><span><i /> 모의 환경 정상</span><p>샘플 지연 218ms</p><p>모의 위험검사 활성</p><p>최근 샘플 대사 11:30</p><b>실거래 게이트 잠금</b></section>
    <section className="institutional-kpis">
      <article><label>순자산가치 <em>PAPER</em></label><strong>₩4,823,100,000</strong><p className="positive">샘플 금일 +0.78%</p></article>
      <article><label>일일 손익 <em>PAPER</em></label><strong className="positive">+₩37,420,000</strong><p>샘플 월 누계 +4.32%</p></article>
      <article><label>총 / 순 익스포저 <em>PAPER</em></label><strong>62.4% <small>/ 18.7%</small></strong><p>모의 총 한도 80%</p></article>
      <article><label>사용 가능 위험자본 <em>PAPER</em></label><strong>₩1,438,000,000</strong><p>샘플 순자산가치의 29.8%</p></article>
      <article><label>현금성 자산 <em>PAPER</em></label><strong>₩1,246,000,000</strong><p>샘플 순자산가치의 25.8%</p></article>
      <article className="attention"><label>미해결 대사 <em>예시</em></label><strong>1건</strong><p>모의 SLA 18분 남음</p></article>
    </section>
    <section className="institutional-dashboard-grid">
      <article className="panel institutional-positions">
        <div className="panel-header"><div><h2>PAPER 펀드 보유 현황</h2><p>고정 샘플 원장에 있는 PAPER 보유분만 표시합니다</p></div><button type="button" className="table-action" aria-label="모의 주문 7건 보기" onClick={() => go("transactions")}>모의 주문 7건 보기</button></div>
        <div className="institutional-table-wrap"><table><thead><tr><th>상품</th><th>전략</th><th>포지션</th><th>평가금액</th><th>24시간 손익</th><th>총 비중</th><th>상태</th></tr></thead><tbody>{[
          ["BTC / KRW","시스템 캐리 v12","0.182 BTC","₩21.2억","+₩2,430만","31.2%","ACTIVE"],
          ["ETH / KRW","평균회귀 v7","1.93 ETH","₩15.4억","-₩810만","18.6%","ACTIVE"],
          ["SOL / KRW","모멘텀 바스켓 v4","12.5 SOL","₩6.43억","+₩680만","8.9%","REVIEW"],
          ["XRP / KRW","유동성 슬리브 v3","820 XRP","₩5.20억","+₩140만","3.7%","ACTIVE"],
        ].map((row) => <tr key={row[0]}>{row.map((cell,index) => <td data-label={["상품","전략","포지션","평가금액","24시간 손익","총 비중","상태"][index]} className={index === 4 ? (cell.startsWith("+") ? "positive" : "negative") : ""} key={cell}>{index === 0 ? <b>{cell}</b> : index === 6 ? <span className={`institutional-state ${cell.toLowerCase()}`}>{cell === "ACTIVE" ? "PAPER 운용" : "PAPER 검토"}</span> : cell}</td>)}</tr>)}</tbody></table></div>
      </article>
      <aside className="institutional-side-stack">
        <section className="panel approval-panel"><header><div><h2>모의 승인 대기열</h2><p>작성·승인 분리 통제 예시</p></div><span>대기 2건</span></header><button type="button" onClick={() => go("control")}><i>전략</i><div><strong>시스템 캐리 v12</strong><small>박지훈 제출 · 리스크팀 담당 · SLA 27분</small></div><em>검토</em></button><button type="button" onClick={() => go("control")}><i>운영</i><div><strong>ETH 평균회귀 v7</strong><small>김서윤 제출 · 운용통제 담당 · SLA 42분</small></div><em>검토</em></button><footer><button type="button" onClick={() => go("control")}>통제센터 열기 →</button></footer></section>
        <section className="panel reconciliation-panel"><header><div><h2>샘플 원장 대사</h2><p>모의 원장과 고정 샘플 체결 비교</p></div><b>예외 1건</b></header><dl><div><dt>모의 주문 일치</dt><dd>124 / 124</dd></div><div><dt>모의 체결 일치</dt><dd>121 / 122</dd></div><div><dt>샘플 잔고 점검</dt><dd>4 / 4</dd></div></dl><button type="button" onClick={() => go("control")}><span><i>예외</i>ETH 샘플 체결 시각 불일치</span><b>조사하기 →</b></button></section>
      </aside>
    </section>
    <section className="institutional-bottom-grid">
      <article className="panel risk-utilization"><div className="panel-header"><div><h2>리스크 한도 사용률</h2><p>승인 한도 대비 현재 사용량</p></div><button type="button" onClick={() => go("control")}>정책 BT-RISK-04</button></div>{[["총 익스포저","62.4%","80.0%",78],["단일 자산 집중도","31.2%","40.0%",78],["일일 손실","0.7%","3.0%",23],["거래소 집중도","58.0%","65.0%",89]].map((item) => <div className="risk-utilization-row" key={item[0]}><span>{item[0]}</span><b>{item[1]} <small>/ {item[2]}</small></b><i><b className={Number(item[3]) > 85 ? "warning" : ""} style={{width:`${item[3]}%`}} /></i></div>)}</article>
      <article className="panel institutional-activity"><div className="panel-header"><div><h2>통제 활동</h2><p>변경 불가능한 증적 미리보기</p></div><button type="button" onClick={() => go("notifications")}>전체 알림</button></div>{[
        ["11:31:44","위험검사","주문 의도가 사전 통제 12개를 모두 통과했습니다","OK"],
        ["11:28:09","승인","전략 v12가 독립 검토에 제출됐습니다","PENDING"],
        ["11:24:17","대사","ETH 체결 시각 예외가 생성됐습니다","REVIEW"],
        ["11:20:02","시스템","모의 비상중단 장치의 상태 신호를 확인했습니다","OK"],
      ].map((row) => <div key={row[0]}><time>{row[0]}</time><span>{row[1]}</span><p>{row[2]}</p><b className={row[3].toLowerCase()}>{row[3] === "OK" ? "정상" : row[3] === "PENDING" ? "대기" : "검토"}</b></div>)}</article>
    </section>
  </div>;
}

function InstitutionalControlCenter({ go }: { go: (screen: Screen) => void }) {
  const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<"loading" | "synced" | "error">("loading");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeControlStatus | null>(null);
  const [runtimeState, setRuntimeState] = useState<"loading" | "synced" | "error">("loading");
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadControlPlaneSnapshot(controller.signal)
      .then(async (next) => {
        setSnapshot(next);
        setConnectionState("synced");
        try {
          const runtime = await loadRuntimeStatus(controller.signal);
          setRuntimeStatus(runtime);
          setRuntimeState("synced");
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setRuntimeState("error");
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setConnectionState("error");
        setRuntimeState("error");
      });
    return () => controller.abort();
  }, [reloadToken]);
  const policy = snapshot?.riskPolicy;
  const controls = [
    ["총 익스포저","62.4%",`${policy?.maxGrossExposurePct ?? 80}%`,"PASS"],
    ["단일 자산 집중도","31.2%",`${policy?.maxAssetConcentrationPct ?? 40}%`,"PASS"],
    ["일일 손실","0.7%",`${policy?.maxDailyLossPct ?? 3}%`,"PASS"],
    ["거래소 집중도","58.0%",`${policy?.maxExchangeConcentrationPct ?? 65}%`,"WATCH"],
    ["주문 최대 금액","₩4,230만",`₩${((policy?.maxOrderKrw ?? 100_000_000)/10_000).toLocaleString("ko-KR")}만`,"PASS"],
  ];
  const pending = snapshot?.approvals.filter((item) => item.status === "pending") ?? [];
  const gates = snapshot?.liveGates ?? [];
  const readyCount = gates.filter((gate) => gate.ready).length;
  const openExceptions = snapshot?.reconciliationExceptions.filter((item) => item.status !== "resolved") ?? [];
  const eventLabel = (event: string) => ({ institution_initialized:"기관 초기화", strategy_version_created:"전략 버전 생성", strategy_approval_requested:"승인 요청", strategy_approved:"전략 승인", strategy_rejected:"전략 거절", reconciliation_resolved:"대사 해결", shadow_template_registered:"섀도 템플릿 등록", shadow_deployment_created:"섀도 배포 생성", shadow_cycle_completed:"섀도 주기 완료" }[event] ?? event);
  const runtimeItems = [
    {
      label: "기관 인증",
      value: runtimeStatus?.authentication.productionIdentity ? "실제 인증" : runtimeState === "synced" ? "개발 인증" : "확인 중",
      ready: runtimeStatus?.authentication.productionIdentity ?? false,
      note: runtimeStatus?.authentication.provider === "sign_in_with_chatgpt" ? "ChatGPT 계정 서명" : runtimeStatus?.authentication.provider === "cloudflare_access" ? "Cloudflare Access" : "운영 인증 필요",
    },
    {
      label: "연속 스케줄러",
      value: runtimeStatus?.scheduler.state === "active" ? "정상" : runtimeStatus?.scheduler.state === "stale" ? "지연" : "기동 전",
      ready: runtimeStatus?.scheduler.state === "active",
      note: runtimeStatus?.scheduler.lastCompletedAt ? new Date(runtimeStatus.scheduler.lastCompletedAt).toLocaleString("ko-KR") : "첫 서버 주기 대기",
    },
    {
      label: "내구성 실행 큐",
      value: runtimeStatus ? `대기 ${runtimeStatus.queue.pending + runtimeStatus.queue.retryWait} · 격리 ${runtimeStatus.queue.quarantined}` : "확인 중",
      ready: runtimeStatus ? runtimeStatus.queue.quarantined === 0 : false,
      note: runtimeStatus ? `처리 ${runtimeStatus.queue.succeeded} · 임대 ${runtimeStatus.queue.leased}` : "서버 원장 확인",
    },
    {
      label: "KMS/Vault 브로커",
      value: runtimeStatus?.secretBroker.ready ? "연결 준비" : "외부 설정 필요",
      ready: runtimeStatus?.secretBroker.ready ?? false,
      note: "평문 키 저장 금지",
    },
    {
      label: "법인 계정 읽기 전용 대사",
      value: runtimeStatus?.exchangeReconciliation.activeConnections ? `활성 ${runtimeStatus.exchangeReconciliation.activeConnections}개` : "승인 계정 없음",
      ready: Boolean(runtimeStatus?.exchangeReconciliation.activeConnections && runtimeStatus.exchangeReconciliation.lastStatus === "observed"),
      note: runtimeStatus?.exchangeReconciliation.lastRunAt ? `최근 ${new Date(runtimeStatus.exchangeReconciliation.lastRunAt).toLocaleString("ko-KR")}` : "거래·출금 권한 없음",
    },
  ];
  const operatingModeLabel = snapshot?.institution.operatingMode === "live"
    ? "실거래"
    : snapshot?.institution.operatingMode === "shadow"
      ? "섀도 운용"
      : snapshot
        ? "모의 운용"
        : "확인 중";
  const runtimeWarningCount = runtimeItems.filter((item) => !item.ready).length;
  const controlSummary = [
    {
      label: "운영 모드",
      value: operatingModeLabel,
      note: snapshot?.institution.operatingMode === "live" ? "승인된 실거래 환경" : "외부 주문 차단",
      tone: snapshot?.institution.operatingMode === "live" ? "critical" : "neutral",
    },
    {
      label: "총 익스포저",
      value: "62.4%",
      note: `모의 계측 · 한도 ${policy?.maxGrossExposurePct ?? 80}%`,
      tone: "normal",
    },
    {
      label: "일일 손실",
      value: "0.7%",
      note: `모의 계측 · 한도 ${policy?.maxDailyLossPct ?? 3}%`,
      tone: "normal",
    },
    {
      label: "승인 대기",
      value: `${pending.length}건`,
      note: pending.length ? "독립 검토 필요" : "미처리 요청 없음",
      tone: pending.length ? "warning" : "normal",
    },
    {
      label: "미해결 대사",
      value: `${openExceptions.length}건`,
      note: openExceptions.length ? "담당자 조치 필요" : "미해결 예외 없음",
      tone: openExceptions.length ? "critical" : "normal",
    },
    {
      label: "런타임 경고",
      value: `${runtimeWarningCount}건`,
      note: runtimeState === "synced" ? "외부 연결 포함" : "서버 상태 확인 중",
      tone: runtimeWarningCount ? "warning" : "normal",
    },
  ];
  return <div className="product-page institutional-control-page">
    <PageTitle title="리스크·통제센터" subtitle="2인 승인, 실거래 준비도, 위험 한도와 대사 증적을 관리합니다" action={<div className="inline-actions control-toolbar"><span className="control-policy-chip">{policy ? `정책 v${policy.version} · 서버 원장` : "정책 상태 확인 중"}</span><button type="button" className="btn secondary" onClick={() => go("settings")}>정책 관리</button><button type="button" className="btn danger" onClick={() => go("operations")}>긴급 통제 열기</button>{connectionState === "error" && <button type="button" className="btn secondary" onClick={() => { setConnectionState("loading"); setReloadToken((value) => value+1); }}>다시 연결</button>}</div>} />
    <section className={`control-data-status ${connectionState}`}><i /><span>{connectionState === "synced" ? `${snapshot?.institution.name} · ${ROLE_LABELS[snapshot!.currentMember.role]} 권한` : connectionState === "loading" ? "기관 통제 원장을 확인하고 있습니다" : "기관 통제 원장을 불러오지 못해 변경 기능을 잠갔습니다"}</span><b>{connectionState === "synced" ? "서버 동기화" : connectionState === "loading" ? "확인 중" : "안전 잠금"}</b></section>
    <section className="control-summary-grid" aria-label="리스크 통제 핵심 상태">
      {controlSummary.map((item) => <article className={`panel ${item.tone}`} key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></article>)}
    </section>
    <section className="control-readiness"><div><span>실거래 준비도</span><strong>통제 {gates.length || 10}개 중 {readyCount}개 충족</strong><p>실거래 게이트는 모든 내부·외부 통제가 검증되기 전까지 잠겨 있습니다.</p></div><i><b style={{width:`${gates.length ? Math.round(readyCount/gates.length*100) : 0}%`}} /></i><b>게이트웨이 잠금</b></section>
    <section className={`panel institutional-runtime ${runtimeState}`}>
      <header><div><h2>기관 런타임 기반</h2><p>연속 실행·장애 복구·비밀정보·법인 계정 대사를 실제 서버 상태로 확인합니다.</p></div><span>{runtimeState === "synced" ? "서버 증적" : runtimeState === "error" ? "안전 잠금" : "확인 중"}</span></header>
      <div>{runtimeItems.map((item) => <article key={item.label}><i className={item.ready ? "ready" : ""}>{item.ready ? "완료" : "대기"}</i><span><strong>{item.label}</strong><small>{item.note}</small></span><b>{item.value}</b></article>)}</div>
      <footer><span>실거래 주문 권한</span><strong>차단 유지</strong><p>이 기반의 장기 검증과 외부 승인이 끝날 때까지 거래소 주문은 열리지 않습니다.</p></footer>
    </section>
    <section className="control-grid">
      <article className="panel control-approvals"><header><div><h2>2인 승인 대기열</h2><p>작성자는 자신의 변경을 승인할 수 없습니다.</p></div><span>대기 {pending.length}건</span></header>{pending.map((approval) => { const version = snapshot?.strategyVersions.find((item) => item.id === approval.strategyVersionId); const author = snapshot?.members.find((item) => item.memberKey === approval.requestedBy); const selfAuthored = snapshot?.currentMember.memberKey === approval.requestedBy; return <section key={approval.id}><div><small>{approval.id.slice(0,18)}</small><h3>{version ? `${version.name} v${version.version}` : "전략 버전"}</h3><p>{version?.source === "ai" ? "AI 초안" : "수동 초안"} · 작성자 {author?.displayName ?? approval.requestedBy}</p></div><span><small>필수 승인 역할</small><b>{ROLE_LABELS[approval.requiredRole]}</b></span><button type="button" disabled={selfAuthored} title={selfAuthored ? "자신이 제출한 변경은 승인할 수 없습니다" : undefined} onClick={() => go("builder")}>{selfAuthored ? "자기 승인 차단" : "검토 증적 보기 →"}</button></section>; })}{connectionState === "synced" && pending.length === 0 && <div className="control-empty">대기 중인 승인 요청이 없습니다.</div>}{connectionState !== "synced" && <div className="control-empty">동기화 전에는 승인 데이터를 표시하지 않습니다.</div>}</article>
      <aside className="panel live-gates"><header><h2>실거래 전환 게이트</h2><span>차단 조건 {gates.filter((gate) => !gate.ready).length || 10}개</span></header>{gates.length ? gates.map((gate) => <div key={gate.code}><i className={gate.ready ? "ready" : ""}>{gate.ready ? "완료" : "대기"}</i><span>{gate.label}</span><b>{gate.ready ? "검증 완료" : gate.external ? "외부 필요" : "미충족"}</b></div>) : <div className="gate-loading"><i>대기</i><span>원장 동기화 후 조건을 표시합니다</span><b>잠금</b></div>}</aside>
    </section>
    <section className="control-grid lower">
      <article className="panel limit-matrix"><div className="panel-header"><div><h2>주문 전 한도 매트릭스</h2><p>모든 주문 의도가 통과해야 하는 서버측 정책</p></div><button type="button" onClick={() => go("settings")}>정책 관리</button></div><table><thead><tr><th>통제 항목</th><th>현재값</th><th>한도</th><th>결과</th></tr></thead><tbody>{controls.map((row) => <tr key={row[0]}><td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td><td><span className={row[3].toLowerCase()}>{row[3] === "PASS" ? "통과" : "주의"}</span></td></tr>)}</tbody></table></article>
      <aside className="panel control-exceptions"><header><div><h2>대사 예외</h2><p>담당자 지정과 해결 증적이 필요합니다</p></div><span>미해결 {openExceptions.length}건</span></header>{openExceptions.slice(0,1).map((item) => <article key={item.id}><div><i>예외</i><span><small>{item.id.slice(0,18)}</small><strong>{item.kind === "fill" ? "체결 대사 불일치" : "대사 예외"}</strong></span></div><p>{item.summary}</p><dl><div><dt>담당</dt><dd>{ROLE_LABELS[item.assignedRole]}</dd></div><div><dt>상태</dt><dd>{item.status === "investigating" ? "조사 중" : "미해결"}</dd></div><div><dt>심각도</dt><dd>{item.severity === "critical" ? "치명" : item.severity === "high" ? "높음" : item.severity === "medium" ? "중간" : "낮음"}</dd></div></dl><button type="button" onClick={() => go("operations")}>주문관리 증적 열기 →</button></article>)}{connectionState === "synced" && openExceptions.length === 0 && <div className="control-empty">미해결 대사 예외가 없습니다.</div>}</aside>
    </section>
    <section className="panel audit-stream"><div className="panel-header"><div><h2>감사 증적 스트림</h2><p>승인·정책·주문·시스템 사건의 추가 전용 해시 원장</p></div><span>{connectionState === "synced" ? "해시 체인 기록" : "원장 확인 중"}</span></div>{snapshot?.auditEvents.slice(0,5).map((event) => <div key={event.id}><span>{new Date(event.createdAt).toLocaleTimeString("ko-KR",{hour12:false})}</span><span>{eventLabel(event.eventType)}</span><span>{event.objectType} · {event.objectId.slice(0,18)}</span><span>{snapshot.members.find((member) => member.memberKey === event.actorKey)?.displayName ?? event.actorKey}</span><span className="hash">{event.eventHash.slice(0,8)}…{event.eventHash.slice(-4)}</span></div>)}{connectionState === "synced" && !snapshot?.auditEvents.length && <div className="control-empty">아직 기록된 감사 증적이 없습니다.</div>}{connectionState !== "synced" && <div className="control-empty">동기화 전에는 감사 증적을 표시하지 않습니다.</div>}</section>
  </div>;
}

function ShadowOperationCenter({ notify }: { notify: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<ShadowConsoleSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "running" | "error">("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadShadowSnapshot(controller.signal).then((next) => { setSnapshot(next); setState("ready"); setError(""); }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "섀도 운용 원장을 불러오지 못했습니다.");
      setState("error");
    });
    return () => controller.abort();
  }, [reload]);
  const execute = async () => {
    if (state === "running") return;
    setState("running");
    try {
      const result = await runShadowCycle();
      setSnapshot(result.snapshot);
      setState("ready");
      if (result.duplicate || result.sameMarketSnapshot) notify("동일한 시장 스냅샷은 다시 실행하지 않았습니다");
      else if (result.snapshot.lastCycle?.status === "simulated_fill") notify("사전 위험검사를 통과한 섀도 모의 체결을 원장에 기록했습니다");
      else if (result.snapshot.lastCycle?.status === "risk_blocked") notify("위험 한도에 따라 섀도 주문 의도를 차단했습니다");
      else notify("실제 공개 시세를 검증했으며 이번 주기에는 새 주문 신호가 없습니다");
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : "섀도 주기를 실행하지 못했습니다.";
      setError(message);
      setState("error");
      notify(message);
    }
  };
  const krw = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`;
  const percent = (bps: number) => `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;
  const age = snapshot?.marketData ? snapshot.marketData.ageSeconds < 60 ? `${snapshot.marketData.ageSeconds}초` : snapshot.marketData.ageSeconds < 3_600 ? `${Math.floor(snapshot.marketData.ageSeconds/60)}분` : `${Math.floor(snapshot.marketData.ageSeconds/3_600)}시간` : "—";
  const nav = snapshot ? snapshot.deployment.cashMinor + snapshot.position.marketValueMinor : 0;
  const signalLabel = snapshot?.lastCycle?.signal.reason === "entry" ? "진입 신호" : snapshot?.lastCycle?.signal.reason === "take_profit" ? "익절 신호" : snapshot?.lastCycle?.signal.reason === "stop_loss" ? "손절 신호" : snapshot?.lastCycle?.signal.reason === "insufficient_history" ? "표본 부족" : "새 신호 없음";
  return <div className="product-page shadow-page">
    <PageTitle title="섀도 운용" subtitle="실제 업비트 공개 시세로 전략과 위험 통제를 검증하되 거래소 주문은 전송하지 않습니다" action={<div className="inline-actions"><span className="shadow-mode-chip">섀도 · 외부 주문 0</span><button type="button" className="btn primary" disabled={state === "loading" || state === "running" || !snapshot} onClick={() => void execute()}>{state === "running" ? "시세 검증 중" : "실제 시세로 1회 실행"}</button></div>} />
    <section className={`shadow-safety ${state}`}><div><i /><span><strong>{state === "error" ? "안전 잠금" : "공개 시세 · 내부 모의 실행"}</strong><small>{state === "error" ? error : "업비트 공개 시세 API만 읽으며 거래 API·API 키·출금 권한을 사용하지 않습니다."}</small></span></div><b>{state === "running" ? "검증 중" : state === "error" ? "실행 차단" : "외부 주문 차단"}</b>{state === "error" && <button type="button" onClick={() => { setError(""); setState("loading"); setReload((value) => value+1); }}>다시 연결</button>}</section>
    <section className="shadow-summary-grid">
      <article className="panel"><span>검증 순자산</span><strong>{snapshot ? krw(nav) : "—"}</strong><small>현금 + 실제 시세 평가액</small></article>
      <article className="panel"><span>{snapshot?.strategy.market ?? "시장 시세"}</span><strong>{snapshot?.marketData ? krw(snapshot.marketData.latestCloseMinor) : "실행 전"}</strong><small>{snapshot?.marketData ? `${snapshot.marketData.intervalMinutes}분 캔들 · ${age} 전` : "공개 시세 스냅샷 없음"}</small></article>
      <article className="panel"><span>동일 표본 백테스트</span><strong className={(snapshot?.backtest?.totalReturnBps ?? 0) >= 0 ? "positive" : "negative"}>{snapshot?.backtest ? percent(snapshot.backtest.totalReturnBps) : "실행 전"}</strong><small>{snapshot?.backtest ? `최대 낙폭 ${percent(snapshot.backtest.maxDrawdownBps)} · ${snapshot.backtest.tradeCount}건` : "전략 버전과 데이터 해시 고정"}</small></article>
      <article className="panel"><span>거래소 전송 주문</span><strong>0건</strong><small>내부 시뮬레이터만 허용</small></article>
    </section>
    <section className="shadow-evidence-grid">
      <article className="panel shadow-cycle-card"><header><div><span>최근 검증 주기</span><h2>{snapshot?.lastCycle ? signalLabel : "아직 실행되지 않음"}</h2></div><b className={snapshot?.lastCycle?.status === "risk_blocked" ? "blocked" : "verified"}>{snapshot?.lastCycle?.status === "simulated_fill" ? "모의 체결" : snapshot?.lastCycle?.status === "risk_blocked" ? "위험 차단" : snapshot?.lastCycle ? "검증 완료" : "대기"}</b></header>{snapshot?.lastCycle ? <><dl><div><dt>평가 지표</dt><dd>{snapshot.lastCycle.signal.metricBps === null ? "—" : percent(snapshot.lastCycle.signal.metricBps)}</dd></div><div><dt>판정 기준</dt><dd>{snapshot.lastCycle.signal.thresholdBps === null ? "—" : percent(snapshot.lastCycle.signal.thresholdBps)}</dd></div><div><dt>캔들 시각</dt><dd>{snapshot.lastCycle.signal.candleAt ? new Date(snapshot.lastCycle.signal.candleAt).toLocaleString("ko-KR") : "—"}</dd></div><div><dt>증적 해시</dt><dd><code>{snapshot.lastCycle.evidenceHash.slice(0,12)}…{snapshot.lastCycle.evidenceHash.slice(-6)}</code></dd></div></dl><p>신호가 없으면 주문 의도를 만들지 않습니다. 신호가 있어도 승인 전략·시세 신선도·손실·주문금액·익스포저 한도를 모두 통과해야만 내부 체결을 기록합니다.</p></> : <p>버튼을 누르면 공개 캔들 180개를 저장하고 같은 표본으로 백테스트와 최신 신호 판정을 실행합니다.</p>}</article>
      <aside className="panel shadow-evidence-card"><header><div><span>고정된 실행 근거</span><h2>버전·정책·데이터 계보</h2></div><b>서버 원장</b></header><dl><div><dt>전략 버전</dt><dd>{snapshot ? `${snapshot.strategy.name} v${snapshot.strategy.version}` : "확인 중"}<small>{snapshot ? `${snapshot.strategy.contentHash.slice(0,12)}…` : ""}</small></dd></div><div><dt>위험 정책</dt><dd>{snapshot ? `정책 v${snapshot.riskPolicy.version}` : "확인 중"}<small>{snapshot ? `주문당 ${krw(snapshot.riskPolicy.maxOrderKrw)}` : ""}</small></dd></div><div><dt>시장 표본</dt><dd>{snapshot?.marketData ? `${snapshot.marketData.candleCount}개 캔들` : "실행 전"}<small>{snapshot?.marketData ? `${snapshot.marketData.payloadHash.slice(0,12)}…` : ""}</small></dd></div><div><dt>백테스트 엔진</dt><dd>{snapshot?.backtest?.engineVersion ?? "실행 전"}<small>비용·슬리피지 포함</small></dd></div></dl></aside>
    </section>
    <section className="shadow-ledger-grid">
      <article className="panel shadow-position"><div className="panel-header"><div><h2>섀도 펀드 보유 현황</h2><p>실제 자산이 아닌 검증 전용 내부 장부</p></div><span>{snapshot?.deployment.status === "running" ? "운용 중" : "준비"}</span></div><dl><div><dt>현금</dt><dd>{snapshot ? krw(snapshot.deployment.cashMinor) : "—"}</dd></div><div><dt>{snapshot?.position.asset ?? "자산"} 수량</dt><dd>{snapshot ? Number(snapshot.position.quantity).toLocaleString("ko-KR",{maximumFractionDigits:8}) : "—"}</dd></div><div><dt>평가액</dt><dd>{snapshot ? krw(snapshot.position.marketValueMinor) : "—"}</dd></div><div><dt>미실현 손익</dt><dd className={(snapshot?.position.unrealizedPnlMinor ?? 0) >= 0 ? "positive" : "negative"}>{snapshot ? krw(snapshot.position.unrealizedPnlMinor) : "—"}</dd></div><div><dt>실현 손익</dt><dd className={(snapshot?.position.realizedPnlMinor ?? 0) >= 0 ? "positive" : "negative"}>{snapshot ? krw(snapshot.position.realizedPnlMinor) : "—"}</dd></div></dl></article>
      <article className="panel shadow-reconciliation"><div className="panel-header"><div><h2>주기 대사</h2><p>주문 의도·위험판정·주문·체결 수량 비교</p></div><span>{snapshot?.reconciliation?.status === "matched" ? "일치" : snapshot?.reconciliation ? "예외" : "실행 전"}</span></div>{snapshot?.reconciliation ? <><div className="recon-counts"><span>의도 <b>{snapshot.reconciliation.intentCount}</b></span><span>주문 <b>{snapshot.reconciliation.orderCount}</b></span><span>체결 <b>{snapshot.reconciliation.fillCount}</b></span><span>예외 <b>{snapshot.reconciliation.exceptionCount}</b></span></div><code>{snapshot.reconciliation.evidenceHash.slice(0,16)}…{snapshot.reconciliation.evidenceHash.slice(-8)}</code></> : <p>첫 섀도 주기 이후 대사 증적이 생성됩니다.</p>}</article>
    </section>
    <section className="panel shadow-orders"><div className="panel-header"><div><h2>내부 모의 체결 원장</h2><p>구매·판매 주문이 아니라 위험검사를 통과한 섀도 기록입니다</p></div><span>{snapshot?.recentOrders.length ?? 0}건</span></div>{snapshot?.recentOrders.length ? <div className="shadow-order-table"><div><b>주문 ID</b><b>구분</b><b>수량</b><b>체결가</b><b>비용</b><b>상태</b></div>{snapshot.recentOrders.map((order) => <div key={order.id}><code>{order.clientOrderId.slice(0,18)}</code><span>{order.side === "buy" ? "매수" : "매도"}</span><span>{Number(order.quantity).toLocaleString("ko-KR",{maximumFractionDigits:8})}</span><span>{krw(order.priceMinor)}</span><span>{krw(order.feeMinor)}</span><b>모의 체결</b></div>)}</div> : <div className="control-empty">현재 표본에서 체결 신호가 발생하면 이 원장에만 기록됩니다.</div>}</section>
  </div>;
}

function StrategyCopilot({ go, setBlocks, notify }: { go: (screen: Screen) => void; setBlocks: React.Dispatch<React.SetStateAction<StrategyBlock[]>>; notify: (message: string) => void }) {
  const examples = [
    "BTC가 최근 4시간 고점에서 5% 하락하면 현금 10%를 매수하고 일일 손실 3%에서 중단해줘",
    "ETH가 1시간 시가보다 3% 상승하면 보유 수량 20%를 매도하고 앱으로 알려줘",
    "SOL 거래량이 4시간 평균보다 150% 증가하고 가격이 상승하면 현금 8%를 매수해줘",
  ];
  const [message, setMessage] = useState(examples[0]);
  const [history, setHistory] = useState<Array<{ role:"user" | "assistant"; text:string }>>([
    { role:"assistant", text:"전략 아이디어를 한국어로 설명해주세요. 조건·실행·손실 한도를 구조화된 블록 초안으로 바꾸겠습니다." },
  ]);
  const [result, setResult] = useState<StrategyCopilotResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = result?.draft.findings.some((item) => item.severity === "blocker") ?? false;
  const generate = async () => {
    const prompt = message.trim();
    if (prompt.length < 8 || busy) return;
    setBusy(true);
    setHistory((state) => [...state, { role:"user", text:prompt }]);
    try {
      const next = await requestStrategyDraft(prompt);
      setResult(next);
      setHistory((state) => [...state, { role:"assistant", text:`${next.draft.title} 초안을 만들었습니다. ${next.draft.blocks.length}개 블록과 ${next.draft.findings.length}개 검토 항목을 확인해주세요.` }]);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "전략 초안을 생성하지 못했습니다";
      setHistory((state) => [...state, { role:"assistant", text }]);
      notify(text);
    } finally {
      setBusy(false);
    }
  };
  const applyDraft = () => {
    if (!result || blocked) return;
    const base = Date.now();
    setBlocks(result.draft.blocks.map((block,index) => {
      const draftBlock = { id:base + index, kind:block.kind, label:block.label, source:"ai" as const };
      const config = block.config ? block.config as StrategyBlockConfig : defaultConfigForBlock(draftBlock);
      return { ...draftBlock, config, label:strategyBlockLabel(config) };
    }));
    notify("검토 가능한 AI 전략 초안을 블록 빌더에 적용했습니다");
    go("builder");
  };
  return <div className="product-page copilot-page">
    <PageTitle title="AI 전략 코파일럿" subtitle="자연어 아이디어를 주문 권한이 없는 검증용 블록 초안으로 변환합니다" action={<button type="button" className="btn secondary" onClick={() => go("builder")}>← 전략 등록부</button>} />
    <section className="copilot-safety-strip"><span>AI 실행 권한 없음</span><p>생성된 결과는 초안이며 서버 검증, 백테스트, 독립 승인 전에는 모의 주문에도 연결되지 않습니다.</p><b>실거래 차단</b></section>
    <section className="copilot-layout">
      <article className="panel copilot-chat">
        <header><div><span>대화형 전략 설계</span><h2>운용 아이디어를 설명하세요</h2></div><b>{result?.generationMode === "openai" ? "AI 구조화 모드" : "안전 규칙 모드"}</b></header>
        <div className="copilot-messages" aria-live="polite">{history.map((item,index) => <div className={item.role} key={`${item.role}-${index}`}><small>{item.role === "user" ? "운용역" : "BlockTrade"}</small><p>{item.text}</p></div>)}{busy && <div className="assistant pending"><small>BlockTrade</small><p>조건과 위험 한도를 검증하고 있습니다…</p></div>}</div>
        <div className="copilot-examples"><span>예시</span>{examples.map((example,index) => <button type="button" key={example} onClick={() => setMessage(example)}>예시 {index+1}</button>)}</div>
        <label className="copilot-input">전략 설명<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} placeholder="예: BTC가 최근 4시간 고점에서…" /><span>{message.length}/2,000</span></label>
        <button type="button" className="btn primary wide" disabled={busy || message.trim().length < 8} onClick={() => void generate()}>{busy ? "초안 생성 중" : "블록 초안 생성"}</button>
      </article>
      <aside className="panel copilot-draft">
        {!result ? <div className="copilot-empty"><span>AI</span><strong>아직 생성된 초안이 없습니다</strong><p>왼쪽에 조건, 실행 비중과 손실 한도를 함께 적어주세요.</p></div> : <>
          <header><div><span>{result.generationMode === "openai" ? "AI 구조화 초안" : "규칙 기반 안전 초안"}</span><h2>{result.draft.title}</h2><p>{result.draft.summary}</p></div><b className={`confidence ${result.draft.confidence}`}>신뢰도 {result.draft.confidence === "high" ? "높음" : result.draft.confidence === "medium" ? "중간" : "낮음"}</b></header>
          <div className="copilot-blocks">{result.draft.blocks.map((block,index) => <article className={block.kind} key={block.id}><i>{String(index+1).padStart(2,"0")}</i><div><small>{block.kind === "condition" ? "조건" : block.kind === "action" ? "실행" : block.kind === "risk" ? "위험 통제" : "알림"}</small><strong>{block.label}</strong></div></article>)}</div>
          {result.draft.findings.length > 0 && <section className="copilot-findings"><h3>검토 항목</h3>{result.draft.findings.map((item) => <div className={item.severity} key={item.code}><b>{item.severity === "blocker" ? "차단" : item.severity === "warning" ? "확인" : "안내"}</b><span>{item.message}</span></div>)}</section>}
          {(result.draft.assumptions.length > 0 || result.draft.questions.length > 0) && <section className="copilot-assumptions"><h3>가정·확인 질문</h3>{[...result.draft.assumptions, ...result.draft.questions].map((item,index) => <p key={`${item}-${index}`}>{item}</p>)}</section>}
          <div className="copilot-provider-note"><span>{result.auditRecorded ? "감사 식별자 기록됨" : "감사 저장 확인 필요"}</span><p>{result.notice}</p></div>
          <button type="button" className="btn primary wide" disabled={blocked} onClick={applyDraft}>{blocked ? "차단 항목을 먼저 수정하세요" : "블록 빌더에 초안 적용"}</button>
        </>}
      </aside>
    </section>
  </div>;
}

function Builder({ go, blocks, setBlocks, notify }: { go: (screen: Screen) => void; blocks: StrategyBlock[]; setBlocks: React.Dispatch<React.SetStateAction<StrategyBlock[]>>; notify: (message: string) => void }) {
  const conditionLibrary: Omit<StrategyBlock,"id">[] = [
    { kind:"condition", label:"가격 변동 %", config:{ ...DEFAULT_PRICE_CONFIG, metric:"return" } },
    { kind:"condition", label:"고점 대비 낙폭 %", config:{ ...DEFAULT_PRICE_CONFIG, metric:"drawdown", direction:"down", reference:"rolling_high" } },
    { kind:"condition", label:"저점 대비 반등 %", config:{ ...DEFAULT_PRICE_CONFIG, metric:"rebound", direction:"up", reference:"rolling_low" } },
    { kind:"condition", label:"이동평균 괴리율 %", config:{ ...DEFAULT_PRICE_CONFIG, metric:"ma_deviation" } },
    { kind:"condition", label:"거래량 변화율 %", config:{ ...DEFAULT_PRICE_CONFIG, metric:"volume_change", threshold:150 } },
    { kind:"condition", label:"포지션 손익률 %", config:{ ...DEFAULT_PRICE_CONFIG, metric:"position_pnl", reference:"average_buy" } },
    { kind:"condition", label:"RSI 지표", config:{ ...DEFAULT_RSI_CONFIG } },
    { kind:"condition", label:"시간 조건", config:{ ...DEFAULT_TIME_CONFIG, days:[...DEFAULT_TIME_CONFIG.days] } },
  ];
  const actionLibrary: Omit<StrategyBlock,"id">[] = [
    { kind:"action", label:"전량 매수", config:{ ...DEFAULT_TRADE_CONFIG, side:"buy", sizeMode:"all" } },
    { kind:"action", label:"전량 매도", config:{ ...DEFAULT_TRADE_CONFIG, side:"sell", sizeMode:"all" } },
    { kind:"action", label:"금액 지정 매수", config:{ ...DEFAULT_TRADE_CONFIG, side:"buy", sizeMode:"fixed_krw" } },
    { kind:"action", label:"비율 매도", config:{ ...DEFAULT_RATIO_CONFIG } },
    { kind:"action", label:"리밸런싱", config:{ ...DEFAULT_REBALANCE_CONFIG } },
  ];
  const noticeLibrary: Omit<StrategyBlock,"id">[] = [
    { kind:"notice", label:"앱 알림", config:{ ...DEFAULT_NOTIFICATION_CONFIG, channel:"app" } },
    { kind:"notice", label:"이메일", config:{ ...DEFAULT_NOTIFICATION_CONFIG, channel:"email" } },
    { kind:"notice", label:"카카오톡", config:{ ...DEFAULT_NOTIFICATION_CONFIG, channel:"kakao" } },
  ];
  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(blocks.find((block) => block.config)?.id || null);
  const [compactEditor, setCompactEditor] = useState(false);
  const [savedVersionId, setSavedVersionId] = useState("");
  const [registryBusy, setRegistryBusy] = useState<"" | "save" | "submit">("");
  const selectedBlock = blocks.find((block) => block.id === selectedBlockId);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 1100px)");
    const sync = () => setCompactEditor(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);
  const strategyDiagnostics = useMemo(() => {
    const references: Record<PriceConditionConfig["reference"], string> = {
      window_open:"window_open", previous_close:"previous_close", average_buy:"position_entry",
      rolling_high:"rolling_peak", rolling_low:"rolling_low", vwap:"window_open",
    };
    const conditions = blocks.flatMap((block) => {
      if (block.config?.type !== "price_change") return [];
      const confirmationBars = block.config.confirmation === "two_closes" ? 2 : 1;
      const cooldownBars = block.config.repeat === "cooldown_30m" ? 1 : block.config.repeat === "cooldown_4h" ? 4 : undefined;
      return [{
        id:`block-${block.id}`, label:block.label, metric:block.config.metric,
        reference:references[block.config.reference], threshold:block.config.threshold,
        timeframe:block.config.window, operator:block.config.direction === "up" ? "gte" : "lte",
        trigger:block.config.trigger, confirmationBars, cooldownBars,
      }];
    });
    return diagnoseStrategy(migrateLegacyStrategy({ id:"builder-draft", name:"DCA 비트코인 적립", timeZone:"Asia/Seoul", match:"all", conditions }));
  }, [blocks]);
  const configurationErrors = useMemo(() => blocks.flatMap((block) => validateBlockConfiguration(block).map((message) => `${block.label}: ${message}`)), [blocks]);
  const add = (item: Omit<StrategyBlock,"id">) => {
    const id = blocks.reduce((maximum, block) => Math.max(maximum, block.id), 0) + 1;
    const config = copyBlockConfig(item.config || defaultConfigForBlock(item));
    const label = strategyBlockLabel(config);
    setBlocks((state) => [...state,{ ...item, label, config, id }]);
    setSelectedBlockId(id);
    notify(`${item.label} 블록을 추가했습니다`);
  };
  const remove = (id: number) => {
    setBlocks((state) => state.filter((item) => item.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
    notify("블록을 삭제했습니다");
  };
  const selectBlock = (block: StrategyBlock) => {
    if (!block.config) {
      const config = defaultConfigForBlock(block);
      setBlocks((state) => state.map((item) => item.id === block.id ? { ...item, config, label:strategyBlockLabel(config) } : item));
    }
    setSelectedBlockId(block.id);
  };
  const updateSelectedConfig = (next: StrategyBlockConfig) => setBlocks((state) => state.map((block) => block.id === selectedBlockId ? { ...block, config:next, label:strategyBlockLabel(next) } : block));
  const saveInstitutionalDraft = async () => {
    setRegistryBusy("save");
    try {
      const response = await sendControlPlaneCommand({ action:"create_strategy_version", name:"DCA 비트코인 적립", source:blocks.some((block) => block.source === "ai") ? "ai" : "manual", definition:{ schemaVersion:1, match:"all", blocks:blocks.map((block) => ({ kind:block.kind, label:block.label, config:block.config ?? null, source:block.source ?? "manual" })) } });
      if (!response.createdVersionId) throw new Error("저장된 버전 식별자를 확인하지 못했습니다");
      setSavedVersionId(response.createdVersionId);
      notify("수정할 수 없는 기관 전략 초안 버전을 저장했습니다");
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : "기관 전략 초안을 저장하지 못했습니다");
    } finally { setRegistryBusy(""); }
  };
  const submitInstitutionalDraft = async () => {
    if (!savedVersionId) return;
    setRegistryBusy("submit");
    try {
      await sendControlPlaneCommand({ action:"submit_for_approval", strategyVersionId:savedVersionId, requiredRole:"risk_officer" });
      notify("독립 리스크 책임자에게 승인 검토를 요청했습니다");
      setSavedVersionId("");
      go("control");
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : "승인 요청을 제출하지 못했습니다");
    } finally { setRegistryBusy(""); }
  };
  const editor = selectedBlock?.config
    ? <BlockConfigEditor key={selectedBlock.id} block={selectedBlock} update={updateSelectedConfig} close={() => setSelectedBlockId(null)} />
    : <div className="inspector-empty"><span>01</span><strong>블록을 선택하세요</strong><p>조건 블록을 누르면 3%·5% 같은 임계값과 기준 시간, 실행 비중을 여기서 설정할 수 있습니다.</p></div>;
  return <div className="product-page builder-page">
    <PageTitle title="블록 로직 생성기" subtitle="기준이 명확한 조건과 액션을 조립해 나만의 전략을 만드세요" action={<div className="inline-actions"><button type="button" className="btn secondary copilot-launch" onClick={() => go("copilot")}>AI로 전략 만들기</button><button type="button" className="btn secondary" onClick={() => go("library")}>전략 보관함</button><button type="button" className="btn secondary" onClick={() => go("market")}>전략 마켓</button><button type="button" className="btn primary" onClick={() => go("backtest")}>백테스팅 실행 →</button></div>} />
    <section className="builder-help-strip"><div><span>1</span><p><strong>블록 추가</strong>왼쪽 목록에서 조건·실행·알림을 고릅니다.</p></div><div><span>2</span><p><strong>블록 선택</strong>선택한 블록의 상세 설정이 열립니다.</p></div><div><span>3</span><p><strong>수치 입력</strong>3%·5%와 기준 시간·비중을 저장합니다.</p></div></section>
    <section className="builder-layout">
      <aside className="block-library"><h3>% 조건 블록</h3>{conditionLibrary.map((item) => <button key={item.label} onClick={() => add(item)}>＋ {item.label}</button>)}<h3>액션 블록</h3>{actionLibrary.map((item) => <button key={item.label} onClick={() => add(item)}>＋ {item.label}</button>)}<h3>알림 블록</h3>{noticeLibrary.map((item) => <button key={item.label} onClick={() => add(item)}>＋ {item.label}</button>)}</aside>
      <article className="builder-canvas">
        <header><div><h2>DCA 비트코인 적립</h2><p>블록을 누르면 상세 수치와 실행 기준을 수정할 수 있습니다</p></div><span>초안</span></header>
        <div className="logic-start">조건 시작</div>
        <div className="logic-flow">{blocks.map((block,index) => <div key={block.id}>
          <article className={`logic-block ${block.kind} ${selectedBlockId === block.id ? "selected" : ""}`}>
            <button type="button" className="logic-block-label" onClick={() => selectBlock(block)} aria-label={`${block.label} 설정`}>
              <span>{block.label}</span><small>{selectedBlockId === block.id ? "상세 설정 열림" : "눌러서 수치·기준 수정"}</small>
            </button>
            <button type="button" onClick={() => remove(block.id)} aria-label={`${block.label} 삭제`}>×</button>
          </article>
          {compactEditor && selectedBlockId === block.id && <div className="inline-block-editor">{editor}</div>}
          {index < blocks.length - 1 && <i>↓</i>}
        </div>)}</div>
        <button type="button" className="add-block" onClick={() => add(conditionLibrary[0])}>＋ 조건 블록 추가</button>
        <section className={`strategy-diagnostics ${strategyDiagnostics.length === 0 && configurationErrors.length === 0 ? "ready" : ""}`} aria-live="polite">
          <strong>{configurationErrors.length > 0 ? `설정 오류 ${configurationErrors.length}건` : strategyDiagnostics.length === 0 ? "조건 충돌 없음" : `조건 점검 ${strategyDiagnostics.length}건`}</strong>
          {configurationErrors.length > 0 ? <ul>{configurationErrors.map((message,index) => <li className="error" key={`${message}-${index}`}>차단 · {message}</li>)}</ul> : strategyDiagnostics.length === 0 ? <p>모든 블록에 세부 기준이 저장되어 기관 초안으로 만들 수 있습니다.</p> : <ul>{strategyDiagnostics.map((diagnostic,index) => <li className={diagnostic.severity} key={`${diagnostic.code}-${index}`}>{diagnostic.severity === "error" ? "차단" : "확인"} · {diagnostic.message}</li>)}</ul>}
        </section>
        <div className="builder-actions"><button type="button" className="btn primary" disabled={registryBusy !== "" || configurationErrors.length > 0 || strategyDiagnostics.some((item) => item.severity === "error") || blocks.length < 2} onClick={() => void saveInstitutionalDraft()}>{registryBusy === "save" ? "기관 버전 저장 중" : "기관 초안 저장"}</button>{savedVersionId && <button type="button" className="btn primary" disabled={registryBusy !== ""} onClick={() => void submitInstitutionalDraft()}>{registryBusy === "submit" ? "승인 요청 중" : "리스크 승인 요청"}</button>}<button type="button" className="btn secondary" disabled={configurationErrors.length > 0 || strategyDiagnostics.some((item) => item.severity === "error")} onClick={() => go("backtest")}>백테스팅 →</button><button type="button" className="btn secondary" onClick={() => go("creator")}>전략 판매하기</button><button type="button" className="btn danger" onClick={() => { setBlocks([]); setSelectedBlockId(null); setSavedVersionId(""); }}>전체 삭제</button></div>
        <div className="coach"><b>AI</b><div><strong>AI 전략 코파일럿 <em>초안 전용</em></strong><p>자연어 아이디어를 검증 가능한 블록으로 만들고 불명확한 조건을 질문합니다</p><small>AI는 주문 실행 권한이 없으며 독립 승인 전에는 운영할 수 없습니다</small></div><button type="button" onClick={() => go("copilot")}>대화로 만들기</button></div>
      </article>
      {!compactEditor && <aside className="builder-inspector" aria-label="선택 블록 상세 설정">{editor}</aside>}
    </section>
  </div>;
}

function BlockConfigEditor({ block, update, close }: { block: StrategyBlock; update: (config: StrategyBlockConfig) => void; close: () => void }) {
  if (!block.config) return null;
  const typeLabel = block.kind === "condition" ? "조건 블록" : block.kind === "action" ? "실행 블록" : block.kind === "risk" ? "위험 통제 블록" : "알림 블록";
  return <div className="block-inspector-content">
    <header className="inspector-header"><div><span>{typeLabel}</span><strong>블록 상세 설정</strong><p>변경한 수치와 기준은 현재 초안에 즉시 반영됩니다.</p></div><button type="button" onClick={close} aria-label="상세 설정 닫기">×</button></header>
    {block.config.type === "price_change" && <PercentConditionEditor config={block.config} update={update} />}
    {block.config.type === "ratio_trade" && <RatioActionEditor config={block.config} update={update} />}
    {block.config.type === "rsi_condition" && <RsiConditionEditor config={block.config} update={update} />}
    {block.config.type === "time_condition" && <TimeConditionEditor config={block.config} update={update} />}
    {block.config.type === "trade_action" && <TradeActionEditor config={block.config} update={update} />}
    {block.config.type === "rebalance_action" && <RebalanceActionEditor config={block.config} update={update} />}
    {block.config.type === "notification" && <NotificationEditor config={block.config} update={update} />}
    {block.config.type === "risk_action" && <RiskActionEditor config={block.config} update={update} />}
    <footer className="inspector-footer"><i /><span><strong>자동 저장됨</strong><small>현재 초안에만 반영 · 승인 전 실행 차단</small></span></footer>
  </div>;
}

function PercentPresets({ values, value, select }: { values: number[]; value: number; select: (value: number) => void }) {
  return <div className="percent-presets" aria-label="빠른 퍼센트 선택"><span>빠른 선택</span>{values.map((preset) => <button type="button" className={value === preset ? "selected" : ""} onClick={() => select(preset)} key={preset} aria-label={`${preset}%로 설정`}>{preset}%</button>)}</div>;
}

function NumberInput({ ariaLabel, value, min, max, step = 1, commit }: { ariaLabel: string; value: number; min: number; max: number; step?: number; commit: (value: number) => void }) {
  const [draft, setDraft] = useState({ source:value, text:String(value) });
  if (draft.source !== value) setDraft({ source:value, text:String(value) });
  const finalize = () => {
    const number = Number(draft.text);
    const next = Math.min(max,Math.max(min,Number.isFinite(number) ? number : min));
    setDraft({ source:next, text:String(next) });
    commit(next);
  };
  const change = (nextText: string) => {
    setDraft({ source:value, text:nextText });
    const number = Number(nextText);
    if (nextText !== "" && Number.isFinite(number) && number >= min && number <= max) commit(number);
  };
  return <input aria-label={ariaLabel} type="number" min={min} max={max} step={step} value={draft.text} onChange={(event) => change(event.target.value)} onBlur={finalize} />;
}

function PercentConditionEditor({ config, update }: { config: PriceConditionConfig; update: (config: PriceConditionConfig) => void }) {
  const [thresholdText, setThresholdText] = useState(String(config.threshold));
  const commitThreshold = () => {
    const maximum = config.metric === "volume_change" ? 1000 : 100;
    const threshold = Math.min(maximum, Math.max(.1, Number(thresholdText) || .1));
    setThresholdText(String(threshold));
    update({ ...config, threshold });
  };
  const metricLabel = { return:"가격 수익률", drawdown:"고점 대비 낙폭", rebound:"저점 대비 반등", ma_deviation:"이동평균 괴리율", volume_change:"거래량 변화율", position_pnl:"포지션 손익률" }[config.metric];
  const calculation = {
    return:"(평가 가격 − 기준 가격) ÷ 기준 가격 × 100",
    drawdown:"(평가 가격 − 구간 최고가) ÷ 구간 최고가 × 100",
    rebound:"(평가 가격 − 구간 최저가) ÷ 구간 최저가 × 100",
    ma_deviation:"(평가 가격 − 구간 이동평균) ÷ 구간 이동평균 × 100",
    volume_change:"(현재 거래량 − 구간 평균 거래량) ÷ 구간 평균 거래량 × 100",
    position_pnl:"(평가 가격 − 평균 매수가) ÷ 평균 매수가 × 100",
  }[config.metric];
  const changeMetric = (metric: PriceConditionConfig["metric"]) => {
    const metricDefaults: Partial<PriceConditionConfig> = metric === "drawdown" ? { direction:"down", reference:"rolling_high" } : metric === "rebound" ? { direction:"up", reference:"rolling_low" } : metric === "position_pnl" ? { reference:"average_buy" } : {};
    update({ ...config, metric, threshold:metric === "volume_change" && config.threshold < 10 ? 150 : config.threshold, ...metricDefaults });
    if (metric === "volume_change" && Number(thresholdText) < 10) setThresholdText("150");
  };
  const chooseThreshold = (threshold: number) => { setThresholdText(String(threshold)); update({ ...config, threshold }); };
  return <section className="block-config-panel" aria-label="세부 퍼센트 조건 설정"><header><div><span>조건 기준</span><h3>{metricLabel} % 설정</h3></div><b>{config.threshold}%</b></header><PercentPresets values={config.metric === "volume_change" ? [50,100,150,200] : [1,3,5,10]} value={config.threshold} select={chooseThreshold} /><div className="config-grid">
    <label>조건 종류<select value={config.metric} onChange={(event) => changeMetric(event.target.value as PriceConditionConfig["metric"])}><option value="return">가격 수익률</option><option value="drawdown">고점 대비 낙폭</option><option value="rebound">저점 대비 반등</option><option value="ma_deviation">이동평균 괴리율</option><option value="volume_change">거래량 변화율</option><option value="position_pnl">포지션 손익률</option></select></label>
    <label>대상 코인<select value={config.asset} onChange={(event) => update({ ...config, asset:event.target.value as PriceConditionConfig["asset"] })}>{["BTC","ETH","SOL","XRP"].map((asset) => <option key={asset}>{asset}</option>)}</select></label>
    <label>관찰 기간<select value={config.window} onChange={(event) => update({ ...config, window:event.target.value as PriceConditionConfig["window"] })}><option value="5m">최근 5분</option><option value="15m">최근 15분</option><option value="1h">최근 1시간</option><option value="4h">최근 4시간</option><option value="24h">최근 24시간</option><option value="7d">최근 7일</option></select></label>
    <label>비교 기준<select value={config.reference} onChange={(event) => update({ ...config, reference:event.target.value as PriceConditionConfig["reference"] })}><option value="window_open">해당 기간 시가</option><option value="previous_close">직전 캔들 종가</option><option value="average_buy">내 평균 매수가</option><option value="rolling_high">구간 최고가</option><option value="rolling_low">구간 최저가</option><option value="vwap">거래량 가중 평균가</option></select></label>
    <label>평가 가격<select value={config.priceSource} onChange={(event) => update({ ...config, priceSource:event.target.value as PriceConditionConfig["priceSource"] })}><option value="last_trade">실시간 최근 체결가</option><option value="candle_close">캔들 종가</option><option value="candle_high">캔들 고가</option><option value="candle_low">캔들 저가</option></select></label>
    <label>방향<select value={config.direction} onChange={(event) => update({ ...config, direction:event.target.value as PriceConditionConfig["direction"] })}><option value="up">상승·이상</option><option value="down">하락·이하</option></select></label>
    <label>판정 방식<select value={config.trigger} onChange={(event) => update({ ...config, trigger:event.target.value as PriceConditionConfig["trigger"] })}><option value="cross">기준선을 처음 돌파</option><option value="level">기준 이상·이하 상태 유지</option></select></label>
    <label>변화율<input aria-label="가격 변화율" type="number" min="0.1" max={config.metric === "volume_change" ? 1000 : 100} step="0.1" value={thresholdText} onChange={(event) => setThresholdText(event.target.value)} onBlur={commitThreshold} /><em>%</em></label>
    <label>신호 확정<select value={config.confirmation} onChange={(event) => update({ ...config, confirmation:event.target.value as PriceConditionConfig["confirmation"] })}><option value="realtime">실시간 즉시</option><option value="candle_close">캔들 종가 1회 확정</option><option value="two_closes">연속 2개 종가 확정</option></select></label>
    <label>빈 캔들 처리<select value={config.missingData} onChange={(event) => update({ ...config, missingData:event.target.value as PriceConditionConfig["missingData"] })}><option value="skip">신호 계산 건너뛰기</option><option value="carry_forward">직전 종가로 보정</option></select></label>
    <label>재실행 제한<select value={config.repeat} onChange={(event) => update({ ...config, repeat:event.target.value as PriceConditionConfig["repeat"] })}><option value="once_per_candle">캔들마다 1회</option><option value="cooldown_30m">실행 후 30분 대기</option><option value="cooldown_4h">실행 후 4시간 대기</option><option value="once">최초 1회만</option></select></label>
  </div><p><strong>계산식</strong> {calculation} · 기본값은 체결이 없는 빈 캔들을 건너뛰고 캔들 종가로 신호를 확정합니다.</p></section>;
}

function RatioActionEditor({ config, update }: { config: RatioActionConfig; update: (config: RatioActionConfig) => void }) {
  const [ratioText, setRatioText] = useState(String(config.ratio));
  const commitRatio = () => {
    const ratio = Math.min(100, Math.max(1, Number(ratioText) || 1));
    setRatioText(String(ratio));
    update({ ...config, ratio });
  };
  const chooseRatio = (ratio: number) => { setRatioText(String(ratio)); update({ ...config, ratio }); };
  return <section className="block-config-panel ratio-config" aria-label="거래 비율 액션 설정"><header><div><span>실행 비율</span><h3>매수·매도 % 설정</h3></div><b>{config.ratio}%</b></header><PercentPresets values={[10,20,30,50,100]} value={config.ratio} select={chooseRatio} /><div className="config-grid compact">
    <label>거래 방향<select value={config.side} onChange={(event) => { const side = event.target.value as RatioActionConfig["side"]; update({ ...config, side, basis:side === "buy" ? "available_cash" : "holding_asset" }); }}><option value="buy">매수</option><option value="sell">매도</option></select></label>
    <label>비율 기준<select value={config.basis} onChange={(event) => update({ ...config, basis:event.target.value as RatioActionConfig["basis"] })}><option value="available_cash">사용 가능 원화</option><option value="holding_asset">현재 보유 수량</option></select></label>
    <label>실행 비율<input aria-label="거래 실행 비율" type="number" min="1" max="100" step="1" value={ratioText} onChange={(event) => setRatioText(event.target.value)} onBlur={commitRatio} /><em>%</em></label>
  </div><p><strong>안전 기준</strong> 주문 생성 시점의 사용 가능 잔액 또는 보유 수량을 기준으로 계산합니다.</p></section>;
}

function RsiConditionEditor({ config, update }: { config: RsiConditionConfig; update: (config: RsiConditionConfig) => void }) {
  return <section className="block-config-panel" aria-label="RSI 조건 설정">
    <header><div><span>기술 지표</span><h3>RSI 임계값 설정</h3></div><b>{config.threshold}</b></header>
    <PercentPresets values={[20,30,50,70]} value={config.threshold} select={(threshold) => update({ ...config, threshold })} />
    <div className="config-grid">
      <label>대상 코인<select aria-label="RSI 대상 코인" value={config.asset} onChange={(event) => update({ ...config, asset:event.target.value as RsiConditionConfig["asset"] })}>{["BTC","ETH","SOL","XRP"].map((asset) => <option key={asset}>{asset}</option>)}</select></label>
      <label>캔들 주기<select value={config.timeframe} onChange={(event) => update({ ...config, timeframe:event.target.value as RsiConditionConfig["timeframe"] })}><option value="5m">5분</option><option value="15m">15분</option><option value="1h">1시간</option><option value="4h">4시간</option><option value="24h">24시간</option></select></label>
      <label>RSI 기간<NumberInput ariaLabel="RSI 계산 기간" value={config.period} min={2} max={200} commit={(period) => update({ ...config, period })} /></label>
      <label>판정 방향<select value={config.operator} onChange={(event) => update({ ...config, operator:event.target.value as RsiConditionConfig["operator"] })}><option value="lte">임계값 이하</option><option value="gte">임계값 이상</option></select></label>
      <label>RSI 임계값<NumberInput ariaLabel="RSI 임계값" value={config.threshold} min={1} max={99} commit={(threshold) => update({ ...config, threshold })} /></label>
      <label>신호 확정<select value={config.confirmation} onChange={(event) => update({ ...config, confirmation:event.target.value as RsiConditionConfig["confirmation"] })}><option value="realtime">실시간 즉시</option><option value="candle_close">캔들 종가 1회</option><option value="two_closes">연속 2개 종가</option></select></label>
    </div>
    <p><strong>기관 기본값</strong> RSI(14)를 캔들 종가로 확정하며, 같은 캔들 안의 일시적 움직임은 신호로 쓰지 않습니다.</p>
  </section>;
}

function TimeConditionEditor({ config, update }: { config: TimeConditionConfig; update: (config: TimeConditionConfig) => void }) {
  const dayLabels: [TimeConditionConfig["days"][number],string][] = [["mon","월"],["tue","화"],["wed","수"],["thu","목"],["fri","금"],["sat","토"],["sun","일"]];
  const toggleDay = (day: TimeConditionConfig["days"][number]) => update({ ...config, days:config.days.includes(day) ? config.days.filter((item) => item !== day) : [...config.days,day] });
  return <section className="block-config-panel" aria-label="시간 조건 설정">
    <header><div><span>거래 시간</span><h3>허용 요일·시간 설정</h3></div><b>{config.startTime}</b></header>
    <fieldset className="day-selector"><legend>실행 요일</legend>{dayLabels.map(([day,label]) => <button type="button" aria-pressed={config.days.includes(day)} className={config.days.includes(day) ? "selected" : ""} onClick={() => toggleDay(day)} key={day}>{label}</button>)}</fieldset>
    <div className="config-grid compact">
      <label>시작 시간<input aria-label="실행 시작 시간" type="time" value={config.startTime} onChange={(event) => update({ ...config, startTime:event.target.value })} /></label>
      <label>종료 시간<input aria-label="실행 종료 시간" type="time" value={config.endTime} onChange={(event) => update({ ...config, endTime:event.target.value })} /></label>
      <label>기준 시간대<select value={config.timeZone} onChange={(event) => update({ ...config, timeZone:event.target.value as TimeConditionConfig["timeZone"] })}><option value="Asia/Seoul">한국 표준시</option><option value="UTC">UTC</option></select></label>
    </div>
    <p><strong>차단 규칙</strong> 선택하지 않은 요일과 허용 시간 밖에서는 조건이 맞아도 주문 의도를 만들지 않습니다.</p>
  </section>;
}

function TradeActionEditor({ config, update }: { config: TradeActionConfig; update: (config: TradeActionConfig) => void }) {
  return <section className="block-config-panel" aria-label="주문 액션 설정">
    <header><div><span>주문 액션</span><h3>방향·금액·주문 방식</h3></div><b>{config.side === "buy" ? "매수" : "매도"}</b></header>
    {config.sizeMode === "ratio" && <PercentPresets values={[10,20,30,50,100]} value={config.ratio} select={(ratio) => update({ ...config, ratio })} />}
    <div className="config-grid">
      <label>거래 방향<select value={config.side} onChange={(event) => update({ ...config, side:event.target.value as TradeActionConfig["side"] })}><option value="buy">매수</option><option value="sell">매도</option></select></label>
      <label>수량 기준<select value={config.sizeMode} onChange={(event) => update({ ...config, sizeMode:event.target.value as TradeActionConfig["sizeMode"] })}><option value="all">사용 가능 수량 전부</option><option value="ratio">비율 지정</option><option value="fixed_krw">원화 금액 지정</option></select></label>
      {config.sizeMode === "ratio" && <label>주문 비율<NumberInput ariaLabel="주문 비율" value={config.ratio} min={1} max={100} commit={(ratio) => update({ ...config, ratio })} /><em>%</em></label>}
      {config.sizeMode === "fixed_krw" && <label>주문 금액<NumberInput ariaLabel="주문 원화 금액" value={config.amountKrw} min={0} max={10_000_000_000} step={1000} commit={(amountKrw) => update({ ...config, amountKrw })} /><em>원</em></label>}
      <label>주문 방식<select value={config.orderType} onChange={(event) => update({ ...config, orderType:event.target.value as TradeActionConfig["orderType"] })}><option value="market">시장가</option><option value="limit">기준가 대비 지정가</option></select></label>
      {config.orderType === "limit" && <label>지정가 오프셋<NumberInput ariaLabel="지정가 오프셋" value={config.limitOffsetPct} min={-10} max={10} step={.1} commit={(limitOffsetPct) => update({ ...config, limitOffsetPct })} /><em>%</em></label>}
    </div>
    <p><strong>주문 전 검사</strong> 저장된 수량 기준은 서버의 잔액·노출·슬리피지·최대 주문금액 한도를 다시 통과해야 합니다.</p>
  </section>;
}

function RebalanceActionEditor({ config, update }: { config: RebalanceActionConfig; update: (config: RebalanceActionConfig) => void }) {
  const total = config.btcPct + config.ethPct + config.cashPct;
  return <section className="block-config-panel" aria-label="리밸런싱 설정">
    <header><div><span>목표 배분</span><h3>자산 비중 리밸런싱</h3></div><b className={total === 100 ? "" : "invalid"}>{total}%</b></header>
    <PercentPresets values={[3,5,10]} value={config.driftPct} select={(driftPct) => update({ ...config, driftPct })} />
    <div className="config-grid">
      <label>BTC 목표<NumberInput ariaLabel="BTC 목표 비중" value={config.btcPct} min={0} max={100} commit={(btcPct) => update({ ...config, btcPct })} /><em>%</em></label>
      <label>ETH 목표<NumberInput ariaLabel="ETH 목표 비중" value={config.ethPct} min={0} max={100} commit={(ethPct) => update({ ...config, ethPct })} /><em>%</em></label>
      <label>현금 목표<NumberInput ariaLabel="현금 목표 비중" value={config.cashPct} min={0} max={100} commit={(cashPct) => update({ ...config, cashPct })} /><em>%</em></label>
      <label>이탈 허용폭<NumberInput ariaLabel="리밸런싱 이탈 허용폭" value={config.driftPct} min={1} max={50} commit={(driftPct) => update({ ...config, driftPct })} /><em>%p</em></label>
      <label>정기 점검<select value={config.schedule} onChange={(event) => update({ ...config, schedule:event.target.value as RebalanceActionConfig["schedule"] })}><option value="daily">매일</option><option value="weekly">매주</option><option value="monthly">매월</option></select></label>
    </div>
    <p className={total === 100 ? "" : "config-error"}><strong>{total === 100 ? "검증 통과" : "저장 차단"}</strong> 목표 비중 합계는 정확히 100%여야 합니다. 현재 {total}%입니다.</p>
  </section>;
}

function NotificationEditor({ config, update }: { config: NotificationConfig; update: (config: NotificationConfig) => void }) {
  return <section className="block-config-panel" aria-label="알림 블록 설정">
    <header><div><span>통지 정책</span><h3>채널·중요도·중복 제한</h3></div><b>{config.cooldownMinutes}분</b></header>
    <div className="config-grid">
      <label>알림 채널<select value={config.channel} onChange={(event) => update({ ...config, channel:event.target.value as NotificationConfig["channel"] })}><option value="app">앱 알림</option><option value="email">이메일</option><option value="kakao">카카오톡</option></select></label>
      <label>중요도<select value={config.priority} onChange={(event) => update({ ...config, priority:event.target.value as NotificationConfig["priority"] })}><option value="info">안내</option><option value="warning">경고</option><option value="critical">긴급</option></select></label>
      <label>중복 제한<NumberInput ariaLabel="알림 중복 제한 시간" value={config.cooldownMinutes} min={0} max={1440} step={5} commit={(cooldownMinutes) => update({ ...config, cooldownMinutes })} /><em>분</em></label>
      <label className="config-span">알림 문구<input aria-label="알림 문구" maxLength={120} value={config.message} onChange={(event) => update({ ...config, message:event.target.value })} /></label>
    </div>
    <p><strong>보안 원칙</strong> 알림에는 API 키·원본 전략 수치·민감 계정정보를 포함하지 않습니다.</p>
  </section>;
}

function RiskActionEditor({ config, update }: { config: RiskActionConfig; update: (config: RiskActionConfig) => void }) {
  return <section className="block-config-panel" aria-label="위험 통제 설정">
    <header><div><span>위험 통제</span><h3>손절·익절·축소 기준</h3></div><b>{config.threshold}%</b></header>
    <PercentPresets values={[1,3,5,7,10]} value={config.threshold} select={(threshold) => update({ ...config, threshold })} />
    <div className="config-grid">
      <label>통제 종류<select value={config.rule} onChange={(event) => update({ ...config, rule:event.target.value as RiskActionConfig["rule"] })}><option value="stop_loss">손절</option><option value="take_profit">익절</option><option value="reduce_position">포지션 축소</option></select></label>
      <label>비교 기준<select value={config.reference} onChange={(event) => update({ ...config, reference:event.target.value as RiskActionConfig["reference"] })}><option value="average_buy">평균 매수가</option><option value="rolling_high">운용 중 최고가</option></select></label>
      <label>임계값<NumberInput ariaLabel="위험 통제 임계값" value={config.threshold} min={.1} max={100} step={.1} commit={(threshold) => update({ ...config, threshold })} /><em>%</em></label>
      <label>매도 비율<NumberInput ariaLabel="위험 통제 매도 비율" value={config.reduceRatio} min={1} max={100} commit={(reduceRatio) => update({ ...config, reduceRatio })} /><em>%</em></label>
      <label>재실행 대기<NumberInput ariaLabel="위험 통제 재실행 대기" value={config.cooldownMinutes} min={0} max={1440} step={10} commit={(cooldownMinutes) => update({ ...config, cooldownMinutes })} /><em>분</em></label>
    </div>
    <p><strong>우선순위</strong> 위험 통제는 일반 매수·매도 액션보다 먼저 평가되고, 전사 Kill Switch와 계정 한도보다 낮은 우선순위로 실행됩니다.</p>
  </section>;
}

function StrategyMarketplace({ snapshot, plan, openDetail, go }: { snapshot: MarketplaceSnapshot; plan: Plan; openDetail: (id: string) => void; go: (screen: Screen) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [sort, setSort] = useState("신뢰 점수순");
  const subscribedIds = new Set(snapshot.subscriptions.filter((item) => item.status === "active").map((item) => item.strategyId));
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return snapshot.strategies
      .filter((strategy) => strategy.status === "listed")
      .filter((strategy) => category === "전체" || strategy.category === category)
      .filter((strategy) => !normalized || `${strategy.name} ${strategy.creatorName} ${strategy.conditionSummary}`.toLowerCase().includes(normalized))
      .sort((a, b) => sort === "구독자순" ? b.subscribers - a.subscribers : sort === "수익률순" ? b.return90d - a.return90d : b.trustScore - a.trustScore);
  }, [snapshot.strategies, query, category, sort]);
  const activeSubscriptions = snapshot.subscriptions.filter((item) => item.status === "active");
  const canUseStrategies = plan !== "Free";
  if (plan) return <div className="product-page marketplace-page protected-marketplace">
    <PageTitle title="전략 사용권 마켓" subtitle="원본 공개 없이 검증된 전략을 내 위험 한도 안에서 서버로 실행합니다" action={<div className="inline-actions"><button type="button" className="btn secondary" onClick={() => go("builder")}>내 전략 만들기</button><button type="button" className="btn primary" onClick={() => go("creator")}>판매자 센터</button></div>} />
    <section className={`market-access-strip ${canUseStrategies ? "eligible" : "restricted"}`}>
      <div><span>{PLAN_LABELS[plan]} 플랜</span><strong>{canUseStrategies ? "전략 사용권 활성화 가능" : "전략 비교만 가능"}</strong><p>{canUseStrategies ? "구매 후에도 원본 블록은 제공되지 않으며 서버 실행 권한만 연결됩니다." : "Pro 또는 Gold 플랜에서 전략 사용권을 활성화할 수 있습니다."}</p></div>
      {!canUseStrategies && <button type="button" className="btn primary" onClick={() => go("billing")}>플랜 선택하기</button>}
    </section>
    <section className="market-license-hero panel"><div><span>원본 비공개 사용권</span><h2>전략은 보여주지 않고,<br />검증된 실행만 제공합니다.</h2><p>카탈로그에는 성과·위험·운영 이력만 표시됩니다. 조건, 임계값, 블록, 프롬프트와 코드는 제작자 전용 서버 경계에 남습니다.</p></div><dl><div><dt>기본 성과보수</dt><dd>10%</dd><small>순신규 실현이익</small></div><div><dt>손실 회복 구간</dt><dd>0원</dd><small>최고수익기준선</small></div><div><dt>원본 접근</dt><dd>차단</dd><small>구매자 API 포함</small></div></dl></section>
    {activeSubscriptions.length > 0 && <section className="my-subscriptions panel"><header><div><h2>내 전략 사용권</h2><p>원본 복제 없이 서버 실행 권한과 개인 위험 한도만 연결됩니다.</p></div></header><div>{activeSubscriptions.map((subscription) => { const strategy = snapshot.strategies.find((item) => item.id === subscription.strategyId); return strategy ? <button type="button" key={subscription.strategyId} onClick={() => openDetail(subscription.strategyId)}><span><strong>{strategy.name}</strong><small>{strategy.creatorName} · 성과보수 {subscription.profitSharePct}% · 원본 비공개</small></span><b>{canUseStrategies ? `손실 한도 ${subscription.riskLimit}% · 비중 ${subscription.allocation}% ›` : "플랜 만료 · 실행 잠금 ›"}</b></button> : null; })}</div></section>}
    <section className="market-toolbar panel"><div className="market-categories">{["전체","적립식","스윙","돌파"].map((item) => <button type="button" className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div><input aria-label="전략 마켓 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="전략·제작자 검색" /><select aria-label="전략 정렬" value={sort} onChange={(event) => setSort(event.target.value)}><option>신뢰 점수순</option><option>구독자순</option><option>수익률순</option></select></section>
    <section className="market-grid">{visible.map((strategy) => <article className="market-card panel protected-strategy-card" key={strategy.id}><header><div><span className={`verification ${strategy.verification === "실운영 검증" ? "verified" : strategy.verification === "검증 대기" ? "pending" : ""}`}>{strategy.verification}</span><h2>{strategy.name}</h2><p>{strategy.creatorName}</p></div><b className={`market-risk risk-${strategy.risk}`}>위험 {strategy.risk}</b></header><p className="market-description">{strategy.description}</p><div className="market-performance"><div><span>90일 수익률</span><strong className={strategy.return90d >= 0 ? "positive" : "negative"}>{strategy.return90d >= 0 ? "+" : ""}{strategy.return90d}%</strong></div><div><span>최대 낙폭</span><strong className="negative">{strategy.maxDrawdown}%</strong></div><div><span>신뢰 점수</span><strong>{strategy.trustScore}<small>/100</small></strong></div></div><div className="trust-bar" aria-label={`신뢰 점수 ${strategy.trustScore}점`}><i style={{ width:`${strategy.trustScore}%` }} /></div><p className="condition-preview"><b>실행 범위</b>{strategy.conditionSummary}<small>정확한 조건·수치·블록은 공개되지 않습니다.</small></p><footer><span><strong>성과보수 {strategy.profitSharePct}%</strong><small>플랫폼 플랜 별도 · {strategy.subscribers.toLocaleString("ko-KR")}명 이용</small></span><button type="button" className={subscribedIds.has(strategy.id) ? "btn secondary" : "btn primary"} onClick={() => openDetail(strategy.id)}>{strategy.isMine ? "내 전략 관리" : subscribedIds.has(strategy.id) ? "사용권 관리" : "검증 정보 보기"}</button></footer></article>)}</section>
    {visible.length === 0 && <div className="empty-market"><strong>조건에 맞는 전략이 없습니다</strong><p>검색어나 카테고리를 바꿔보세요.</p></div>}
    <p className="market-disclaimer">성과보수는 순신규 실현이익과 최고수익기준선을 기준으로 한 설계 예시입니다. 실제 청구·정산·자동 주문은 결제 및 규제 검토 전까지 잠겨 있습니다.</p>
  </div>;
  return <div className="product-page marketplace-page">
    <PageTitle title="전략 마켓" subtitle="검증된 운영 기록과 위험 지표를 비교하고 내 계정에 맞게 구독하세요" action={<div className="inline-actions"><button type="button" className="btn secondary" onClick={() => go("builder")}>내 전략 만들기</button><button type="button" className="btn primary" onClick={() => go("creator")}>판매자 센터</button></div>} />
    <section className="market-hero"><div><span>전략 마켓 미리보기</span><h2>높은 수익률보다<br />오래 버틴 전략을 먼저 봅니다</h2><p>예시 신뢰 점수는 수익률·최대 낙폭·운영 기간·거래 횟수를 함께 반영한 화면 샘플입니다.</p></div><dl><div><dt>등록 예시</dt><dd>{snapshot.strategies.filter((item) => item.status === "listed").length}</dd></div><div><dt>실운영 검증</dt><dd>{snapshot.strategies.filter((item) => item.verification === "실운영 검증").length}</dd></div><div><dt>내 구독</dt><dd>{activeSubscriptions.length}</dd></div></dl></section>
    {activeSubscriptions.length > 0 && <section className="my-subscriptions panel"><header><div><h2>내 구독 전략</h2><p>구독은 전략을 복제하지만 내 손실 한도와 운용 비중은 별도로 적용됩니다.</p></div></header><div>{activeSubscriptions.map((subscription) => { const strategy = snapshot.strategies.find((item) => item.id === subscription.strategyId); return strategy ? <button type="button" key={subscription.strategyId} onClick={() => openDetail(subscription.strategyId)}><span><strong>{strategy.name}</strong><small>{strategy.creatorName} · 월 {strategy.priceMonthly.toLocaleString("ko-KR")}원</small></span><b>손실 한도 {subscription.riskLimit}% · 비중 {subscription.allocation}% ›</b></button> : null; })}</div></section>}
    <section className="market-toolbar panel"><div className="market-categories">{["전체","적립식","스윙","돌파"].map((item) => <button type="button" className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div><input aria-label="전략 마켓 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="전략·제작자·조건 검색" /><select aria-label="전략 정렬" value={sort} onChange={(event) => setSort(event.target.value)}><option>신뢰 점수순</option><option>구독자순</option><option>수익률순</option></select></section>
    <section className="market-grid">{visible.map((strategy) => <article className="market-card panel" key={strategy.id}><header><div><span className={`verification ${strategy.verification === "실운영 검증" ? "verified" : strategy.verification === "검증 대기" ? "pending" : ""}`}>{strategy.verification}</span><h2>{strategy.name}</h2><p>{strategy.creatorName}</p></div><b className={`market-risk risk-${strategy.risk}`}>위험 {strategy.risk}</b></header><p className="market-description">{strategy.description}</p><div className="market-performance"><div><span>90일 수익률</span><strong className={strategy.return90d >= 0 ? "positive" : "negative"}>{strategy.return90d >= 0 ? "+" : ""}{strategy.return90d}%</strong></div><div><span>최대 낙폭</span><strong className="negative">{strategy.maxDrawdown}%</strong></div><div><span>신뢰 점수</span><strong>{strategy.trustScore}<small>/100</small></strong></div></div><div className="trust-bar" aria-label={`신뢰 점수 ${strategy.trustScore}점`}><i style={{ width:`${strategy.trustScore}%` }} /></div><p className="condition-preview"><b>조건 기준</b>{strategy.conditionSummary}</p><footer><span><strong>{strategy.priceMonthly === 0 ? "무료" : `월 ${strategy.priceMonthly.toLocaleString("ko-KR")}원`}</strong><small>{strategy.subscribers.toLocaleString("ko-KR")}명 구독</small></span><button type="button" className={subscribedIds.has(strategy.id) ? "btn secondary" : "btn primary"} onClick={() => openDetail(strategy.id)}>{strategy.isMine ? "내 전략 관리" : subscribedIds.has(strategy.id) ? "구독 관리" : "상세 보기"}</button></footer></article>)}</section>
    {visible.length === 0 && <div className="empty-market"><strong>조건에 맞는 전략이 없습니다</strong><p>검색어나 카테고리를 바꿔보세요.</p></div>}
    <p className="market-disclaimer">표시된 성과는 과거 운영 기록이며 미래 수익을 보장하지 않습니다. 실제 결제와 투자자문 기능은 출시 전 별도 검토가 필요합니다.</p>
  </div>;
}

function MarketplaceDetail({ strategy, subscription, plan, go, perform, busy }: { strategy: MarketplaceStrategy; subscription?: MarketplaceSnapshot["subscriptions"][number]; plan: Plan; go: (screen: Screen) => void; perform: (input: MarketplaceCommandInput, message: string) => Promise<boolean>; busy: string }) {
  const [riskLimit, setRiskLimit] = useState(3);
  const [allocation, setAllocation] = useState(20);
  const [acknowledged, setAcknowledged] = useState(false);
  const subscribed = subscription?.status === "active";
  const canViewBlocks = strategy.isMine;
  const canUseStrategies = plan !== "Free";
  if (plan) return <div className="product-page market-detail-page protected-market-detail"><PageTitle title={strategy.name} subtitle={`${strategy.creatorName} · ${strategy.category} · ${strategy.verification}`} action={<button type="button" className="btn secondary" onClick={() => go("market")}>← 전략 마켓</button>} />
    <section className="detail-hero panel"><div><span className={`verification ${strategy.verification === "예시 데이터" ? "pending" : "verified"}`}>{strategy.verification}</span><h2>{strategy.name}</h2><p>{strategy.description}</p><div className="creator-line"><i>{strategy.creatorName.slice(0, 1)}</i><span><strong>{strategy.creatorName}</strong><small>전략 버전 갱신 {strategy.updatedAt} · 원본 소유자</small></span></div></div><aside><span>{strategy.verification === "예시 데이터" ? "예시 신뢰 점수" : "신뢰 점수"}</span><strong>{strategy.trustScore}</strong><div className="trust-bar"><i style={{ width:`${strategy.trustScore}%` }} /></div><small>{strategy.verification === "예시 데이터" ? "실제 성과 증빙이 아닌 UI 샘플" : "수익률·MDD·운영 기간·거래 횟수 종합"}</small></aside></section>
    <section className="license-boundary panel"><div><span>전달 방식</span><strong>서버 실행 사용권</strong><p>구매자 기기에는 전략 블록이나 실행 코드가 저장되지 않습니다.</p></div><div><span>원본 접근</span><strong>제작자 전용</strong><p>구독 후에도 조건·임계값·프롬프트·소스는 공개되지 않습니다.</p></div><div><span>재판매 방지</span><strong>복제본 미발급</strong><p>허용 계정과 승인된 실행 요청만 서버가 평가합니다.</p></div></section>
    <section className="market-detail-grid"><div><section className="performance-panel panel"><header><div><h2>검증 성과</h2><p>수수료 반영 후 예시 운영 기록</p></div><span>90일</span></header><div className="detail-metrics"><article><span>총 수익률</span><strong className={strategy.return90d >= 0 ? "positive" : "negative"}>{strategy.return90d >= 0 ? "+" : ""}{strategy.return90d}%</strong></article><article><span>최대 낙폭 MDD</span><strong className="negative">{strategy.maxDrawdown}%</strong></article><article><span>승률</span><strong>{strategy.winRate}%</strong></article><article><span>운영 기간</span><strong>{strategy.liveDays}일</strong></article><article><span>거래 횟수</span><strong>{strategy.tradeCount}회</strong></article><article><span>이용자</span><strong>{strategy.subscribers}명</strong></article></div><div className="performance-bars">{[["수익",Math.min(100,Math.max(8,strategy.return90d*3))],["방어",Math.min(100,Math.max(8,100-Math.abs(strategy.maxDrawdown)*4))],["표본",Math.min(100,Math.max(8,strategy.tradeCount/1.5))]].map(([label,value]) => <div key={label}><span>{label}</span><i><b style={{ width:`${value}%` }} /></i></div>)}</div></section>
      <section className="shared-logic panel"><header><div><h2>{strategy.isMine ? "전략 원본" : "전략 원본 보호"}</h2><p>{strategy.isMine ? "소유자에게만 표시" : "구매 후에도 비공개"}</p></div></header><div className={canViewBlocks ? "shared-blocks" : "shared-blocks locked protected-lock"}>{canViewBlocks ? (strategy.blocks.length > 0 ? strategy.blocks.map((block,index) => <div key={block}><b>{index === 0 ? "조건" : index === strategy.blocks.length - 1 ? "보호" : "실행"}</b><span>{block}</span>{index < strategy.blocks.length - 1 && <i>↓</i>}</div>) : <div className="owner-empty-source"><span>저장된 원본 블록이 없습니다.</span></div>) : <><span>원본 비공개</span><strong>조건·수치·블록은 구매자 화면과 API에 전송되지 않습니다.</strong><p>서버가 신호를 평가하고 승인된 실행 상태만 제공합니다.</p></>}</div></section></div>
      <aside className="subscribe-panel panel"><span className="subscribe-price"><b>순신규 실현이익의 {strategy.profitSharePct}%</b><small>최고수익기준선 · 월 단위 정산 설계</small></span><div className="performance-fee-policy"><div><span>손실·회복 구간</span><strong>성과보수 0원</strong></div><div><span>성과보수 배분</span><strong>제작자 {strategy.creatorFeeSplitPct}% · 플랫폼 {strategy.platformFeeSplitPct}%</strong></div><div><span>실제 청구</span><strong className="locked-copy">정산 연동 전 잠금</strong></div></div>{strategy.isMine ? <><div className="owner-notice"><strong>내가 게시한 전략입니다</strong><p>원본은 소유자 계정에만 표시되며 구매자에게는 서버 실행권만 발급됩니다.</p></div><button type="button" className="btn primary wide" onClick={() => go("creator")}>판매자 센터 열기</button></> : subscribed && canUseStrategies ? <><div className="active-subscription"><strong>사용권 활성</strong><p>{PLAN_LABELS[plan]} 플랜 · 손실 한도 {subscription?.riskLimit}% · 운용 비중 {subscription?.allocation}%</p></div><button type="button" className="btn secondary wide" onClick={() => go("operations")}>운영 상태 보기</button><button type="button" className="btn danger wide" disabled={busy !== ""} onClick={() => perform({ action:"unsubscribe", strategyId:strategy.id }, "전략 사용권을 해지했습니다")}>사용권 해지</button></> : !canUseStrategies ? <><div className="plan-required"><span>플랜 필요</span><strong>Pro 또는 Gold에서 사용할 수 있습니다</strong><p>무료 플랜에서는 성과와 위험 정보만 비교할 수 있습니다.</p></div><button type="button" className="btn primary wide" onClick={() => go("billing")}>플랜 선택하기</button>{subscribed && <button type="button" className="btn danger wide" disabled={busy !== ""} onClick={() => perform({ action:"unsubscribe", strategyId:strategy.id }, "전략 사용권을 해지했습니다")}>잠긴 사용권 해지</button>}</> : <><h3>내 안전 기준 설정</h3><label>일일 손실 한도<strong>{riskLimit}%</strong><input aria-label="구독 전략 일일 손실 한도" type="range" min="1" max="10" step="1" value={riskLimit} onChange={(event) => setRiskLimit(Number(event.target.value))} /></label><label>운용 가능 자산 비중<strong>{allocation}%</strong><input aria-label="구독 전략 운용 비중" type="range" min="5" max="100" step="5" value={allocation} onChange={(event) => setAllocation(Number(event.target.value))} /></label><button type="button" className="subscription-check" aria-pressed={acknowledged} onClick={() => setAcknowledged(!acknowledged)}><Check checked={acknowledged} /><span><strong>위험·성과보수 기준을 확인했습니다</strong><small>제작자 설정보다 내 손실 한도가 우선합니다.</small></span></button><button type="button" className="btn primary wide" disabled={!acknowledged || busy !== ""} onClick={() => perform({ action:"subscribe", strategyId:strategy.id, riskLimit, allocation }, "모의 전략 사용권을 활성화했습니다")}>모의 사용권 활성화</button></>}<div className="subscribe-safety"><strong>원본 보호 원칙</strong><p>활성화 후에도 전략의 조건·수치·블록은 공개되지 않습니다. 실제 결제·성과정산·자동 주문은 준비 전까지 잠겨 있습니다.</p></div></aside>
    </section></div>;
  return <div className="product-page market-detail-page"><PageTitle title={strategy.name} subtitle={`${strategy.creatorName} · ${strategy.category} · ${strategy.verification}`} action={<button type="button" className="btn secondary" onClick={() => go("market")}>← 전략 마켓</button>} />
    <section className="detail-hero panel"><div><span className={`verification ${strategy.verification === "예시 데이터" ? "pending" : "verified"}`}>{strategy.verification}</span><h2>{strategy.name}</h2><p>{strategy.description}</p><div className="creator-line"><i>{strategy.creatorName.slice(0, 1)}</i><span><strong>{strategy.creatorName}</strong><small>전략 버전 갱신 {strategy.updatedAt}</small></span></div></div><aside><span>{strategy.verification === "예시 데이터" ? "예시 신뢰 점수" : "신뢰 점수"}</span><strong>{strategy.trustScore}</strong><div className="trust-bar"><i style={{ width:`${strategy.trustScore}%` }} /></div><small>{strategy.verification === "예시 데이터" ? "실제 성과 증빙이 아닌 UI 샘플" : "수익률·MDD·운영 기간·거래 횟수 종합"}</small></aside></section>
    <section className="market-detail-grid"><div><section className="performance-panel panel"><header><div><h2>검증 성과</h2><p>수수료 반영 후 예시 운영 기록</p></div><span>90일</span></header><div className="detail-metrics"><article><span>총 수익률</span><strong className="positive">+{strategy.return90d}%</strong></article><article><span>최대 낙폭 MDD</span><strong className="negative">{strategy.maxDrawdown}%</strong></article><article><span>승률</span><strong>{strategy.winRate}%</strong></article><article><span>운영 기간</span><strong>{strategy.liveDays}일</strong></article><article><span>거래 횟수</span><strong>{strategy.tradeCount}회</strong></article><article><span>구독자</span><strong>{strategy.subscribers}명</strong></article></div><div className="performance-bars">{[["수익",Math.min(100,Math.max(8,strategy.return90d*3))],["방어",Math.min(100,Math.max(8,100-Math.abs(strategy.maxDrawdown)*4))],["표본",Math.min(100,Math.max(8,strategy.tradeCount/1.5))]].map(([label,value]) => <div key={label}><span>{label}</span><i><b style={{ width:`${value}%` }} /></i></div>)}</div></section>
      <section className="shared-logic panel"><header><div><h2>공유된 조건 블록</h2><p>{strategy.visibility === "public" ? "전체 공개" : strategy.visibility === "subscribers" ? "구독 후 세부 조건 공개" : "조건 비공개 · 신호만 제공"}</p></div></header><div className={canViewBlocks ? "shared-blocks" : "shared-blocks locked"}>{canViewBlocks ? strategy.blocks.map((block,index) => <div key={block}><b>{index === 0 ? "조건" : index === strategy.blocks.length - 1 ? "보호" : "실행"}</b><span>{block}</span>{index < strategy.blocks.length - 1 && <i>↓</i>}</div>) : <><span>잠긴 조건</span><strong>구독 후 조건의 기준 시간과 퍼센트를 확인할 수 있습니다.</strong></>}</div></section></div>
      <aside className="subscribe-panel panel"><span className="subscribe-price">{strategy.priceMonthly === 0 ? "무료 예시 전략" : <><b>월 {strategy.priceMonthly.toLocaleString("ko-KR")}원</b><small>결제·환불 연동 전 잠금</small></>}</span>{strategy.isMine ? <><div className="owner-notice"><strong>내가 게시한 전략입니다</strong><p>판매 상태와 예상 정산은 판매자 센터에서 관리합니다.</p></div><button type="button" className="btn primary wide" onClick={() => go("creator")}>판매자 센터 열기</button></> : subscribed ? <><div className="active-subscription"><strong>구독 중</strong><p>손실 한도 {subscription?.riskLimit}% · 운용 비중 {subscription?.allocation}%</p></div><button type="button" className="btn secondary wide" onClick={() => go("operations")}>운영 상태 보기</button><button type="button" className="btn danger wide" disabled={busy !== ""} onClick={() => perform({ action:"unsubscribe", strategyId:strategy.id }, "전략 구독을 해지했습니다")}>구독 해지</button></> : <><h3>내 안전 기준 설정</h3><label>일일 손실 한도<strong>{riskLimit}%</strong><input aria-label="구독 전략 일일 손실 한도" type="range" min="1" max="10" step="1" value={riskLimit} onChange={(event) => setRiskLimit(Number(event.target.value))} /></label><label>운용 가능 자산 비중<strong>{allocation}%</strong><input aria-label="구독 전략 운용 비중" type="range" min="5" max="100" step="5" value={allocation} onChange={(event) => setAllocation(Number(event.target.value))} /></label><button type="button" className="subscription-check" aria-pressed={acknowledged} onClick={() => setAcknowledged(!acknowledged)}><Check checked={acknowledged} /><span><strong>위험 지표를 확인했습니다</strong><small>제작자 설정보다 내 손실 한도가 우선합니다.</small></span></button><button type="button" className="btn primary wide" disabled={strategy.priceMonthly > 0 || !acknowledged || busy !== ""} onClick={() => perform({ action:"subscribe", strategyId:strategy.id, riskLimit, allocation }, "무료 예시 전략을 복제했습니다")}>{strategy.priceMonthly === 0 ? "무료 예시 복제" : "유료 구독 준비 중"}</button></>}<div className="subscribe-safety"><strong>보호 원칙</strong><p>현재 유료 결제와 실제 자동 주문은 잠겨 있습니다. 신호 전용 전략의 조건은 구독자에게도 공개하지 않습니다.</p></div></aside>
    </section></div>;
}

function CreatorStudio({ snapshot, blocks, profile, plan, go, perform, busy }: { snapshot: MarketplaceSnapshot; blocks: StrategyBlock[]; profile: Profile; plan: Plan; go: (screen: Screen) => void; perform: (input: MarketplaceCommandInput, message: string) => Promise<boolean>; busy: string }) {
  const [name, setName] = useState("ETH 기준가 변동 전략");
  const [description, setDescription] = useState("기준 시간과 기준 가격을 명확하게 설정하고 손실 한도를 함께 적용하는 조건형 전략입니다.");
  const [category, setCategory] = useState("스윙");
  const [risk, setRisk] = useState<MarketplaceRisk>("보통");
  const [price, setPrice] = useState(9900);
  const [visibility, setVisibility] = useState<MarketplaceStrategy["visibility"]>("subscribers");
  const conditionSummary = blocks.find((block) => block.config?.type === "price_change")?.label || blocks.find((block) => block.kind === "condition")?.label || "조건 기준 확인 필요";
  const mine = snapshot.strategies.filter((strategy) => strategy.isMine);
  const publish = async () => {
    const success = await perform({ action:"publish", listing:{ name, description, category, risk, priceMonthly:price, visibility, conditionSummary, blocks:blocks.map((block) => block.label) } }, "전략을 마켓 검증 대기로 등록했습니다");
    if (success) { setName(""); setDescription(""); }
  };
  const canPublish = plan !== "Free";
  const publishProtected = async () => {
    if (!canPublish) { go("billing"); return; }
    const success = await perform({ action:"publish", listing:{ name, description, category, risk, priceMonthly:0, visibility:"signal_only", conditionSummary, blocks:blocks.map((block) => block.label) } }, "원본 비공개 전략을 검증 대기로 등록했습니다");
    if (success) { setName(""); setDescription(""); }
  };
  if (plan) return <div className="product-page creator-page protected-creator-page"><PageTitle title="전략 제작자 센터" subtitle="원본은 공개하지 않고 서버 실행 사용권으로 전략을 수익화합니다" action={<div className="inline-actions"><button type="button" className="btn secondary" onClick={() => go("builder")}>← 전략 수정</button><button type="button" className="btn secondary" onClick={() => go("market")}>전략 마켓</button></div>} />
    <section className={`market-access-strip ${canPublish ? "eligible" : "restricted"}`}><div><span>{PLAN_LABELS[plan]} 플랜</span><strong>{canPublish ? "전략 게시 가능" : "전략 게시 잠금"}</strong><p>{canPublish ? "게시 원본은 서버에만 보관되고 구매자에게는 실행 사용권만 발급됩니다." : "Pro 또는 Gold 플랜에서 전략을 게시하고 사용권을 제공할 수 있습니다."}</p></div>{!canPublish && <button type="button" className="btn primary" onClick={() => go("billing")}>플랜 선택하기</button>}</section>
    <section className="creator-summary protected-creator-summary"><article><span>게시 전략</span><strong>{snapshot.creator.listedCount}개</strong><small>검증 대기 포함</small></article><article><span>활성 이용자</span><strong>{snapshot.creator.activeSubscribers.toLocaleString("ko-KR")}명</strong><small>서버 실행 사용권</small></article><article><span>기본 성과보수</span><strong>{DEFAULT_PROFIT_SHARE_PCT}%</strong><small>순신규 실현이익만</small></article><article><span>제작자 배분</span><strong>{CREATOR_FEE_SPLIT_PCT}%</strong><small>플랫폼 {PLATFORM_FEE_SPLIT_PCT}% · 실정산 잠금</small></article></section>
    <section className="creator-grid"><form className="publish-form panel" onSubmit={(event) => event.preventDefault()}><header><div><h2>원본 비공개 전략 게시</h2><p>현재 빌더의 {blocks.length}개 블록을 소유자 전용 원본으로 저장합니다.</p></div><span>{profile.nickname}</span></header><label>전략 이름<input value={name} onChange={(event) => setName(event.target.value)} maxLength={50} placeholder="전략 이름" /></label><label>공개 설명<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="시장 성격과 위험 수준만 설명하세요. 정확한 수치나 임계값은 쓰지 마세요." /><em>정확한 퍼센트·주기·RSI 수치는 공개 설명에 입력할 수 없습니다.</em></label><div className="publish-row"><label>카테고리<select value={category} onChange={(event) => setCategory(event.target.value)}><option>적립식</option><option>스윙</option><option>돌파</option><option>리밸런싱</option></select></label><label>위험도<select value={risk} onChange={(event) => setRisk(event.target.value as MarketplaceRisk)}><option>낮음</option><option>보통</option><option>높음</option></select></label></div><section className="protected-publish-policy"><header><span>고정 배포 정책</span><b>변경 불가</b></header><dl><div><dt>전달 방식</dt><dd>서버 실행 전용</dd></div><div><dt>원본 접근</dt><dd>제작자만</dd></div><div><dt>성과보수</dt><dd>{DEFAULT_PROFIT_SHARE_PCT}% · HWM</dd></div><div><dt>정산 배분</dt><dd>제작자 {CREATOR_FEE_SPLIT_PCT}% / 플랫폼 {PLATFORM_FEE_SPLIT_PCT}%</dd></div></dl></section><div className="publish-condition protected-source-preview"><span>소유자 전용 원본 미리보기</span><strong>{conditionSummary}</strong><small>이 내용과 전체 블록은 구매자 화면·API 응답에 포함되지 않습니다.</small></div>{canPublish ? <button type="button" className="btn primary wide" onClick={() => void publishProtected()} disabled={busy !== "" || name.trim().length < 3 || description.trim().length < 12 || blocks.length < 2}>원본 비공개로 검증 요청</button> : <button type="button" className="btn primary wide" onClick={() => go("billing")}>Pro·Gold 플랜 선택</button>}<p className="publish-notice">성과는 사용자가 입력할 수 없습니다. 플랫폼이 검증한 모의·실운영 기록만 표시되며 실제 성과정산은 현재 잠겨 있습니다.</p></form>
      <section className="my-listings panel"><header><div><h2>내 게시 전략</h2><p>원본 보호 상태, 검증 상태와 이용자 수를 관리합니다.</p></div></header>{mine.length === 0 ? <div className="creator-empty"><span>없음</span><strong>아직 게시한 전략이 없습니다</strong><p>왼쪽 양식에서 현재 전략을 등록해보세요.</p></div> : mine.map((strategy) => <article key={strategy.id}><header><div><span className={`verification ${strategy.verification === "검증 대기" ? "pending" : "verified"}`}>{strategy.verification}</span><h3>{strategy.name}</h3><p>원본 비공개 · 성과보수 {strategy.profitSharePct}% · 이용자 {strategy.subscribers}명</p></div><b className={strategy.status === "listed" ? "listing-on" : "listing-off"}>{strategy.status === "listed" ? "게시 중" : "사용 중지"}</b></header><dl><div><dt>90일 수익률</dt><dd>{strategy.liveDays === 0 ? "데이터 수집 중" : `${strategy.return90d}%`}</dd></div><div><dt>신뢰 점수</dt><dd>{strategy.liveDays === 0 ? "검증 대기" : `${strategy.trustScore}/100`}</dd></div><div><dt>성과 정산</dt><dd>연동 전 잠금</dd></div></dl><button type="button" className="btn secondary wide" disabled={busy !== ""} onClick={() => perform({ action:"toggle_listing", strategyId:strategy.id }, strategy.status === "listed" ? "전략 사용권 제공을 일시중지했습니다" : "전략 사용권 제공을 다시 시작했습니다")}>{strategy.status === "listed" ? "사용권 제공 일시중지" : "사용권 제공 다시 시작"}</button></article>)}</section></section>
  </div>;
  return <div className="product-page creator-page"><PageTitle title="판매자 센터" subtitle="내 조건 블록을 공유하고 검증된 전략으로 수익화하세요" action={<div className="inline-actions"><button type="button" className="btn secondary" onClick={() => go("builder")}>← 전략 수정</button><button type="button" className="btn secondary" onClick={() => go("market")}>전략 마켓</button></div>} />
    <section className="creator-summary"><article><span>게시 전략</span><strong>{snapshot.creator.listedCount}개</strong><small>검증 대기 포함</small></article><article><span>활성 구독자</span><strong>{snapshot.creator.activeSubscribers.toLocaleString("ko-KR")}명</strong><small>게시 중 전략 합계</small></article><article><span>예상 성과보수</span><strong>₩{snapshot.creator.estimatedPerformanceFee.toLocaleString("ko-KR")}</strong><small>실현손익 연동 전</small></article><article><span>예상 제작자 정산</span><strong className="positive">₩{snapshot.creator.estimatedCreatorPayout.toLocaleString("ko-KR")}</strong><small>예시 정산율 80%</small></article></section>
    <section className="creator-grid"><form className="publish-form panel" onSubmit={(event) => event.preventDefault()}><header><div><h2>새 전략 게시</h2><p>현재 빌더의 {blocks.length}개 블록을 게시합니다.</p></div><span>{profile.nickname}</span></header><label>전략 이름<input value={name} onChange={(event) => setName(event.target.value)} maxLength={50} placeholder="전략 이름" /></label><label>전략 설명<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="어떤 시장과 위험 수준에 적합한지 설명하세요" /></label><div className="publish-row"><label>카테고리<select value={category} onChange={(event) => setCategory(event.target.value)}><option>적립식</option><option>스윙</option><option>돌파</option><option>리밸런싱</option></select></label><label>위험도<select value={risk} onChange={(event) => setRisk(event.target.value as MarketplaceRisk)}><option>낮음</option><option>보통</option><option>높음</option></select></label></div><label>월 구독료<input aria-label="전략 월 구독료" type="number" min="0" max="300000" step="1000" value={price} onChange={(event) => setPrice(Math.min(300000, Math.max(0, Number(event.target.value) || 0)))} /><em>원 · 0원은 무료 공유</em></label><fieldset><legend>조건 공개 범위</legend>{[["public","전체 조건 공개"],["subscribers","구독 후 세부 수치 공개"],["signal_only","조건 비공개·신호만 제공"]].map(([value,label]) => <button type="button" key={value} className={visibility === value ? "selected" : ""} onClick={() => setVisibility(value as MarketplaceStrategy["visibility"])}>{label}</button>)}</fieldset><div className="publish-condition"><span>대표 조건</span><strong>{conditionSummary}</strong><small>게시 후 성과 지표는 플랫폼의 모의·실운영 기록으로만 갱신됩니다.</small></div><button type="button" className="btn primary wide" onClick={() => void publish()} disabled={busy !== "" || name.trim().length < 3 || description.trim().length < 12 || blocks.length < 2}>검증 대기로 게시하기</button><p className="publish-notice">사용자가 입력한 수익률은 게시할 수 없습니다. 수수료·슬리피지를 반영한 플랫폼 기록만 표시합니다.</p></form>
      <section className="my-listings panel"><header><div><h2>내 판매 전략</h2><p>게시 상태와 구독자 수를 관리합니다.</p></div></header>{mine.length === 0 ? <div className="creator-empty"><span>없음</span><strong>아직 게시한 전략이 없습니다</strong><p>왼쪽 양식에서 현재 전략을 등록해보세요.</p></div> : mine.map((strategy) => <article key={strategy.id}><header><div><span className={`verification ${strategy.verification === "검증 대기" ? "pending" : "verified"}`}>{strategy.verification}</span><h3>{strategy.name}</h3><p>{strategy.priceMonthly === 0 ? "무료" : `월 ${strategy.priceMonthly.toLocaleString("ko-KR")}원`} · 구독자 {strategy.subscribers}명</p></div><b className={strategy.status === "listed" ? "listing-on" : "listing-off"}>{strategy.status === "listed" ? "게시 중" : "판매 중지"}</b></header><dl><div><dt>90일 수익률</dt><dd>{strategy.liveDays === 0 ? "데이터 수집 중" : `${strategy.return90d}%`}</dd></div><div><dt>신뢰 점수</dt><dd>{strategy.liveDays === 0 ? "검증 대기" : `${strategy.trustScore}/100`}</dd></div><div><dt>월 예상 매출</dt><dd>₩{(strategy.subscribers * strategy.priceMonthly).toLocaleString("ko-KR")}</dd></div></dl><button type="button" className="btn secondary wide" disabled={busy !== ""} onClick={() => perform({ action:"toggle_listing", strategyId:strategy.id }, strategy.status === "listed" ? "전략 판매를 일시중지했습니다" : "전략 판매를 다시 시작했습니다")}>{strategy.status === "listed" ? "판매 일시중지" : "판매 다시 시작"}</button></article>)}</section></section>
  </div>;
}

function Backtest({ go, setBlocks, notify }: { go: (screen: Screen) => void; setBlocks: React.Dispatch<React.SetStateAction<StrategyBlock[]>>; notify: (message: string) => void }) {
  const addRiskBlock = () => {
    const config = { ...DEFAULT_RISK_CONFIG };
    setBlocks((state) => state.some((item) => item.config?.type === "risk_action" && item.config.rule === "stop_loss") ? state : [...state, { id: Date.now(), kind:"risk", label:riskActionLabel(config), config }]);
    notify("손절 5% 블록을 전략에 추가했습니다");
    go("builder");
  };
  return <div className="product-page backtest-page"><PageTitle title="예시 백테스트 결과" subtitle="검증되지 않은 UI 샘플 · 현재 전략 및 실제 시장 데이터와 미연결" action={<div className="inline-actions"><button type="button" className="btn secondary" onClick={() => go("builder")}>← 전략 수정</button><button type="button" className="btn primary validation-locked" disabled aria-describedby="backtest-gate-help" title="전략 버전, 시장 데이터, 비용 모델과 표본 외 검증이 필요합니다">검증 완료 후 모의 운영 가능</button></div>} />
    <div className="complete-bar blocked"><b>차단</b><strong>UI 예시 · 의사결정 금지</strong><span>실제 시세 데이터·현재 블록·수수료·슬리피지·주문 실행과 연결되지 않았습니다</span></div>
    <section className="backtest-gate panel" aria-labelledby="backtest-gate-title">
      <header><div><span>운영 전환 게이트</span><h2 id="backtest-gate-title">검증 5개 항목 미충족</h2></div><b>전환 차단</b></header>
      <div>{[
        ["전략 버전·콘텐츠 해시","미생성"],
        ["시장 데이터 출처·기준 시각","미연결"],
        ["수수료·슬리피지 모델","예시만 존재"],
        ["표본 외·워크포워드 검증","미실행"],
        ["벤치마크·용량·스트레스 검증","미실행"],
      ].map(([label,status]) => <article key={label}><span>{label}</span><b>{status}</b></article>)}</div>
      <p id="backtest-gate-help">모든 항목이 서버 검증을 통과하고 결과 버전이 고정되기 전에는 모의 운영 검토로 이동할 수 없습니다.</p>
    </section>
    <section className="summary-grid backtest-summary">{[["총 수익률","+18.4%","UI 샘플 · 비교 기준 미연결","green"],["최대 낙폭","-7.3%","UI 샘플 · 계산 근거 미연결","red"],["승률","72.4%","UI 샘플 · 29전 21승 8패",""],["샤프 비율","1.83","UI 샘플 · 무위험수익률 미설정",""]].map((item) => <article className="summary-card" key={item[0]}><label>{item[0]} <em>예시</em></label><strong className={item[3]}>{item[1]}</strong><p>{item[2]}</p></article>)}</section>
    <section className="backtest-grid"><article className="panel chart-panel"><div className="panel-header"><div><h2>예시 자본금 변화 (90일)</h2><p>샘플 시작 ₩3,000,000 → ₩3,552,000</p></div><span>SAMPLE-90D · 합성 데이터</span></div><div className="line-chart" role="img" aria-label="감사나 투자 판단에 사용할 수 없는 예시 자본금 변화 차트"><div className="chart-grid" /><div className="area-shape" />{[24,31,28,42,38,48,44,59,54,68,64,78,73,88].map((point,index) => <i key={index} style={{ left:`${index*7.65}%`, bottom:`${point}%` }} />)}<strong>예시 ₩3,552,000</strong><small>샘플 시작　　　　　　　　　　　　　　　　　　　　　　　　　　　　90일</small></div><p className="chart-provenance">데이터 ID: SAMPLE-90D · 생성 규칙: 고정 UI fixture · 실제 캔들/호가/체결 미사용</p></article><article className="panel monthly-panel"><h2>예시 월별 성과</h2>{[["1월","+6.2%"],["2월","-3.1%"],["3월","+15.3%"]].map((item) => <div key={item[0]}><span>{item[0]}</span><i><b style={{width:item[1].startsWith("-")?"22%":"72%"}} /></i><strong className={item[1].startsWith("-")?"negative":"positive"}>{item[1]}</strong></div>)}<footer><strong>+18.4%</strong><span>+12.2%p<br /><small>가상 벤치마크 대비</small></span></footer></article></section>
    <section className="backtest-validation-grid">
      <article className="panel backtest-methodology"><div className="panel-header"><div><h2>검증 메타데이터</h2><p>결과를 재현하고 승인하려면 반드시 채워져야 합니다.</p></div><span>0 / 6 연결</span></div><dl><div><dt>전략 버전</dt><dd>미연결</dd></div><div><dt>데이터셋 ID</dt><dd>UI-SAMPLE</dd></div><div><dt>거래 비용</dt><dd>미적용</dd></div><div><dt>슬리피지</dt><dd>미적용</dd></div><div><dt>표본 외 구간</dt><dd>미지정</dd></div><div><dt>재현 실행 ID</dt><dd>미생성</dd></div></dl></article>
      <article className="panel validation-next-steps"><div className="panel-header"><div><h2>다음 검증 작업</h2><p>운영 전환 전에 서버가 통과시켜야 하는 순서입니다.</p></div><span>필수</span></div><ol><li><b>01</b><span>전략 버전 고정과 콘텐츠 해시 생성</span></li><li><b>02</b><span>시세 원천·결측·이상치 품질 검사</span></li><li><b>03</b><span>수수료·슬리피지·체결 가능성 재계산</span></li><li><b>04</b><span>표본 외·워크포워드·스트레스 검증</span></li><li><b>05</b><span>독립 검토자 승인과 결과 봉인</span></li></ol></article>
    </section>
    <section className="panel trades sample-trades"><div className="panel-header"><div><h2>예시 체결 내역 (최근 4건)</h2><p>실제 거래소 체결이 아닌 고정 UI 샘플입니다.</p></div><span>PAPER</span></div>{[["03/14","ETH +2.5% 조건","₩3,182,000","+₩48,200","매도"],["03/11","ETH +2.5% 조건","₩2,950,000","+₩31,500","매도"],["03/09","리밸런싱 매수","₩2,880,000","—","매수"],["03/06","ETH +2.5% 조건","₩2,920,000","-₩12,300","매도"]].map((row) => <div key={row[0]}><time data-label="일자">{row[0]}</time><span data-label="신호">{row[1]}</span><b data-label="예시 자산">{row[2]}</b><em data-label="예시 손익" className={row[3].startsWith("-")?"negative":"positive"}>{row[3]}</em><i data-label="구분">{row[4]}</i></div>)}</section>
    <div className="weakness"><div><strong>이 전략의 약점</strong><p>하락장(`24.10 ~ `25.02) 구간에서 -8% 손실 · 리스크 회피형 손절 5% 추가 권장</p></div><div className="weakness-actions"><button type="button" onClick={() => go("postmortem")}>실패 구간 분석</button><button type="button" onClick={addRiskBlock}>손절 블록 적용 →</button></div></div>
  </div>;
}

function ExecutionReview({ go, notify }: { go: (screen: Screen) => void; notify: (message: string) => void }) {
  const [dailyLoss, setDailyLoss] = useState("3");
  const [confirmed, setConfirmed] = useState(false);
  const start = () => {
    if (!confirmed) return;
    notify("모의 운영 전략을 시작했습니다. 실제 주문은 전송되지 않습니다");
    go("operations");
  };
  return <div className="product-page execution-page"><PageTitle title="모의 운영 시작 전 검토" subtitle="예시 백테스트와 손실 한도를 확인한 뒤 모의 전략을 실행합니다" action={<button type="button" className="btn secondary" onClick={() => go("backtest")}>← 백테스트 결과</button>} /><section className="execution-grid"><article className="panel review-panel"><h2>전략 요약</h2><dl><div><dt>전략</dt><dd>ETH 급등 익절 전략 · 예시</dd></div><div><dt>백테스트</dt><dd>예시 결과 +18.4% · MDD -7.3%</dd></div><div><dt>거래 방식</dt><dd>조건 충족 시 모의 지정 비율 매도</dd></div><div><dt>거래소 API</dt><dd>사용하지 않음 · 외부 주문 차단</dd></div></dl></article><article className="panel risk-controls"><h2>모의 위험 한도</h2><label>일일 최대 손실률<select value={dailyLoss} onChange={(event) => setDailyLoss(event.target.value)}><option value="1">1%</option><option value="3">3%</option><option value="5">5%</option></select></label><p>모의 손실률이 {dailyLoss}%에 도달하면 전략 상태를 중단합니다.</p><button type="button" className="execution-confirm" aria-pressed={confirmed} onClick={() => setConfirmed(!confirmed)}><Check checked={confirmed} /><span><strong>예시 결과와 모의 운영임을 확인했습니다</strong><small>실제 주문·결제·수익 보장은 없습니다.</small></span></button><button type="button" className="btn primary wide" disabled={!confirmed} onClick={start}>모의 운영 시작</button><small className="execution-help">운영센터에서 데모 상태를 일시정지할 수 있습니다.</small></article></section></div>;
}

const ORDER_STATUS_LABELS: Record<OrderRunStatus, string> = {
  queued: "대기",
  submitted: "주문 접수",
  partially_filled: "부분 체결",
  filled: "체결 완료",
  cancelled: "취소 완료",
  failed: "확인 필요",
};

function formatOperationPnl(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₩${Math.abs(value).toLocaleString("ko-KR")}`;
}

function OperationsCenter({ go, notify }: { go: (screen: Screen) => void; notify: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<OperationSnapshot>(DEFAULT_OPERATION_SNAPSHOT);
  const [connectionState, setConnectionState] = useState<"loading" | "synced" | "error">("loading");
  const [orderFilter, setOrderFilter] = useState<"all" | "open" | "attention">("all");
  const [selectedOrderId, setSelectedOrderId] = useState(DEFAULT_OPERATION_SNAPSHOT.orders[0].id);
  const [busy, setBusy] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [emergencyMode, setEmergencyMode] = useState<"stop" | "reset" | null>(null);
  const [emergencyPhrase, setEmergencyPhrase] = useState("");
  const [cancelOpenOrders, setCancelOpenOrders] = useState(true);
  const [pendingStrategyControl, setPendingStrategyControl] = useState<{ action: "pause_strategy" | "resume_strategy"; strategyId: string; strategyName: string } | null>(null);
  const [strategyControlConfirmed, setStrategyControlConfirmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadOperationSnapshot(controller.signal)
      .then((result) => {
        setSnapshot(result);
        setSelectedOrderId((current) => result.orders.some((order) => order.id === current) ? current : result.orders[0]?.id || "");
        setConnectionState("synced");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setConnectionState("error");
      });
    return () => controller.abort();
  }, [reloadToken]);

  const visibleOrders = useMemo(() => snapshot.orders.filter((order) => {
    if (orderFilter === "open") return ["queued", "submitted", "partially_filled"].includes(order.status);
    if (orderFilter === "attention") return order.status === "failed";
    return true;
  }), [orderFilter, snapshot.orders]);
  const selectedOrder = snapshot.orders.find((order) => order.id === selectedOrderId) || snapshot.orders[0];
  const runningCount = snapshot.strategies.filter((strategy) => strategy.status === "running").length;
  const openOrderCount = snapshot.orders.filter((order) => ["queued", "submitted", "partially_filled"].includes(order.status)).length;
  const pnlToday = snapshot.strategies.reduce((sum, strategy) => sum + strategy.pnlToday, 0);

  const perform = async (command: OperationCommandInput, successMessage: string) => {
    if (connectionState !== "synced") {
      notify("운영 데이터 연결을 먼저 복구해주세요");
      return;
    }
    setBusy(command.action);
    try {
      const result = await sendOperationCommand(command);
      setSnapshot(result.snapshot);
      notify(successMessage);
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : "운영 명령을 처리하지 못했습니다");
      setConnectionState("error");
    } finally {
      setBusy("");
    }
  };

  const confirmEmergency = async () => {
    if (!emergencyMode) return;
    const requiredPhrase = emergencyMode === "stop" ? "긴급중단" : "운영복구";
    if (emergencyPhrase !== requiredPhrase) return;
    if (emergencyMode === "stop") {
      await perform({ action: "emergency_stop", cancelOpenOrders }, "모의 운영을 긴급 중단했습니다");
    } else {
      await perform({ action: "reset_demo" }, "모의 운영 상태를 초기화했습니다");
    }
    setEmergencyMode(null);
    setEmergencyPhrase("");
  };

  const confirmStrategyControl = async () => {
    if (!pendingStrategyControl || !strategyControlConfirmed) return;
    const { action, strategyId, strategyName } = pendingStrategyControl;
    await perform({ action, strategyId }, action === "pause_strategy" ? `${strategyName}을 일시정지했습니다` : `${strategyName}을 재개했습니다`);
    setPendingStrategyControl(null);
    setStrategyControlConfirmed(false);
  };

  return <div className="product-page operations-page">
    <PageTitle title="모의 운영센터" subtitle="PAPER 전략·주문·위험 상태 · 외부 거래소 주문 전송 없음" action={<div className="inline-actions"><button type="button" className="btn secondary" onClick={() => go("builder")}>전략 편집</button>{snapshot.settings.emergencyStatus === "stopped" ? <button type="button" className="btn secondary" disabled={busy !== ""} onClick={() => { setEmergencyMode("reset"); setEmergencyPhrase(""); }}>데모 복구 검토</button> : <button type="button" className="btn danger emergency-trigger" onClick={() => { setEmergencyMode("stop"); setEmergencyPhrase(""); }}>데모 중단 검토</button>}</div>} />

    <div className={`operations-health ${snapshot.settings.emergencyStatus === "stopped" ? "stopped" : ""}`}>
      <div><i /><span><strong>{snapshot.settings.emergencyStatus === "stopped" ? "PAPER 상태 중단" : "PAPER 모의 운영 정상"}</strong><small>샘플 상태만 저장되며 거래소 주문은 전송되지 않습니다</small></span></div>
      <dl><div><dt>환경</dt><dd>PAPER</dd></div><div><dt>외부 주문</dt><dd>0건 · 차단</dd></div><div><dt>마지막 응답</dt><dd>{connectionState === "synced" ? "방금 전" : connectionState === "loading" ? "동기화 중" : "연결 지연"}</dd></div><div><dt>데이터 저장</dt><dd>{connectionState === "synced" ? "서버 저장됨" : "재확인 필요"}</dd></div></dl>
      {connectionState === "error" && <button type="button" className="btn secondary" onClick={() => { setConnectionState("loading"); setReloadToken((value) => value + 1); }}>다시 연결</button>}
    </div>

    <section className="summary-grid operations-summary">
      <article className="summary-card"><label>실행 전략</label><strong>{runningCount}/{snapshot.strategies.length}</strong><p>{snapshot.strategies.length - runningCount}개 일시정지·중단</p></article>
      <article className="summary-card"><label>진행 주문</label><strong>{openOrderCount}건</strong><p>부분 체결 포함</p></article>
      <article className="summary-card"><label>오늘 전략 손익</label><strong className={pnlToday >= 0 ? "positive" : "negative"}>{formatOperationPnl(pnlToday)}</strong><p>모의 체결 기준</p></article>
      <article className="summary-card"><label>일일 손실 한도</label><strong>{snapshot.settings.currentLoss}% / {snapshot.settings.dailyLossLimit}%</strong><div className="loss-limit"><i style={{ width: `${Math.min(100, snapshot.settings.currentLoss / snapshot.settings.dailyLossLimit * 100)}%` }} /></div></article>
    </section>

    <section className="operations-grid">
      <article className="panel live-strategies">
        <div className="panel-header"><div><h2>전략 제어</h2><p>일시정지는 새 주문만 막고 진행 주문은 계속 추적합니다.</p></div><span>{runningCount}개 실행 중</span></div>
        <div className="strategy-control-list">{snapshot.strategies.map((strategy) => <article key={strategy.id} className={`strategy-control ${strategy.status}`}><header><div><span className={`run-dot ${strategy.status}`} /> <small>{strategy.status === "running" ? "실행 중" : strategy.status === "paused" ? "일시정지" : "중단"} · PAPER</small></div><b className={strategy.risk === "높음" ? "risk-high" : ""}>위험 {strategy.risk}</b></header><h3>{strategy.name}</h3><p>{strategy.market} · 모의 노출 {strategy.exposure}</p><dl><div><dt>오늘 모의 손익</dt><dd className={strategy.pnlToday >= 0 ? "positive" : "negative"}>{formatOperationPnl(strategy.pnlToday)}</dd></div><div><dt>30일 예시</dt><dd>{strategy.pnl30d > 0 ? "+" : ""}{strategy.pnl30d}%</dd></div><div><dt>최근 모의 신호</dt><dd>{strategy.lastSignalAt}</dd></div></dl><div className="strategy-control-actions"><button type="button" className="btn secondary" onClick={() => go("builder")}>편집</button>{strategy.status !== "stopped" && <button type="button" className={strategy.status === "running" ? "btn pause" : "btn primary"} disabled={busy !== "" || snapshot.settings.emergencyStatus === "stopped"} onClick={() => { setPendingStrategyControl({ action: strategy.status === "running" ? "pause_strategy" : "resume_strategy", strategyId: strategy.id, strategyName: strategy.name }); setStrategyControlConfirmed(false); }}>{strategy.status === "running" ? "일시정지 검토" : "재개 검토"}</button>}</div></article>)}</div>
      </article>

      <aside className="panel order-focus" aria-live="polite">
        <div className="panel-header"><div><h2>선택 모의 주문 <em className="paper-object-badge">PAPER</em></h2><p>{selectedOrder?.id || "주문 없음"}</p></div>{selectedOrder && <span className={`order-status ${selectedOrder.status}`}>{ORDER_STATUS_LABELS[selectedOrder.status]}</span>}</div>
        {selectedOrder ? <><div className="order-focus-main"><strong>{selectedOrder.market}</strong><span className={selectedOrder.side === "buy" ? "buy-text" : "sell-text"}>{selectedOrder.side === "buy" ? "매수" : "매도"}</span><p>{selectedOrder.strategyName}</p></div><div className="order-progress" aria-label={`체결 진행률 ${selectedOrder.filledRatio}%`}><i style={{ width: `${selectedOrder.filledRatio}%` }} /></div><b className="progress-label">체결 {selectedOrder.filledRatio}%</b><dl><div><dt>주문 수량</dt><dd>{selectedOrder.amount}</dd></div><div><dt>주문 가격</dt><dd>{selectedOrder.price}</dd></div><div><dt>생성 시각</dt><dd>{selectedOrder.createdAt}</dd></div><div><dt>마지막 변경</dt><dd>{selectedOrder.updatedAt}</dd></div></dl>{selectedOrder.failureReason && <div className="order-warning"><strong>체결 여부 확인 완료</strong><p>{selectedOrder.failureReason}</p></div>}<div className="order-steps">{["전략 신호", "주문 접수", "거래소 확인", "체결 완료"].map((step, index) => { const activeStep = selectedOrder.status === "filled" ? 4 : selectedOrder.status === "partially_filled" ? 3 : selectedOrder.status === "submitted" ? 2 : selectedOrder.status === "failed" ? 2 : selectedOrder.status === "cancelled" ? 2 : 1; return <span className={index < activeStep ? "done" : ""} key={step}><i>{index + 1}</i>{step}</span>; })}</div></> : <p className="empty-table">표시할 주문이 없습니다.</p>}
      </aside>
    </section>

    <section className="panel live-orders">
      <div className="orders-toolbar"><div><h2>모의 주문 상태</h2><p>거래소 체결이 아닌 데모 상태 변경 기록입니다.</p></div><div>{[["all","전체"],["open","진행 중"],["attention","확인 필요"]].map(([value,label]) => <button type="button" key={value} className={orderFilter === value ? "active" : ""} onClick={() => setOrderFilter(value as typeof orderFilter)}>{label}</button>)}</div></div>
      <div className="live-order-table-wrap"><table className="live-order-table"><thead><tr><th>주문 / 시각</th><th>마켓</th><th>구분</th><th>전략</th><th>수량</th><th>진행률</th><th>상태</th><th>조치</th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.id} className={selectedOrderId === order.id ? "selected" : ""}><td data-label="모의 주문"><button type="button" className="order-id-button" onClick={() => setSelectedOrderId(order.id)}><strong>{order.id}</strong><small>{order.createdAt} · PAPER</small></button></td><td data-label="마켓"><b>{order.market}</b></td><td data-label="구분"><span className={`side-badge ${order.side === "buy" ? "buy" : "sell"}`}>{order.side === "buy" ? "매수" : "매도"}</span></td><td data-label="전략">{order.strategyName}</td><td data-label="수량">{order.amount}</td><td data-label="진행률"><span className="mini-progress"><i style={{ width: `${order.filledRatio}%` }} /></span>{order.filledRatio}%</td><td data-label="상태"><span className={`order-status ${order.status}`}>{ORDER_STATUS_LABELS[order.status]}</span></td><td data-label="조치">{["queued","submitted","partially_filled"].includes(order.status) ? <button type="button" className="table-action" disabled={busy !== ""} onClick={() => perform({ action: "cancel_order", orderId: order.id }, `${order.id} 데모 취소 상태를 저장했습니다`)}>데모 취소 처리</button> : order.status === "failed" ? <button type="button" className="table-action" disabled={busy !== ""} onClick={() => perform({ action: "retry_order", orderId: order.id }, `${order.id}을 데모 재확인 대기로 전환했습니다`)}>데모 재확인</button> : <button type="button" className="table-action subtle" onClick={() => setSelectedOrderId(order.id)}>상세 보기</button>}</td></tr>)}</tbody></table>{visibleOrders.length === 0 && <div className="empty-table">선택한 상태의 주문이 없습니다.</div>}</div>
    </section>

    <section className="panel operation-events"><div className="panel-header"><div><h2>운영 이벤트</h2><p>사용자 조치와 시스템 보호 동작을 시간순으로 기록합니다.</p></div><button type="button" className="text-link" onClick={() => go("notifications")}>전체 알림 →</button></div>{snapshot.events.slice(0, 6).map((event) => <article key={event.id}><i className={event.severity}>{event.severity === "critical" ? "중단" : event.severity === "warning" ? "주의" : "정상"}</i><div><strong>{event.message}</strong><small>{event.orderId ? `주문 ${event.orderId}` : "전략 상태 변경"}</small></div><time>{event.createdAt}</time></article>)}</section>

    {pendingStrategyControl && <div className="modal-backdrop" role="presentation"><section className="emergency-modal control-review-modal" role="dialog" aria-modal="true" aria-labelledby="strategy-control-title"><header><span>검토</span><div><small>PAPER 제어</small><h2 id="strategy-control-title">{pendingStrategyControl.action === "pause_strategy" ? "전략 일시정지 검토" : "전략 재개 검토"}</h2></div></header><p><b>{pendingStrategyControl.strategyName}</b>의 모의 상태를 변경합니다. 실제 주문·취소·거래소 계정에는 영향을 주지 않습니다.</p><dl className="control-impact-list"><div><dt>환경</dt><dd>PAPER</dd></div><div><dt>영향 범위</dt><dd>{pendingStrategyControl.action === "pause_strategy" ? "새 모의 주문 생성 중단" : "새 모의 주문 생성 허용"}</dd></div><div><dt>실거래 요구사항</dt><dd>강한 재인증 + 독립 승인자</dd></div></dl><button type="button" className="emergency-option" aria-pressed={strategyControlConfirmed} onClick={() => setStrategyControlConfirmed(!strategyControlConfirmed)}><Check checked={strategyControlConfirmed} /><span><strong>대상과 PAPER 영향 범위를 확인했습니다</strong><small>이 확인은 실거래 승인이나 권한 부여가 아닙니다.</small></span></button><div><button type="button" className="btn secondary" onClick={() => { setPendingStrategyControl(null); setStrategyControlConfirmed(false); }}>돌아가기</button><button type="button" className={pendingStrategyControl.action === "pause_strategy" ? "btn danger solid" : "btn primary"} disabled={!strategyControlConfirmed || busy !== ""} onClick={confirmStrategyControl}>{pendingStrategyControl.action === "pause_strategy" ? "PAPER 전략 일시정지" : "PAPER 전략 재개"}</button></div></section></div>}
    {emergencyMode && <div className="modal-backdrop" role="presentation"><section className="emergency-modal" role="dialog" aria-modal="true" aria-labelledby="emergency-title"><header><span>{emergencyMode === "stop" ? "중단" : "복구"}</span><div><small>PAPER 안전 제어</small><h2 id="emergency-title">{emergencyMode === "stop" ? "모의 운영 상태 중단" : "모의 운영 복구 검토"}</h2></div></header><p>{emergencyMode === "stop" ? "서버에 저장된 모든 데모 전략의 새 상태 생성을 중단합니다. 실제 거래소에는 주문이나 취소 요청을 보내지 않습니다." : "중단된 데모 상태를 초기화합니다. 실거래 복구라면 강한 재인증, 장애 원인 확인과 독립 승인자의 승인이 추가로 필요합니다."}</p><dl className="control-impact-list"><div><dt>환경</dt><dd>PAPER</dd></div><div><dt>외부 주문</dt><dd>0건 · 전송 차단</dd></div><div><dt>실거래 요구사항</dt><dd>원인 확인 + 재인증 + 2인 승인</dd></div></dl>{emergencyMode === "stop" && <button type="button" className="emergency-option" aria-pressed={cancelOpenOrders} onClick={() => setCancelOpenOrders(!cancelOpenOrders)}><Check checked={cancelOpenOrders} /><span><strong>모의 미체결 상태도 취소 처리</strong><small>실제 거래소 체결과 무관한 데모 상태만 바꿉니다.</small></span></button>}<label>확인을 위해 <b>{emergencyMode === "stop" ? "긴급중단" : "운영복구"}</b>을 입력하세요<input autoFocus value={emergencyPhrase} onChange={(event) => setEmergencyPhrase(event.target.value)} placeholder={emergencyMode === "stop" ? "긴급중단" : "운영복구"} /></label><div><button type="button" className="btn secondary" onClick={() => { setEmergencyMode(null); setEmergencyPhrase(""); }}>돌아가기</button><button type="button" className={emergencyMode === "stop" ? "btn danger solid" : "btn primary"} disabled={emergencyPhrase !== (emergencyMode === "stop" ? "긴급중단" : "운영복구") || busy !== ""} onClick={confirmEmergency}>{emergencyMode === "stop" ? "모든 데모 상태 중단" : "데모 운영 복구 승인"}</button></div></section></div>}
  </div>;
}

function Notifications({ notify, read, setRead, openDetail }: { notify: (message: string) => void; read: Set<string>; setRead: React.Dispatch<React.SetStateAction<Set<string>>>; openDetail: (id: string) => void }) {
  const [filter, setFilter] = useState("전체 6");
  const initiallyUnread = new Set(NOTIFICATIONS.slice(0, 2).map((item) => item.id));
  const unread = [...initiallyUnread].filter((id) => !read.has(id)).length;
  const visible = filter === "전체 6" ? NOTIFICATIONS : NOTIFICATIONS.filter((item) => item.category === filter.split(" ")[0]);
  const markAllRead = () => { setRead(new Set(NOTIFICATIONS.map((item) => item.id))); notify("모든 알림을 읽음 처리했습니다"); };
  return <div className="product-page notifications-page"><PageTitle title="알림" subtitle={`최근 30일 활동 · 미확인 ${unread}건`} /><div className="notification-tabs"><div>{["전체 6","체결 2","가격 1","전략 오류 1"].map((item) => <button type="button" className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div><button type="button" onClick={markAllRead}>모두 읽음</button></div><section className="notification-list"><header><strong>{filter === "전체 6" ? "최근 알림 · 6건" : filter}</strong><span>미확인 {unread}</span></header>{visible.map((item) => <button type="button" className={initiallyUnread.has(item.id) && !read.has(item.id) ? "unread" : ""} key={item.id} onClick={() => openDetail(item.id)}><i>{item.icon}</i><em>{item.category}</em><div><strong>{item.title}</strong><p>{item.body}</p></div><time>{item.time}</time></button>)}</section></div>;
}

function NotificationDetail({ itemId, go, openApi }: { itemId: string; go: (screen: Screen) => void; openApi: (returnTo: Screen) => void }) {
  const item = NOTIFICATIONS.find((candidate) => candidate.id === itemId) ?? NOTIFICATIONS[0];
  const action = () => {
    if (item.id === "api-expiry") return openApi("notificationDetail");
    if (item.category === "체결") return go("transactions");
    if (item.category === "백테스팅") return go("backtest");
    if (item.category === "전략 오류") return go("settings");
    return go("dashboard");
  };
  const actionLabel = item.id === "api-expiry" ? "API 키 갱신하기" : item.category === "체결" ? "체결 내역 보기" : item.category === "백테스팅" ? "백테스트 결과 보기" : item.category === "전략 오류" ? "연동 상태 확인" : "대시보드로 이동";
  return <div className="product-page detail-page"><PageTitle title="알림 상세" subtitle="발생 원인과 다음 조치를 확인하세요" action={<button type="button" className="btn secondary" onClick={() => go("notifications")}>← 알림 목록</button>} /><article className="panel notification-detail-card"><header><i>{item.icon}</i><div><span>{item.category} · {item.time}</span><h2>{item.title}</h2><p>{item.body}</p></div></header><section><h3>상세 내용</h3><p>{item.detail}</p></section><section className="notification-safety"><strong>자동 보호 상태</strong><p>{item.category === "전략 오류" ? "응답이 확인되지 않아 주문은 생성되지 않았습니다. 중복 체결 방지 보호가 활성화되어 있습니다." : "이 알림을 확인하는 동안 별도의 주문이나 설정 변경은 발생하지 않습니다."}</p></section><footer><button type="button" className="btn primary" onClick={action}>{actionLabel}</button><button type="button" className="btn secondary" onClick={() => go("notifications")}>확인 완료</button></footer></article></div>;
}

function TransactionHistory({ go, notify }: { go: (screen: Screen) => void; notify: (message: string) => void }) {
  const [side, setSide] = useState("전체");
  const [range, setRange] = useState("30일");
  const [query, setQuery] = useState("");
  const visible = TRANSACTIONS.filter((item) => (side === "전체" || item.side === side) && `${item.asset} ${item.strategy} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const exportCsv = () => {
    const header = ["거래 ID","일시","구분","자산","전략","수량","체결금액","손익","상태"];
    const rows = visible.map((item) => [item.id,item.date,item.side,item.asset,item.strategy,item.amount,item.price,item.pnl,item.status]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell.replaceAll('"','""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type:"text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "blocktrade-transactions.csv"; link.click();
    URL.revokeObjectURL(url);
    notify(`${visible.length}건을 CSV로 내보냈습니다`);
  };
  return <div className="product-page transactions-page"><PageTitle title="체결 내역" subtitle="주문 결과와 실현 손익을 거래 단위로 확인하세요" action={<div className="inline-actions"><button type="button" className="btn secondary" onClick={() => go("dashboard")}>← 대시보드</button><button type="button" className="btn primary" onClick={exportCsv}>CSV 내보내기</button></div>} /><section className="summary-grid transaction-summary"><article className="summary-card"><label>선택 기간</label><strong>{range}</strong><p>총 {visible.length}건</p></article><article className="summary-card"><label>매수</label><strong>3건</strong><p>₩828,350</p></article><article className="summary-card"><label>매도</label><strong>3건</strong><p>₩1,322,100</p></article><article className="summary-card"><label>실현 손익</label><strong className="positive">+₩67,400</strong><p>수수료 반영 전</p></article></section><div className="table-filters panel"><div>{["전체","매수","매도"].map((item) => <button type="button" className={side === item ? "active" : ""} key={item} onClick={() => setSide(item)}>{item}</button>)}</div><label>조회 기간<select value={range} onChange={(event) => setRange(event.target.value)}><option>7일</option><option>30일</option><option>90일</option></select></label><input aria-label="체결 내역 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="코인·전략·거래 ID 검색" /></div><section className="panel transaction-table-wrap"><table className="transaction-table"><thead><tr><th>일시 / ID</th><th>구분</th><th>자산</th><th>전략</th><th>수량</th><th>체결 금액</th><th>실현 손익</th><th>상태</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td><strong>{item.date}</strong><small>{item.id}</small></td><td><span className={`side-badge ${item.side === "매수" ? "buy" : "sell"}`}>{item.side}</span></td><td><b>{item.asset}</b></td><td>{item.strategy}</td><td>{item.amount}</td><td>{item.price}</td><td className={item.pnl.startsWith("+") ? "positive" : item.pnl.startsWith("-") ? "negative" : ""}>{item.pnl}</td><td><span className="status-badge">{item.status}</span></td></tr>)}</tbody></table>{visible.length === 0 && <div className="empty-table">검색 조건에 맞는 체결 내역이 없습니다.</div>}</section></div>;
}

function StrategyLibrary({ go, setBlocks, notify }: { go: (screen: Screen) => void; setBlocks: React.Dispatch<React.SetStateAction<StrategyBlock[]>>; notify: (message: string) => void }) {
  const [filter, setFilter] = useState("전체");
  const [saved, setSaved] = useState<Set<string>>(new Set(["DCA 적립식"]));
  const templates = [
    { name:"DCA 적립식", type:"초보", description:"정해진 시간에 일정 금액을 분할 매수해 변동성을 낮춰요.", return:"+8.7%", risk:"낮음", blocks:[{kind:"condition" as const,label:"매일 오전 9시"},{kind:"action" as const,label:"BTC 30,000원 매수"},{kind:"notice" as const,label:"체결 알림"}] },
    { name:"RSI 역추세", type:"중급", description:"RSI 과매도 구간에서 진입하고 회복 구간에서 분할 청산해요.", return:"+14.2%", risk:"중간", blocks:[{kind:"condition" as const,label:"RSI 30 이하"},{kind:"action" as const,label:"보유 현금 20% 매수"},{kind:"action" as const,label:"손절 5% 실행"}] },
    { name:"변동성 돌파", type:"고급", description:"전일 변동폭을 돌파할 때 진입하고 일일 손실 한도로 보호해요.", return:"+18.1%", risk:"높음", blocks:[{kind:"condition" as const,label:"전일 변동폭 0.5배 돌파"},{kind:"action" as const,label:"BTC 비율 매수 25%"},{kind:"action" as const,label:"일일 손실 3% 중단"}] },
    { name:"주간 리밸런싱", type:"중급", description:"BTC·ETH 목표 비중을 매주 다시 맞춰 쏠림을 관리해요.", return:"+11.4%", risk:"중간", blocks:[{kind:"condition" as const,label:"매주 월요일 10시"},{kind:"action" as const,label:"BTC 60% · ETH 40%"},{kind:"notice" as const,label:"리밸런싱 결과 이메일"}] },
  ];
  const visible = filter === "전체" ? templates : templates.filter((item) => item.type === filter);
  const applyTemplate = (template: typeof templates[number]) => {
    setBlocks(template.blocks.map((block, index) => ({ ...block, id: Date.now() + index })));
    notify(`${template.name} 템플릿을 불러왔습니다`);
    go("builder");
  };
  return <div className="product-page library-page"><PageTitle title="전략 보관함" subtitle="검증용 템플릿을 내 전략의 출발점으로 활용하세요" action={<button type="button" className="btn secondary" onClick={() => go("builder")}>← 전략 빌더</button>} /><div className="library-toolbar"><div>{["전체","초보","중급","고급"].map((item) => <button type="button" className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div><span>수익률은 예시 백테스트이며 미래 성과를 보장하지 않습니다.</span></div><section className="template-grid">{visible.map((template) => <article className="panel template-card" key={template.name}><header><div><span>{template.type}</span><h2>{template.name}</h2></div><button type="button" aria-label={`${template.name} 즐겨찾기`} aria-pressed={saved.has(template.name)} onClick={() => setSaved((state) => { const next = new Set(state); if (next.has(template.name)) next.delete(template.name); else next.add(template.name); return next; })}>{saved.has(template.name) ? "저장됨" : "즐겨찾기"}</button></header><p>{template.description}</p><div className="template-metrics"><span>90일 예시 <b className="positive">{template.return}</b></span><span>위험도 <b>{template.risk}</b></span><span>블록 <b>{template.blocks.length}개</b></span></div><ul>{template.blocks.map((block) => <li key={block.label}>{block.label}</li>)}</ul><button type="button" className="btn primary wide" onClick={() => applyTemplate(template)}>이 전략으로 편집</button></article>)}</section></div>;
}

function Postmortem({ go, setBlocks, notify }: { go: (screen: Screen) => void; setBlocks: React.Dispatch<React.SetStateAction<StrategyBlock[]>>; notify: (message: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["손절 5%"]));
  const fixes = ["손절 5%","거래 시간 제한","진입 비중 20% 축소"];
  const createNext = () => {
    const additions: StrategyBlock[] = [];
    if (selected.has("손절 5%")) additions.push({ id:Date.now(), kind:"action", label:"손절 5% 실행" });
    if (selected.has("거래 시간 제한")) additions.push({ id:Date.now()+1, kind:"condition", label:"09:00~18:00에만 실행" });
    if (selected.has("진입 비중 20% 축소")) additions.push({ id:Date.now()+2, kind:"action", label:"진입 비중 20% 축소" });
    setBlocks((state) => [...state, ...additions]);
    notify(`${additions.length}개 개선 블록을 추가했습니다`);
    go("builder");
  };
  return <div className="product-page postmortem-page"><PageTitle title="실패 구간 분석" subtitle="손실을 원인별로 나누고 다음 전략에 반영합니다" action={<button type="button" className="btn secondary" onClick={() => go("backtest")}>← 백테스트 결과</button>} /><section className="postmortem-hero"><div><span>분석 구간</span><strong>2024.10.03 — 2025.02.12</strong><p>장기 하락과 짧은 반등이 반복된 구간</p></div><div><span>구간 손익</span><strong className="negative">-8.0%</strong><p>전체 MDD의 71% 발생</p></div><div><span>실패 거래</span><strong>8건</strong><p>평균 보유 19시간</p></div></section><section className="postmortem-grid"><article className="panel cause-panel"><h2>무슨 일이 있었나요?</h2><div className="cause-timeline"><article><b>1</b><div><strong>늦은 추세 감지</strong><p>가격 상승 조건만 사용해 하락 추세 전환을 걸러내지 못했습니다.</p></div></article><article><b>2</b><div><strong>손절 조건 부재</strong><p>반등을 기다리는 동안 한 거래의 손실이 -5.8%까지 확대됐습니다.</p></div></article><article><b>3</b><div><strong>야간 유동성 감소</strong><p>03:00~05:00 체결에서 평균 슬리피지가 평소보다 2.1배 높았습니다.</p></div></article></div></article><article className="panel lesson-panel"><h2>다음 시도에 반영</h2><p>적용할 개선안을 선택하면 전략 빌더에 블록으로 추가합니다.</p>{fixes.map((item) => <button type="button" className="fix-option" aria-pressed={selected.has(item)} key={item} onClick={() => setSelected((state) => { const next = new Set(state); if (next.has(item)) next.delete(item); else next.add(item); return next; })}><Check checked={selected.has(item)} /><span><strong>{item}</strong><small>{item === "손절 5%" ? "단일 거래 최대 손실 제한" : item === "거래 시간 제한" ? "유동성이 낮은 야간 제외" : "초기 노출 금액 축소"}</small></span></button>)}<button type="button" className="btn primary wide" disabled={selected.size === 0} onClick={createNext}>다음 시도 만들기 →</button></article></section></div>;
}

function ProfileEdit({ profile, setProfile, go, notify }: { profile: Profile; setProfile: (profile: Profile) => void; go: (screen: Screen) => void; notify: (message: string) => void }) {
  const [draft, setDraft] = useState(profile);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.nickname.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(draft.email)) { notify("닉네임과 이메일을 확인해주세요"); return; }
    setProfile(draft); notify("프로필을 저장했습니다"); go("settings");
  };
  return <div className="product-page profile-page"><PageTitle title="프로필 편집" subtitle="서비스에 표시되는 정보와 투자 성향을 관리하세요" action={<button type="button" className="btn secondary" onClick={() => go("settings")}>← 설정</button>} /><section className="profile-layout"><form className="panel profile-form" onSubmit={submit}><div className="profile-avatar">{draft.nickname.slice(0, 2) || "BT"}</div><label>닉네임<input value={draft.nickname} onChange={(event) => setDraft((state) => ({...state,nickname:event.target.value}))} autoComplete="nickname" /></label><label>이메일<input type="email" value={draft.email} onChange={(event) => setDraft((state) => ({...state,email:event.target.value}))} autoComplete="email" /></label><label>한 줄 소개<textarea value={draft.bio} maxLength={60} onChange={(event) => setDraft((state) => ({...state,bio:event.target.value}))} /><small>{draft.bio.length}/60</small></label><fieldset><legend>투자 성향</legend><div className="risk-style-row">{["보수형","중립형","적극형"].map((item) => <button type="button" aria-pressed={draft.riskStyle === item} className={draft.riskStyle === item ? "selected" : ""} key={item} onClick={() => setDraft((state) => ({...state,riskStyle:item}))}>{item}</button>)}</div></fieldset><button className="btn primary wide" type="submit">변경사항 저장</button></form><aside className="profile-side"><article className="panel"><h2>계정 상태</h2><dl><div><dt>본인 인증</dt><dd className="positive">완료</dd></div><div><dt>가입일</dt><dd>2024.09.28</dd></div><div><dt>최근 로그인</dt><dd>오늘 · 태블릿</dd></div></dl></article><article className="panel"><h2>개인정보 보호</h2><p>다른 기기에서 로그인된 세션을 종료하거나 내 데이터 사본을 요청할 수 있습니다.</p><button type="button" className="btn secondary wide" onClick={() => notify("다른 기기의 데모 세션을 종료했습니다")}>다른 기기 로그아웃</button><button type="button" className="text-link center" onClick={() => notify("데이터 사본 요청을 접수했습니다")}>내 데이터 사본 요청</button></article></aside></section></div>;
}

function Billing({ plan, setPlan, go, notify }: { plan: Plan; setPlan: (plan: Plan) => void; go: (screen: Screen) => void; notify: (message: string) => void }) {
  const [commerce, setCommerce] = useState<CommerceReadiness | null>(null);
  const plans: { name: Plan; price: string; description: string; features: string[] }[] = [
    { name:"Free", price:"₩0", description:"전략을 둘러보고 직접 설계하는 사용자", features:["전략 마켓 비교","전략 2개","월 백테스트 10회","타인 전략 실행 불가"] },
    { name:"Pro", price:"₩9,900", description:"검증 전략을 사용하고 판매하는 사용자", features:["전략 마켓 사용권","원본 비공개 서버 실행","전략 게시·판매","백테스트 무제한"] },
    { name:"Gold", price:"₩24,900", description:"여러 전략과 위험 한도를 운영하는 사용자", features:["Pro 전체 기능","전략 무제한","고급 리스크 분석","우선 지원"] },
  ];
  useEffect(() => {
    if (typeof fetch !== "function") return;
    const controller = new AbortController();
    fetch("/api/marketplace/readiness", { headers:{ Accept:"application/json" }, cache:"no-store", signal:controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ readiness:CommerceReadiness }> : null)
      .then((payload) => { if (payload?.readiness) setCommerce(payload.readiness); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const choose = (next: Plan) => { setPlan(next); notify(`데모 플랜을 ${PLAN_LABELS[next]}로 변경했습니다. 실제 결제는 발생하지 않습니다`); };
  const pendingBlockers = commerce?.blockers.filter((item) => !item.satisfied).length;
  return <div className="product-page billing-page">
    <PageTitle title="플랫폼 플랜 · 성과보수" subtitle="플랫폼 이용료와 타인 전략 사용 성과보수를 분리해 확인하세요" action={<div className="inline-actions"><button type="button" className="btn secondary" onClick={() => go("settings")}>← 설정</button><button type="button" className="btn secondary" onClick={() => go("market")}>전략 마켓</button></div>} />
    <div className="billing-notice">현재 플랜 변경은 화면 데모입니다. 결제 정보는 입력받지 않으며 실제 플랜 청구와 성과정산도 발생하지 않습니다.</div>
    <section className={`commerce-readiness ${commerce?.liveReady ? "live" : "demo"}`}><div><span>{commerce?.liveReady ? "준비" : "잠금"}</span><div><strong>{commerce?.liveReady ? "실정산 준비 완료" : "데모 결제 · 실정산 잠금"}</strong><p>{commerce?.liveReady ? `${commerce.payment.provider} 결제와 판매자 정산 검증이 완료됐습니다.` : "결제 어댑터·고객확인·규제 검토·세무 정보·정산 계좌가 모두 확인된 뒤에만 실정산을 엽니다."}</p></div></div><b>{commerce ? `${pendingBlockers}개 확인 필요` : "상태 확인 중"}</b></section>
    <section className="plan-grid">{plans.map((item) => <article className={plan === item.name ? "plan-card panel active" : "plan-card panel"} key={item.name}>{plan === item.name && <span className="current-plan">현재 플랜</span>}<h2>{PLAN_LABELS[item.name]}</h2><p>{item.description}</p><strong>{item.price}<small>/월</small></strong><ul>{item.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><button type="button" className={plan === item.name ? "btn secondary wide" : "btn primary wide"} disabled={plan === item.name} onClick={() => choose(item.name)}>{plan === item.name ? "사용 중" : `${PLAN_LABELS[item.name]} 선택`}</button></article>)}</section>
    <section className="panel fee-policy"><header><div><h2>전략 마켓 비용 정책</h2><p>플랫폼 플랜, 전략 성과보수와 거래소 수수료는 서로 다른 비용입니다.</p></div><button type="button" className="text-link" onClick={() => notify("성과보수 정책은 출시 전 관할권별 법률 검토가 필요합니다")}>정책 전문</button></header><div className="fee-row"><span>플랫폼 이용료</span><strong>Pro·Gold 월 플랜</strong><small>전략 마켓 사용권에 필요</small></div><div className="fee-row"><span>타인 전략 성과보수</span><strong>{DEFAULT_PROFIT_SHARE_PCT}%</strong><small>최고수익기준선 초과 순신규 실현이익</small></div><div className="fee-row"><span>손실·회복 구간</span><strong>0원</strong><small>이전 최고 실현이익 회복 전 미부과</small></div><div className="fee-row"><span>성과보수 배분</span><strong>제작자 {CREATOR_FEE_SPLIT_PCT}%</strong><small>플랫폼 {PLATFORM_FEE_SPLIT_PCT}% · 실정산 잠금</small></div><div className="fee-row"><span>거래소 체결 수수료</span><strong>거래소별 상이</strong><small>사용자 거래소 계정에서 별도 부과</small></div></section>
  </div>;
}

function Support({ go, notify }: { go: (screen: Screen) => void; notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState("");
  const [form, setForm] = useState({ category:"거래소 연동", email:"", message:"" });
  const faqs = [
    ["API 키에 출금 권한이 필요한가요?","아니요. 자동매매에는 조회와 주문 권한만 필요합니다. 출금 권한이 포함된 키는 연결하지 않도록 서버에서도 차단해야 합니다."],
    ["백테스트 수익률을 믿어도 되나요?","백테스트는 과거 데이터 기반 시뮬레이션입니다. 수수료, 슬리피지, 거래소 장애를 반영해도 미래 성과를 보장하지 않습니다."],
    ["전략을 즉시 중단할 수 있나요?","실서비스에서는 대시보드의 일시정지와 긴급 중단을 분리하고, 미체결 주문 취소 상태까지 확인해야 합니다."],
    ["거래소 연결이 자꾸 끊겨요.","API 키 만료, IP 제한, 거래소 점검 여부를 먼저 확인하세요. 중복 주문 방지를 위해 재연결 중에는 새 주문을 만들지 않습니다."],
    ["계정을 삭제하면 데이터는 어떻게 되나요?","법적 보관 의무가 없는 전략·설정 데이터는 삭제하고, 거래 기록 등 보관 의무가 있는 항목은 기간을 안내한 뒤 분리 보관해야 합니다."],
  ];
  const visible = faqs.filter((item) => `${item[0]} ${item[1]}`.includes(query.trim()));
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!/^\S+@\S+\.\S+$/.test(form.email) || form.message.trim().length < 10) { notify("이메일과 문의 내용 10자 이상을 확인해주세요"); return; } notify("문의가 접수되었습니다. 데모 접수 번호 BT-2401"); setForm((state) => ({...state,message:""})); };
  return <div className="product-page support-page"><PageTitle title="고객지원" subtitle="문제를 빠르게 진단하고 필요한 도움을 요청하세요" action={<button type="button" className="btn secondary" onClick={() => go("settings")}>← 설정</button>} /><section className="support-hero"><div><h2>무엇을 도와드릴까요?</h2><p>질문을 검색하거나 아래에서 문의를 남겨주세요.</p></div><input aria-label="도움말 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: API 키, 백테스트, 전략 중단" /></section><section className="support-grid"><article className="panel faq-panel"><h2>자주 묻는 질문</h2>{visible.map((item) => <div className="faq-item" key={item[0]}><button type="button" aria-expanded={open === item[0]} onClick={() => setOpen(open === item[0] ? "" : item[0])}><span>{item[0]}</span><b>{open === item[0] ? "−" : "+"}</b></button>{open === item[0] && <p>{item[1]}</p>}</div>)}{visible.length === 0 && <p className="empty-faq">검색 결과가 없습니다.</p>}</article><form className="panel support-form" onSubmit={submit}><h2>1:1 문의</h2><label>문의 유형<select value={form.category} onChange={(event) => setForm((state) => ({...state,category:event.target.value}))}><option>거래소 연동</option><option>전략·백테스트</option><option>결제·멤버십</option><option>계정·보안</option></select></label><label>답변 받을 이메일<input type="email" value={form.email} onChange={(event) => setForm((state) => ({...state,email:event.target.value}))} placeholder="name@example.com" /></label><label>문의 내용<textarea value={form.message} onChange={(event) => setForm((state) => ({...state,message:event.target.value}))} placeholder="오류가 발생한 화면과 상황을 적어주세요" /></label><div className="support-privacy">민감한 API 키·비밀번호·주민등록번호는 문의 내용에 입력하지 마세요.</div><button className="btn primary wide" type="submit">문의 접수</button></form></section></div>;
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) { return <button type="button" aria-label={label} aria-pressed={value} className={value ? "toggle on" : "toggle"} onClick={() => onChange(!value)}><i /></button>; }

function Settings({ dark, setDark, notify, connected, openApi, profile, plan, go }: { dark: boolean; setDark: (value: boolean) => void; notify: (message: string) => void; connected: boolean; openApi: (returnTo: Screen) => void; profile: Profile; plan: Plan; go: (screen: Screen) => void }) {
  const [alerts, setAlerts] = useState({ price:true, trade:true, error:true, marketing:false });
  const [language, setLanguage] = useState("한국어");
  return <div className="product-page settings-page">
    <PageTitle title="설정" subtitle="계정·보안·외부 연결 환경을 관리합니다" />
    <section className="settings-grid">
      <div className="settings-column">
        <article className="panel profile-settings">
          <h2>프로필</h2>
          <div className="profile-head"><i>{profile.nickname.slice(0, 2)}</i><div><strong>{profile.nickname}</strong><p>{connected ? "인증된 기관 세션" : profile.email}</p></div></div>
          <p className="settings-description">{profile.bio}</p>
          <button type="button" className="btn secondary wide" onClick={() => go("profile")}>프로필 상세 편집</button>
        </article>
        <article className="panel exchange-settings">
          <h2>법인 거래소 읽기 전용 연결</h2>
          <div className="empty-exchange"><strong>브라우저 키 입력 차단</strong><p>원시 키는 외부 KMS/Vault에 보관하고 이곳에는 참조값만 등록합니다. 계좌 조회·주문내역 대사 외 권한은 허용하지 않습니다.</p></div>
          <button type="button" className="btn secondary wide" onClick={() => openApi("settings")}>읽기 전용 연결 요청</button>
        </article>
        <article className="panel membership-settings">
          <div className="panel-header"><h2>멤버십 · 수수료 예시</h2><span>{PLAN_LABELS[plan]}</span></div>
          <p>{PLAN_LABELS[plan]} 플랜 화면 예시입니다. 실제 결제와 구독은 아직 연결되지 않았습니다.</p>
          <button type="button" className="btn secondary wide" onClick={() => go("billing")}>플랜 화면 보기</button>
        </article>
      </div>
      <div className="settings-column">
        <article className="panel alert-settings">
          <h2>알림 화면 미리보기</h2>
          <p className="settings-description">현재 선택은 이 기기의 화면 데모에만 반영됩니다.</p>
          {[["가격 알림","price"],["체결 알림","trade"],["전략 오류 알림","error"],["마케팅 알림","marketing"]].map(([label,key]) => <div key={key}><span>{label}</span><Toggle label={label} value={alerts[key as keyof typeof alerts]} onChange={(value) => setAlerts((state) => ({...state,[key]:value}))} /></div>)}
          <h3>화면 설정</h3>
          <div><span>다크 모드</span><Toggle label="다크 모드" value={dark} onChange={setDark} /></div>
          <div><label htmlFor="language">언어</label><select id="language" value={language} onChange={(event) => { setLanguage(event.target.value); notify(`${event.target.value} 설정을 저장했습니다`); }}><option>한국어</option></select></div>
        </article>
        <article className="panel security-settings">
          <div className="panel-header"><h2>기관 인증</h2><span>{connected ? "서버 인증" : "잠금"}</span></div>
          <p className="settings-description">{connected ? "운영 환경은 신뢰된 계정 서명을 서버에서 검증합니다. 비밀번호는 BlockTrade가 직접 받지 않습니다." : "기관 인증이 확인되기 전에는 운영 데이터와 변경 명령을 사용할 수 없습니다."}</p>
          <button type="button" className="btn secondary wide" disabled>비밀번호 변경 준비 중</button>
          <div className="security-tip"><strong>강한 재인증 · 패스키</strong><p>비밀번호는 외부 인증 제공자에서 관리합니다. 실거래 단계 전 별도의 IdP 정책과 최근 재인증 게이트를 연결합니다.</p><button type="button" disabled>연동 준비 중</button></div>
        </article>
        <article className="panel support-settings">
          <h2>고객지원</h2><p>자주 묻는 질문, 장애 대응 안내, 문의 접수를 한곳에서 확인하세요.</p>
          <button type="button" className="btn secondary wide" onClick={() => go("support")}>고객지원 열기</button>
        </article>
      </div>
    </section>
  </div>;
}

function Toast({ message }: { message: string }) { return <div className="toast" role="status"><span>완료</span>{message}</div>; }
