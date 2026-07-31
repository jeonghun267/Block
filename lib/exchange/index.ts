import type { ExchangeRuntimeConfig } from "../security/config";
import { DemoExchangeAdapter } from "./demo";
import type { ExchangeAdapter } from "./types";
import { UpbitExchangeAdapter } from "./upbit";

export * from "./types";
export * from "./demo";
export * from "./upbit";

export function createExchangeAdapter(config: ExchangeRuntimeConfig, fetcher: typeof fetch = fetch): ExchangeAdapter {
  return config.mode === "live"
    ? new UpbitExchangeAdapter(config, fetcher)
    : new DemoExchangeAdapter();
}
