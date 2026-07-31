export type AuditAppendInput = {
  institutionId: string;
  requestId: string;
  eventType: string;
  actorKey: string;
  objectType: string;
  objectId: string;
  payload: unknown;
  createdAt?: string;
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,239}$/;

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validate(value: string, label: string) {
  if (!SAFE_ID.test(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
}

export async function appendAuditEvent(
  db: D1Database,
  input: AuditAppendInput,
): Promise<{ id: string; sequence: number; eventHash: string; duplicate: boolean }> {
  validate(input.institutionId, "기관 식별자");
  validate(input.requestId, "요청 식별자");
  validate(input.eventType, "감사 사건");
  validate(input.actorKey, "행위자");
  validate(input.objectType, "대상 종류");
  validate(input.objectId, "대상 식별자");
  const payloadJson = stableSerialize(input.payload);
  if (new TextEncoder().encode(payloadJson).byteLength > 16_000) {
    throw new Error("감사 원장 입력이 허용 크기를 초과했습니다.");
  }
  const duplicate = await db.prepare(`SELECT id, sequence, event_hash FROM institutional_audit_ledger
    WHERE institution_id = ? AND request_id = ? LIMIT 1`)
    .bind(input.institutionId, input.requestId)
    .first<{ id: string; sequence: number; event_hash: string }>();
  if (duplicate) return { id: duplicate.id, sequence: duplicate.sequence, eventHash: duplicate.event_hash, duplicate: true };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prior = await db.prepare(`SELECT sequence, event_hash FROM institutional_audit_ledger
      WHERE institution_id = ? ORDER BY sequence DESC LIMIT 1`)
      .bind(input.institutionId)
      .first<{ sequence: number; event_hash: string }>();
    const sequence = (prior?.sequence ?? 0) + 1;
    const previousHash = prior?.event_hash ?? "GENESIS";
    const createdAt = input.createdAt ?? new Date().toISOString();
    const eventHash = await sha256(
      `${previousHash}|${input.eventType}|${input.actorKey}|${input.objectType}|${input.objectId}|${payloadJson}|${createdAt}`,
    );
    const id = `audit-${crypto.randomUUID()}`;
    try {
      await db.prepare(`INSERT INTO institutional_audit_ledger
        (id, institution_id, sequence, previous_hash, event_hash, event_type, actor_key, object_type,
         object_id, request_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          input.institutionId,
          sequence,
          previousHash,
          eventHash,
          input.eventType,
          input.actorKey,
          input.objectType,
          input.objectId,
          input.requestId,
          payloadJson,
          createdAt,
        )
        .run();
      return { id, sequence, eventHash, duplicate: false };
    } catch (error) {
      const existing = await db.prepare(`SELECT id, sequence, event_hash FROM institutional_audit_ledger
        WHERE institution_id = ? AND request_id = ? LIMIT 1`)
        .bind(input.institutionId, input.requestId)
        .first<{ id: string; sequence: number; event_hash: string }>();
      if (existing) return { id: existing.id, sequence: existing.sequence, eventHash: existing.event_hash, duplicate: true };
      if (attempt === 2) throw error;
    }
  }
  throw new Error("감사 원장을 기록하지 못했습니다.");
}

export async function verifyAuditChain(
  db: D1Database,
  institutionId: string,
): Promise<{ valid: boolean; checked: number; brokenSequence: number | null }> {
  const rows = await db.prepare(`SELECT sequence, previous_hash, event_hash, event_type, actor_key,
    object_type, object_id, payload_json, created_at FROM institutional_audit_ledger
    WHERE institution_id = ? ORDER BY sequence ASC`)
    .bind(institutionId)
    .all<{
      sequence: number;
      previous_hash: string;
      event_hash: string;
      event_type: string;
      actor_key: string;
      object_type: string;
      object_id: string;
      payload_json: string;
      created_at: string;
    }>();
  let expectedPreviousHash = "GENESIS";
  for (const row of rows.results) {
    const expectedHash = await sha256(
      `${expectedPreviousHash}|${row.event_type}|${row.actor_key}|${row.object_type}|${row.object_id}|${row.payload_json}|${row.created_at}`,
    );
    if (row.previous_hash !== expectedPreviousHash || row.event_hash !== expectedHash) {
      return { valid: false, checked: row.sequence - 1, brokenSequence: row.sequence };
    }
    expectedPreviousHash = row.event_hash;
  }
  return { valid: true, checked: rows.results.length, brokenSequence: null };
}
