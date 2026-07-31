import { runCycle } from "../../app/api/shadow/route";
import { runReadOnlyExchangeReconciliation } from "./exchange-reconciliation";
import {
  claimRuntimeJobs,
  completeRuntimeJob,
  enqueueRuntimeJob,
  failRuntimeJob,
  recoverExpiredRuntimeJobs,
  type RuntimeJob,
} from "./job-queue";

export type RuntimeEnvironment = Record<string, unknown> & { DB: D1Database };

type ShadowTargetRow = {
  institution_id: string;
  owner_key: string;
  deployment_id: string;
  interval_minutes: number;
  last_cycle_at: string | null;
};

type ExchangeTargetRow = {
  institution_id: string;
  owner_key: string;
  connection_id: string;
  last_reconciled_at: string | null;
};

export type RuntimeTickResult = {
  workerId: string;
  jobsEnqueued: number;
  jobsClaimed: number;
  jobsSucceeded: number;
  jobsFailed: number;
  recoveredLeases: number;
  status: "healthy" | "degraded";
  startedAt: string;
  completedAt: string;
};

function bucketKey(date: Date, periodMs: number): string {
  return String(Math.floor(date.getTime() / periodMs));
}

function due(lastRunAt: string | null, periodMs: number, now: Date): boolean {
  if (!lastRunAt) return true;
  const timestamp = Date.parse(lastRunAt);
  return !Number.isFinite(timestamp) || now.getTime() - timestamp >= periodMs;
}

async function enqueueDueJobs(db: D1Database, now: Date): Promise<number> {
  const [shadowTargets, exchangeTargets] = await Promise.all([
    db.prepare(`SELECT d.institution_id, i.owner_key, d.id AS deployment_id, d.interval_minutes, d.last_cycle_at
      FROM shadow_deployments d
      INNER JOIN institutions i ON i.id = d.institution_id
      WHERE d.status IN ('ready', 'running')`)
      .all<ShadowTargetRow>(),
    db.prepare(`SELECT c.institution_id, i.owner_key, c.id AS connection_id, c.last_reconciled_at
      FROM exchange_connections c
      INNER JOIN institutions i ON i.id = c.institution_id
      WHERE c.status = 'active' AND c.permission_mode = 'read_only'`)
      .all<ExchangeTargetRow>(),
  ]);
  let inserted = 0;
  for (const target of shadowTargets.results) {
    const periodMs = Math.max(60_000, target.interval_minutes * 60_000);
    if (!due(target.last_cycle_at, periodMs, now)) continue;
    const result = await enqueueRuntimeJob(db, {
      institutionId: target.institution_id,
      kind: "shadow_cycle",
      targetId: target.deployment_id,
      dedupeKey: `shadow:${target.deployment_id}:${bucketKey(now, periodMs)}`,
      payload: { ownerKey: target.owner_key },
      scheduledFor: now,
      maxAttempts: 5,
    });
    if (result.inserted) inserted += 1;
  }
  for (const target of exchangeTargets.results) {
    const periodMs = 5 * 60_000;
    if (!due(target.last_reconciled_at, periodMs, now)) continue;
    const result = await enqueueRuntimeJob(db, {
      institutionId: target.institution_id,
      kind: "exchange_reconciliation",
      targetId: target.connection_id,
      dedupeKey: `reconciliation:${target.connection_id}:${bucketKey(now, periodMs)}`,
      payload: { ownerKey: target.owner_key },
      scheduledFor: now,
      maxAttempts: 5,
    });
    if (result.inserted) inserted += 1;
  }
  return inserted;
}

function ownerFromJob(job: RuntimeJob): string {
  const value = job.payload.ownerKey;
  if (typeof value !== "string" || !/^[^\s@]{1,80}@[^\s@]{1,120}$/.test(value)) {
    throw new Error("작업에 신뢰할 수 있는 기관 소유자 식별자가 없습니다.");
  }
  return value.toLowerCase();
}

async function executeJob(environment: RuntimeEnvironment, job: RuntimeJob): Promise<void> {
  const ownerKey = ownerFromJob(job);
  if (job.kind === "shadow_cycle") {
    await runCycle(ownerKey, `runtime-shadow-${job.id}`);
    return;
  }
  if (job.kind === "exchange_reconciliation") {
    await runReadOnlyExchangeReconciliation({
      db: environment.DB,
      environment,
      institutionId: job.institutionId,
      connectionId: job.targetId,
      actorKey: "runtime-service@blocktrade.internal",
      requestId: `runtime-recon-${job.id}`,
    });
    return;
  }
  throw new Error("지원하지 않는 런타임 작업 종류입니다.");
}

async function writeHeartbeat(db: D1Database, result: RuntimeTickResult) {
  await db.prepare(`INSERT INTO runtime_scheduler_heartbeats
    (scheduler_key, worker_id, status, jobs_enqueued, jobs_claimed, jobs_succeeded, jobs_failed,
     recovered_leases, started_at, completed_at, updated_at)
    VALUES ('institutional-runtime', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scheduler_key) DO UPDATE SET
      worker_id = excluded.worker_id,
      status = excluded.status,
      jobs_enqueued = excluded.jobs_enqueued,
      jobs_claimed = excluded.jobs_claimed,
      jobs_succeeded = excluded.jobs_succeeded,
      jobs_failed = excluded.jobs_failed,
      recovered_leases = excluded.recovered_leases,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at`)
    .bind(
      result.workerId,
      result.status,
      result.jobsEnqueued,
      result.jobsClaimed,
      result.jobsSucceeded,
      result.jobsFailed,
      result.recoveredLeases,
      result.startedAt,
      result.completedAt,
      result.completedAt,
    )
    .run();
}

export async function runRuntimeTick(
  environment: RuntimeEnvironment,
  options: { now?: Date; workerId?: string; claimLimit?: number } = {},
): Promise<RuntimeTickResult> {
  if (!environment.DB) throw new Error("런타임 작업 큐에 D1 연결이 필요합니다.");
  const now = options.now ?? new Date();
  const workerId = options.workerId ?? `runtime-${crypto.randomUUID()}`;
  const startedAt = now.toISOString();
  const recoveredLeases = await recoverExpiredRuntimeJobs(environment.DB, now);
  const jobsEnqueued = await enqueueDueJobs(environment.DB, now);
  const jobs = await claimRuntimeJobs(environment.DB, {
    workerId,
    limit: options.claimLimit ?? 4,
    leaseMs: 150_000,
    now,
  });
  let jobsSucceeded = 0;
  let jobsFailed = 0;
  for (const job of jobs) {
    const attemptStartedAt = new Date().toISOString();
    try {
      await executeJob(environment, job);
      await completeRuntimeJob(environment.DB, job, workerId, attemptStartedAt);
      jobsSucceeded += 1;
    } catch (error) {
      jobsFailed += 1;
      await failRuntimeJob(environment.DB, job, workerId, attemptStartedAt, error);
      console.error(JSON.stringify({
        level: "error",
        event: "runtime_job_failed",
        jobId: job.id,
        kind: job.kind,
        institutionId: job.institutionId,
        attempt: job.attemptCount,
      }));
    }
  }
  const completedAt = new Date().toISOString();
  const result: RuntimeTickResult = {
    workerId,
    jobsEnqueued,
    jobsClaimed: jobs.length,
    jobsSucceeded,
    jobsFailed,
    recoveredLeases,
    status: jobsFailed > 0 ? "degraded" : "healthy",
    startedAt,
    completedAt,
  };
  await writeHeartbeat(environment.DB, result);
  return result;
}
