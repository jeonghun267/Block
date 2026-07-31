import type { StrategyCopilotResponse } from "../strategy-copilot";

type ErrorPayload = { error?: string };

export async function requestStrategyDraft(message: string, signal?: AbortSignal) {
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `copilot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetch("/api/strategy-copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-request-id": requestId },
    cache: "no-store",
    signal,
    body: JSON.stringify({ message }),
  });
  const payload = await response.json() as StrategyCopilotResponse & ErrorPayload;
  if (!response.ok || !payload.draft) throw new Error(payload.error || `전략 코파일럿 응답 오류 ${response.status}`);
  return payload;
}
