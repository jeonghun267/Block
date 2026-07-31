export type RuntimeEnvironment = "development" | "test" | "production";
export type ExchangeModeSetting = "auto" | "demo" | "live";
export type EffectiveExchangeMode = "demo" | "live";

export type EnvironmentSource = Record<string, unknown>;

export class SafeConfigError extends Error {
  readonly code: "INVALID_CONFIGURATION";

  constructor(message: string) {
    super(message);
    this.name = "SafeConfigError";
    this.code = "INVALID_CONFIGURATION";
  }
}

export type ExchangeRuntimeConfig = {
  modeSetting: ExchangeModeSetting;
  mode: EffectiveExchangeMode;
  runtimeEnvironment: RuntimeEnvironment;
  apiBaseUrl: string;
  credentials: {
    accessKey: string;
    secretKey: string;
  } | null;
  liveReady: boolean;
  credentialReady: boolean;
  liveTradingEnabled: boolean;
  approvedAccountId: string | null;
  liveBlockers: Array<"credentials" | "operator_switch" | "approved_account">;
  missing: Array<"UPBIT_ACCESS_KEY" | "UPBIT_SECRET_KEY">;
  identityHeader: "oai-authenticated-user-email" | "cf-access-authenticated-user-email";
  allowDemoIdentity: boolean;
};

const DEFAULT_UPBIT_API_BASE_URL = "https://api.upbit.com";
const ALLOWED_UPBIT_HOSTS = new Set(["api.upbit.com"]);
const ALLOWED_IDENTITY_HEADERS = new Set<ExchangeRuntimeConfig["identityHeader"]>([
  "oai-authenticated-user-email",
  "cf-access-authenticated-user-email",
]);

function readString(source: EnvironmentSource, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(source: EnvironmentSource, key: string, fallback = false): boolean {
  const value = readString(source, key);
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new SafeConfigError(`${key} must be true or false`);
}

function readRuntimeEnvironment(source: EnvironmentSource): RuntimeEnvironment {
  const value = readString(source, "APP_ENV") ?? readString(source, "NODE_ENV") ?? "production";
  if (value === "production" || value === "test" || value === "development") return value;
  throw new SafeConfigError("APP_ENV must be development, test, or production");
}

function readMode(source: EnvironmentSource): ExchangeModeSetting {
  const value = readString(source, "EXCHANGE_MODE") ?? "auto";
  if (value === "auto" || value === "demo" || value === "live") return value;
  throw new SafeConfigError("EXCHANGE_MODE must be auto, demo, or live");
}

function readApiBaseUrl(source: EnvironmentSource): string {
  const raw = readString(source, "UPBIT_API_BASE_URL") ?? DEFAULT_UPBIT_API_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeConfigError("UPBIT_API_BASE_URL is invalid");
  }
  if (url.protocol !== "https:" || !ALLOWED_UPBIT_HOSTS.has(url.hostname) || (url.pathname !== "/" && url.pathname !== "")) {
    throw new SafeConfigError("UPBIT_API_BASE_URL must use the approved Upbit HTTPS origin");
  }
  return url.origin;
}

function readIdentityHeader(source: EnvironmentSource): ExchangeRuntimeConfig["identityHeader"] {
  const value = (readString(source, "TRUSTED_IDENTITY_HEADER") ?? "oai-authenticated-user-email").toLowerCase();
  if (!ALLOWED_IDENTITY_HEADERS.has(value as ExchangeRuntimeConfig["identityHeader"])) {
    throw new SafeConfigError("TRUSTED_IDENTITY_HEADER is not approved");
  }
  return value as ExchangeRuntimeConfig["identityHeader"];
}

export function readExchangeRuntimeConfig(source: EnvironmentSource): ExchangeRuntimeConfig {
  const accessKey = readString(source, "UPBIT_ACCESS_KEY");
  const secretKey = readString(source, "UPBIT_SECRET_KEY");
  const modeSetting = readMode(source);
  const runtimeEnvironment = readRuntimeEnvironment(source);
  const missing: ExchangeRuntimeConfig["missing"] = [];
  if (!accessKey) missing.push("UPBIT_ACCESS_KEY");
  if (!secretKey) missing.push("UPBIT_SECRET_KEY");
  const credentialReady = missing.length === 0;
  const liveTradingEnabled = readBoolean(source, "LIVE_TRADING_ENABLED", false);
  const approvedAccountId = readString(source, "LIVE_TRADING_ACCOUNT_ID") ?? null;
  const liveBlockers: ExchangeRuntimeConfig["liveBlockers"] = [];
  if (!credentialReady) liveBlockers.push("credentials");
  if (!liveTradingEnabled) liveBlockers.push("operator_switch");
  if (!approvedAccountId) liveBlockers.push("approved_account");
  const liveReady = liveBlockers.length === 0;
  if (modeSetting === "live" && !liveReady) {
    throw new SafeConfigError("Live exchange mode requires credentials, the operator switch, and an approved account");
  }
  const mode: EffectiveExchangeMode = modeSetting === "live" || (modeSetting === "auto" && liveReady) ? "live" : "demo";

  return {
    modeSetting,
    mode,
    runtimeEnvironment,
    apiBaseUrl: readApiBaseUrl(source),
    credentials: credentialReady ? { accessKey: accessKey!, secretKey: secretKey! } : null,
    liveReady,
    credentialReady,
    liveTradingEnabled,
    approvedAccountId,
    liveBlockers,
    missing,
    identityHeader: readIdentityHeader(source),
    allowDemoIdentity: runtimeEnvironment !== "production" && readBoolean(source, "ALLOW_DEMO_IDENTITY", false),
  };
}

export type PublicExchangeStatus = {
  provider: "upbit";
  mode: EffectiveExchangeMode;
  modeSetting: ExchangeModeSetting;
  ready: boolean;
  liveReady: boolean;
  liveBlockers: ExchangeRuntimeConfig["liveBlockers"];
  missing: ExchangeRuntimeConfig["missing"];
  withdrawalsAllowed: false;
};

export function toPublicExchangeStatus(config: ExchangeRuntimeConfig): PublicExchangeStatus {
  return {
    provider: "upbit",
    mode: config.mode,
    modeSetting: config.modeSetting,
    ready: config.mode === "demo" || config.liveReady,
    liveReady: config.liveReady,
    liveBlockers: [...config.liveBlockers],
    missing: [...config.missing],
    withdrawalsAllowed: false,
  };
}
