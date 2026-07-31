import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import {
  DEFAULT_MARKETPLACE_SNAPSHOT,
  type MarketplaceCommand,
  type MarketplaceRisk,
  type MarketplaceSnapshot,
  type MarketplaceStrategy,
  type MarketplaceSubscription,
} from "../../../lib/marketplace";
import { assessStrategyTrust, type StrategyPerformanceEvidence } from "../../../lib/market-trust";
import {
  CREATOR_FEE_SPLIT_PCT,
  DEFAULT_PROFIT_SHARE_PCT,
  PLATFORM_FEE_SPLIT_PCT,
  containsExecutableRuleDetail,
  projectStrategySourceForViewer,
} from "../../../lib/marketplace-license";
import { readExchangeRuntimeConfig } from "../../../lib/security/config";
import { requireTrustedIdentity, TrustedIdentityError } from "../../../lib/security/identity";

export const runtime = "edge";

type StrategyRow = {
  id: string;
  creator_key: string;
  creator_name: string;
  name: string;
  description: string;
  category: string;
  risk: string;
  price_monthly: number;
  return_90d: number;
  max_drawdown: number;
  win_rate: number;
  live_days: number;
  trade_count: number;
  trust_score: number;
  condition_summary: string;
  blocks_json: string;
  visibility: string;
  verification: string;
  status: string;
  subscribers: number;
  updated_at: string;
};

type SubscriptionRow = {
  strategy_id: string;
  status: string;
  risk_limit: number;
  allocation: number;
  monthly_price: number;
  created_at: string;
};

const JSON_HEADERS = { "Cache-Control": "no-store" };
const VALID_ID = /^[A-Za-z0-9-]{3,100}$/;
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,120}$/;
const VALID_RISKS: MarketplaceRisk[] = ["낮음", "보통", "높음"];

function ownerKey(request: Request) {
  const config = readExchangeRuntimeConfig(env as unknown as Record<string, unknown>);
  return requireTrustedIdentity(request, config).subject;
}

function creatorName(request: Request) {
  const name = request.headers.get("oai-authenticated-user-name")?.trim();
  return name && name.length <= 40 ? name : "정훈";
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: JSON_HEADERS });
}

function parseBlocks(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

async function ensureSeed() {
  const seedStatements = DEFAULT_MARKETPLACE_SNAPSHOT.strategies.map((strategy) =>
    env.DB.prepare(`INSERT OR IGNORE INTO marketplace_strategies
      (id, creator_key, creator_name, name, description, category, risk, price_monthly,
       return_90d, max_drawdown, win_rate, live_days, trade_count, trust_score,
       condition_summary, blocks_json, visibility, verification, status, subscribers, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        strategy.id,
        `seed:${strategy.id}`,
        strategy.creatorName,
        strategy.name,
        strategy.description,
        strategy.category,
        strategy.risk,
        strategy.priceMonthly,
        strategy.return90d,
        strategy.maxDrawdown,
        strategy.winRate,
        strategy.liveDays,
        strategy.tradeCount,
        strategy.trustScore,
        strategy.conditionSummary,
        JSON.stringify(strategy.blocks),
        strategy.visibility,
        strategy.verification,
        strategy.status,
        strategy.subscribers,
        "2026-07-01T00:00:00.000Z",
        strategy.updatedAt,
      ),
  );
  const protectedSeedStatements = DEFAULT_MARKETPLACE_SNAPSHOT.strategies.map((strategy) =>
    env.DB.prepare("UPDATE marketplace_strategies SET price_monthly = 0, visibility = 'signal_only' WHERE id = ? AND creator_key = ?")
      .bind(strategy.id, `seed:${strategy.id}`),
  );
  await env.DB.batch([...seedStatements, ...protectedSeedStatements]);
}

async function loadSnapshot(owner: string): Promise<MarketplaceSnapshot> {
  await ensureSeed();
  const [strategyRows, subscriptionRows] = await Promise.all([
    env.DB.prepare(`SELECT id, creator_key, creator_name, name, description, category, risk,
      price_monthly, return_90d, max_drawdown, win_rate, live_days, trade_count, trust_score,
      condition_summary, blocks_json, visibility, verification, status, subscribers, updated_at
      FROM marketplace_strategies ORDER BY trust_score DESC, subscribers DESC`).all<StrategyRow>(),
    env.DB.prepare(`SELECT strategy_id, status, risk_limit, allocation, monthly_price, created_at
      FROM marketplace_subscriptions WHERE subscriber_key = ? ORDER BY rowid DESC`).bind(owner).all<SubscriptionRow>(),
  ]);

  const strategies: MarketplaceStrategy[] = strategyRows.results.map((row) => {
    const isSeedExample = row.creator_key.startsWith("seed:");
    const verification: MarketplaceStrategy["verification"] = isSeedExample ? "예시 데이터" : row.verification as MarketplaceStrategy["verification"];
    const directUpdatedAt = Date.parse(row.updated_at);
    const parsedUpdatedAt = Number.isFinite(directUpdatedAt) ? directUpdatedAt : Date.parse(row.updated_at.replaceAll(".", "-"));
    const metrics = {
      netReturnPct:row.return_90d, maxDrawdownPct:Math.abs(row.max_drawdown), tradeCount:row.trade_count,
      liveDays:row.live_days, dataFreshnessMinutes:Number.isFinite(parsedUpdatedAt) ? Math.max(0, Math.round((Date.now() - parsedUpdatedAt) / 60_000)) : 10_000,
      sampleSize:row.trade_count, asOf:row.updated_at,
    };
    const evidence: StrategyPerformanceEvidence = verification === "실운영 검증" && !isSeedExample
      ? { verified:{ source:"verified_live", metrics, verificationRunId:`live-${row.id}`, verifiedAt:row.updated_at, verifierId:"exchange-connector" }, cohort:{ includesInactiveStrategies:false, includesDelistedStrategies:false } }
        : verification === "모의운영 검증" && !isSeedExample
        ? { verified:{ source:"verified_paper", metrics, verificationRunId:`paper-${row.id}`, verifiedAt:row.updated_at, verifierId:"backtest-engine-v1" }, cohort:{ includesInactiveStrategies:false, includesDelistedStrategies:false } }
        : { selfReported:{ source:"self_reported", metrics, declaredAt:row.updated_at, declarationId:`declared-${row.id}` }, cohort:{ includesInactiveStrategies:false, includesDelistedStrategies:false } };
    const trust = assessStrategyTrust(evidence);
    const isMine = row.creator_key === owner;
    const source = projectStrategySourceForViewer({
      name: row.name,
      category: row.category,
      description: row.description,
      conditionSummary: row.condition_summary,
      blocks: parseBlocks(row.blocks_json),
    }, isMine);
    return {
    id: row.id,
    creatorName: row.creator_name,
    isMine,
    name: source.name,
    description: source.description,
    category: row.category,
    risk: row.risk as MarketplaceStrategy["risk"],
    priceMonthly: 0,
    profitSharePct: DEFAULT_PROFIT_SHARE_PCT,
    creatorFeeSplitPct: CREATOR_FEE_SPLIT_PCT,
    platformFeeSplitPct: PLATFORM_FEE_SPLIT_PCT,
    deliveryMode: "server_execution",
    sourceAccess: "owner_only",
    performanceSettlement: "locked",
    return90d: row.return_90d,
    maxDrawdown: row.max_drawdown,
    winRate: row.win_rate,
    liveDays: row.live_days,
    tradeCount: row.trade_count,
    trustScore: trust.score,
    trustGrade: trust.grade,
    trustWarnings: trust.warnings.map((warning) => warning.message),
    conditionSummary: source.conditionSummary,
    blocks: source.blocks,
    visibility: source.visibility,
    verification,
    status: row.status as MarketplaceStrategy["status"],
    subscribers: row.subscribers,
    updatedAt: row.updated_at,
  }; });
  const subscriptions: MarketplaceSubscription[] = subscriptionRows.results.map((row) => ({
    strategyId: row.strategy_id,
    status: row.status as MarketplaceSubscription["status"],
    riskLimit: row.risk_limit,
    allocation: row.allocation,
    monthlyPrice: row.monthly_price,
    profitSharePct: DEFAULT_PROFIT_SHARE_PCT,
    deliveryMode: "server_execution",
    sourceAccess: false,
    createdAt: row.created_at,
  }));
  const mine = strategies.filter((strategy) => strategy.isMine && strategy.status === "listed");

  return {
    strategies,
    subscriptions,
    creator: {
      listedCount: mine.length,
      activeSubscribers: mine.reduce((sum, strategy) => sum + strategy.subscribers, 0),
      estimatedPerformanceFee: 0,
      estimatedCreatorPayout: 0,
    },
  };
}

async function subscribe(owner: string, command: Extract<MarketplaceCommand, { action: "subscribe" }>) {
  if (!VALID_ID.test(command.strategyId)) throw new Error("유효하지 않은 전략입니다");
  if (!Number.isFinite(command.riskLimit) || command.riskLimit < 1 || command.riskLimit > 10) throw new Error("손실 한도는 1~10%로 설정해주세요");
  if (!Number.isInteger(command.allocation) || command.allocation < 5 || command.allocation > 100) throw new Error("운용 비중은 5~100%로 설정해주세요");
  const strategy = await env.DB.prepare("SELECT price_monthly, status, creator_key FROM marketplace_strategies WHERE id = ? LIMIT 1").bind(command.strategyId).first<{ price_monthly: number; status: string; creator_key: string }>();
  if (!strategy || strategy.status !== "listed") throw new Error("현재 구독할 수 없는 전략입니다");
  if (strategy.creator_key === owner) throw new Error("내 전략은 구독할 필요가 없습니다");
  const previous = await env.DB.prepare("SELECT status FROM marketplace_subscriptions WHERE subscriber_key = ? AND strategy_id = ? LIMIT 1").bind(owner, command.strategyId).first<{ status: string }>();
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`INSERT INTO marketplace_subscriptions
      (subscriber_key, strategy_id, status, risk_limit, allocation, monthly_price, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?)
      ON CONFLICT(subscriber_key, strategy_id) DO UPDATE SET
        status = 'active', risk_limit = excluded.risk_limit, allocation = excluded.allocation,
        monthly_price = excluded.monthly_price, updated_at = excluded.updated_at`)
      .bind(owner, command.strategyId, command.riskLimit, command.allocation, 0, now, now),
  ];
  if (!previous || previous.status !== "active") {
    statements.push(env.DB.prepare("UPDATE marketplace_strategies SET subscribers = subscribers + 1, updated_at = ? WHERE id = ?").bind(now, command.strategyId));
  }
  await env.DB.batch(statements);
}

async function unsubscribe(owner: string, command: Extract<MarketplaceCommand, { action: "unsubscribe" }>) {
  if (!VALID_ID.test(command.strategyId)) throw new Error("유효하지 않은 전략입니다");
  const previous = await env.DB.prepare("SELECT status FROM marketplace_subscriptions WHERE subscriber_key = ? AND strategy_id = ? LIMIT 1").bind(owner, command.strategyId).first<{ status: string }>();
  if (!previous || previous.status !== "active") throw new Error("활성 구독을 찾을 수 없습니다");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE marketplace_subscriptions SET status = 'cancelled', updated_at = ? WHERE subscriber_key = ? AND strategy_id = ?").bind(now, owner, command.strategyId),
    env.DB.prepare("UPDATE marketplace_strategies SET subscribers = MAX(0, subscribers - 1), updated_at = ? WHERE id = ?").bind(now, command.strategyId),
  ]);
}

async function publish(owner: string, displayName: string, command: Extract<MarketplaceCommand, { action: "publish" }>) {
  const listing = command.listing;
  if (!listing || listing.name.trim().length < 3 || listing.name.trim().length > 50) throw new Error("전략 이름은 3~50자로 입력해주세요");
  if (listing.description.trim().length < 12 || listing.description.trim().length > 240) throw new Error("전략 설명은 12~240자로 입력해주세요");
  if (!VALID_RISKS.includes(listing.risk)) throw new Error("위험도를 확인해주세요");
  if (listing.priceMonthly !== 0) throw new Error("전략별 월 구독료는 사용할 수 없습니다");
  if (!Array.isArray(listing.blocks) || listing.blocks.length < 2 || listing.blocks.length > 20) throw new Error("공유할 전략 블록을 확인해주세요");
  if (listing.visibility !== "signal_only") throw new Error("전략 원본은 서버 실행 전용으로만 게시할 수 있습니다");
  if (containsExecutableRuleDetail(listing.name)) throw new Error("전략 이름에서 정확한 수치·주기·임계값을 제거해주세요");
  if (containsExecutableRuleDetail(listing.description)) throw new Error("공개 설명에서 정확한 수치·주기·임계값을 제거해주세요");
  const duplicate = await env.DB.prepare("SELECT id FROM marketplace_strategies WHERE creator_key = ? AND name = ? LIMIT 1").bind(owner, listing.name.trim()).first();
  if (duplicate) throw new Error("같은 이름의 전략이 이미 등록되어 있습니다");
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO marketplace_strategies
    (id, creator_key, creator_name, name, description, category, risk, price_monthly,
     return_90d, max_drawdown, win_rate, live_days, trade_count, trust_score,
     condition_summary, blocks_json, visibility, verification, status, subscribers, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, '검증 대기', 'listed', 0, ?, ?)`)
    .bind(
      `market-user-${crypto.randomUUID()}`,
      owner,
      displayName,
      listing.name.trim(),
      listing.description.trim(),
      listing.category.slice(0, 20),
      listing.risk,
      0,
      listing.conditionSummary.slice(0, 180),
      JSON.stringify(listing.blocks.map((block) => block.slice(0, 160))),
      "signal_only",
      now,
      new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }).replaceAll(". ", ".").replace(".", ""),
    ).run();
}

async function toggleListing(owner: string, command: Extract<MarketplaceCommand, { action: "toggle_listing" }>) {
  if (!VALID_ID.test(command.strategyId)) throw new Error("유효하지 않은 전략입니다");
  const strategy = await env.DB.prepare("SELECT status FROM marketplace_strategies WHERE id = ? AND creator_key = ? LIMIT 1").bind(command.strategyId, owner).first<{ status: string }>();
  if (!strategy) throw new Error("내 전략을 찾을 수 없습니다");
  const nextStatus = strategy.status === "listed" ? "paused" : "listed";
  await env.DB.prepare("UPDATE marketplace_strategies SET status = ?, updated_at = ? WHERE id = ? AND creator_key = ?").bind(nextStatus, new Date().toISOString(), command.strategyId, owner).run();
}

export async function GET(request: Request) {
  try {
    return NextResponse.json({ snapshot: await loadSnapshot(ownerKey(request)) }, { headers: JSON_HEADERS });
  } catch (error: unknown) {
    if (error instanceof TrustedIdentityError) return jsonError("인증이 필요합니다", 401);
    console.error("[marketplace:get]", error instanceof Error ? error.message : "unknown error");
    return jsonError("전략 마켓 데이터를 불러오지 못했습니다", 500);
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 16_000) return jsonError("요청이 너무 큽니다", 413);
    let command: MarketplaceCommand;
    try {
      command = JSON.parse(raw) as MarketplaceCommand;
    } catch {
      return jsonError("요청 형식이 올바르지 않습니다", 400);
    }
    if (!command || !VALID_REQUEST_ID.test(command.requestId || "")) return jsonError("요청 식별자가 올바르지 않습니다", 400);
    const owner = ownerKey(request);
    if (command.action === "subscribe") await subscribe(owner, command);
    else if (command.action === "unsubscribe") await unsubscribe(owner, command);
    else if (command.action === "publish") await publish(owner, creatorName(request), command);
    else if (command.action === "toggle_listing") await toggleListing(owner, command);
    else return jsonError("지원하지 않는 마켓 명령입니다", 400);
    return NextResponse.json({ snapshot: await loadSnapshot(owner) }, { headers: JSON_HEADERS });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "요청을 처리하지 못했습니다";
    if (error instanceof TrustedIdentityError) return jsonError("인증이 필요합니다", 401);
    console.error("[marketplace:post]", message);
    return jsonError(message, 400);
  }
}
