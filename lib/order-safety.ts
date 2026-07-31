import type { OperationSettings, OrderRunStatus } from "./operations";

export type ExecutionGateCode =
  | "emergency_stopped"
  | "daily_loss_limit"
  | "exchange_unavailable"
  | "heartbeat_stale";

export type ExecutionGate = {
  allowed: boolean;
  codes: ExecutionGateCode[];
  requiresReauthentication: boolean;
};

export type ExchangeOrderSnapshot = {
  status: OrderRunStatus;
  filledRatio: number;
  exchangeOrderId?: string;
};

export type ReconciliationDecision = {
  status: OrderRunStatus;
  filledRatio: number;
  action: "keep" | "update_local" | "manual_review";
  reason: string;
};

const TERMINAL = new Set<OrderRunStatus>(["filled", "cancelled", "failed"]);

const ALLOWED_TRANSITIONS: Record<OrderRunStatus, ReadonlySet<OrderRunStatus>> = {
  queued: new Set(["submitted", "cancelled", "failed"]),
  submitted: new Set(["partially_filled", "filled", "cancelled", "failed"]),
  partially_filled: new Set(["partially_filled", "filled", "cancelled", "failed"]),
  filled: new Set(),
  cancelled: new Set(),
  failed: new Set(["queued"]),
};

export function canTransitionOrder(from: OrderRunStatus, to: OrderRunStatus) {
  return from === to || ALLOWED_TRANSITIONS[from].has(to);
}

export function evaluateExecutionGate(
  settings: OperationSettings,
  now = Date.now(),
  heartbeatMaximumAgeMs = 90_000,
): ExecutionGate {
  const codes: ExecutionGateCode[] = [];
  if (settings.emergencyStatus === "stopped") codes.push("emergency_stopped");
  if (settings.currentLoss >= settings.dailyLossLimit) codes.push("daily_loss_limit");

  if (settings.mode === "live") {
    if (settings.exchangeStatus !== "connected") codes.push("exchange_unavailable");
    const heartbeat = Date.parse(settings.lastHeartbeatAt);
    if (!Number.isFinite(heartbeat) || now - heartbeat > heartbeatMaximumAgeMs) codes.push("heartbeat_stale");
  }

  return {
    allowed: codes.length === 0,
    codes,
    requiresReauthentication: settings.mode === "live",
  };
}

export function reconcileOrder(
  local: Pick<ExchangeOrderSnapshot, "status" | "filledRatio">,
  exchange: ExchangeOrderSnapshot,
): ReconciliationDecision {
  const filledRatio = Math.max(0, Math.min(100, exchange.filledRatio));
  if (local.status === exchange.status && local.filledRatio === filledRatio) {
    return { status: local.status, filledRatio, action: "keep", reason: "상태가 일치합니다" };
  }

  if (TERMINAL.has(local.status) && local.status !== exchange.status) {
    return {
      status: local.status,
      filledRatio: local.filledRatio,
      action: "manual_review",
      reason: "로컬 종결 상태와 거래소 상태가 달라 자동 변경을 차단했습니다",
    };
  }

  if (!canTransitionOrder(local.status, exchange.status)) {
    return {
      status: local.status,
      filledRatio: local.filledRatio,
      action: "manual_review",
      reason: "허용되지 않은 역방향 상태 변경입니다",
    };
  }

  return {
    status: exchange.status,
    filledRatio,
    action: "update_local",
    reason: "거래소를 기준으로 로컬 주문 상태를 갱신합니다",
  };
}

export function createOrderIdempotencyKey(owner: string, strategyId: string, signalId: string) {
  const input = `${owner.trim().toLowerCase()}|${strategyId}|${signalId}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `bt-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

