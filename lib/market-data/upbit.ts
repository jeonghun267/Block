import {
  SUPPORTED_CANDLE_INTERVALS,
  SUPPORTED_SHADOW_MARKETS,
  type MarketCandle,
  type ShadowMarket,
} from "../shadow";

type UpbitMinuteCandle = {
  market: string;
  candle_date_time_utc: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  candle_acc_trade_volume: number;
  candle_acc_trade_price: number;
};

export type UpbitCandleSnapshot = {
  provider: "upbit";
  market: ShadowMarket;
  intervalMinutes: number;
  candles: MarketCandle[];
  fetchedAt: string;
  sourceUrl: string;
};

function validFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseCandle(value: unknown): MarketCandle {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("업비트 캔들 형식이 올바르지 않습니다.");
  const row = value as Partial<UpbitMinuteCandle>;
  if (
    typeof row.candle_date_time_utc !== "string" ||
    !validFinite(row.opening_price) ||
    !validFinite(row.high_price) ||
    !validFinite(row.low_price) ||
    !validFinite(row.trade_price) ||
    !validFinite(row.candle_acc_trade_volume) ||
    !validFinite(row.candle_acc_trade_price)
  ) {
    throw new Error("업비트 캔들 필수 필드를 검증하지 못했습니다.");
  }
  const timestamp = `${row.candle_date_time_utc}Z`;
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("업비트 캔들 시각이 올바르지 않습니다.");
  if (row.high_price < row.low_price || row.high_price < Math.max(row.opening_price, row.trade_price) || row.low_price > Math.min(row.opening_price, row.trade_price)) {
    throw new Error("업비트 OHLC 가격 관계가 올바르지 않습니다.");
  }
  return {
    timestamp,
    open: row.opening_price,
    high: row.high_price,
    low: row.low_price,
    close: row.trade_price,
    volume: row.candle_acc_trade_volume,
    quoteVolume: row.candle_acc_trade_price,
  };
}

export async function fetchUpbitMinuteCandles(input: {
  market: ShadowMarket;
  intervalMinutes: number;
  count?: number;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<UpbitCandleSnapshot> {
  if (!SUPPORTED_SHADOW_MARKETS.includes(input.market)) throw new Error("허용되지 않은 업비트 마켓입니다.");
  if (!SUPPORTED_CANDLE_INTERVALS.includes(input.intervalMinutes as (typeof SUPPORTED_CANDLE_INTERVALS)[number])) {
    throw new Error("허용되지 않은 업비트 분 캔들 주기입니다.");
  }
  const count = Math.max(20, Math.min(200, Math.trunc(input.count ?? 120)));
  const url = new URL(`https://api.upbit.com/v1/candles/minutes/${input.intervalMinutes}`);
  url.searchParams.set("market", input.market);
  url.searchParams.set("count", String(count));
  const response = await (input.fetcher ?? fetch)(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`업비트 공개 시세 응답 오류 ${response.status}`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload) || payload.length < 20) throw new Error("업비트 공개 시세 표본이 부족합니다.");
  const candles = payload.map(parseCandle).reverse();
  for (let index = 1; index < candles.length; index += 1) {
    if (Date.parse(candles[index - 1].timestamp) >= Date.parse(candles[index].timestamp)) {
      throw new Error("업비트 캔들 시간 순서를 검증하지 못했습니다.");
    }
  }
  return {
    provider: "upbit",
    market: input.market,
    intervalMinutes: input.intervalMinutes,
    candles,
    fetchedAt: (input.now ?? new Date()).toISOString(),
    sourceUrl: url.toString(),
  };
}
