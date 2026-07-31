import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import {
  generateRuleBasedStrategyDraft,
  normalizeCopilotInput,
  STRATEGY_COPILOT_JSON_SCHEMA,
  validateCopilotDraft,
  type StrategyCopilotDraft,
  type StrategyCopilotResponse,
} from "../../../lib/strategy-copilot";
import { readExchangeRuntimeConfig } from "../../../lib/security/config";
import { requireTrustedIdentity, TrustedIdentityError } from "../../../lib/security/identity";
import { EdgeRateLimiter, fingerprintRequest, getRequestContext, rateLimitHeaders } from "../../../lib/security/request";

export const runtime = "edge";

const JSON_HEADERS = { "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };
const limiter = new EdgeRateLimiter();

function runtimeValue(key: string) {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jsonError(message: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: message }, { status, headers: { ...JSON_HEADERS, ...headers } });
}

function identity(request: Request) {
  const config = readExchangeRuntimeConfig(env as unknown as Record<string, unknown>);
  return requireTrustedIdentity(request, config).subject;
}

function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return null;
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

async function generateWithOpenAI(input: string, apiKey: string, model: string): Promise<StrategyCopilotDraft> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: [
              "당신은 기관용 가상자산 전략 명세 보조자입니다.",
              "사용자의 한국어 설명을 허용된 JSON 블록 초안으로만 변환하세요.",
              "수익을 보장하지 말고, 레버리지·파생상품·공매도는 blocker로 표시하세요.",
              "명확하지 않은 값은 보수적인 가정과 확인 질문을 남기세요.",
              "AI 초안은 주문을 만들거나 실행하지 않으며 반드시 사람의 검토가 필요합니다.",
            ].join(" "),
          }],
        },
        { role: "user", content: [{ type: "input_text", text: input }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "blocktrade_strategy_draft",
          strict: true,
          schema: STRATEGY_COPILOT_JSON_SCHEMA,
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI 응답 오류 ${response.status}`);
  const payload = await response.json() as unknown;
  const text = responseText(payload);
  if (!text) throw new Error("OpenAI 구조화 응답이 비어 있습니다");
  return validateCopilotDraft(JSON.parse(text) as unknown);
}

async function recordAudit(input: {
  owner: string;
  requestId: string;
  promptHash: string;
  generationMode: "rules" | "openai";
  model: string | null;
  status: "generated" | "fallback" | "blocked";
  blockCount: number;
}) {
  try {
    await env.DB.prepare(`INSERT INTO copilot_audit_events
      (id, owner_key, request_id, prompt_hash, generation_mode, model, status, block_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`copilot-${crypto.randomUUID()}`, input.owner, input.requestId, input.promptHash, input.generationMode, input.model, input.status, input.blockCount, new Date().toISOString())
      .run();
    return true;
  } catch (error: unknown) {
    console.error("[strategy-copilot:audit]", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}

export async function POST(request: Request) {
  let owner = "";
  try {
    owner = identity(request);
    const rate = limiter.take(owner, 10, 60_000);
    const headers = rateLimitHeaders(rate);
    if (!rate.allowed) return jsonError("전략 초안 생성 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429, headers);

    const raw = await request.text();
    if (raw.length > 4_000) return jsonError("요청이 너무 큽니다.", 413, headers);
    let body: { message?: unknown };
    try {
      body = JSON.parse(raw) as { message?: unknown };
    } catch {
      return jsonError("요청 형식이 올바르지 않습니다.", 400, headers);
    }
    const message = normalizeCopilotInput(body.message);
    const { requestId } = getRequestContext(request);
    const promptHash = await fingerprintRequest("POST", "/api/strategy-copilot", { owner, message });
    const apiKey = runtimeValue("OPENAI_API_KEY");
    const model = runtimeValue("OPENAI_STRATEGY_MODEL") ?? "gpt-5.6-sol";
    let generationMode: "rules" | "openai" = "rules";
    let notice = "OpenAI 비밀키가 연결되기 전까지 검증 가능한 규칙 엔진으로 초안을 생성했습니다.";
    let draft = generateRuleBasedStrategyDraft(message);
    let status: "generated" | "fallback" | "blocked" = draft.findings.some((item) => item.severity === "blocker") ? "blocked" : "generated";

    if (apiKey) {
      try {
        draft = await generateWithOpenAI(message, apiKey, model);
        generationMode = "openai";
        notice = "AI가 구조화된 초안을 만들었으며, 서버 검증과 사람의 승인이 남아 있습니다.";
        status = draft.findings.some((item) => item.severity === "blocker") ? "blocked" : "generated";
      } catch (error: unknown) {
        console.error("[strategy-copilot:provider]", error instanceof Error ? error.message : "unknown error");
        generationMode = "rules";
        status = "fallback";
        notice = "AI 제공자 응답을 검증하지 못해 안전한 규칙 기반 초안으로 대체했습니다.";
      }
    }

    const auditRecorded = await recordAudit({ owner, requestId, promptHash, generationMode, model: apiKey ? model : null, status, blockCount: draft.blocks.length });
    const payload: StrategyCopilotResponse = {
      draft,
      generationMode,
      providerReady: Boolean(apiKey),
      auditRecorded,
      model: apiKey ? model : null,
      requestId,
      notice,
    };
    return NextResponse.json(payload, { headers: { ...JSON_HEADERS, ...headers } });
  } catch (error: unknown) {
    if (error instanceof TrustedIdentityError) return jsonError("인증이 필요합니다.", 401);
    const message = error instanceof Error ? error.message : "전략 초안을 생성하지 못했습니다.";
    console.error("[strategy-copilot:post]", owner ? message : "identity error");
    return jsonError(message, message.includes("입력") || message.includes("자 이하") ? 400 : 500);
  }
}
