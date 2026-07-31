export type PaymentMode = "demo" | "live";
export type PaymentCurrency = "KRW";

export type CheckoutRequest = {
  requestId: string;
  buyerId: string;
  strategyId: string;
  amount: number;
  currency: PaymentCurrency;
  returnUrl: string;
};

export type CheckoutResult = {
  checkoutId: string;
  status: "ready" | "confirmed";
  redirectUrl: string | null;
  provider: string;
};

export type RefundRequest = {
  requestId: string;
  paymentId: string;
  amount: number;
  reason: string;
};

export type RefundResult = {
  refundId: string;
  status: "requested" | "refunded";
  provider: string;
};

export type PaymentReadiness = {
  mode: PaymentMode;
  provider: string;
  adapterImplemented: boolean;
  environmentConfigured: boolean;
  ready: boolean;
  /** Variable names only. Secret values must never enter readiness responses. */
  missingEnvironmentKeys: string[];
  keyPresence: Record<string, boolean>;
};

export interface PaymentAdapter {
  readonly provider: string;
  readonly mode: PaymentMode;
  readiness(): PaymentReadiness;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
  refund(input: RefundRequest): Promise<RefundResult>;
}

export type SettlementStatus = "pending" | "available" | "on_hold" | "paid" | "partially_refunded" | "refunded";
export type HoldReason = "refund_window" | "dispute" | "risk_review" | "identity_review" | "compliance_review";

export type SettlementFeePolicy = {
  platformFeeBps: number;
  paymentFeeBps: number;
  fixedPaymentFee: number;
};

export type SettlementInput = {
  grossAmount: number;
  refundedAmount: number;
  currency: PaymentCurrency;
  status: SettlementStatus;
  holdReasons: HoldReason[];
  policy: SettlementFeePolicy;
};

export type SettlementBreakdown = {
  grossAmount: number;
  refundedAmount: number;
  platformFee: number;
  paymentFee: number;
  creatorNetAmount: number;
  currency: PaymentCurrency;
  status: SettlementStatus;
  holdReasons: HoldReason[];
};

export type LiveCommerceBlockerCode = "kyc" | "regulatory_review" | "tax_profile" | "payout_account" | "provider_adapter" | "payment_environment";

export type LiveCommerceBlocker = {
  code: LiveCommerceBlockerCode;
  satisfied: boolean;
  liveBlocking: true;
  note: string;
};

export type MarketplaceCommerceReadiness = {
  demoReady: boolean;
  liveReady: boolean;
  payment: PaymentReadiness;
  blockers: LiveCommerceBlocker[];
  disclaimer: string;
};
