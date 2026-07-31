import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { fetchUpbitMinuteCandles } from "../../../lib/market-data/upbit";
import {
  applyShadowFill,
  evaluateLatestShadowSignal,
  evaluateShadowRisk,
  normalizeShadowStrategyDefinition,
  runShadowBacktest,
  type MarketCandle,
  type ShadowConsoleSnapshot,
  type ShadowSignalEvaluation,
  type ShadowStrategySpec,
} from "../../../lib/shadow";
import { readExchangeRuntimeConfig } from "../../../lib/security/config";
import { requireTrustedIdentity, TrustedIdentityError } from "../../../lib/security/identity";
import { EdgeRateLimiter } from "../../../lib/security/request";

export const runtime = "edge";

const JSON_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
const VALID_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const SHADOW_TEMPLATE_KEY = "bt-shadow-btc-mean-reversion";
const limiter = new EdgeRateLimiter();

type InstitutionRow = { id: string; name: string };
type MemberRow = { member_key: string; display_name: string; role: string; status: string };
type StrategyRow = { id: string; name: string; version: number; status: string; definition_json: string; content_hash: string };
type PolicyRow = { id: string; version: number; max_gross_exposure_pct: number; max_asset_concentration_pct: number; max_daily_loss_pct: number; max_order_krw: number };
type DeploymentRow = { id: string; strategy_version_id: string; risk_policy_id: string; market: string; interval_minutes: number; status: string; starting_cash_minor: number; cash_minor: number; realized_pnl_minor: number; last_market_price_minor: number; last_candle_at: string | null; last_cycle_at: string | null; updated_at: string };
type PositionRow = { asset: string; quantity: string; cost_basis_minor: number; market_value_minor: number; unrealized_pnl_minor: number; realized_pnl_minor: number };
type SnapshotRow = { id: string; provider: string; market: string; interval_minutes: number; candle_count: number; started_at: string; ended_at: string; fetched_at: string; payload_hash: string; candles_json: string };
type BacktestRow = { id: string; engine_version: string; status: string; starting_cash_minor: number; ending_equity_minor: number; total_return_bps: number; max_drawdown_bps: number; trade_count: number; win_rate_bps: number; fees_minor: number; created_at: string };
type CycleRow = { id: string; status: string; signal_json: string; evidence_hash: string; completed_at: string };
type OrderRow = { id: string; client_order_id: string; side: string; quantity: string; price_minor: number; notional_minor: number; fee_minor: number; status: string; filled_at: string | null };
type ReconciliationRow = { id: string; status: string; intent_count: number; order_count: number; fill_count: number; exception_count: number; evidence_hash: string; created_at: string };

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: JSON_HEADERS });
}

function ownerKey(request: Request) {
  const config = readExchangeRuntimeConfig(env as unknown as Record<string, unknown>);
  return requireTrustedIdentity(request, config).subject;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function institutionContext(owner: string) {
  const institution = await env.DB.prepare("SELECT id, name FROM institutions WHERE owner_key = ? LIMIT 1").bind(owner).first<InstitutionRow>();
  if (!institution) throw new Error("기관 통제 원장을 먼저 초기화해주세요.");
  const member = await env.DB.prepare("SELECT member_key, display_name, role, status FROM institution_memberships WHERE institution_id = ? AND member_key = ? LIMIT 1")
    .bind(institution.id, owner).first<MemberRow>();
  if (!member || member.status !== "active") throw new Error("활성 기관 구성원 권한이 없습니다.");
  return { institution, member };
}

async function auditStatement(input: { institutionId: string; requestId: string; eventType: string; actorKey: string; objectType: string; objectId: string; payload: unknown }) {
  const prior = await env.DB.prepare("SELECT sequence, event_hash FROM institutional_audit_ledger WHERE institution_id = ? ORDER BY sequence DESC LIMIT 1")
    .bind(input.institutionId).first<{ sequence: number; event_hash: string }>();
  const sequence = (prior?.sequence ?? 0) + 1;
  const previousHash = prior?.event_hash ?? "GENESIS";
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload);
  const eventHash = await sha256(`${previousHash}|${input.eventType}|${input.actorKey}|${input.objectType}|${input.objectId}|${payloadJson}|${createdAt}`);
  return env.DB.prepare(`INSERT INTO institutional_audit_ledger
    (id, institution_id, sequence, previous_hash, event_hash, event_type, actor_key, object_type, object_id, request_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      `audit-${crypto.randomUUID()}`, input.institutionId, sequence, previousHash, eventHash,
      input.eventType, input.actorKey, input.objectType, input.objectId, input.requestId, payloadJson, createdAt,
    );
}

function templateDefinition() {
  return {
    schemaVersion: 1,
    purpose: "public_market_data_shadow_validation",
    disclosure: "실제 업비트 공개 시세를 사용하지만 거래소 주문을 전송하지 않는 검증 템플릿",
    shadowSpec: {
      schemaVersion: 1,
      market: "KRW-BTC",
      intervalMinutes: 240,
      entry: { metric: "drawdown", lookbackBars: 6, operator: "lte", thresholdBps: -150 },
      allocationBps: 2_000,
      takeProfitBps: 250,
      stopLossBps: 200,
      feeBps: 5,
      slippageBps: 10,
      startingCashMinor: 100_000_000,
    },
  };
}

async function ensureShadowStrategy(institutionId: string, owner: string) {
  const existing = await env.DB.prepare(`SELECT id, name, version, status, definition_json, content_hash
    FROM institutional_strategy_versions WHERE institution_id = ? AND strategy_key = ? ORDER BY version DESC LIMIT 1`)
    .bind(institutionId, SHADOW_TEMPLATE_KEY).first<StrategyRow>();
  if (existing) return existing;
  const id = `sv-${crypto.randomUUID()}`;
  const definitionJson = JSON.stringify(templateDefinition());
  const contentHash = await sha256(definitionJson);
  const now = new Date().toISOString();
  const requestId = `shadow-seed-${institutionId}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO institutional_strategy_versions
      (id, institution_id, strategy_key, version, name, status, definition_json, source, created_by, created_at, content_hash)
      VALUES (?, ?, ?, 1, 'BTC 4시간 낙폭 섀도 템플릿', 'paper', ?, 'manual', ?, ?, ?)`)
      .bind(id, institutionId, SHADOW_TEMPLATE_KEY, definitionJson, owner, now, contentHash),
    await auditStatement({
      institutionId,
      requestId,
      eventType: "shadow_template_registered",
      actorKey: owner,
      objectType: "strategy_version",
      objectId: id,
      payload: { strategyKey: SHADOW_TEMPLATE_KEY, version: 1, contentHash, externalOrdersAllowed: false },
    }),
  ]);
  const inserted = await env.DB.prepare(`SELECT id, name, version, status, definition_json, content_hash
    FROM institutional_strategy_versions WHERE institution_id = ? AND strategy_key = ? ORDER BY version DESC LIMIT 1`)
    .bind(institutionId, SHADOW_TEMPLATE_KEY).first<StrategyRow>();
  if (!inserted) throw new Error("섀도 검증 전략을 초기화하지 못했습니다.");
  return inserted;
}

async function approvedPolicy(institutionId: string) {
  const policy = await env.DB.prepare(`SELECT id, version, max_gross_exposure_pct, max_asset_concentration_pct, max_daily_loss_pct, max_order_krw
    FROM institutional_risk_policies WHERE institution_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1`)
    .bind(institutionId).first<PolicyRow>();
  if (!policy) throw new Error("승인된 기관 리스크 정책이 필요합니다.");
  return policy;
}

async function ensureDeployment(input: { institutionId: string; owner: string; strategy: StrategyRow; policy: PolicyRow; spec: ShadowStrategySpec }) {
  let deployment = await env.DB.prepare(`SELECT id, strategy_version_id, risk_policy_id, market, interval_minutes, status, starting_cash_minor, cash_minor,
    realized_pnl_minor, last_market_price_minor, last_candle_at, last_cycle_at, updated_at FROM shadow_deployments
    WHERE institution_id = ? AND strategy_version_id = ? LIMIT 1`).bind(input.institutionId, input.strategy.id).first<DeploymentRow>();
  if (deployment) return deployment;
  const id = `sd-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO shadow_deployments
      (id, institution_id, strategy_version_id, risk_policy_id, market, interval_minutes, status, starting_cash_minor, cash_minor,
       realized_pnl_minor, last_market_price_minor, last_candle_at, last_cycle_at, created_by, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, 0, 0, NULL, NULL, ?, ?, ?, 1)`)
      .bind(id, input.institutionId, input.strategy.id, input.policy.id, input.spec.market, input.spec.intervalMinutes, input.spec.startingCashMinor, input.spec.startingCashMinor, input.owner, now, now),
    env.DB.prepare(`INSERT INTO shadow_positions
      (deployment_id, institution_id, asset, quantity, cost_basis_minor, market_value_minor, unrealized_pnl_minor, realized_pnl_minor, updated_at)
      VALUES (?, ?, ?, '0', 0, 0, 0, 0, ?)`)
      .bind(id, input.institutionId, input.spec.market.replace("KRW-", ""), now),
    await auditStatement({
      institutionId: input.institutionId,
      requestId: `shadow-deploy-${id}`,
      eventType: "shadow_deployment_created",
      actorKey: input.owner,
      objectType: "shadow_deployment",
      objectId: id,
      payload: { strategyVersionId: input.strategy.id, riskPolicyId: input.policy.id, market: input.spec.market, externalOrdersAllowed: false },
    }),
  ]);
  deployment = await env.DB.prepare(`SELECT id, strategy_version_id, risk_policy_id, market, interval_minutes, status, starting_cash_minor, cash_minor,
    realized_pnl_minor, last_market_price_minor, last_candle_at, last_cycle_at, updated_at FROM shadow_deployments WHERE id = ? LIMIT 1`).bind(id).first<DeploymentRow>();
  if (!deployment) throw new Error("섀도 배포를 초기화하지 못했습니다.");
  return deployment;
}

async function loadPosition(deploymentId: string): Promise<PositionRow> {
  const position = await env.DB.prepare(`SELECT asset, quantity, cost_basis_minor, market_value_minor, unrealized_pnl_minor, realized_pnl_minor
    FROM shadow_positions WHERE deployment_id = ? LIMIT 1`).bind(deploymentId).first<PositionRow>();
  if (!position) throw new Error("섀도 포지션 원장을 찾을 수 없습니다.");
  return position;
}

async function loadConsoleSnapshot(owner: string): Promise<ShadowConsoleSnapshot> {
  const { institution } = await institutionContext(owner);
  const strategy = await ensureShadowStrategy(institution.id, owner);
  const spec = normalizeShadowStrategyDefinition(parseJson(strategy.definition_json, null));
  const policy = await approvedPolicy(institution.id);
  const deployment = await ensureDeployment({ institutionId: institution.id, owner, strategy, policy, spec });
  const [position, marketData, backtest, cycle, orders, reconciliation] = await Promise.all([
    loadPosition(deployment.id),
    env.DB.prepare(`SELECT id, provider, market, interval_minutes, candle_count, started_at, ended_at, fetched_at, payload_hash, candles_json
      FROM market_data_snapshots WHERE institution_id = ? AND market = ? AND interval_minutes = ? ORDER BY fetched_at DESC LIMIT 1`)
      .bind(institution.id, spec.market, spec.intervalMinutes).first<SnapshotRow>(),
    env.DB.prepare(`SELECT id, engine_version, status, starting_cash_minor, ending_equity_minor, total_return_bps, max_drawdown_bps,
      trade_count, win_rate_bps, fees_minor, created_at FROM institutional_backtest_runs
      WHERE institution_id = ? AND strategy_version_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(institution.id, strategy.id).first<BacktestRow>(),
    env.DB.prepare(`SELECT id, status, signal_json, evidence_hash, completed_at FROM shadow_cycles
      WHERE institution_id = ? AND deployment_id = ? ORDER BY completed_at DESC LIMIT 1`)
      .bind(institution.id, deployment.id).first<CycleRow>(),
    env.DB.prepare(`SELECT id, client_order_id, side, quantity, price_minor, notional_minor, fee_minor, status, filled_at
      FROM shadow_orders WHERE institution_id = ? ORDER BY created_at DESC LIMIT 8`).bind(institution.id).all<OrderRow>(),
    env.DB.prepare(`SELECT id, status, intent_count, order_count, fill_count, exception_count, evidence_hash, created_at
      FROM shadow_reconciliation_runs WHERE institution_id = ? AND deployment_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(institution.id, deployment.id).first<ReconciliationRow>(),
  ]);
  const candles = marketData ? parseJson<MarketCandle[]>(marketData.candles_json, []) : [];
  const latestCloseMinor = Math.round(candles.at(-1)?.close ?? deployment.last_market_price_minor);
  const ageSeconds = marketData ? Math.max(0, Math.floor((Date.now() - Date.parse(marketData.ended_at)) / 1_000)) : 0;
  return {
    safety: { mode: "shadow", externalOrdersAllowed: false, marketDataSource: "upbit_public_quotation", execution: "internal_simulator" },
    strategy: { id: strategy.id, name: strategy.name, version: strategy.version, status: strategy.status, contentHash: strategy.content_hash, market: spec.market, intervalMinutes: spec.intervalMinutes },
    riskPolicy: { id: policy.id, version: policy.version, maxGrossExposurePct: policy.max_gross_exposure_pct, maxAssetConcentrationPct: policy.max_asset_concentration_pct, maxDailyLossPct: policy.max_daily_loss_pct, maxOrderKrw: policy.max_order_krw },
    deployment: { id: deployment.id, status: deployment.status, startingCashMinor: deployment.starting_cash_minor, cashMinor: deployment.cash_minor, realizedPnlMinor: deployment.realized_pnl_minor, lastMarketPriceMinor: deployment.last_market_price_minor, lastCandleAt: deployment.last_candle_at, lastCycleAt: deployment.last_cycle_at, updatedAt: deployment.updated_at },
    position: { asset: position.asset, quantity: position.quantity, costBasisMinor: position.cost_basis_minor, marketValueMinor: position.market_value_minor, unrealizedPnlMinor: position.unrealized_pnl_minor, realizedPnlMinor: position.realized_pnl_minor },
    marketData: marketData ? { snapshotId: marketData.id, provider: marketData.provider, market: marketData.market, intervalMinutes: marketData.interval_minutes, candleCount: marketData.candle_count, startedAt: marketData.started_at, endedAt: marketData.ended_at, fetchedAt: marketData.fetched_at, payloadHash: marketData.payload_hash, latestCloseMinor, ageSeconds } : null,
    backtest: backtest ? { id: backtest.id, engineVersion: backtest.engine_version, status: backtest.status, startingCashMinor: backtest.starting_cash_minor, endingEquityMinor: backtest.ending_equity_minor, totalReturnBps: backtest.total_return_bps, maxDrawdownBps: backtest.max_drawdown_bps, tradeCount: backtest.trade_count, winRateBps: backtest.win_rate_bps, feesMinor: backtest.fees_minor, createdAt: backtest.created_at } : null,
    lastCycle: cycle ? { id: cycle.id, status: cycle.status, signal: parseJson<ShadowSignalEvaluation>(cycle.signal_json, { triggered: false, side: null, reason: "no_signal", metricBps: null, thresholdBps: null, candleAt: null, signalKey: null }), evidenceHash: cycle.evidence_hash, completedAt: cycle.completed_at } : null,
    recentOrders: orders.results.map((row) => ({ id: row.id, clientOrderId: row.client_order_id, side: row.side as "buy" | "sell", quantity: row.quantity, priceMinor: row.price_minor, notionalMinor: row.notional_minor, feeMinor: row.fee_minor, status: row.status, filledAt: row.filled_at })),
    reconciliation: reconciliation ? { id: reconciliation.id, status: reconciliation.status, intentCount: reconciliation.intent_count, orderCount: reconciliation.order_count, fillCount: reconciliation.fill_count, exceptionCount: reconciliation.exception_count, evidenceHash: reconciliation.evidence_hash, createdAt: reconciliation.created_at } : null,
    serverTime: new Date().toISOString(),
  };
}

export async function runCycle(owner: string, requestId: string) {
  const { institution, member } = await institutionContext(owner);
  if (!["portfolio_manager", "risk_officer", "operations", "administrator"].includes(member.role)) {
    throw new Error("현재 역할은 섀도 주기를 실행할 수 없습니다.");
  }
  const duplicate = await env.DB.prepare("SELECT id FROM shadow_cycles WHERE institution_id = ? AND request_id = ? LIMIT 1")
    .bind(institution.id, requestId).first<{ id: string }>();
  if (duplicate) return { snapshot: await loadConsoleSnapshot(owner), duplicate: true };

  const strategy = await ensureShadowStrategy(institution.id, owner);
  const spec = normalizeShadowStrategyDefinition(parseJson(strategy.definition_json, null));
  const policy = await approvedPolicy(institution.id);
  const deployment = await ensureDeployment({ institutionId: institution.id, owner, strategy, policy, spec });
  const position = await loadPosition(deployment.id);

  const source = await fetchUpbitMinuteCandles({ market: spec.market, intervalMinutes: spec.intervalMinutes, count: 180 });
  const candlesJson = JSON.stringify(source.candles);
  const payloadHash = await sha256(candlesJson);
  let marketSnapshot = await env.DB.prepare(`SELECT id, provider, market, interval_minutes, candle_count, started_at, ended_at, fetched_at, payload_hash, candles_json
    FROM market_data_snapshots WHERE institution_id = ? AND provider = 'upbit' AND market = ? AND interval_minutes = ? AND payload_hash = ? LIMIT 1`)
    .bind(institution.id, spec.market, spec.intervalMinutes, payloadHash).first<SnapshotRow>();
  if (!marketSnapshot) {
    const id = `md-${crypto.randomUUID()}`;
    await env.DB.prepare(`INSERT INTO market_data_snapshots
      (id, institution_id, provider, market, interval_minutes, candle_count, started_at, ended_at, fetched_at, source_url, payload_hash, candles_json, status)
      VALUES (?, ?, 'upbit', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified')`).bind(
        id, institution.id, spec.market, spec.intervalMinutes, source.candles.length, source.candles[0].timestamp,
        source.candles.at(-1)!.timestamp, source.fetchedAt, source.sourceUrl, payloadHash, candlesJson,
      ).run();
    marketSnapshot = { id, provider: "upbit", market: spec.market, interval_minutes: spec.intervalMinutes, candle_count: source.candles.length, started_at: source.candles[0].timestamp, ended_at: source.candles.at(-1)!.timestamp, fetched_at: source.fetchedAt, payload_hash: payloadHash, candles_json: candlesJson };
  }
  const priorCycle = await env.DB.prepare("SELECT id FROM shadow_cycles WHERE deployment_id = ? AND market_data_snapshot_id = ? LIMIT 1")
    .bind(deployment.id, marketSnapshot.id).first<{ id: string }>();
  if (priorCycle) return { snapshot: await loadConsoleSnapshot(owner), duplicate: true, sameMarketSnapshot: true };

  const backtestResult = runShadowBacktest(source.candles, spec);
  const backtestId = `bt-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO institutional_backtest_runs
    (id, institution_id, strategy_version_id, market_data_snapshot_id, engine_version, status, starting_cash_minor, ending_equity_minor,
     total_return_bps, max_drawdown_bps, trade_count, win_rate_bps, fees_minor, metrics_json, trades_json, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      backtestId, institution.id, strategy.id, marketSnapshot.id, backtestResult.engineVersion,
      backtestResult.startingCashMinor, backtestResult.endingEquityMinor, backtestResult.totalReturnBps, backtestResult.maxDrawdownBps,
      backtestResult.tradeCount, backtestResult.winRateBps, backtestResult.feesMinor,
      JSON.stringify({ sampleCount: source.candles.length, startedAt: source.candles[0].timestamp, endedAt: source.candles.at(-1)!.timestamp }),
      JSON.stringify(backtestResult.trades), owner, now,
    ).run();

  const positionQuantity = Number(position.quantity);
  const latestCandle = source.candles.at(-1)!;
  const positionValue = Math.round(positionQuantity * latestCandle.close);
  const signal = evaluateLatestShadowSignal({ candles: source.candles, spec, positionQuantity, positionCostMinor: position.cost_basis_minor });
  const dataAgeSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(latestCandle.timestamp)) / 1_000));
  const maxDataAgeSeconds = spec.intervalMinutes * 60 * 2 + 120;
  const statements: D1PreparedStatement[] = [];
  let cycleStatus = "no_signal";
  let orderIntentId: string | null = null;
  let orderId: string | null = null;
  let riskCodes: string[] = [];
  let nextCash = deployment.cash_minor;
  let nextQuantity = positionQuantity;
  let nextCost = position.cost_basis_minor;
  let nextRealized = deployment.realized_pnl_minor;
  let nextPositionValue = positionValue;
  let nextUnrealized = positionValue - position.cost_basis_minor;

  if (signal.triggered && signal.side && signal.signalKey) {
    orderIntentId = `oi-${crypto.randomUUID()}`;
    const orderNotional = signal.side === "buy"
      ? Math.floor(deployment.cash_minor * spec.allocationBps / 10_000)
      : positionValue;
    const quantity = signal.side === "buy" ? orderNotional / latestCandle.close : positionQuantity;
    const idempotencyKey = await sha256(`${institution.id}|${deployment.id}|${signal.signalKey}`);
    const currentDailyLossBps = deployment.realized_pnl_minor < 0
      ? Math.round(-deployment.realized_pnl_minor / deployment.starting_cash_minor * 10_000)
      : 0;
    const risk = evaluateShadowRisk({
      strategyStatus: strategy.status,
      policy: { maxGrossExposurePct: policy.max_gross_exposure_pct, maxAssetConcentrationPct: policy.max_asset_concentration_pct, maxDailyLossPct: policy.max_daily_loss_pct, maxOrderKrw: policy.max_order_krw },
      startingCashMinor: deployment.starting_cash_minor,
      cashMinor: deployment.cash_minor,
      currentPositionValueMinor: positionValue,
      currentDailyLossBps,
      side: signal.side,
      orderNotionalMinor: orderNotional,
      dataAgeSeconds,
      maxDataAgeSeconds,
    });
    riskCodes = risk.codes;
    const riskInputHash = await sha256(JSON.stringify({ strategyVersionId: strategy.id, policyId: policy.id, signal, orderNotional, dataAgeSeconds, projectedGrossExposurePct: risk.projectedGrossExposurePct }));
    statements.push(
      env.DB.prepare(`INSERT INTO shadow_order_intents
        (id, institution_id, deployment_id, strategy_version_id, signal_key, idempotency_key, market, side, notional_minor, quantity, reference_price_minor, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          orderIntentId, institution.id, deployment.id, strategy.id, signal.signalKey, idempotencyKey, spec.market, signal.side,
          orderNotional, quantity.toFixed(12), Math.round(latestCandle.close), risk.allowed ? "allowed" : "blocked", now,
        ),
      env.DB.prepare(`INSERT INTO shadow_risk_decisions
        (id, institution_id, order_intent_id, risk_policy_id, decision, codes_json, input_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          `rd-${crypto.randomUUID()}`, institution.id, orderIntentId, policy.id, risk.allowed ? "allow" : "block", JSON.stringify(risk.codes), riskInputHash, now,
        ),
    );
    if (risk.allowed) {
      const fill = applyShadowFill({ side: signal.side, cashMinor: deployment.cash_minor, positionQuantity, positionCostMinor: position.cost_basis_minor, referencePriceMinor: Math.round(latestCandle.close), orderNotionalMinor: orderNotional, feeBps: spec.feeBps, slippageBps: spec.slippageBps });
      orderId = `so-${crypto.randomUUID()}`;
      const clientOrderId = `shadow-${idempotencyKey.slice(0, 24)}`;
      const fillId = `sf-${crypto.randomUUID()}`;
      nextCash = fill.cashMinor;
      nextQuantity = fill.positionQuantity;
      nextCost = fill.positionCostMinor;
      nextRealized += fill.realizedPnlMinor;
      nextPositionValue = Math.round(nextQuantity * latestCandle.close);
      nextUnrealized = nextPositionValue - nextCost;
      cycleStatus = "simulated_fill";
      statements.push(
        env.DB.prepare(`INSERT INTO shadow_orders
          (id, institution_id, order_intent_id, client_order_id, market, side, quantity, price_minor, notional_minor, fee_minor, status, filled_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'filled', ?, ?)`).bind(
            orderId, institution.id, orderIntentId, clientOrderId, spec.market, signal.side, fill.fillQuantity.toFixed(12), fill.fillPriceMinor, fill.fillNotionalMinor, fill.feeMinor, now, now,
          ),
        env.DB.prepare(`INSERT INTO shadow_fills
          (id, institution_id, order_id, fill_key, quantity, price_minor, notional_minor, fee_minor, filled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
            fillId, institution.id, orderId, `${clientOrderId}-1`, fill.fillQuantity.toFixed(12), fill.fillPriceMinor, fill.fillNotionalMinor, fill.feeMinor, now,
          ),
      );
    } else {
      cycleStatus = "risk_blocked";
    }
  }

  const reconciliationId = `recon-${crypto.randomUUID()}`;
  const expectedCount = orderIntentId ? 1 : 0;
  const filledCount = orderId ? 1 : 0;
  const reconciliationStatus = expectedCount === filledCount || cycleStatus === "risk_blocked" ? "matched" : "exception";
  const exceptionCount = reconciliationStatus === "matched" ? 0 : 1;
  if (exceptionCount > 0) cycleStatus = "reconciliation_exception";
  const reconciliationHash = await sha256(JSON.stringify({ deploymentId: deployment.id, requestId, expectedCount, filledCount, cycleStatus, orderIntentId, orderId }));
  const cycleId = `sc-${crypto.randomUUID()}`;
  const evidenceHash = await sha256(JSON.stringify({ strategyHash: strategy.content_hash, policyId: policy.id, marketPayloadHash: payloadHash, backtest: { engine: backtestResult.engineVersion, returnBps: backtestResult.totalReturnBps, drawdownBps: backtestResult.maxDrawdownBps }, signal, riskCodes, orderIntentId, orderId, reconciliationHash }));

  statements.push(
    env.DB.prepare(`UPDATE shadow_deployments SET status = 'running', cash_minor = ?, realized_pnl_minor = ?, last_market_price_minor = ?,
      last_candle_at = ?, last_cycle_at = ?, updated_at = ?, version = version + 1 WHERE institution_id = ? AND id = ?`).bind(
        nextCash, nextRealized, Math.round(latestCandle.close), latestCandle.timestamp, now, now, institution.id, deployment.id,
      ),
    env.DB.prepare(`INSERT INTO shadow_positions
      (deployment_id, institution_id, asset, quantity, cost_basis_minor, market_value_minor, unrealized_pnl_minor, realized_pnl_minor, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(deployment_id, asset) DO UPDATE SET quantity = excluded.quantity, cost_basis_minor = excluded.cost_basis_minor,
      market_value_minor = excluded.market_value_minor, unrealized_pnl_minor = excluded.unrealized_pnl_minor,
      realized_pnl_minor = excluded.realized_pnl_minor, updated_at = excluded.updated_at`).bind(
        deployment.id, institution.id, spec.market.replace("KRW-", ""), nextQuantity.toFixed(12), nextCost, nextPositionValue, nextUnrealized, nextRealized, now,
      ),
    env.DB.prepare(`INSERT INTO shadow_reconciliation_runs
      (id, institution_id, deployment_id, status, intent_count, order_count, fill_count, exception_count, evidence_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        reconciliationId, institution.id, deployment.id, reconciliationStatus, expectedCount, filledCount, filledCount, exceptionCount, reconciliationHash, now,
      ),
    env.DB.prepare(`INSERT INTO shadow_cycles
      (id, institution_id, deployment_id, market_data_snapshot_id, backtest_run_id, order_intent_id, reconciliation_run_id,
       status, signal_json, evidence_hash, request_id, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        cycleId, institution.id, deployment.id, marketSnapshot.id, backtestId, orderIntentId, reconciliationId,
        cycleStatus, JSON.stringify(signal), evidenceHash, requestId, now, now,
      ),
    await auditStatement({
      institutionId: institution.id,
      requestId,
      eventType: "shadow_cycle_completed",
      actorKey: owner,
      objectType: "shadow_cycle",
      objectId: cycleId,
      payload: { strategyVersionId: strategy.id, marketDataSnapshotId: marketSnapshot.id, cycleStatus, signal, riskCodes, orderIntentId, orderId, reconciliationId, evidenceHash, externalOrdersAllowed: false },
    }),
  );
  if (exceptionCount) {
    statements.push(env.DB.prepare(`INSERT INTO reconciliation_exceptions
      (id, institution_id, kind, severity, status, summary, assigned_role, order_id, created_at, resolved_at)
      VALUES (?, ?, 'position', 'high', 'open', '섀도 의도·주문·체결 수량이 일치하지 않습니다.', 'operations', ?, ?, NULL)`)
      .bind(`rc-${crypto.randomUUID()}`, institution.id, orderId, now));
  }
  await env.DB.batch(statements);
  return { snapshot: await loadConsoleSnapshot(owner), duplicate: false };
}

export async function GET(request: Request) {
  try {
    const owner = ownerKey(request);
    return NextResponse.json({ snapshot: await loadConsoleSnapshot(owner) }, { headers: JSON_HEADERS });
  } catch (error: unknown) {
    if (error instanceof TrustedIdentityError) return jsonError("인증이 필요합니다.", 401);
    const message = error instanceof Error ? error.message : "섀도 운용 상태를 불러오지 못했습니다.";
    console.error("[shadow:get]", message);
    return jsonError(message, message.includes("먼저 초기화") ? 409 : message.includes("권한") ? 403 : 500);
  }
}

export async function POST(request: Request) {
  let owner = "";
  try {
    owner = ownerKey(request);
    const rate = limiter.take(`shadow:${owner}`, 6, 60_000);
    if (!rate.allowed) return jsonError("섀도 실행 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429);
    const raw = await request.text();
    if (raw.length > 4_000) return jsonError("요청이 너무 큽니다.", 413);
    let body: { action?: unknown; requestId?: unknown };
    try { body = JSON.parse(raw) as typeof body; } catch { return jsonError("요청 형식이 올바르지 않습니다.", 400); }
    if (body.action !== "run_cycle") return jsonError("지원하지 않는 섀도 명령입니다.", 400);
    if (typeof body.requestId !== "string" || !VALID_REQUEST_ID.test(body.requestId)) return jsonError("요청 식별자가 올바르지 않습니다.", 400);
    return NextResponse.json(await runCycle(owner, body.requestId), { headers: JSON_HEADERS });
  } catch (error: unknown) {
    if (error instanceof TrustedIdentityError) return jsonError("인증이 필요합니다.", 401);
    const message = error instanceof Error ? error.message : "섀도 주기를 실행하지 못했습니다.";
    console.error("[shadow:post]", owner ? message : "identity error");
    return jsonError(message, message.includes("권한") ? 403 : message.includes("필요") || message.includes("지원") ? 409 : 502);
  }
}
