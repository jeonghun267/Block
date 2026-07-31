import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import {
  approvalDecisionBlockers,
  buildLiveGates,
  canCreateStrategyVersion,
  validateStrategyVersionDefinition,
  type AuditLedgerEvent,
  type ControlPlaneCommand,
  type ControlPlaneSnapshot,
  type Institution,
  type InstitutionalApproval,
  type InstitutionalRiskPolicy,
  type InstitutionalStrategyVersion,
  type InstitutionMember,
  type ReconciliationException,
} from "../../../lib/control-plane";
import { readExchangeRuntimeConfig } from "../../../lib/security/config";
import { requireTrustedIdentity, TrustedIdentityError } from "../../../lib/security/identity";
import { EdgeRateLimiter } from "../../../lib/security/request";

export const runtime = "edge";

const JSON_HEADERS = { "Cache-Control": "no-store" };
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const VALID_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const limiter = new EdgeRateLimiter();

type InstitutionRow = { id: string; name: string; jurisdiction: string; operating_mode: string; created_at: string };
type MemberRow = { member_key: string; display_name: string; role: string; status: string };
type VersionRow = { id: string; strategy_key: string; version: number; name: string; status: string; definition_json: string; source: string; created_by: string; created_at: string; content_hash: string };
type ApprovalRow = { id: string; strategy_version_id: string; status: string; requested_by: string; required_role: string; decided_by: string | null; decision_note: string | null; created_at: string; decided_at: string | null };
type PolicyRow = { id: string; version: number; status: string; max_gross_exposure_pct: number; max_asset_concentration_pct: number; max_daily_loss_pct: number; max_order_krw: number; max_exchange_concentration_pct: number; created_by: string; approved_by: string | null; created_at: string };
type ExceptionRow = { id: string; kind: string; severity: string; status: string; summary: string; assigned_role: string; order_id: string | null; created_at: string; resolved_at: string | null };
type AuditRow = { id: string; sequence: number; previous_hash: string; event_hash: string; event_type: string; actor_key: string; object_type: string; object_id: string; created_at: string };
type ShadowEvidenceRow = { cycle_count: number; first_completed_at: string | null; last_completed_at: string | null; exception_count: number };

function ownerKey(request: Request) {
  const config = readExchangeRuntimeConfig(env as unknown as Record<string, unknown>);
  return requireTrustedIdentity(request, config).subject;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: JSON_HEADERS });
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function safeJson(value: string) {
  try { return JSON.parse(value) as unknown; } catch { return { invalid: true }; }
}

async function ensureInstitution(owner: string) {
  let institution = await env.DB.prepare("SELECT id, name, jurisdiction, operating_mode, created_at FROM institutions WHERE owner_key = ? LIMIT 1").bind(owner).first<InstitutionRow>();
  if (institution) return institution;
  const institutionId = `inst-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO institutions (id, owner_key, name, jurisdiction, operating_mode, created_at)
    VALUES (?, ?, ?, 'KR', 'paper', ?)`).bind(institutionId, owner, "BlockTrade 모의 기관", now).run();
  institution = await env.DB.prepare("SELECT id, name, jurisdiction, operating_mode, created_at FROM institutions WHERE owner_key = ? LIMIT 1").bind(owner).first<InstitutionRow>();
  if (!institution) throw new Error("기관 작업공간을 초기화하지 못했습니다.");

  const existingMember = await env.DB.prepare("SELECT member_key FROM institution_memberships WHERE institution_id = ? LIMIT 1").bind(institution.id).first();
  if (existingMember) return institution;
  const versionA = `sv-${crypto.randomUUID()}`;
  const versionB = `sv-${crypto.randomUUID()}`;
  const approvalId = `ap-${crypto.randomUUID()}`;
  const policyId = `rp-${crypto.randomUUID()}`;
  const exceptionId = `rc-${crypto.randomUUID()}`;
  const definitionA = JSON.stringify({ schemaVersion: 1, blocks: [{ kind: "condition", label: "BTC 4시간 수익률 상향 돌파" }, { kind: "action", label: "사용 가능 원화의 10% 매수" }] });
  const definitionB = JSON.stringify({ schemaVersion: 1, blocks: [{ kind: "condition", label: "ETH 평균회귀 조건" }, { kind: "action", label: "보유 자산의 20% 매도" }] });
  const hashA = await sha256(definitionA);
  const hashB = await sha256(definitionB);
  const auditPayload = JSON.stringify({ operatingMode: "paper", reason: "institution_workspace_initialized" });
  const auditHash = await sha256(`GENESIS|institution_initialized|${owner}|${institution.id}|${auditPayload}|${now}`);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO institution_memberships (institution_id, member_key, display_name, role, status, created_at) VALUES (?, ?, ?, 'portfolio_manager', 'active', ?)`)
      .bind(institution.id, owner, owner.split("@")[0] || "기관 사용자", now),
    env.DB.prepare(`INSERT OR IGNORE INTO institution_memberships (institution_id, member_key, display_name, role, status, created_at) VALUES (?, 'risk.officer@blocktrade.demo', '독립 리스크 검토자', 'risk_officer', 'active', ?)`)
      .bind(institution.id, now),
    env.DB.prepare(`INSERT OR IGNORE INTO institution_memberships (institution_id, member_key, display_name, role, status, created_at) VALUES (?, 'operations@blocktrade.demo', '운영 대사 담당자', 'operations', 'active', ?)`)
      .bind(institution.id, now),
    env.DB.prepare(`INSERT OR IGNORE INTO institutional_strategy_versions
      (id, institution_id, strategy_key, version, name, status, definition_json, source, created_by, created_at, content_hash)
      VALUES (?, ?, 'system-carry', 12, '시스템 캐리', 'pending_approval', ?, 'manual', ?, ?, ?)`)
      .bind(versionA, institution.id, definitionA, owner, now, hashA),
    env.DB.prepare(`INSERT OR IGNORE INTO institutional_strategy_versions
      (id, institution_id, strategy_key, version, name, status, definition_json, source, created_by, created_at, content_hash)
      VALUES (?, ?, 'eth-mean-reversion', 7, 'ETH 평균회귀', 'paper', ?, 'manual', 'research@blocktrade.demo', ?, ?)`)
      .bind(versionB, institution.id, definitionB, now, hashB),
    env.DB.prepare(`INSERT OR IGNORE INTO institutional_approval_requests
      (id, institution_id, strategy_version_id, status, requested_by, required_role, decided_by, decision_note, created_at, decided_at)
      VALUES (?, ?, ?, 'pending', ?, 'risk_officer', NULL, NULL, ?, NULL)`)
      .bind(approvalId, institution.id, versionA, owner, now),
    env.DB.prepare(`INSERT OR IGNORE INTO institutional_risk_policies
      (id, institution_id, version, status, max_gross_exposure_pct, max_asset_concentration_pct, max_daily_loss_pct, max_order_krw, max_exchange_concentration_pct, created_by, approved_by, created_at)
      VALUES (?, ?, 6, 'approved', 80, 40, 3, 100000000, 65, 'risk.author@blocktrade.demo', 'risk.officer@blocktrade.demo', ?)`)
      .bind(policyId, institution.id, now),
    env.DB.prepare(`INSERT OR IGNORE INTO reconciliation_exceptions
      (id, institution_id, kind, severity, status, summary, assigned_role, order_id, created_at, resolved_at)
      VALUES (?, ?, 'fill', 'medium', 'investigating', 'ETH 체결 시각과 내부 원장이 1.8초 차이납니다.', 'operations', 'BT-260713-006', ?, NULL)`)
      .bind(exceptionId, institution.id, now),
    env.DB.prepare(`INSERT OR IGNORE INTO institutional_audit_ledger
      (id, institution_id, sequence, previous_hash, event_hash, event_type, actor_key, object_type, object_id, request_id, payload_json, created_at)
      VALUES (?, ?, 1, 'GENESIS', ?, 'institution_initialized', ?, 'institution', ?, ?, ?, ?)`)
      .bind(`audit-${crypto.randomUUID()}`, institution.id, auditHash, owner, institution.id, `seed-${institution.id}`, auditPayload, now),
  ]);
  return institution;
}

async function currentMembership(institutionId: string, owner: string) {
  return env.DB.prepare("SELECT member_key, display_name, role, status FROM institution_memberships WHERE institution_id = ? AND member_key = ? LIMIT 1")
    .bind(institutionId, owner).first<MemberRow>();
}

async function loadSnapshot(owner: string): Promise<ControlPlaneSnapshot> {
  const institutionRow = await ensureInstitution(owner);
  const [member, members, versions, approvals, policy, exceptions, audits, shadowEvidence] = await Promise.all([
    currentMembership(institutionRow.id, owner),
    env.DB.prepare("SELECT member_key, display_name, role, status FROM institution_memberships WHERE institution_id = ? ORDER BY role, member_key").bind(institutionRow.id).all<MemberRow>(),
    env.DB.prepare(`SELECT id, strategy_key, version, name, status, definition_json, source, created_by, created_at, content_hash
      FROM institutional_strategy_versions WHERE institution_id = ? ORDER BY created_at DESC, version DESC LIMIT 50`).bind(institutionRow.id).all<VersionRow>(),
    env.DB.prepare(`SELECT id, strategy_version_id, status, requested_by, required_role, decided_by, decision_note, created_at, decided_at
      FROM institutional_approval_requests WHERE institution_id = ? ORDER BY created_at DESC LIMIT 50`).bind(institutionRow.id).all<ApprovalRow>(),
    env.DB.prepare(`SELECT id, version, status, max_gross_exposure_pct, max_asset_concentration_pct, max_daily_loss_pct,
      max_order_krw, max_exchange_concentration_pct, created_by, approved_by, created_at FROM institutional_risk_policies
      WHERE institution_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1`).bind(institutionRow.id).first<PolicyRow>(),
    env.DB.prepare(`SELECT id, kind, severity, status, summary, assigned_role, order_id, created_at, resolved_at
      FROM reconciliation_exceptions WHERE institution_id = ? ORDER BY created_at DESC LIMIT 50`).bind(institutionRow.id).all<ExceptionRow>(),
    env.DB.prepare(`SELECT id, sequence, previous_hash, event_hash, event_type, actor_key, object_type, object_id, created_at
      FROM institutional_audit_ledger WHERE institution_id = ? ORDER BY sequence DESC LIMIT 50`).bind(institutionRow.id).all<AuditRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS cycle_count, MIN(completed_at) AS first_completed_at, MAX(completed_at) AS last_completed_at,
      SUM(CASE WHEN status = 'reconciliation_exception' THEN 1 ELSE 0 END) AS exception_count
      FROM shadow_cycles WHERE institution_id = ?`).bind(institutionRow.id).first<ShadowEvidenceRow>(),
  ]);
  if (!member) throw new Error("기관 구성원 권한이 없습니다.");

  const institution: Institution = { id: institutionRow.id, name: institutionRow.name, jurisdiction: institutionRow.jurisdiction, operatingMode: institutionRow.operating_mode as Institution["operatingMode"], createdAt: institutionRow.created_at };
  const mappedMembers: InstitutionMember[] = members.results.map((row) => ({ memberKey: row.member_key, displayName: row.display_name, role: row.role as InstitutionMember["role"], status: row.status as InstitutionMember["status"] }));
  const mappedVersions: InstitutionalStrategyVersion[] = versions.results.map((row) => ({ id: row.id, strategyKey: row.strategy_key, version: row.version, name: row.name, status: row.status as InstitutionalStrategyVersion["status"], definition: safeJson(row.definition_json), source: row.source as InstitutionalStrategyVersion["source"], createdBy: row.created_by, createdAt: row.created_at, contentHash: row.content_hash }));
  const mappedApprovals: InstitutionalApproval[] = approvals.results.map((row) => ({ id: row.id, strategyVersionId: row.strategy_version_id, status: row.status as InstitutionalApproval["status"], requestedBy: row.requested_by, requiredRole: row.required_role as InstitutionalApproval["requiredRole"], decidedBy: row.decided_by, decisionNote: row.decision_note, createdAt: row.created_at, decidedAt: row.decided_at }));
  const mappedPolicy: InstitutionalRiskPolicy | null = policy ? { id: policy.id, version: policy.version, status: policy.status as InstitutionalRiskPolicy["status"], maxGrossExposurePct: policy.max_gross_exposure_pct, maxAssetConcentrationPct: policy.max_asset_concentration_pct, maxDailyLossPct: policy.max_daily_loss_pct, maxOrderKrw: policy.max_order_krw, maxExchangeConcentrationPct: policy.max_exchange_concentration_pct, createdBy: policy.created_by, approvedBy: policy.approved_by, createdAt: policy.created_at } : null;
  const mappedExceptions: ReconciliationException[] = exceptions.results.map((row) => ({ id: row.id, kind: row.kind as ReconciliationException["kind"], severity: row.severity as ReconciliationException["severity"], status: row.status as ReconciliationException["status"], summary: row.summary, assignedRole: row.assigned_role as ReconciliationException["assignedRole"], orderId: row.order_id, createdAt: row.created_at, resolvedAt: row.resolved_at }));
  const mappedAudits: AuditLedgerEvent[] = audits.results.map((row) => ({ id: row.id, sequence: row.sequence, previousHash: row.previous_hash, eventHash: row.event_hash, eventType: row.event_type, actorKey: row.actor_key, objectType: row.object_type, objectId: row.object_id, createdAt: row.created_at }));
  return {
    institution,
    currentMember: { memberKey: member.member_key, displayName: member.display_name, role: member.role as InstitutionMember["role"], status: member.status as InstitutionMember["status"] },
    members: mappedMembers,
    strategyVersions: mappedVersions,
    approvals: mappedApprovals,
    riskPolicy: mappedPolicy,
    reconciliationExceptions: mappedExceptions,
    auditEvents: mappedAudits,
    liveGates: buildLiveGates({
      members: mappedMembers,
      versions: mappedVersions,
      policy: mappedPolicy,
      exceptions: mappedExceptions,
      shadowEvidence: {
        cycleCount: Number(shadowEvidence?.cycle_count ?? 0),
        firstCompletedAt: shadowEvidence?.first_completed_at ?? null,
        lastCompletedAt: shadowEvidence?.last_completed_at ?? null,
        exceptionCount: Number(shadowEvidence?.exception_count ?? 0),
      },
    }),
    serverTime: new Date().toISOString(),
  };
}

async function auditStatement(input: { institutionId: string; requestId: string; eventType: string; actorKey: string; objectType: string; objectId: string; payload: unknown }) {
  const prior = await env.DB.prepare("SELECT sequence, event_hash FROM institutional_audit_ledger WHERE institution_id = ? ORDER BY sequence DESC LIMIT 1").bind(input.institutionId).first<{ sequence: number; event_hash: string }>();
  const sequence = (prior?.sequence ?? 0) + 1;
  const previousHash = prior?.event_hash ?? "GENESIS";
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload);
  const eventHash = await sha256(`${previousHash}|${input.eventType}|${input.actorKey}|${input.objectType}|${input.objectId}|${payloadJson}|${createdAt}`);
  return env.DB.prepare(`INSERT INTO institutional_audit_ledger
    (id, institution_id, sequence, previous_hash, event_hash, event_type, actor_key, object_type, object_id, request_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`audit-${crypto.randomUUID()}`, input.institutionId, sequence, previousHash, eventHash, input.eventType, input.actorKey, input.objectType, input.objectId, input.requestId, payloadJson, createdAt);
}

async function createVersion(institutionId: string, actor: InstitutionMember, command: Extract<ControlPlaneCommand, { action: "create_strategy_version" }>) {
  if (!canCreateStrategyVersion(actor.role)) throw new Error("현재 역할은 전략 버전을 만들 수 없습니다.");
  const name = command.name.trim();
  if (name.length < 3 || name.length > 80) throw new Error("전략 이름은 3~80자여야 합니다.");
  const definitionJson = validateStrategyVersionDefinition(command.definition);
  const strategyKey = command.strategyKey && VALID_ID.test(command.strategyKey) ? command.strategyKey : `strategy-${crypto.randomUUID()}`;
  const prior = await env.DB.prepare("SELECT MAX(version) AS version FROM institutional_strategy_versions WHERE institution_id = ? AND strategy_key = ?").bind(institutionId, strategyKey).first<{ version: number | null }>();
  const version = (prior?.version ?? 0) + 1;
  const versionId = `sv-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const contentHash = await sha256(definitionJson);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO institutional_strategy_versions
      (id, institution_id, strategy_key, version, name, status, definition_json, source, created_by, created_at, content_hash)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`)
      .bind(versionId, institutionId, strategyKey, version, name, definitionJson, command.source, actor.memberKey, createdAt, contentHash),
    await auditStatement({ institutionId, requestId: command.requestId, eventType: "strategy_version_created", actorKey: actor.memberKey, objectType: "strategy_version", objectId: versionId, payload: { strategyKey, version, name, source: command.source, contentHash } }),
  ]);
  return versionId;
}

async function submitApproval(institutionId: string, actor: InstitutionMember, command: Extract<ControlPlaneCommand, { action: "submit_for_approval" }>) {
  if (!VALID_ID.test(command.strategyVersionId)) throw new Error("전략 버전 식별자가 올바르지 않습니다.");
  if (!canCreateStrategyVersion(actor.role)) throw new Error("현재 역할은 승인 요청을 제출할 수 없습니다.");
  const version = await env.DB.prepare("SELECT status, created_by FROM institutional_strategy_versions WHERE institution_id = ? AND id = ? LIMIT 1").bind(institutionId, command.strategyVersionId).first<{ status: string; created_by: string }>();
  if (!version) throw new Error("전략 버전을 찾을 수 없습니다.");
  if (version.status !== "draft") throw new Error("초안 상태의 전략만 승인 요청할 수 있습니다.");
  if (version.created_by !== actor.memberKey && actor.role !== "administrator") throw new Error("자신이 작성한 전략 버전만 제출할 수 있습니다.");
  const approvalId = `ap-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE institutional_strategy_versions SET status = 'pending_approval' WHERE institution_id = ? AND id = ?").bind(institutionId, command.strategyVersionId),
    env.DB.prepare(`INSERT INTO institutional_approval_requests
      (id, institution_id, strategy_version_id, status, requested_by, required_role, decided_by, decision_note, created_at, decided_at)
      VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, NULL)`)
      .bind(approvalId, institutionId, command.strategyVersionId, actor.memberKey, command.requiredRole, now),
    await auditStatement({ institutionId, requestId: command.requestId, eventType: "strategy_approval_requested", actorKey: actor.memberKey, objectType: "approval", objectId: approvalId, payload: { strategyVersionId: command.strategyVersionId, requiredRole: command.requiredRole } }),
  ]);
}

async function decideApproval(institutionId: string, actor: InstitutionMember, command: Extract<ControlPlaneCommand, { action: "decide_approval" }>) {
  if (!VALID_ID.test(command.approvalId)) throw new Error("승인 요청 식별자가 올바르지 않습니다.");
  const row = await env.DB.prepare(`SELECT a.id, a.strategy_version_id, a.status, a.requested_by, a.required_role, a.decided_by, a.decision_note, a.created_at, a.decided_at,
    v.id AS version_id, v.strategy_key, v.version, v.name, v.status AS version_status, v.definition_json, v.source, v.created_by, v.created_at AS version_created_at, v.content_hash
    FROM institutional_approval_requests a JOIN institutional_strategy_versions v ON v.id = a.strategy_version_id
    WHERE a.institution_id = ? AND a.id = ? LIMIT 1`).bind(institutionId, command.approvalId).first<Record<string, unknown>>();
  if (!row) throw new Error("승인 요청을 찾을 수 없습니다.");
  const approval: InstitutionalApproval = { id: String(row.id), strategyVersionId: String(row.strategy_version_id), status: row.status as InstitutionalApproval["status"], requestedBy: String(row.requested_by), requiredRole: row.required_role as InstitutionalApproval["requiredRole"], decidedBy: row.decided_by ? String(row.decided_by) : null, decisionNote: row.decision_note ? String(row.decision_note) : null, createdAt: String(row.created_at), decidedAt: row.decided_at ? String(row.decided_at) : null };
  const version: InstitutionalStrategyVersion = { id: String(row.version_id), strategyKey: String(row.strategy_key), version: Number(row.version), name: String(row.name), status: row.version_status as InstitutionalStrategyVersion["status"], definition: safeJson(String(row.definition_json)), source: row.source as InstitutionalStrategyVersion["source"], createdBy: String(row.created_by), createdAt: String(row.version_created_at), contentHash: String(row.content_hash) };
  const blockers = approvalDecisionBlockers({ actor, approval, version });
  if (blockers.length) throw new Error(blockers[0]);
  const note = command.note.trim();
  if (note.length < 5 || note.length > 500) throw new Error("승인 판단 근거를 5~500자로 입력해주세요.");
  const approvalStatus = command.decision === "approve" ? "approved" : "rejected";
  const versionStatus = command.decision === "approve" ? "approved" : "rejected";
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE institutional_approval_requests SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE institution_id = ? AND id = ?")
      .bind(approvalStatus, actor.memberKey, note, now, institutionId, approval.id),
    env.DB.prepare("UPDATE institutional_strategy_versions SET status = ? WHERE institution_id = ? AND id = ?")
      .bind(versionStatus, institutionId, version.id),
    await auditStatement({ institutionId, requestId: command.requestId, eventType: command.decision === "approve" ? "strategy_approved" : "strategy_rejected", actorKey: actor.memberKey, objectType: "strategy_version", objectId: version.id, payload: { approvalId: approval.id, note } }),
  ]);
}

async function resolveException(institutionId: string, actor: InstitutionMember, command: Extract<ControlPlaneCommand, { action: "resolve_reconciliation" }>) {
  if (!VALID_ID.test(command.exceptionId)) throw new Error("대사 예외 식별자가 올바르지 않습니다.");
  if (!["operations", "risk_officer", "administrator"].includes(actor.role)) throw new Error("운영·리스크 담당자만 대사 예외를 해결할 수 있습니다.");
  const note = command.note.trim();
  if (note.length < 10 || note.length > 500) throw new Error("해결 증적을 10~500자로 입력해주세요.");
  const exception = await env.DB.prepare("SELECT status FROM reconciliation_exceptions WHERE institution_id = ? AND id = ? LIMIT 1").bind(institutionId, command.exceptionId).first<{ status: string }>();
  if (!exception) throw new Error("대사 예외를 찾을 수 없습니다.");
  if (exception.status === "resolved") throw new Error("이미 해결된 대사 예외입니다.");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE reconciliation_exceptions SET status = 'resolved', resolved_at = ? WHERE institution_id = ? AND id = ?").bind(now, institutionId, command.exceptionId),
    await auditStatement({ institutionId, requestId: command.requestId, eventType: "reconciliation_resolved", actorKey: actor.memberKey, objectType: "reconciliation_exception", objectId: command.exceptionId, payload: { note } }),
  ]);
}

export async function GET(request: Request) {
  try {
    return NextResponse.json({ snapshot: await loadSnapshot(ownerKey(request)) }, { headers: JSON_HEADERS });
  } catch (error: unknown) {
    if (error instanceof TrustedIdentityError) return jsonError("인증이 필요합니다.", 401);
    console.error("[control-plane:get]", error instanceof Error ? error.message : "unknown error");
    return jsonError("기관 통제 데이터를 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request) {
  let owner = "";
  try {
    owner = ownerKey(request);
    const rate = limiter.take(owner, 30, 60_000);
    if (!rate.allowed) return jsonError("기관 통제 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429);
    const raw = await request.text();
    if (raw.length > 110_000) return jsonError("요청이 너무 큽니다.", 413);
    let command: ControlPlaneCommand;
    try { command = JSON.parse(raw) as ControlPlaneCommand; } catch { return jsonError("요청 형식이 올바르지 않습니다.", 400); }
    if (!command || !VALID_REQUEST_ID.test(command.requestId || "")) return jsonError("요청 식별자가 올바르지 않습니다.", 400);
    if (!["create_strategy_version", "submit_for_approval", "decide_approval", "resolve_reconciliation"].includes(command.action)) return jsonError("지원하지 않는 기관 통제 명령입니다.", 400);
    const institution = await ensureInstitution(owner);
    const memberRow = await currentMembership(institution.id, owner);
    if (!memberRow) return jsonError("기관 구성원 권한이 없습니다.", 403);
    const actor: InstitutionMember = { memberKey: memberRow.member_key, displayName: memberRow.display_name, role: memberRow.role as InstitutionMember["role"], status: memberRow.status as InstitutionMember["status"] };
    const duplicate = await env.DB.prepare("SELECT id FROM institutional_audit_ledger WHERE institution_id = ? AND request_id = ? LIMIT 1").bind(institution.id, command.requestId).first();
    if (duplicate) return NextResponse.json({ snapshot: await loadSnapshot(owner), duplicate: true }, { headers: JSON_HEADERS });

    let createdVersionId: string | undefined;
    if (command.action === "create_strategy_version") createdVersionId = await createVersion(institution.id, actor, command);
    else if (command.action === "submit_for_approval") await submitApproval(institution.id, actor, command);
    else if (command.action === "decide_approval") await decideApproval(institution.id, actor, command);
    else await resolveException(institution.id, actor, command);
    return NextResponse.json({ snapshot: await loadSnapshot(owner), ...(createdVersionId ? { createdVersionId } : {}) }, { headers: JSON_HEADERS });
  } catch (error: unknown) {
    if (error instanceof TrustedIdentityError) return jsonError("인증이 필요합니다.", 401);
    const message = error instanceof Error ? error.message : "기관 통제 요청을 처리하지 못했습니다.";
    console.error("[control-plane:post]", owner ? message : "identity error");
    return jsonError(message, message.includes("찾을 수") ? 404 : message.includes("권한") || message.includes("역할") ? 403 : 409);
  }
}
