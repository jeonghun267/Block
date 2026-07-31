import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getMarketplaceCommerceReadiness, type EnvironmentReader } from "../../../../lib/payment";

export const runtime = "edge";

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export async function GET() {
  const readiness = getMarketplaceCommerceReadiness(env as unknown as EnvironmentReader);
  return NextResponse.json(
    {
      readiness,
      generatedAt: new Date().toISOString(),
    },
    { headers: JSON_HEADERS },
  );
}
