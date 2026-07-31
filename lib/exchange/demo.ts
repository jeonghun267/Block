import type {
  CancelOrderInput,
  ExchangeAccount,
  ExchangeAdapter,
  ExchangeCapabilities,
  ExchangeOrder,
  PlaceOrderInput,
} from "./types";

export class DemoExchangeAdapter implements ExchangeAdapter {
  readonly capabilities: ExchangeCapabilities = {
    provider: "demo",
    mode: "demo",
    accounts: true,
    marketData: true,
    placeOrders: true,
    cancelOrders: true,
    withdrawals: false,
  };

  private readonly orders = new Map<string, ExchangeOrder>();
  private readonly idempotencyIndex = new Map<string, string>();

  async getAccounts(): Promise<ExchangeAccount[]> {
    return [
      { currency: "KRW", balance: "10000000", locked: "0", averageBuyPrice: "0" },
      { currency: "BTC", balance: "0.015", locked: "0", averageBuyPrice: "95000000" },
    ];
  }

  async placeLimitOrder(input: PlaceOrderInput): Promise<ExchangeOrder> {
    const existingId = this.idempotencyIndex.get(input.idempotencyKey);
    if (existingId) return this.orders.get(existingId)!;

    const order: ExchangeOrder = {
      id: `demo-${crypto.randomUUID()}`,
      market: input.market,
      side: input.side,
      state: "queued",
      volume: input.volume,
      price: input.price,
      createdAt: new Date().toISOString(),
    };
    this.orders.set(order.id, order);
    this.idempotencyIndex.set(input.idempotencyKey, order.id);
    return order;
  }

  async cancelOrder(input: CancelOrderInput): Promise<ExchangeOrder> {
    const order = this.orders.get(input.orderId);
    if (!order) throw new Error("Demo order was not found");
    const cancelled = { ...order, state: "cancelled" as const };
    this.orders.set(order.id, cancelled);
    return cancelled;
  }
}
