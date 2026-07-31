import { UpbitReadOnlyAdapter } from "../exchange/upbit";
import type { ExchangeAccount, ReadOnlyExchangeOrder } from "../exchange/types";
import { readSecretBrokerConfig, resolveExchangeCredential } from "../security/secret-broker";

type Environment = Record<string, unknown>;

type ConnectionRow = {
  id: string;
  institution_id: string;
  provider: string;
  account_fingerprint: string;
  secret_reference: string;
  permission_mode: string;
  status: string;
};

function sha256(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function isSafeDecimal(value: string): boolean {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
}

function validateAccounts(accounts: readonly ExchangeAccount[]): string[] {
  const issues: string[] = [];
  const currencies = new Set<string>();
  for (const account of accounts) {
    if (!/^[A-Z0-9]{2,16}$/.test(account.currency) || currencies.has(account.currency)) {
      issues.push("ACCOUNT_CURRENCY_INVALID_OR_DUPLICATED");
    }
    currencies.add(account.currency);
    if (![account.balance, account.locked, account.averageBuyPrice].every(isSafeDecimal)) {
      issues.push("ACCOUNT_DECIMAL_INVALID");
    }
  }
  if (!currencies.has("KRW")) issues.push("KRW_BALANCE_NOT_VISIBLE");
  return [...new Set(issues)];
}

function validateOrders(orders: readonly ReadOnlyExchangeOrder[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const order of orders) {
    if (!order.id || ids.has(order.id)) issues.push("EXCHANGE_ORDER_DUPLICATED");
    ids.add(order.id);
    if (!/^KRW-[A-Z0-9]{2,16}$/.test(order.market)) issues.push("EXCHANGE_MARKET_INVALID");
    if (![order.volume, order.executedVolume, order.remainingVolume, order.price, order.paidFee].every(isSafeDecimal)) {
      issues.push("EXCHANGE_ORDER_DECIMAL_INVALID");
    }
  }
  return [...new Set(issues)];
}

async function insertException(
  db: D1Database,
  input: { institutionId: string; summary: string; requestId: string },
) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO reconciliation_exceptions
    (id, institution_id, kind, severity, status, summary, assigned_role, order_id, created_at, resolved_at)
    VALUES (?, ?, 'balance', 'high', 'open', ?, 'operations', NULL, ?, NULL)`)
    .bind(`rc-${crypto.randomUUID()}`, input.institutionId, `${input.summary} · 요청 ${input.requestId.slice(0, 18)}`, now)
    .run();
}

export async function runReadOnlyExchangeReconciliation(input: {
  db: D1Database;
  environment: Environment;
  institutionId: string;
  connectionId: string;
  actorKey: string;
  requestId: string;
  fetcher?: typeof fetch;
}): Promise<{
  runId: string;
  status: "observed" | "exception";
  balanceCount: number;
  openOrderCount: number;
  closedOrderCount: number;
  exceptionCodes: string[];
  evidenceHash: string;
}> {
  const connection = await input.db.prepare(`SELECT id, institution_id, provider, account_fingerprint,
    secret_reference, permission_mode, status FROM exchange_connections
    WHERE id = ? AND institution_id = ? LIMIT 1`)
    .bind(input.connectionId, input.institutionId)
    .first<ConnectionRow>();
  if (!connection) throw new Error("읽기 전용 거래소 연결을 찾을 수 없습니다.");
  if (connection.provider !== "upbit" || connection.permission_mode !== "read_only" || connection.status !== "active") {
    throw new Error("읽기 전용으로 승인된 업비트 연결만 대사할 수 있습니다.");
  }

  const brokerConfig = readSecretBrokerConfig(input.environment);
  const credential = await resolveExchangeCredential(brokerConfig, {
    secretReference: connection.secret_reference,
    institutionId: input.institutionId,
    actorKey: input.actorKey,
    requestId: input.requestId,
    purpose: "read_only_reconciliation",
  }, input.fetcher);
  if (credential.credentialFingerprint !== connection.account_fingerprint.toLowerCase()) {
    throw new Error("승인된 계정 지문과 비밀정보 브로커의 자격증명이 일치하지 않습니다.");
  }

  const adapter = new UpbitReadOnlyAdapter({
    apiBaseUrl: "https://api.upbit.com",
    accessKey: credential.accessKey,
    secretKey: credential.secretKey,
  }, input.fetcher);
  const startedAt = new Date().toISOString();
  const [accounts, openOrders, closedOrders] = await Promise.all([
    adapter.getAccounts(`${input.requestId}:accounts`),
    adapter.getOpenOrders(`${input.requestId}:open`),
    adapter.getClosedOrders(`${input.requestId}:closed`, { limit: 200 }),
  ]);
  const exceptionCodes = [
    ...validateAccounts(accounts),
    ...validateOrders([...openOrders, ...closedOrders]),
  ].filter((value, index, all) => all.indexOf(value) === index);
  const status = exceptionCodes.length === 0 ? "observed" : "exception";
  const normalized = {
    connectionId: connection.id,
    accounts: [...accounts].sort((a, b) => a.currency.localeCompare(b.currency)),
    openOrders: [...openOrders].sort((a, b) => a.id.localeCompare(b.id)),
    closedOrders: [...closedOrders].sort((a, b) => a.id.localeCompare(b.id)),
    exceptionCodes,
  };
  const evidenceHash = await sha256(stableJson(normalized));
  const runId = `xrr-${crypto.randomUUID()}`;
  const completedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    input.db.prepare(`INSERT INTO exchange_reconciliation_runs
      (id, institution_id, connection_id, status, comparison_scope, balance_count, open_order_count,
       closed_order_count, exception_count, evidence_hash, started_at, completed_at)
      VALUES (?, ?, ?, ?, 'read_only_observation', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        runId,
        input.institutionId,
        connection.id,
        status,
        accounts.length,
        openOrders.length,
        closedOrders.length,
        exceptionCodes.length,
        evidenceHash,
        startedAt,
        completedAt,
      ),
    input.db.prepare(`UPDATE exchange_connections
      SET last_verified_at = ?, last_reconciled_at = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`)
      .bind(completedAt, completedAt, completedAt, connection.id, input.institutionId),
  ];
  for (const account of accounts) {
    const payloadHash = await sha256(stableJson(account));
    statements.push(input.db.prepare(`INSERT INTO exchange_balance_snapshots
      (run_id, institution_id, currency, available, locked, average_buy_price, payload_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(runId, input.institutionId, account.currency, account.balance, account.locked, account.averageBuyPrice, payloadHash));
  }
  for (const order of [...openOrders, ...closedOrders]) {
    const payloadHash = await sha256(stableJson(order));
    statements.push(input.db.prepare(`INSERT OR IGNORE INTO exchange_order_snapshots
      (run_id, institution_id, exchange_order_id, market, side, state, volume, executed_volume,
       remaining_volume, price, paid_fee, exchange_created_at, payload_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        runId,
        input.institutionId,
        order.id,
        order.market,
        order.side,
        order.state,
        order.volume,
        order.executedVolume,
        order.remainingVolume,
        order.price,
        order.paidFee,
        order.createdAt,
        payloadHash,
      ));
  }
  await input.db.batch(statements);
  if (exceptionCodes.length > 0) {
    await insertException(input.db, {
      institutionId: input.institutionId,
      summary: `법인 거래소 읽기 전용 대사 예외: ${exceptionCodes.join(", ")}`,
      requestId: input.requestId,
    });
  }
  return {
    runId,
    status,
    balanceCount: accounts.length,
    openOrderCount: openOrders.length,
    closedOrderCount: closedOrders.length,
    exceptionCodes,
    evidenceHash,
  };
}
