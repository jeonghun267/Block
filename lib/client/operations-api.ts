import type { OperationCommandInput, OperationSnapshot } from "../operations";

type OperationPayload = {
  snapshot?: OperationSnapshot;
  error?: string;
  duplicate?: boolean;
};

async function parseOperationResponse(response: Response): Promise<OperationPayload & { snapshot: OperationSnapshot }> {
  const payload = await response.json() as OperationPayload;
  if (!response.ok || !payload.snapshot) {
    throw new Error(payload.error || `운영 API 응답 오류 ${response.status}`);
  }
  return payload as OperationPayload & { snapshot: OperationSnapshot };
}

export async function loadOperationSnapshot(signal?: AbortSignal) {
  const response = await fetch("/api/operations", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  return (await parseOperationResponse(response)).snapshot as OperationSnapshot;
}

export async function sendOperationCommand(input: OperationCommandInput) {
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `bt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetch("/api/operations", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...input, requestId }),
  });
  return parseOperationResponse(response);
}
