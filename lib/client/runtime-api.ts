import type { RuntimeCommandInput, RuntimeControlStatus } from "../runtime/status";

type RuntimePayload = {
  status?: RuntimeControlStatus;
  error?: string;
  requestId?: string;
};

async function parse(response: Response): Promise<RuntimePayload & { status: RuntimeControlStatus }> {
  const payload = await response.json() as RuntimePayload;
  if (!response.ok || !payload.status) throw new Error(payload.error || `기관 런타임 API 응답 오류 ${response.status}`);
  return payload as RuntimePayload & { status: RuntimeControlStatus };
}

function randomId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function loadRuntimeStatus(signal?: AbortSignal): Promise<RuntimeControlStatus> {
  const response = await fetch("/api/runtime", {
    headers: { Accept: "application/json", "X-Request-ID": randomId("runtime-read") },
    cache: "no-store",
    signal,
  });
  return (await parse(response)).status;
}

export async function sendRuntimeCommand(input: RuntimeCommandInput) {
  const response = await fetch("/api/runtime", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Request-ID": randomId("runtime-command"),
      "Idempotency-Key": randomId("runtime-idempotency"),
    },
    body: JSON.stringify(input),
  });
  return parse(response);
}
