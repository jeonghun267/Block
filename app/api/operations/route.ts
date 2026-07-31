import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import {
  DEFAULT_OPERATION_SNAPSHOT,
  type OperationCommand,
  type OperationEvent,
  type OperationOrder,
  type OperationSettings,
  type OperationSnapshot,
  type OperationStrategy,
  type OrderRunStatus,
  type StrategyRunStatus,
} from "../../../lib/operations";
import { readExchangeRuntimeConfig } from "../../../lib/security/config";
import { requireTrustedIdentity, TrustedIdentityError } from "../../../lib/security/identity";

export const runtime = "edge";

type SettingsRow = {
  mode: string;
  exchange_status: string;
  emergency_status: string;
  daily_loss_limit: number;
  current_loss: number;
  last_heartbeat_at: string;
  updated_at: string;
  version: number;
};

type StrategyRow = {
  id: string;
  name: string;
  market: string;
  status: string;
  pnl_today: number;
  pnl_30d: number;
  exposure: string;
  risk: string;
  last_signal_at: string;
  updated_at: string;
};

type OrderRow = {
  id: string;
  strategy_id: string;
  strategy_name: string;
  market: string;
  side: string;
  order_type: string;
  amount: string;
  price: string;
  status: string;
  filled_ratio: number;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  event_type: string;
  severity: string;
  message: string;
  strategy_id: string | null;
  order_id: string | null;
  created_at: string;
};

const JSON_HEADERS = { "Cache-Control": "no-store" };
const VALID_ID = /^[A-Za-z0-9-]{3,80}$/;
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,120}$/;

function ownerKey(request: Request) {
  const config = readExchangeRuntimeConfig(env as unknown as Record<string, unknown>);
  return requireTrustedIdentity(request, config).subject;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: JSON_HEADERS });
}

async function ensureSeed(owner: string) {
  const existing = await env.DB.prepare("SELECT owner_key FROM operation_settings WHERE owner_key = ? LIMIT 1").bind(owner).first();
  if (existing) return;

  const seed = DEFAULT_OPERATION_SNAPSHOT;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO operation_settings
      (owner_key, mode, exchange_status, emergency_status, daily_loss_limit, current_loss, last_heartbeat_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(owner, seed.settings.mode, seed.settings.exchangeStatus, seed.settings.emergencyStatus, seed.settings.dailyLossLimit, seed.settings.currentLoss, seed.settings.lastHeartbeatAt, seed.settings.updatedAt, seed.version),
    ...seed.strategies.map((strategy) => env.DB.prepare(`INSERT OR IGNORE INTO operation_strategies
      (id, owner_key, name, market, status, pnl_today, pnl_30d, exposure, risk, last_signal_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(strategy.id, owner, strategy.name, strategy.market, strategy.status, strategy.pnlToday, strategy.pnl30d, strategy.exposure, strategy.risk, strategy.lastSignalAt, strategy.updatedAt)),
    ...seed.orders.map((order) => env.DB.prepare(`INSERT OR IGNORE INTO operation_orders
      (id, owner_key, strategy_id, strategy_name, market, side, order_type, amount, price, status, filled_ratio, failure_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(order.id, owner, order.strategyId, order.strategyName, order.market, order.side, order.orderType, order.amount, order.price, order.status, order.filledRatio, order.failureReason, order.createdAt, order.updatedAt)),
    ...seed.events.map((event) => env.DB.prepare(`INSERT OR IGNORE INTO operation_events
      (id, owner_key, event_type, severity, message, strategy_id, order_id, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
      .bind(event.id, owner, event.eventType, event.severity, event.message, event.strategyId, event.orderId, event.createdAt)),
  ]);
}

async function loadSnapshot(owner: string): Promise<OperationSnapshot> {
  await ensureSeed(owner);
  const [settings, strategies, orders, events] = await Promise.all([
    env.DB.prepare(`SELECT mode, exchange_status, emergency_status, daily_loss_limit, current_loss,
      last_heartbeat_at, updated_at, version FROM operation_settings WHERE owner_key = ? LIMIT 1`).bind(owner).first<SettingsRow>(),
    env.DB.prepare(`SELECT id, name, market, status, pnl_today, pnl_30d, exposure, risk,
      last_signal_at, updated_at FROM operation_strategies WHERE owner_key = ? ORDER BY rowid`).bind(owner).all<StrategyRow>(),
    env.DB.prepare(`SELECT id, strategy_id, strategy_name, market, side, order_type, amount, price,
      status, filled_ratio, failure_reason, created_at, updated_at FROM operation_orders
      WHERE owner_key = ? ORDER BY rowid DESC`).bind(owner).all<OrderRow>(),
    env.DB.prepare(`SELECT id, event_type, severity, message, strategy_id, order_id, created_at
      FROM operation_events WHERE owner_key = ? ORDER BY rowid DESC LIMIT 30`).bind(owner).all<EventRow>(),
  ]);
  if (!settings) throw new Error("운영 설정을 초기화하지 못했습니다");

  const mappedSettings: OperationSettings = {
    mode: settings.mode === "live" ? "live" : "paper",
    exchangeStatus: settings.exchange_status as OperationSettings["exchangeStatus"],
    emergencyStatus: settings.emergency_status as OperationSettings["emergencyStatus"],
    dailyLossLimit: settings.daily_loss_limit,
    currentLoss: settings.current_loss,
    lastHeartbeatAt: settings.last_heartbeat_at,
    updatedAt: settings.updated_at,
  };
  const mappedStrategies: OperationStrategy[] = strategies.results.map((row) => ({
    id: row.id,
    name: row.name,
    market: row.market,
    status: row.status as StrategyRunStatus,
    pnlToday: row.pnl_today,
    pnl30d: row.pnl_30d,
    exposure: row.exposure,
    risk: row.risk as OperationStrategy["risk"],
    lastSignalAt: row.last_signal_at,
    updatedAt: row.updated_at,
  }));
  const mappedOrders: OperationOrder[] = orders.results.map((row) => ({
    id: row.id,
    strategyId: row.strategy_id,
    strategyName: row.strategy_name,
    market: row.market,
    side: row.side as OperationOrder["side"],
    orderType: row.order_type as OperationOrder["orderType"],
    amount: row.amount,
    price: row.price,
    status: row.status as OrderRunStatus,
    filledRatio: row.filled_ratio,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const mappedEvents: OperationEvent[] = events.results.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    severity: row.severity as OperationEvent["severity"],
    message: row.message,
    strategyId: row.strategy_id,
    orderId: row.order_id,
    createdAt: row.created_at,
  }));

  return {
    settings: mappedSettings,
    strategies: mappedStrategies,
    orders: mappedOrders,
    events: mappedEvents,
    serverTime: new Date().toISOString(),
    version: settings.version,
  };
}

function eventInsert(owner: string, requestId: string, event: Omit<OperationEvent, "id">) {
  return env.DB.prepare(`INSERT INTO operation_events
    (id, owner_key, event_type, severity, message, strategy_id, order_id, request_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`event-${crypto.randomUUID()}`, owner, event.eventType, event.severity, event.message, event.strategyId, event.orderId, requestId, event.createdAt);
}

async function strategyCommand(owner: string, command: Extract<OperationCommand, { action: "pause_strategy" | "resume_strategy" }>) {
  if (!VALID_ID.test(command.strategyId)) throw new Error("유효하지 않은 전략입니다");
  const strategy = await env.DB.prepare("SELECT name, status FROM operation_strategies WHERE owner_key = ? AND id = ? LIMIT 1").bind(owner, command.strategyId).first<{ name: string; status: string }>();
  if (!strategy) throw new Error("전략을 찾을 수 없습니다");
  if (strategy.status === "stopped") throw new Error("긴급 중단된 전략은 데모 운영 복구 후 재개할 수 있습니다");
  const nextStatus = command.action === "pause_strategy" ? "paused" : "running";
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE operation_strategies SET status = ?, updated_at = ? WHERE owner_key = ? AND id = ?").bind(nextStatus, now, owner, command.strategyId),
    env.DB.prepare("UPDATE operation_settings SET updated_at = ?, version = version + 1 WHERE owner_key = ?").bind(now, owner),
    eventInsert(owner, command.requestId, {
      eventType: command.action,
      severity: command.action === "pause_strategy" ? "warning" : "info",
      message: `${strategy.name} 전략을 ${nextStatus === "paused" ? "일시정지" : "재개"}했습니다.`,
      strategyId: command.strategyId,
      orderId: null,
      createdAt: new Date().toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Seoul" }),
    }),
  ]);
}

async function orderCommand(owner: string, command: Extract<OperationCommand, { action: "cancel_order" | "retry_order" }>) {
  if (!VALID_ID.test(command.orderId)) throw new Error("유효하지 않은 주문입니다");
  const order = await env.DB.prepare("SELECT status FROM operation_orders WHERE owner_key = ? AND id = ? LIMIT 1").bind(owner, command.orderId).first<{ status: string }>();
  if (!order) throw new Error("주문을 찾을 수 없습니다");
  if (command.action === "cancel_order" && !["queued", "submitted", "partially_filled"].includes(order.status)) throw new Error("현재 상태에서는 취소할 수 없습니다");
  if (command.action === "retry_order" && order.status !== "failed") throw new Error("실패 상태 주문만 재확인할 수 있습니다");
  const nextStatus = command.action === "cancel_order" ? "cancelled" : "queued";
  const now = new Date().toISOString();
  const displayTime = new Date().toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Seoul" });
  await env.DB.batch([
    env.DB.prepare("UPDATE operation_orders SET status = ?, failure_reason = NULL, updated_at = ? WHERE owner_key = ? AND id = ?").bind(nextStatus, displayTime, owner, command.orderId),
    env.DB.prepare("UPDATE operation_settings SET updated_at = ?, version = version + 1 WHERE owner_key = ?").bind(now, owner),
    eventInsert(owner, command.requestId, {
      eventType: command.action,
      severity: command.action === "cancel_order" ? "warning" : "info",
      message: command.action === "cancel_order" ? `${command.orderId} 데모 주문을 취소 상태로 전환했습니다.` : `${command.orderId} 데모 주문을 재확인 대기로 전환했습니다.`,
      strategyId: null,
      orderId: command.orderId,
      createdAt: displayTime,
    }),
  ]);
}

async function emergencyStop(owner: string, command: Extract<OperationCommand, { action: "emergency_stop" }>) {
  const now = new Date().toISOString();
  const displayTime = new Date().toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Seoul" });
  const statements = [
    env.DB.prepare("UPDATE operation_strategies SET status = 'stopped', updated_at = ? WHERE owner_key = ?").bind(now, owner),
    env.DB.prepare("UPDATE operation_settings SET emergency_status = 'stopped', updated_at = ?, version = version + 1 WHERE owner_key = ?").bind(now, owner),
    eventInsert(owner, command.requestId, {
      eventType: "emergency_stop",
      severity: "critical",
      message: command.cancelOpenOrders ? "모든 데모 전략을 중단하고 모의 미체결 주문을 취소 상태로 전환했습니다." : "모든 데모 전략의 새 상태 생성을 중단했습니다.",
      strategyId: null,
      orderId: null,
      createdAt: displayTime,
    }),
  ];
  if (command.cancelOpenOrders) statements.splice(1, 0, env.DB.prepare(`UPDATE operation_orders SET status = 'cancelled', updated_at = ?
    WHERE owner_key = ? AND status IN ('queued', 'submitted', 'partially_filled')`).bind(displayTime, owner));
  await env.DB.batch(statements);
}

async function resetDemo(owner: string) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM operation_events WHERE owner_key = ?").bind(owner),
    env.DB.prepare("DELETE FROM operation_orders WHERE owner_key = ?").bind(owner),
    env.DB.prepare("DELETE FROM operation_strategies WHERE owner_key = ?").bind(owner),
    env.DB.prepare("DELETE FROM operation_settings WHERE owner_key = ?").bind(owner),
  ]);
  await ensureSeed(owner);
}

export async function GET(request: Request) {
  try {
    const snapshot = await loadSnapshot(ownerKey(request));
    return NextResponse.json({ snapshot }, { headers: JSON_HEADERS });
  } catch (error: unknown) {
    if (error instanceof TrustedIdentityError) return jsonError("인증이 필요합니다", 401);
    console.error("[operations:get]", error instanceof Error ? error.message : "unknown error");
    return jsonError("운영 데이터를 불러오지 못했습니다", 500);
  }
}

export async function PATCH(request: Request) {
  let owner = "";
  let requestId = "";
  try {
    const raw = await request.text();
    if (raw.length > 4_000) return jsonError("요청이 너무 큽니다", 413);
    let command: OperationCommand;
    try {
      command = JSON.parse(raw) as OperationCommand;
    } catch {
      return jsonError("요청 형식이 올바르지 않습니다", 400);
    }
    if (!command || !VALID_REQUEST_ID.test(command.requestId || "")) return jsonError("요청 식별자가 올바르지 않습니다", 400);
    requestId = command.requestId;
    const allowed = ["pause_strategy", "resume_strategy", "cancel_order", "retry_order", "emergency_stop", "reset_demo"];
    if (!allowed.includes(command.action)) return jsonError("지원하지 않는 운영 명령입니다", 400);

    owner = ownerKey(request);
    await ensureSeed(owner);
    const prior = await env.DB.prepare("SELECT id FROM operation_events WHERE owner_key = ? AND request_id = ? LIMIT 1").bind(owner, command.requestId).first();
    if (prior) return NextResponse.json({ snapshot: await loadSnapshot(owner), duplicate: true }, { headers: JSON_HEADERS });

    if (command.action === "pause_strategy" || command.action === "resume_strategy") await strategyCommand(owner, command);
    else if (command.action === "cancel_order" || command.action === "retry_order") await orderCommand(owner, command);
    else if (command.action === "emergency_stop") await emergencyStop(owner, command);
    else await resetDemo(owner);

    return NextResponse.json({ snapshot: await loadSnapshot(owner) }, { headers: JSON_HEADERS });
  } catch (error: unknown) {
    if (owner && requestId) {
      const prior = await env.DB.prepare("SELECT id FROM operation_events WHERE owner_key = ? AND request_id = ? LIMIT 1").bind(owner, requestId).first();
      if (prior) return NextResponse.json({ snapshot: await loadSnapshot(owner), duplicate: true }, { headers: JSON_HEADERS });
    }
    const message = error instanceof Error ? error.message : "운영 명령을 처리하지 못했습니다";
    if (error instanceof TrustedIdentityError) return jsonError("인증이 필요합니다", 401);
    console.error("[operations:patch]", message);
    return jsonError(message, message.includes("찾을 수") ? 404 : 409);
  }
}
