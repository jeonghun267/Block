import type { ShadowConsoleSnapshot } from "../shadow";

type ShadowPayload = {
  snapshot?: ShadowConsoleSnapshot;
  error?: string;
  duplicate?: boolean;
  sameMarketSnapshot?: boolean;
};

async function parse(response: Response) {
  const payload = await response.json() as ShadowPayload;
  if (!response.ok || !payload.snapshot) throw new Error(payload.error || `섀도 API 응답 오류 ${response.status}`);
  return payload as ShadowPayload & { snapshot: ShadowConsoleSnapshot };
}

async function ensureInstitution(signal?: AbortSignal) {
  const response = await fetch("/api/control-plane", { headers: { Accept: "application/json" }, cache: "no-store", signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "기관 통제 원장을 초기화하지 못했습니다.");
  }
}

export async function loadShadowSnapshot(signal?: AbortSignal) {
  let response = await fetch("/api/shadow", { headers: { Accept: "application/json" }, cache: "no-store", signal });
  if (response.status === 409) {
    await ensureInstitution(signal);
    response = await fetch("/api/shadow", { headers: { Accept: "application/json" }, cache: "no-store", signal });
  }
  return (await parse(response)).snapshot;
}

export async function runShadowCycle() {
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `shadow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetch("/api/shadow", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "run_cycle", requestId }),
  });
  return parse(response);
}
