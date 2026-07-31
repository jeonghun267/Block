import { describe, expect, it } from "vitest";
import {
  canTransitionOrder,
  createOrderIdempotencyKey,
  evaluateExecutionGate,
  reconcileOrder,
} from "../lib/order-safety";
import type { OperationSettings } from "../lib/operations";

const settings: OperationSettings = {
  mode: "live",
  exchangeStatus: "connected",
  emergencyStatus: "normal",
  dailyLossLimit: 3,
  currentLoss: 0.7,
  lastHeartbeatAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

describe("주문 안전 계층", () => {
  it("허용된 상태 전이와 역방향 전이를 구분한다", () => {
    expect(canTransitionOrder("submitted", "partially_filled")).toBe(true);
    expect(canTransitionOrder("partially_filled", "filled")).toBe(true);
    expect(canTransitionOrder("filled", "submitted")).toBe(false);
  });

  it("실거래의 연결·손실·하트비트 위험을 한 번에 차단한다", () => {
    const gate = evaluateExecutionGate(
      { ...settings, exchangeStatus: "degraded", currentLoss: 3.1 },
      Date.parse("2026-07-14T00:03:00.000Z"),
    );
    expect(gate.allowed).toBe(false);
    expect(gate.codes).toEqual(["daily_loss_limit", "exchange_unavailable", "heartbeat_stale"]);
    expect(gate.requiresReauthentication).toBe(true);
  });

  it("거래소가 앞선 정상 전이는 갱신하고 종결 충돌은 사람에게 넘긴다", () => {
    expect(reconcileOrder(
      { status: "submitted", filledRatio: 0 },
      { status: "partially_filled", filledRatio: 64, exchangeOrderId: "U-1" },
    ).action).toBe("update_local");
    expect(reconcileOrder(
      { status: "filled", filledRatio: 100 },
      { status: "cancelled", filledRatio: 0, exchangeOrderId: "U-1" },
    ).action).toBe("manual_review");
  });

  it("같은 사용자·전략·신호는 같은 중복 방지키를 만든다", () => {
    const first = createOrderIdempotencyKey("USER@example.com", "strategy-1", "signal-9");
    const second = createOrderIdempotencyKey("user@example.com", "strategy-1", "signal-9");
    expect(first).toBe(second);
    expect(createOrderIdempotencyKey("user@example.com", "strategy-1", "signal-10")).not.toBe(first);
  });
});
