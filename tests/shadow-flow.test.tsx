// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen as ui } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "../app/page";
import type { ShadowConsoleSnapshot } from "../lib/shadow";

const initial: ShadowConsoleSnapshot = {
  safety: { mode: "shadow", externalOrdersAllowed: false, marketDataSource: "upbit_public_quotation", execution: "internal_simulator" },
  strategy: { id: "sv-shadow", name: "BTC 4시간 낙폭 섀도 템플릿", version: 1, status: "paper", contentHash: "a".repeat(64), market: "KRW-BTC", intervalMinutes: 240 },
  riskPolicy: { id: "rp-1", version: 6, maxGrossExposurePct: 80, maxAssetConcentrationPct: 40, maxDailyLossPct: 3, maxOrderKrw: 100_000_000 },
  deployment: { id: "sd-1", status: "ready", startingCashMinor: 100_000_000, cashMinor: 100_000_000, realizedPnlMinor: 0, lastMarketPriceMinor: 0, lastCandleAt: null, lastCycleAt: null, updatedAt: "2026-07-21T00:00:00Z" },
  position: { asset: "BTC", quantity: "0", costBasisMinor: 0, marketValueMinor: 0, unrealizedPnlMinor: 0, realizedPnlMinor: 0 },
  marketData: null,
  backtest: null,
  lastCycle: null,
  recentOrders: [],
  reconciliation: null,
  serverTime: "2026-07-21T00:00:00Z",
};

describe("섀도 운용 사용자 흐름", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("실제 공개 시세 주기를 실행해도 외부 주문은 0건으로 유지한다", async () => {
    const completed: ShadowConsoleSnapshot = {
      ...initial,
      deployment: { ...initial.deployment, status: "running", lastMarketPriceMinor: 151_000_000, lastCandleAt: "2026-07-21T00:00:00Z", lastCycleAt: "2026-07-21T00:01:00Z" },
      marketData: { snapshotId: "md-1", provider: "upbit", market: "KRW-BTC", intervalMinutes: 240, candleCount: 180, startedAt: "2026-06-21T00:00:00Z", endedAt: "2026-07-21T00:00:00Z", fetchedAt: "2026-07-21T00:01:00Z", payloadHash: "b".repeat(64), latestCloseMinor: 151_000_000, ageSeconds: 60 },
      backtest: { id: "bt-1", engineVersion: "bt-shadow-1.0.0", status: "completed", startingCashMinor: 100_000_000, endingEquityMinor: 102_500_000, totalReturnBps: 250, maxDrawdownBps: -180, tradeCount: 8, winRateBps: 6250, feesMinor: 32_000, createdAt: "2026-07-21T00:01:00Z" },
      lastCycle: { id: "sc-1", status: "no_signal", signal: { triggered: false, side: null, reason: "no_signal", metricBps: -70, thresholdBps: -150, candleAt: "2026-07-21T00:00:00Z", signalKey: null }, evidenceHash: "c".repeat(64), completedAt: "2026-07-21T00:01:00Z" },
      reconciliation: { id: "recon-1", status: "matched", intentCount: 0, orderCount: 0, fillCount: 0, exceptionCount: 0, evidenceHash: "d".repeat(64), createdAt: "2026-07-21T00:01:00Z" },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/shadow") && init?.method === "POST") return { ok: true, status: 200, json: async () => ({ snapshot: completed, duplicate: false }) } as Response;
      if (String(input).includes("/api/shadow")) return { ok: true, status: 200, json: async () => ({ snapshot: initial }) } as Response;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: /구글로 로그인/ }));
    await user.click(ui.getAllByRole("button", { name: "섀도 운용" })[0]);
    expect(await ui.findByRole("heading", { name: "섀도 운용" })).toBeTruthy();
    expect(await ui.findByText("외부 주문 차단")).toBeTruthy();
    await user.click(ui.getByRole("button", { name: "실제 시세로 1회 실행" }));
    expect(await ui.findByText("+2.50%")).toBeTruthy();
    expect(ui.getAllByText("0건").length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.some((call) => String(call[1]?.body || "").includes('"action":"run_cycle"'))).toBe(true);
  });
});
