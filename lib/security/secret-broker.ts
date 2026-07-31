import type { EnvironmentSource } from "./config";

export type SecretBrokerConfig = {
  ready: boolean;
  endpoint: string | null;
  serviceToken: string | null;
  missing: Array<"SECRET_BROKER_URL" | "SECRET_BROKER_SERVICE_TOKEN">;
};

export type EphemeralExchangeCredential = {
  accessKey: string;
  secretKey: string;
  credentialFingerprint: string;
  expiresAt: string;
};

const SECRET_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,239}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;

function optionalString(source: EnvironmentSource, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validateBrokerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SECRET_BROKER_URL 형식이 올바르지 않습니다.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("비밀정보 브로커는 인증정보가 포함되지 않은 HTTPS 주소여야 합니다.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function readSecretBrokerConfig(source: EnvironmentSource): SecretBrokerConfig {
  const rawEndpoint = optionalString(source, "SECRET_BROKER_URL");
  const serviceToken = optionalString(source, "SECRET_BROKER_SERVICE_TOKEN");
  const missing: SecretBrokerConfig["missing"] = [];
  if (!rawEndpoint) missing.push("SECRET_BROKER_URL");
  if (!serviceToken) missing.push("SECRET_BROKER_SERVICE_TOKEN");
  return {
    ready: missing.length === 0,
    endpoint: rawEndpoint ? validateBrokerUrl(rawEndpoint) : null,
    serviceToken,
    missing,
  };
}

function validateCredentialPayload(value: unknown): EphemeralExchangeCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("비밀정보 브로커 응답 형식이 올바르지 않습니다.");
  }
  const payload = value as Record<string, unknown>;
  const accessKey = typeof payload.accessKey === "string" ? payload.accessKey.trim() : "";
  const secretKey = typeof payload.secretKey === "string" ? payload.secretKey.trim() : "";
  const credentialFingerprint = typeof payload.credentialFingerprint === "string" ? payload.credentialFingerprint.trim() : "";
  const expiresAt = typeof payload.expiresAt === "string" ? payload.expiresAt : "";
  const expiry = Date.parse(expiresAt);
  if (accessKey.length < 8 || accessKey.length > 256 || secretKey.length < 16 || secretKey.length > 512) {
    throw new Error("브로커가 유효한 거래소 자격증명을 반환하지 않았습니다.");
  }
  if (!/^[A-Fa-f0-9]{16,128}$/.test(credentialFingerprint)) {
    throw new Error("브로커가 자격증명 지문을 반환하지 않았습니다.");
  }
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 15 * 60_000) {
    throw new Error("거래소 자격증명의 만료 시간이 허용 범위를 벗어났습니다.");
  }
  return { accessKey, secretKey, credentialFingerprint: credentialFingerprint.toLowerCase(), expiresAt };
}

export async function resolveExchangeCredential(
  config: SecretBrokerConfig,
  input: {
    secretReference: string;
    institutionId: string;
    actorKey: string;
    requestId: string;
    purpose: "read_only_reconciliation";
  },
  fetcher: typeof fetch = fetch,
): Promise<EphemeralExchangeCredential> {
  if (!config.ready || !config.endpoint || !config.serviceToken) {
    throw new Error("외부 KMS/Vault 비밀정보 브로커가 준비되지 않았습니다.");
  }
  if (!SECRET_REFERENCE_PATTERN.test(input.secretReference)) throw new Error("비밀정보 참조 형식이 올바르지 않습니다.");
  if (!SECRET_REFERENCE_PATTERN.test(input.institutionId)) throw new Error("기관 식별자 형식이 올바르지 않습니다.");
  if (!REQUEST_ID_PATTERN.test(input.requestId)) throw new Error("요청 식별자 형식이 올바르지 않습니다.");

  const response = await fetcher(`${config.endpoint}/v1/exchange-credentials/resolve`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.serviceToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Request-ID": input.requestId,
    },
    body: JSON.stringify({
      reference: input.secretReference,
      institutionId: input.institutionId,
      actorKey: input.actorKey,
      purpose: input.purpose,
      requestedTtlSeconds: 300,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`비밀정보 브로커 요청이 거절되었습니다 (${response.status}).`);
  }
  return validateCredentialPayload(await response.json());
}
