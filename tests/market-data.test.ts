import { describe, expect, it, vi } from "vitest";
import { fetchUpbitMinuteCandles } from "../lib/market-data/upbit";

describe("업비트 공개 캔들 어댑터", () => {
  it("공식 분 캔들 응답을 오래된 순서의 검증 표본으로 정규화한다", async () => {
    const rows = Array.from({ length: 20 }, (_, index) => {
      const price = 100_000_000 + index * 10_000;
      const hour = String(19 - index).padStart(2, "0");
      return {
        market: "KRW-BTC",
        candle_date_time_utc: `2026-07-20T${hour}:00:00`,
        opening_price: price,
        high_price: price + 1_000,
        low_price: price - 1_000,
        trade_price: price,
        candle_acc_trade_volume: 2,
        candle_acc_trade_price: price * 2,
      };
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } }));
    const snapshot = await fetchUpbitMinuteCandles({ market: "KRW-BTC", intervalMinutes: 60, count: 20, fetcher, now: new Date("2026-07-20T20:00:00Z") });
    expect(snapshot.provider).toBe("upbit");
    expect(snapshot.candles).toHaveLength(20);
    expect(snapshot.candles[0].timestamp).toBe("2026-07-20T00:00:00Z");
    expect(snapshot.candles.at(-1)?.timestamp).toBe("2026-07-20T19:00:00Z");
    expect(String(fetcher.mock.calls[0][0])).toContain("/v1/candles/minutes/60");
  });

  it("허용되지 않은 시장과 비정상 OHLC 응답을 차단한다", async () => {
    await expect(fetchUpbitMinuteCandles({ market: "KRW-DOGE" as "KRW-BTC", intervalMinutes: 60 })).rejects.toThrow(/허용되지 않은/);
    const invalid = Array.from({ length: 20 }, (_, index) => ({
      market: "KRW-BTC",
      candle_date_time_utc: `2026-07-20T${String(index).padStart(2, "0")}:00:00`,
      opening_price: 100,
      high_price: 90,
      low_price: 80,
      trade_price: 100,
      candle_acc_trade_volume: 1,
      candle_acc_trade_price: 100,
    }));
    const fetcher = vi.fn(async () => new Response(JSON.stringify(invalid), { status: 200 }));
    await expect(fetchUpbitMinuteCandles({ market: "KRW-BTC", intervalMinutes: 60, fetcher })).rejects.toThrow(/OHLC/);
  });
});
