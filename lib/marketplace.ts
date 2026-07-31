export type MarketplaceRisk = "낮음" | "보통" | "높음";
export type MarketplaceVerification = "실운영 검증" | "모의운영 검증" | "예시 데이터" | "검증 대기";

export type MarketplaceStrategy = {
  id: string;
  creatorName: string;
  isMine: boolean;
  name: string;
  description: string;
  category: string;
  risk: MarketplaceRisk;
  priceMonthly: number;
  profitSharePct: number;
  creatorFeeSplitPct: number;
  platformFeeSplitPct: number;
  deliveryMode: "server_execution";
  sourceAccess: "owner_only";
  performanceSettlement: "locked" | "demo";
  return90d: number;
  maxDrawdown: number;
  winRate: number;
  liveDays: number;
  tradeCount: number;
  trustScore: number;
  trustGrade?: "A" | "B" | "C" | "D" | "UNVERIFIED";
  trustWarnings?: string[];
  conditionSummary: string;
  blocks: string[];
  visibility: "public" | "subscribers" | "signal_only";
  verification: MarketplaceVerification;
  status: "listed" | "paused";
  subscribers: number;
  updatedAt: string;
};

export type MarketplaceSubscription = {
  strategyId: string;
  status: "active" | "cancelled";
  riskLimit: number;
  allocation: number;
  monthlyPrice: number;
  profitSharePct: number;
  deliveryMode: "server_execution";
  sourceAccess: false;
  createdAt: string;
};

export type CreatorSummary = {
  listedCount: number;
  activeSubscribers: number;
  estimatedPerformanceFee: number;
  estimatedCreatorPayout: number;
};

export type MarketplaceSnapshot = {
  strategies: MarketplaceStrategy[];
  subscriptions: MarketplaceSubscription[];
  creator: CreatorSummary;
};

export type MarketplaceCommandInput =
  | { action: "subscribe"; strategyId: string; riskLimit: number; allocation: number }
  | { action: "unsubscribe"; strategyId: string }
  | { action: "toggle_listing"; strategyId: string }
  | {
      action: "publish";
      listing: {
        name: string;
        description: string;
        category: string;
        risk: MarketplaceRisk;
        priceMonthly: number;
        visibility: MarketplaceStrategy["visibility"];
        conditionSummary: string;
        blocks: string[];
      };
    };

export type MarketplaceCommand = MarketplaceCommandInput & { requestId: string };

export const DEFAULT_MARKETPLACE_SNAPSHOT: MarketplaceSnapshot = {
  strategies: [
    {
      id: "market-steady-dca",
      creatorName: "루틴트레이더",
      isMine: false,
      name: "BTC 저변동 적립식",
      description: "급등 구간을 피하고 변동성이 낮을 때만 분할 매수하는 장기 적립 전략입니다.",
      category: "적립식",
      risk: "낮음",
      priceMonthly: 0,
      profitSharePct: 10,
      creatorFeeSplitPct: 80,
      platformFeeSplitPct: 20,
      deliveryMode: "server_execution",
      sourceAccess: "owner_only",
      performanceSettlement: "locked",
      return90d: 12.8,
      maxDrawdown: -4.2,
      winRate: 68.4,
      liveDays: 184,
      tradeCount: 92,
      trustScore: 88,
      conditionSummary: "BTC · 적립식 · 서버 실행 전용",
      blocks: [],
      visibility: "signal_only",
      verification: "예시 데이터",
      status: "listed",
      subscribers: 326,
      updatedAt: "2026.07.12",
    },
    {
      id: "market-rsi-recovery",
      creatorName: "퀀트여우",
      isMine: false,
      name: "ETH RSI 회복 스윙",
      description: "과매도 이후 거래량 회복을 함께 확인해 허위 반등 진입을 줄이는 전략입니다.",
      category: "스윙",
      risk: "보통",
      priceMonthly: 0,
      profitSharePct: 10,
      creatorFeeSplitPct: 80,
      platformFeeSplitPct: 20,
      deliveryMode: "server_execution",
      sourceAccess: "owner_only",
      performanceSettlement: "locked",
      return90d: 18.6,
      maxDrawdown: -7.1,
      winRate: 72.2,
      liveDays: 121,
      tradeCount: 58,
      trustScore: 91,
      conditionSummary: "ETH · 스윙 · 서버 실행 전용",
      blocks: [],
      visibility: "signal_only",
      verification: "예시 데이터",
      status: "listed",
      subscribers: 241,
      updatedAt: "2026.07.11",
    },
    {
      id: "market-breakout-safe",
      creatorName: "데이터호흡",
      isMine: false,
      name: "BTC 변동성 돌파 라이트",
      description: "일일 손실 한도와 거래 시간 제한을 둔 보수적인 변동성 돌파 전략입니다.",
      category: "돌파",
      risk: "높음",
      priceMonthly: 0,
      profitSharePct: 10,
      creatorFeeSplitPct: 80,
      platformFeeSplitPct: 20,
      deliveryMode: "server_execution",
      sourceAccess: "owner_only",
      performanceSettlement: "locked",
      return90d: 22.4,
      maxDrawdown: -11.8,
      winRate: 54.1,
      liveDays: 76,
      tradeCount: 113,
      trustScore: 74,
      conditionSummary: "BTC · 돌파 · 서버 실행 전용",
      blocks: [],
      visibility: "signal_only",
      verification: "예시 데이터",
      status: "listed",
      subscribers: 518,
      updatedAt: "2026.07.09",
    },
  ],
  subscriptions: [],
  creator: {
    listedCount: 0,
    activeSubscribers: 0,
    estimatedPerformanceFee: 0,
    estimatedCreatorPayout: 0,
  },
};
