const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{11,119}$/;

export type RequestContext = {
  requestId: string;
  idempotencyKey: string | null;
};

export function getRequestContext(request: Request, options: { requireIdempotency?: boolean } = {}): RequestContext {
  const suppliedRequestId = request.headers.get("x-request-id")?.trim();
  const requestId = suppliedRequestId && REQUEST_ID_PATTERN.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  const suppliedIdempotencyKey = request.headers.get("idempotency-key")?.trim() ?? null;

  if (suppliedIdempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(suppliedIdempotencyKey)) {
    throw new Error("Invalid idempotency key");
  }
  if (options.requireIdempotency && !suppliedIdempotencyKey) {
    throw new Error("Idempotency key is required");
  }
  return { requestId, idempotencyKey: suppliedIdempotencyKey };
}

export async function fingerprintRequest(method: string, path: string, body: unknown): Promise<string> {
  const input = new TextEncoder().encode(`${method.toUpperCase()}\n${path}\n${stableSerialize(body)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

type RateLimitBucket = { count: number; resetAt: number };

/** Per-edge-isolate guard. Use a Durable Object or KV-backed limiter before high-volume launch. */
export class EdgeRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  take(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (this.buckets.size > 2_000) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }

    return {
      allowed: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt / 1_000)),
  };
}
