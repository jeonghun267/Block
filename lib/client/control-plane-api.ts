import type { ControlPlaneCommandInput, ControlPlaneSnapshot } from "../control-plane";

type ControlPlanePayload = {
  snapshot?: ControlPlaneSnapshot;
  error?: string;
  duplicate?: boolean;
  createdVersionId?: string;
};

async function parse(response: Response) {
  const payload = await response.json() as ControlPlanePayload;
  if (!response.ok || !payload.snapshot) throw new Error(payload.error || `기관 통제 API 응답 오류 ${response.status}`);
  return payload as ControlPlanePayload & { snapshot: ControlPlaneSnapshot };
}

export async function loadControlPlaneSnapshot(signal?: AbortSignal) {
  const response = await fetch("/api/control-plane", { headers: { Accept: "application/json" }, cache: "no-store", signal });
  return (await parse(response)).snapshot;
}

export async function sendControlPlaneCommand(input: ControlPlaneCommandInput) {
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `control-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetch("/api/control-plane", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...input, requestId }),
  });
  return parse(response);
}
