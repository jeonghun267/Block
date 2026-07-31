export type StrategyRunStatus = "running" | "paused" | "stopped";
export type OrderRunStatus =
  | "queued"
  | "submitted"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "failed";

export type OperationStrategy = {
  id: string;
  name: string;
  market: string;
  status: StrategyRunStatus;
  pnlToday: number;
  pnl30d: number;
  exposure: string;
  risk: "낮음" | "보통" | "높음";
  lastSignalAt: string;
  updatedAt: string;
};

export type OperationOrder = {
  id: string;
  strategyId: string;
  strategyName: string;
  market: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  amount: string;
  price: string;
  status: OrderRunStatus;
  filledRatio: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OperationEvent = {
  id: string;
  eventType: string;
  severity: "info" | "warning" | "critical";
  message: string;
  strategyId: string | null;
  orderId: string | null;
  createdAt: string;
};

export type OperationSettings = {
  mode: "paper" | "live";
  exchangeStatus: "connected" | "degraded" | "disconnected";
  emergencyStatus: "normal" | "stopped";
  dailyLossLimit: number;
  currentLoss: number;
  lastHeartbeatAt: string;
  updatedAt: string;
};

export type OperationSnapshot = {
  settings: OperationSettings;
  strategies: OperationStrategy[];
  orders: OperationOrder[];
  events: OperationEvent[];
  serverTime: string;
  version: number;
};

export type OperationCommandInput =
  | { action: "pause_strategy" | "resume_strategy"; strategyId: string }
  | { action: "cancel_order" | "retry_order"; orderId: string }
  | { action: "emergency_stop"; cancelOpenOrders: boolean }
  | { action: "reset_demo" };

export type OperationCommand = OperationCommandInput & { requestId: string };

export const DEFAULT_OPERATION_SNAPSHOT: OperationSnapshot = {
  settings: {
    mode: "paper",
    exchangeStatus: "connected",
    emergencyStatus: "normal",
    dailyLossLimit: 3,
    currentLoss: 0.8,
    lastHeartbeatAt: "2026-07-13T14:36:42+08:00",
    updatedAt: "2026-07-13T14:36:42+08:00",
  },
  strategies: [
    {
      id: "strategy-dca-btc",
      name: "DCA 비트코인 적립",
      market: "BTC/KRW",
      status: "running",
      pnlToday: 42300,
      pnl30d: 5.2,
      exposure: "₩420,000",
      risk: "낮음",
      lastSignalAt: "1분 전",
      updatedAt: "2026-07-13T14:35:42+08:00",
    },
    {
      id: "strategy-rsi-eth",
      name: "RSI 역추세 스윙",
      market: "ETH/KRW",
      status: "running",
      pnlToday: -12300,
      pnl30d: 2.8,
      exposure: "₩280,000",
      risk: "보통",
      lastSignalAt: "12분 전",
      updatedAt: "2026-07-13T14:24:10+08:00",
    },
    {
      id: "strategy-breakout",
      name: "변동성 돌파 자동매매",
      market: "BTC·ETH",
      status: "paused",
      pnlToday: 0,
      pnl30d: 7.1,
      exposure: "₩0",
      risk: "높음",
      lastSignalAt: "48분 전",
      updatedAt: "2026-07-13T13:48:03+08:00",
    },
  ],
  orders: [
    {
      id: "BT-260713-007",
      strategyId: "strategy-dca-btc",
      strategyName: "DCA 비트코인 적립",
      market: "BTC/KRW",
      side: "buy",
      orderType: "market",
      amount: "0.001 BTC",
      price: "₩42,300",
      status: "filled",
      filledRatio: 100,
      failureReason: null,
      createdAt: "14:32:18",
      updatedAt: "14:32:19",
    },
    {
      id: "BT-260713-006",
      strategyId: "strategy-rsi-eth",
      strategyName: "RSI 역추세 스윙",
      market: "ETH/KRW",
      side: "buy",
      orderType: "limit",
      amount: "0.18 ETH",
      price: "₩632,400",
      status: "partially_filled",
      filledRatio: 64,
      failureReason: null,
      createdAt: "14:28:04",
      updatedAt: "14:35:08",
    },
    {
      id: "BT-260713-005",
      strategyId: "strategy-dca-btc",
      strategyName: "DCA 비트코인 적립",
      market: "BTC/KRW",
      side: "buy",
      orderType: "market",
      amount: "0.001 BTC",
      price: "시장가",
      status: "submitted",
      filledRatio: 0,
      failureReason: null,
      createdAt: "14:26:41",
      updatedAt: "14:26:42",
    },
    {
      id: "BT-260713-004",
      strategyId: "strategy-breakout",
      strategyName: "변동성 돌파 자동매매",
      market: "ETH/KRW",
      side: "sell",
      orderType: "market",
      amount: "0.08 ETH",
      price: "시장가",
      status: "failed",
      filledRatio: 0,
      failureReason: "거래소 응답 시간 초과 — 체결 여부 재확인 완료",
      createdAt: "13:47:55",
      updatedAt: "13:48:03",
    },
  ],
  events: [
    {
      id: "event-260713-001",
      eventType: "order_filled",
      severity: "info",
      message: "BTC 시장가 매수가 100% 체결되었습니다.",
      strategyId: "strategy-dca-btc",
      orderId: "BT-260713-007",
      createdAt: "14:32:19",
    },
    {
      id: "event-260713-002",
      eventType: "order_partial",
      severity: "warning",
      message: "ETH 지정가 주문이 64% 체결되어 잔량을 추적 중입니다.",
      strategyId: "strategy-rsi-eth",
      orderId: "BT-260713-006",
      createdAt: "14:35:08",
    },
    {
      id: "event-260713-003",
      eventType: "strategy_paused",
      severity: "warning",
      message: "연속 API 지연으로 변동성 돌파 전략을 안전 일시정지했습니다.",
      strategyId: "strategy-breakout",
      orderId: null,
      createdAt: "13:48:03",
    },
  ],
  serverTime: "2026-07-13T14:36:42+08:00",
  version: 1,
};
