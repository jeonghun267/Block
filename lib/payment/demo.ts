import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentAdapter,
  PaymentReadiness,
  RefundRequest,
  RefundResult,
} from "./types";

function validateAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("결제 금액은 0보다 큰 정수여야 합니다.");
}

export class DemoPaymentAdapter implements PaymentAdapter {
  readonly provider = "demo";
  readonly mode = "demo" as const;

  readiness(): PaymentReadiness {
    return {
      mode: "demo",
      provider: this.provider,
      adapterImplemented: true,
      environmentConfigured: true,
      ready: true,
      missingEnvironmentKeys: [],
      keyPresence: {},
    };
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    validateAmount(input.amount);
    return {
      checkoutId: `demo-checkout-${input.requestId}`,
      status: "confirmed",
      redirectUrl: null,
      provider: this.provider,
    };
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    validateAmount(input.amount);
    if (!input.reason.trim()) throw new Error("환불 사유가 필요합니다.");
    return {
      refundId: `demo-refund-${input.requestId}`,
      status: "refunded",
      provider: this.provider,
    };
  }
}
