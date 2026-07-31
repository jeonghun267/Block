import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { appendAuditEvent, verifyAuditChain } from "../../../lib/audit-ledger";
import { enqueueRuntimeJob } from "../../../lib/runtime/job-queue";
import type { RuntimeCommandInput, RuntimeControlStatus } from "../../../lib/runtime/status";
import { readExchangeRuntimeConfig } from "../../../lib/security/config";
import { requireTrustedIdentity, TrustedIdentityError } from "../../../lib/security/identity";
import { EdgeRateLimiter, getRequestContext, rateLimitHeaders } from "../../../lib/security/request";
import { readSecretBrokerConfig } from "../../../lib/security/secret-broker";

export const runtime = "edge";

const limiter = new EdgeRateLimiter();
const JSON_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;
const SECRET_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,239}$/;
const FINGERPRINT = /^[A-Fa-f0-9]{16,128}$/;

type InstitutionRow = { id: string; owner_key: string };
type MemberRow = { member_key: string; role: string; status: string };
type HeartbeatRow = { status: string; recovered_leases: number; completed_at: string };
type CountRow = { status: string; count: number };
type ConnectionCountRow = { status: string; count: number };
type ReconRow = { status: string; evidence_hash: string; completed_at: string };
type JobRow = {
  id: string;
  kind: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  scheduled_for: string;
  completed_at: string | null;
  last_error_code: string | null;
};

function jsonError(message: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: message, requestId },
    { status, headers: { ...JSON_HEADERS, "X-Request-ID": requestId } },
  );
}

async function identityContext(request: Request) {
  const config = readExchangeRuntimeConfig(env as unknown as Record<string, unknown>);
  const identity = requireTrustedIdentity(request, config);
  const institution = await env.DB.prepare("SELECT id, owner_key FROM institutions WHERE owner_key = ? LIMIT 1")
    .bind(identity.subject)
    .first<InstitutionRow>();
  if (!institution) throw new Error("기관 통제센터를 먼저 초기화해주세요.");
  const member = await env.DB.prepare(`SELECT member_key, role, status FROM institution_memberships
    WHERE institution_id = ? AND member_key = ? LIMIT 1`)
    .bind(institution.id, identity.subject)
    .first<MemberRow>();
  if (!member || member.status !== "active") throw new TrustedIdentityError();
  return { config, identity, institution, member };
}

function provider(source: string): RuntimeControlStatus["authentication"]["provider"] {
  if (source === "oai-authenticated-user-email") return "sign_in_with_chatgpt";
  if (source === "cf-access-authenticated-user-email") return "cloudflare_access";
  return "development_demo";
}

async function loadStatus(request: Request): Promise<RuntimeControlStatus> {
  const { identity, institution } = await identityContext(request);
  const [heartbeat, counts, connectionCounts, reconciliation, jobs, auditChain] = await Promise.all([
    env.DB.prepare(`SELECT status, recovered_leases, completed_at FROM runtime_scheduler_heartbeats
      WHERE scheduler_key = 'institutional-runtime' LIMIT 1`).first<HeartbeatRow>(),
    env.DB.prepare(`SELECT status, COUNT(*) AS count FROM runtime_jobs
      WHERE institution_id = ? GROUP BY status`).bind(institution.id).all<CountRow>(),
    env.DB.prepare(`SELECT status, COUNT(*) AS count FROM exchange_connections
      WHERE institution_id = ? GROUP BY status`).bind(institution.id).all<ConnectionCountRow>(),
    env.DB.prepare(`SELECT status, evidence_hash, completed_at FROM exchange_reconciliation_runs
      WHERE institution_id = ? ORDER BY completed_at DESC LIMIT 1`).bind(institution.id).first<ReconRow>(),
    env.DB.prepare(`SELECT id, kind, status, attempt_count, max_attempts, scheduled_for, completed_at, last_error_code
      FROM runtime_jobs WHERE institution_id = ? ORDER BY updated_at DESC LIMIT 8`)
      .bind(institution.id).all<JobRow>(),
    verifyAuditChain(env.DB, institution.id),
  ]);
  const queueCounts = Object.fromEntries(counts.results.map((row) => [row.status, Number(row.count)]));
  const connections = Object.fromEntries(connectionCounts.results.map((row) => [row.status, Number(row.count)]));
  const heartbeatAge = heartbeat ? Date.now() - Date.parse(heartbeat.completed_at) : Number.POSITIVE_INFINITY;
  const schedulerState = !heartbeat
    ? "not_started"
    : heartbeatAge <= 3 * 60_000
      ? "active"
      : "stale";
  const broker = readSecretBrokerConfig(env as unknown as Record<string, unknown>);

  return {
    authentication: {
      authenticated: true,
      provider: provider(identity.source),
      productionIdentity: identity.source !== "development-demo",
    },
    scheduler: {
      state: schedulerState,
      lastCompletedAt: heartbeat?.completed_at ?? null,
      lastStatus: heartbeat?.status === "healthy" || heartbeat?.status === "degraded" ? heartbeat.status : null,
      recoveredLeases: Number(heartbeat?.recovered_leases ?? 0),
    },
    queue: {
      pending: Number(queueCounts.pending ?? 0),
      leased: Number(queueCounts.leased ?? 0),
      retryWait: Number(queueCounts.retry_wait ?? 0),
      succeeded: Number(queueCounts.succeeded ?? 0),
      quarantined: Number(queueCounts.quarantined ?? 0),
    },
    secretBroker: {
      ready: broker.ready,
      missing: broker.missing,
      plaintextStorageAllowed: false,
    },
    exchangeReconciliation: {
      activeConnections: Number(connections.active ?? 0),
      pendingConnections: Number(connections.pending_approval ?? 0),
      lastRunAt: reconciliation?.completed_at ?? null,
      lastStatus: reconciliation?.status ?? null,
      lastEvidenceHash: reconciliation?.evidence_hash ?? null,
    },
    auditChain,
    liveTrading: {
      allowed: false,
      reason: "institutional_foundation_validation",
    },
    recentJobs: jobs.results.map((row) => ({
      id: row.id,
      kind: row.kind as "shadow_cycle" | "exchange_reconciliation",
      status: row.status,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      scheduledFor: row.scheduled_for,
      completedAt: row.completed_at,
      errorCode: row.last_error_code,
    })),
    serverTime: new Date().toISOString(),
  };
}

function validateBody(value: unknown): RuntimeCommandInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("요청 형식이 올바르지 않습니다.");
  const body = value as Record<string, unknown>;
  if (body.action === "register_read_only_exchange") {
    const accountLabel = typeof body.accountLabel === "string" ? body.accountLabel.trim() : "";
    const accountFingerprint = typeof body.accountFingerprint === "string" ? body.accountFingerprint.trim().toLowerCase() : "";
    const secretReference = typeof body.secretReference === "string" ? body.secretReference.trim() : "";
    if (accountLabel.length < 3 || accountLabel.length > 80) throw new Error("거래소 계정 이름은 3~80자여야 합니다.");
    if (!FINGERPRINT.test(accountFingerprint)) throw new Error("거래소 계정 지문 형식이 올바르지 않습니다.");
    if (!SECRET_REFERENCE.test(secretReference)) throw new Error("KMS/Vault 비밀정보 참조 형식이 올바르지 않습니다.");
    return { action: body.action, accountLabel, accountFingerprint, secretReference };
  }
  if (body.action === "enqueue_shadow_cycle") {
    const deploymentId = typeof body.deploymentId === "string" ? body.deploymentId : "";
    if (!SAFE_ID.test(deploymentId)) throw new Error("섀도 배포 식별자가 올바르지 않습니다.");
    return { action: body.action, deploymentId };
  }
  if (body.action === "decide_read_only_exchange") {
    const connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
    const decision = body.decision;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!SAFE_ID.test(connectionId)) throw new Error("거래소 연결 식별자가 올바르지 않습니다.");
    if (decision !== "approve" && decision !== "reject") throw new Error("승인 결정을 확인해주세요.");
    if (note.length < 8 || note.length > 500) throw new Error("승인 근거는 8~500자로 기록해야 합니다.");
    return { action: body.action, connectionId, decision, note };
  }
  throw new Error("지원하지 않는 런타임 명령입니다.");
}

export async function GET(request: Request) {
  const requestId = getRequestContext(request).requestId;
  try {
    const { identity } = await identityContext(request);
    const rate = limiter.take(`runtime-status:${identity.subject}`, 30, 60_000);
    const headers = { ...JSON_HEADERS, ...rateLimitHeaders(rate), "X-Request-ID": requestId };
    if (!rate.allowed) return NextResponse.json({ error: "요청이 너무 많습니다.", requestId }, { status: 429, headers });
    return NextResponse.json({ status: await loadStatus(request), requestId }, { headers });
  } catch (error) {
    if (error instanceof TrustedIdentityError) return jsonError("기관 인증이 필요합니다.", 401, requestId);
    console.error(JSON.stringify({ level: "error", event: "runtime_status_failed", requestId, errorType: error instanceof Error ? error.name : "RuntimeError" }));
    return jsonError(error instanceof Error ? error.message : "기관 런타임 상태를 확인하지 못했습니다.", 503, requestId);
  }
}

export async function POST(request: Request) {
  let context: ReturnType<typeof getRequestContext>;
  try {
    context = getRequestContext(request, { requireIdempotency: true });
  } catch {
    return jsonError("유효한 Idempotency-Key가 필요합니다.", 400, crypto.randomUUID());
  }
  try {
    const { identity, institution, member } = await identityContext(request);
    const rate = limiter.take(`runtime-command:${identity.subject}`, 10, 60_000);
    const headers = { ...JSON_HEADERS, ...rateLimitHeaders(rate), "X-Request-ID": context.requestId };
    if (!rate.allowed) return NextResponse.json({ error: "요청이 너무 많습니다.", requestId: context.requestId }, { status: 429, headers });
    const raw = await request.text();
    if (raw.length > 8_000) return NextResponse.json({ error: "요청 크기가 너무 큽니다.", requestId: context.requestId }, { status: 413, headers });
    const command = validateBody(JSON.parse(raw) as unknown);

    if (command.action === "register_read_only_exchange") {
      if (!["administrator", "portfolio_manager"].includes(member.role)) {
        return NextResponse.json({ error: "거래소 연결 요청 권한이 없습니다.", requestId: context.requestId }, { status: 403, headers });
      }
      const connectionId = `xc-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await env.DB.prepare(`INSERT OR IGNORE INTO exchange_connections
        (id, institution_id, provider, account_label, account_fingerprint, secret_reference, permission_mode,
         status, last_verified_at, last_reconciled_at, created_by, created_at, updated_at)
        VALUES (?, ?, 'upbit', ?, ?, ?, 'read_only', 'pending_approval', NULL, NULL, ?, ?, ?)`)
        .bind(
          connectionId,
          institution.id,
          command.accountLabel,
          command.accountFingerprint,
          command.secretReference,
          member.member_key,
          now,
          now,
        )
        .run();
      await appendAuditEvent(env.DB, {
        institutionId: institution.id,
        requestId: context.requestId,
        eventType: "exchange_connection_requested",
        actorKey: member.member_key,
        objectType: "exchange_connection",
        objectId: connectionId,
        payload: {
          provider: "upbit",
          permissionMode: "read_only",
          accountFingerprint: command.accountFingerprint,
          secretReferenceHash: await crypto.subtle.digest("SHA-256", new TextEncoder().encode(command.secretReference))
            .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")),
          status: "pending_approval",
        },
      });
      return NextResponse.json({ status: await loadStatus(request), connectionId, requestId: context.requestId }, { status: 202, headers });
    }

    if (command.action === "decide_read_only_exchange") {
      if (!["risk_officer", "compliance_officer"].includes(member.role)) {
        return NextResponse.json({ error: "독립 리스크·준법 담당자만 거래소 연결을 승인할 수 있습니다.", requestId: context.requestId }, { status: 403, headers });
      }
      const connection = await env.DB.prepare(`SELECT id, created_by, status FROM exchange_connections
        WHERE id = ? AND institution_id = ? LIMIT 1`)
        .bind(command.connectionId, institution.id)
        .first<{ id: string; created_by: string; status: string }>();
      if (!connection) return NextResponse.json({ error: "거래소 연결 요청을 찾을 수 없습니다.", requestId: context.requestId }, { status: 404, headers });
      if (connection.created_by === member.member_key) {
        return NextResponse.json({ error: "자신이 등록한 거래소 연결은 승인할 수 없습니다.", requestId: context.requestId }, { status: 409, headers });
      }
      if (connection.status !== "pending_approval") {
        return NextResponse.json({ error: "대기 상태의 거래소 연결만 결정할 수 있습니다.", requestId: context.requestId }, { status: 409, headers });
      }
      const nextStatus = command.decision === "approve" ? "active" : "rejected";
      const now = new Date().toISOString();
      const update = await env.DB.prepare(`UPDATE exchange_connections SET status = ?, updated_at = ?
        WHERE id = ? AND institution_id = ? AND status = 'pending_approval'`)
        .bind(nextStatus, now, connection.id, institution.id)
        .run();
      if (update.meta.changes !== 1) {
        return NextResponse.json({ error: "거래소 연결 상태가 변경되어 다시 확인해야 합니다.", requestId: context.requestId }, { status: 409, headers });
      }
      await appendAuditEvent(env.DB, {
        institutionId: institution.id,
        requestId: context.requestId,
        eventType: command.decision === "approve" ? "exchange_connection_approved" : "exchange_connection_rejected",
        actorKey: member.member_key,
        objectType: "exchange_connection",
        objectId: connection.id,
        payload: { decision: command.decision, note: command.note, permissionMode: "read_only" },
      });
      return NextResponse.json({ status: await loadStatus(request), connectionId: connection.id, requestId: context.requestId }, { headers });
    }

    if (!["portfolio_manager", "risk_officer", "operations", "administrator"].includes(member.role)) {
      return NextResponse.json({ error: "섀도 작업 등록 권한이 없습니다.", requestId: context.requestId }, { status: 403, headers });
    }
    const deployment = await env.DB.prepare(`SELECT id FROM shadow_deployments
      WHERE id = ? AND institution_id = ? AND status IN ('ready', 'running') LIMIT 1`)
      .bind(command.deploymentId, institution.id)
      .first<{ id: string }>();
    if (!deployment) return NextResponse.json({ error: "실행 가능한 섀도 배포를 찾을 수 없습니다.", requestId: context.requestId }, { status: 404, headers });
    const queued = await enqueueRuntimeJob(env.DB, {
      institutionId: institution.id,
      kind: "shadow_cycle",
      targetId: deployment.id,
      dedupeKey: `manual-shadow:${deployment.id}:${context.idempotencyKey}`,
      payload: { ownerKey: institution.owner_key },
      scheduledFor: new Date(),
    });
    await appendAuditEvent(env.DB, {
      institutionId: institution.id,
      requestId: context.requestId,
      eventType: "runtime_job_enqueued",
      actorKey: member.member_key,
      objectType: "runtime_job",
      objectId: queued.jobId,
      payload: { kind: "shadow_cycle", targetId: deployment.id, inserted: queued.inserted },
    });
    return NextResponse.json({ status: await loadStatus(request), jobId: queued.jobId, duplicate: !queued.inserted, requestId: context.requestId }, { status: 202, headers });
  } catch (error) {
    if (error instanceof TrustedIdentityError) return jsonError("기관 인증이 필요합니다.", 401, context.requestId);
    if (error instanceof SyntaxError) return jsonError("JSON 형식이 올바르지 않습니다.", 400, context.requestId);
    console.error(JSON.stringify({ level: "error", event: "runtime_command_failed", requestId: context.requestId, errorType: error instanceof Error ? error.name : "RuntimeError" }));
    return jsonError(error instanceof Error ? error.message : "런타임 명령을 처리하지 못했습니다.", 400, context.requestId);
  }
}
