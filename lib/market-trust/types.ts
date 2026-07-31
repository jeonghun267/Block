export type PerformanceMetrics = {
  /** Return after recorded trading fees and slippage, expressed in percentage points. */
  netReturnPct: number;
  /** Peak-to-trough loss. Stored as a positive percentage magnitude. */
  maxDrawdownPct: number;
  tradeCount: number;
  liveDays: number;
  /** Age of the newest observation when the evidence was assembled. */
  dataFreshnessMinutes: number;
  /** Independent observations used for the published statistics. */
  sampleSize: number;
  asOf: string;
};

export type SelfReportedPerformance = {
  source: "self_reported";
  metrics: PerformanceMetrics;
  declaredAt: string;
  declarationId: string;
};

export type VerifiedPerformance = {
  source: "verified_live" | "verified_paper";
  metrics: PerformanceMetrics;
  verificationRunId: string;
  verifiedAt: string;
  /** Non-secret identifier of the verifier or exchange connector. */
  verifierId: string;
};

export type StrategyPerformanceEvidence = {
  selfReported?: SelfReportedPerformance;
  verified?: VerifiedPerformance;
  cohort?: {
    includesInactiveStrategies: boolean;
    includesDelistedStrategies: boolean;
    description?: string;
  };
};

export type TrustWarningCode =
  | "self_report_only"
  | "paper_performance"
  | "stale_data"
  | "insufficient_trades"
  | "insufficient_live_days"
  | "small_sample"
  | "reported_verified_gap"
  | "implausible_metrics"
  | "survivorship_bias_risk";

export type TrustWarning = {
  code: TrustWarningCode;
  severity: "info" | "warning" | "critical";
  message: string;
};

export type TrustGrade = "A" | "B" | "C" | "D" | "UNVERIFIED";

export type TrustAssessment = {
  /** Evidence-quality score, not a promise of future profitability. */
  score: number;
  grade: TrustGrade;
  basis: "verified_live" | "verified_paper" | "self_reported" | "none";
  warnings: TrustWarning[];
  evaluatedMetrics: PerformanceMetrics | null;
};

export type StrategyVisibility = "public_summary" | "subscriber_details" | "private";
export type StrategyLicenseMode = "replication" | "signal_only";

export type StrategyDistributionTerms = {
  visibility: StrategyVisibility;
  licenseMode: StrategyLicenseMode;
  exposesExactRules: boolean;
  redistributionAllowed: boolean;
  signalDelaySeconds: number;
  termsVersion: string;
};

export type DistributionValidation = {
  valid: boolean;
  issues: string[];
};
