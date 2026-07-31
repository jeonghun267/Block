export type ExchangeProvider = "demo" | "upbit";
export type OrderSide = "buy" | "sell";

export type ExchangeCapabilities = {
  provider: ExchangeProvider;
  mode: "demo" | "live";
  accounts: true;
  marketData: true;
  placeOrders: true;
  cancelOrders: true;
  withdrawals: false;
};

export type ExchangeAccount = {
  currency: string;
  balance: string;
  locked: string;
  averageBuyPrice: string;
};

export type PlaceOrderInput = {
  market: string;
  side: OrderSide;
  volume: string;
  price: string;
  idempotencyKey: string;
  requestId: string;
};

export type CancelOrderInput = {
  orderId: string;
  requestId: string;
};

export type ExchangeOrder = {
  id: string;
  market: string;
  side: OrderSide;
  state: "queued" | "open" | "filled" | "cancelled" | "failed";
  volume: string;
  price: string;
  createdAt: string;
};

export type ReadOnlyExchangeOrder = ExchangeOrder & {
  executedVolume: string;
  remainingVolume: string;
  paidFee: string;
};

export interface ReadOnlyExchangeAdapter {
  readonly provider: "upbit";
  readonly permissions: {
    viewAccounts: true;
    viewOrders: true;
    placeOrders: false;
    cancelOrders: false;
    withdrawals: false;
  };
  getAccounts(requestId: string): Promise<ExchangeAccount[]>;
  getOpenOrders(requestId: string): Promise<ReadOnlyExchangeOrder[]>;
  getClosedOrders(requestId: string, options?: { limit?: number }): Promise<ReadOnlyExchangeOrder[]>;
}

export interface ExchangeAdapter {
  readonly capabilities: ExchangeCapabilities;
  getAccounts(requestId: string): Promise<ExchangeAccount[]>;
  placeLimitOrder(input: PlaceOrderInput): Promise<ExchangeOrder>;
  cancelOrder(input: CancelOrderInput): Promise<ExchangeOrder>;
}

export const MINIMUM_EXCHANGE_PERMISSION_POLICY = Object.freeze({
  readAccounts: true,
  readOrders: true,
  placeOrders: true,
  cancelOrders: true,
  withdrawals: false,
  deposits: false,
});

export function assertSafeExchangePath(path: string): void {
  const normalized = path.toLowerCase();
  if (normalized.includes("withdraw") || normalized.includes("deposit")) {
    throw new Error("This operation is blocked by the minimum-permission policy");
  }
}

export function assertReadOnlyExchangePath(path: string): void {
  assertSafeExchangePath(path);
  if (!new Set(["/v1/accounts", "/v1/orders/open", "/v1/orders/closed"]).has(path)) {
    throw new Error("읽기 전용 거래소 경계에서 허용되지 않은 경로입니다.");
  }
}
