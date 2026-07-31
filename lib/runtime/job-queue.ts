export type RuntimeJobKind = "shadow_cycle" | "exchange_reconciliation";
export type RuntimeJobStatus =
  | "pending"
  | "leased"
  | "retry_wait"
  | "succeeded"
  | "quarantined"
  | "cancelled";

export type RuntimeJob = {
  id: string;
  institutionId: string;
  kind: RuntimeJobKind;
  targetId: string;
  dedupeKey: string;
  status: RuntimeJobStatus;
  scheduledFor: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type RuntimeJobRow = {
  id: string;
  institution_id: string;
  kind: string;
  target_id: string;
  dedupe_key: string;
  status: string;
  scheduled_for: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  max_attempts: number;
  payload_json: string;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;
const DEDUPE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,239}$/;
const MAX_PAYLOAD_BYTES = 8_000;
const MAX_ERROR_LENGTH = 320;

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapJob(row: RuntimeJobRow): RuntimeJob {
  return {
    id: row.id,
    institutionId: row.institution_id,
    kind: row.kind as RuntimeJobKind,
    targetId: row.target_id,
    dedupeKey: row.dedupe_key,
    status: row.status as RuntimeJobStatus,
    scheduledFor: row.scheduled_for,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    payload: parsePayload(row.payload_json),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function validateIdentifier(value: string, label: string) {
  if (!JOB_ID_PATTERN.test(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
}

export function retryDelayMs(attemptNumber: number): number {
  const normalized = Math.max(1, Math.min(10, Math.floor(attemptNumber)));
  return Math.min(15 * 60_000, 15_000 * (2 ** (normalized - 1)));
}

export function safeRuntimeError(error: unknown): { code: string; message: string } {
  const rawName = error instanceof Error ? error.name : "RuntimeError";
  const rawMessage = error instanceof Error ? error.message : "작업 처리 중 알 수 없는 오류가 발생했습니다.";
  const code = rawName.replace(/[^A-Za-z0-9_:-]/g, "_").slice(0, 80) || "RuntimeError";
  const message = rawMessage
    .replace(/(bearer|token|secret|access[_ -]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[REDACTED]")
    .slice(0, MAX_ERROR_LENGTH);
  return { code, message };
}

export async function enqueueRuntimeJob(
  db: D1Database,
  input: {
    institutionId: string;
    kind: RuntimeJobKind;
    targetId: string;
    dedupeKey: string;
    payload?: Record<string, unknown>;
    scheduledFor?: Date;
    maxAttempts?: number;
  },
): Promise<{ jobId: string; inserted: boolean }> {
  validateIdentifier(input.institutionId, "기관 식별자");
  validateIdentifier(input.targetId, "대상 식별자");
  if (!DEDUPE_KEY_PATTERN.test(input.dedupeKey)) throw new Error("작업 중복방지키 형식이 올바르지 않습니다.");
  const maxAttempts = Math.max(1, Math.min(10, Math.floor(input.maxAttempts ?? 5)));
  const payloadJson = JSON.stringify(input.payload ?? {});
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error("작업 입력이 허용 크기를 초과했습니다.");
  }
  const now = new Date();
  const jobId = `job-${crypto.randomUUID()}`;
  const result = await db.prepare(`INSERT OR IGNORE INTO runtime_jobs
    (id, institution_id, kind, target_id, dedupe_key, status, scheduled_for, lease_owner, lease_expires_at,
     attempt_count, max_attempts, payload_json, last_error_code, last_error_message, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, 0, ?, ?, NULL, NULL, ?, ?, NULL)`)
    .bind(
      jobId,
      input.institutionId,
      input.kind,
      input.targetId,
      input.dedupeKey,
      (input.scheduledFor ?? now).toISOString(),
      maxAttempts,
      payloadJson,
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  if (result.meta.changes === 1) return { jobId, inserted: true };
  const existing = await db.prepare("SELECT id FROM runtime_jobs WHERE institution_id = ? AND dedupe_key = ? LIMIT 1")
    .bind(input.institutionId, input.dedupeKey)
    .first<{ id: string }>();
  if (!existing) throw new Error("중복 작업을 확인하지 못했습니다.");
  return { jobId: existing.id, inserted: false };
}

export async function recoverExpiredRuntimeJobs(db: D1Database, now = new Date()): Promise<number> {
  const nowIso = now.toISOString();
  const result = await db.prepare(`UPDATE runtime_jobs
    SET status = CASE WHEN attempt_count >= max_attempts THEN 'quarantined' ELSE 'retry_wait' END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        scheduled_for = CASE WHEN attempt_count >= max_attempts THEN scheduled_for ELSE ? END,
        last_error_code = 'LEASE_EXPIRED',
        last_error_message = '작업 처리 임대가 만료되어 복구 절차로 이동했습니다.',
        updated_at = ?,
        completed_at = CASE WHEN attempt_count >= max_attempts THEN ? ELSE NULL END
    WHERE status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`)
    .bind(nowIso, nowIso, nowIso, nowIso)
    .run();
  return Number(result.meta.changes ?? 0);
}

export async function claimRuntimeJobs(
  db: D1Database,
  input: { workerId: string; limit?: number; leaseMs?: number; now?: Date },
): Promise<RuntimeJob[]> {
  validateIdentifier(input.workerId, "작업자 식별자");
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(20, Math.floor(input.limit ?? 4)));
  const leaseMs = Math.max(30_000, Math.min(10 * 60_000, Math.floor(input.leaseMs ?? 120_000)));
  const candidates = await db.prepare(`SELECT id FROM runtime_jobs
    WHERE status IN ('pending', 'retry_wait') AND scheduled_for <= ?
    ORDER BY scheduled_for ASC, created_at ASC LIMIT ?`)
    .bind(now.toISOString(), limit * 3)
    .all<{ id: string }>();
  const claimed: RuntimeJob[] = [];
  const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();

  for (const candidate of candidates.results) {
    if (claimed.length >= limit) break;
    const update = await db.prepare(`UPDATE runtime_jobs
      SET status = 'leased', lease_owner = ?, lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'retry_wait') AND scheduled_for <= ?`)
      .bind(input.workerId, leaseExpiresAt, now.toISOString(), candidate.id, now.toISOString())
      .run();
    if (update.meta.changes !== 1) continue;
    const row = await db.prepare(`SELECT id, institution_id, kind, target_id, dedupe_key, status, scheduled_for,
      lease_owner, lease_expires_at, attempt_count, max_attempts, payload_json, last_error_code,
      last_error_message, created_at, updated_at, completed_at FROM runtime_jobs WHERE id = ? LIMIT 1`)
      .bind(candidate.id)
      .first<RuntimeJobRow>();
    if (row) claimed.push(mapJob(row));
  }
  return claimed;
}

export async function completeRuntimeJob(
  db: D1Database,
  job: RuntimeJob,
  workerId: string,
  startedAt: string,
  completedAt = new Date(),
): Promise<void> {
  const completedIso = completedAt.toISOString();
  const update = await db.prepare(`UPDATE runtime_jobs
    SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL,
        last_error_message = NULL, updated_at = ?, completed_at = ?
    WHERE id = ? AND status = 'leased' AND lease_owner = ?`)
    .bind(completedIso, completedIso, job.id, workerId)
    .run();
  if (update.meta.changes !== 1) throw new Error("작업 완료 시 임대 소유권을 확인하지 못했습니다.");
  await db.prepare(`INSERT INTO runtime_job_attempts
    (id, job_id, institution_id, attempt_number, worker_id, status, error_code, error_message, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, 'succeeded', NULL, NULL, ?, ?)`)
    .bind(`attempt-${crypto.randomUUID()}`, job.id, job.institutionId, job.attemptCount, workerId, startedAt, completedIso)
    .run();
}

export async function failRuntimeJob(
  db: D1Database,
  job: RuntimeJob,
  workerId: string,
  startedAt: string,
  error: unknown,
  failedAt = new Date(),
): Promise<"retry_wait" | "quarantined"> {
  const safeError = safeRuntimeError(error);
  const terminal = job.attemptCount >= job.maxAttempts;
  const nextStatus = terminal ? "quarantined" : "retry_wait";
  const failedIso = failedAt.toISOString();
  const retryAt = new Date(failedAt.getTime() + retryDelayMs(job.attemptCount)).toISOString();
  const update = await db.prepare(`UPDATE runtime_jobs
    SET status = ?, lease_owner = NULL, lease_expires_at = NULL, scheduled_for = ?,
        last_error_code = ?, last_error_message = ?, updated_at = ?, completed_at = ?
    WHERE id = ? AND status = 'leased' AND lease_owner = ?`)
    .bind(
      nextStatus,
      terminal ? job.scheduledFor : retryAt,
      safeError.code,
      safeError.message,
      failedIso,
      terminal ? failedIso : null,
      job.id,
      workerId,
    )
    .run();
  if (update.meta.changes !== 1) throw new Error("작업 실패 처리 시 임대 소유권을 확인하지 못했습니다.");
  await db.prepare(`INSERT INTO runtime_job_attempts
    (id, job_id, institution_id, attempt_number, worker_id, status, error_code, error_message, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      `attempt-${crypto.randomUUID()}`,
      job.id,
      job.institutionId,
      job.attemptCount,
      workerId,
      nextStatus,
      safeError.code,
      safeError.message,
      startedAt,
      failedIso,
    )
    .run();
  return nextStatus;
}
