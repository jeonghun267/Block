import type { ExchangeRuntimeConfig } from "../security/config";
import {
  assertReadOnlyExchangePath,
  assertSafeExchangePath,
  type CancelOrderInput,
  type ExchangeAccount,
  type ExchangeAdapter,
  type ExchangeCapabilities,
  type ExchangeOrder,
  type PlaceOrderInput,
  type ReadOnlyExchangeAdapter,
  type ReadOnlyExchangeOrder,
} from "./types";

type Fetcher = typeof fetch;
type UpbitAccountResponse = {
  currency: string;
  balance: string;
  locked: string;
  avg_buy_price: string;
};
type UpbitOrderResponse = {
  uuid: string;
  market: string;
  side: "bid" | "ask";
  state: "wait" | "watch" | "done" | "cancel";
  volume: string;
  remaining_volume?: string;
  executed_volume?: string;
  paid_fee?: string;
  price: string | null;
  created_at: string;
};

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sha512Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signUpbitJwt(
  accessKey: string,
  secretKey: string,
  queryString = "",
  nonce = crypto.randomUUID(),
): Promise<string> {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "HS512", typ: "JWT" })));
  const payload: Record<string, string> = { access_key: accessKey, nonce };
  if (queryString) {
    payload.query_hash = await sha512Hex(queryString);
    payload.query_hash_alg = "SHA512";
  }
  const encodedPayload = base64Url(encoder.encode(JSON.stringify(payload)));
  const unsignedToken = `${header}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(unsignedToken)));
  return `${unsignedToken}.${base64Url(signature)}`;
}

function mapOrder(order: UpbitOrderResponse): ExchangeOrder {
  const states: Record<UpbitOrderResponse["state"], ExchangeOrder["state"]> = {
    wait: "open",
    watch: "open",
    done: "filled",
    cancel: "cancelled",
  };
  return {
    id: order.uuid,
    market: order.market,
    side: order.side === "bid" ? "buy" : "sell",
    state: states[order.state] ?? "failed",
    volume: order.volume,
    price: order.price ?? "0",
    createdAt: order.created_at,
  };
}

function mapReadOnlyOrder(order: UpbitOrderResponse): ReadOnlyExchangeOrder {
  return {
    ...mapOrder(order),
    executedVolume: order.executed_volume ?? "0",
    remainingVolume: order.remaining_volume ?? "0",
    paidFee: order.paid_fee ?? "0",
  };
}

function safeIdentifier(value: string): string {
  return `bt-${value.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 36)}`;
}

export class UpbitExchangeAdapter implements ExchangeAdapter {
  readonly capabilities: ExchangeCapabilities = {
    provider: "upbit",
    mode: "live",
    accounts: true,
    marketData: true,
    placeOrders: true,
    cancelOrders: true,
    withdrawals: false,
  };

  constructor(
    private readonly config: ExchangeRuntimeConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {
    if (config.mode !== "live" || !config.credentials) {
      throw new Error("Live exchange credentials are not ready");
    }
  }

  async getAccounts(requestId: string): Promise<ExchangeAccount[]> {
    const rows = await this.request<UpbitAccountResponse[]>("GET", "/v1/accounts", undefined, requestId);
    return rows.map((row) => ({
      currency: row.currency,
      balance: row.balance,
      locked: row.locked,
      averageBuyPrice: row.avg_buy_price,
    }));
  }

  async placeLimitOrder(input: PlaceOrderInput): Promise<ExchangeOrder> {
    const body = {
      market: input.market,
      side: input.side === "buy" ? "bid" : "ask",
      volume: input.volume,
      price: input.price,
      ord_type: "limit",
      identifier: safeIdentifier(input.idempotencyKey),
    };
    return mapOrder(await this.request<UpbitOrderResponse>("POST", "/v1/orders", body, input.requestId));
  }

  async cancelOrder(input: CancelOrderInput): Promise<ExchangeOrder> {
    return mapOrder(await this.request<UpbitOrderResponse>("DELETE", "/v1/order", { uuid: input.orderId }, input.requestId));
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: "/v1/accounts" | "/v1/orders" | "/v1/order",
    parameters: Record<string, string> | undefined,
    requestId: string,
  ): Promise<T> {
    assertSafeExchangePath(path);
    if (this.config.mode !== "live" || !this.config.credentials) {
      throw new Error("Live exchange requests are disabled");
    }

    const query = parameters ? new URLSearchParams(parameters).toString() : "";
    const url = new URL(path, this.config.apiBaseUrl);
    if (method !== "POST" && query) url.search = query;
    const jwt = await signUpbitJwt(
      this.config.credentials.accessKey,
      this.config.credentials.secretKey,
      query,
    );
    const response = await this.fetcher(url, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
      },
      body: method === "POST" ? JSON.stringify(parameters) : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Exchange request failed with status ${response.status}`);
    }
    return await response.json() as T;
  }
}

export class UpbitReadOnlyAdapter implements ReadOnlyExchangeAdapter {
  readonly provider = "upbit" as const;
  readonly permissions = {
    viewAccounts: true,
    viewOrders: true,
    placeOrders: false,
    cancelOrders: false,
    withdrawals: false,
  } as const;

  constructor(
    private readonly input: {
      apiBaseUrl: string;
      accessKey: string;
      secretKey: string;
    },
    private readonly fetcher: Fetcher = fetch,
  ) {
    const url = new URL(input.apiBaseUrl);
    if (url.protocol !== "https:" || url.hostname !== "api.upbit.com") {
      throw new Error("읽기 전용 대사는 승인된 업비트 HTTPS 주소만 사용할 수 있습니다.");
    }
    if (input.accessKey.length < 8 || input.secretKey.length < 16) {
      throw new Error("읽기 전용 거래소 자격증명이 올바르지 않습니다.");
    }
  }

  async getAccounts(requestId: string): Promise<ExchangeAccount[]> {
    const rows = await this.request<UpbitAccountResponse[]>("/v1/accounts", undefined, requestId);
    return rows.map((row) => ({
      currency: row.currency,
      balance: row.balance,
      locked: row.locked,
      averageBuyPrice: row.avg_buy_price,
    }));
  }

  async getOpenOrders(requestId: string): Promise<ReadOnlyExchangeOrder[]> {
    const rows = await this.request<UpbitOrderResponse[]>("/v1/orders/open", { limit: "100", order_by: "asc" }, requestId);
    return rows.map(mapReadOnlyOrder);
  }

  async getClosedOrders(requestId: string, options: { limit?: number } = {}): Promise<ReadOnlyExchangeOrder[]> {
    const limit = Math.max(1, Math.min(1_000, Math.floor(options.limit ?? 200)));
    const rows = await this.request<UpbitOrderResponse[]>("/v1/orders/closed", { limit: String(limit), order_by: "desc" }, requestId);
    return rows.map(mapReadOnlyOrder);
  }

  private async request<T>(
    path: "/v1/accounts" | "/v1/orders/open" | "/v1/orders/closed",
    parameters: Record<string, string> | undefined,
    requestId: string,
  ): Promise<T> {
    assertReadOnlyExchangePath(path);
    const query = parameters ? new URLSearchParams(parameters).toString() : "";
    const url = new URL(path, this.input.apiBaseUrl);
    if (query) url.search = query;
    const jwt = await signUpbitJwt(this.input.accessKey, this.input.secretKey, query);
    const response = await this.fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
        "X-Request-ID": requestId,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`업비트 읽기 전용 조회가 실패했습니다 (${response.status}).`);
    }
    return await response.json() as T;
  }
}
