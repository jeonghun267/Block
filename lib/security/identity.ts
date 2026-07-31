import type { ExchangeRuntimeConfig } from "./config";

export class TrustedIdentityError extends Error {
  readonly status = 401;
  readonly code = "TRUSTED_IDENTITY_REQUIRED";

  constructor() {
    super("Trusted identity is required");
    this.name = "TrustedIdentityError";
  }
}

export type TrustedIdentity = {
  subject: string;
  source: ExchangeRuntimeConfig["identityHeader"] | "development-demo";
};

const EMAIL_LIKE_IDENTITY = /^[^\s@]{1,80}@[^\s@]{1,120}$/;

export function requireTrustedIdentity(request: Request, config: ExchangeRuntimeConfig): TrustedIdentity {
  const raw = request.headers.get(config.identityHeader)?.trim().toLowerCase();
  if (raw && raw.length <= 200 && EMAIL_LIKE_IDENTITY.test(raw)) {
    return { subject: raw, source: config.identityHeader };
  }

  if (config.runtimeEnvironment !== "production" && config.allowDemoIdentity) {
    return { subject: "local-demo@blocktrade.invalid", source: "development-demo" };
  }

  throw new TrustedIdentityError();
}
