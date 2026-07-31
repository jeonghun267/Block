import { DemoPaymentAdapter } from "./demo";
import type {
  LiveCommerceBlocker,
  MarketplaceCommerceReadiness,
  PaymentAdapter,
  PaymentReadiness,
  SettlementBreakdown,
  SettlementInput,
} from "./types";

export type EnvironmentReader = Record<string, string | undefined>;

const FINAL_PROVIDER_KEYS = ["PAYMENT_PUBLIC_KEY", "PAYMENT_SECRET_KEY", "PAYMENT_WEBHOOK_SECRET"] as const;

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function getLivePaymentReadiness(environment: EnvironmentReader): PaymentReadiness {
  const provider = environment.PAYMENT_PROVIDER?.trim() || "final_provider";
  const keyPresence = Object.fromEntries(FINAL_PROVIDER_KEYS.map((key) => [key, Boolean(environment[key]?.trim())]));
  const missingEnvironmentKeys = FINAL_PROVIDER_KEYS.filter((key) => !keyPresence[key]);
  // A concrete provider adapter is intentionally an explicit gate; having keys
  // alone must never make a placeholder provider appear operational.
  const adapterImplemented = enabled(environment.PAYMENT_ADAPTER_IMPLEMENTED);
  const environmentConfigured = missingEnvironmentKeys.length === 0;
  return {
    mode: "live",
    provider,
    adapterImplemented,
    environmentConfigured,
    ready: adapterImplemented && environmentConfigured,
    missingEnvironmentKeys,
    keyPresence,
  };
}

export function createPaymentAdapter(environment: EnvironmentReader = {}): PaymentAdapter {
  const mode = environment.PAYMENT_MODE?.trim().toLowerCase();
  if (!mode || mode === "demo") return new DemoPaymentAdapter();
  throw new Error("실결제 어댑터가 아직 등록되지 않았습니다. readiness의 provider_adapter 상태를 확인해주세요.");
}

export function calculateSettlement(input: SettlementInput): SettlementBreakdown {
  const { policy } = input;
  if (!Number.isInteger(input.grossAmount) || input.grossAmount < 0) throw new Error("총 결제액은 0 이상의 정수여야 합니다.");
  if (!Number.isInteger(input.refundedAmount) || input.refundedAmount < 0 || input.refundedAmount > input.grossAmount) throw new Error("환불액은 총 결제액 범위여야 합니다.");
  if ([policy.platformFeeBps, policy.paymentFeeBps].some((fee) => !Number.isInteger(fee) || fee < 0 || fee > 10_000)) throw new Error("수수료율은 0~10,000bp 범위여야 합니다.");
  if (!Number.isInteger(policy.fixedPaymentFee) || policy.fixedPaymentFee < 0) throw new Error("고정 결제 수수료는 0 이상의 정수여야 합니다.");

  const capturedAmount = input.grossAmount - input.refundedAmount;
  const platformFee = Math.round((capturedAmount * policy.platformFeeBps) / 10_000);
  const paymentFee = capturedAmount === 0 ? 0 : Math.min(capturedAmount, Math.round((capturedAmount * policy.paymentFeeBps) / 10_000) + policy.fixedPaymentFee);
  return {
    grossAmount: input.grossAmount,
    refundedAmount: input.refundedAmount,
    platformFee,
    paymentFee,
    creatorNetAmount: Math.max(0, capturedAmount - platformFee - paymentFee),
    currency: input.currency,
    status: input.status,
    holdReasons: [...input.holdReasons],
  };
}

export function getMarketplaceCommerceReadiness(environment: EnvironmentReader): MarketplaceCommerceReadiness {
  const payment = environment.PAYMENT_MODE?.trim().toLowerCase() === "live" ? getLivePaymentReadiness(environment) : new DemoPaymentAdapter().readiness();
  const blockers: LiveCommerceBlocker[] = [
    { code: "provider_adapter", satisfied: payment.adapterImplemented, liveBlocking: true, note: "선택한 결제사의 실제 어댑터 구현·검증이 필요합니다." },
    { code: "payment_environment", satisfied: payment.environmentConfigured, liveBlocking: true, note: "결제 키와 웹훅 서명을 서버 환경에 설정해야 합니다." },
    { code: "kyc", satisfied: enabled(environment.MARKETPLACE_KYC_READY), liveBlocking: true, note: "창작자 신원 확인 절차의 운영 준비 여부입니다." },
    { code: "regulatory_review", satisfied: enabled(environment.MARKETPLACE_REGULATORY_REVIEW_READY), liveBlocking: true, note: "서비스 지역·상품 구조에 맞는 전문가 검토가 필요하며 본 모델은 특정 법적 결론을 뜻하지 않습니다." },
    { code: "tax_profile", satisfied: enabled(environment.MARKETPLACE_TAX_PROFILE_READY), liveBlocking: true, note: "정산 대상의 세무 정보 수집·처리 절차 준비 여부입니다." },
    { code: "payout_account", satisfied: enabled(environment.MARKETPLACE_PAYOUT_ACCOUNT_READY), liveBlocking: true, note: "검증된 정산 계좌와 변경 보호 절차가 필요합니다." },
  ];
  return {
    demoReady: true,
    liveReady: payment.mode === "live" && blockers.every((blocker) => blocker.satisfied),
    payment,
    blockers,
    disclaimer: "규제·세무·신원 확인 요구사항은 서비스 지역과 구조에 따라 달라질 수 있으므로 실제 출시 전 전문 검토가 필요합니다.",
  };
}
