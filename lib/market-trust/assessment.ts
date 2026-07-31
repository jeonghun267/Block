import type {
  DistributionValidation,
  PerformanceMetrics,
  StrategyDistributionTerms,
  StrategyPerformanceEvidence,
  TrustAssessment,
  TrustGrade,
  TrustWarning,
} from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const points = (value: number, target: number, weight: number) => clamp(value / target, 0, 1) * weight;

function validMetrics(metrics: PerformanceMetrics) {
  return (
    Number.isFinite(metrics.netReturnPct) &&
    Number.isFinite(metrics.maxDrawdownPct) &&
    metrics.maxDrawdownPct >= 0 &&
    metrics.maxDrawdownPct <= 100 &&
    Number.isInteger(metrics.tradeCount) &&
    metrics.tradeCount >= 0 &&
    Number.isInteger(metrics.liveDays) &&
    metrics.liveDays >= 0 &&
    Number.isFinite(metrics.dataFreshnessMinutes) &&
    metrics.dataFreshnessMinutes >= 0 &&
    Number.isInteger(metrics.sampleSize) &&
    metrics.sampleSize >= 0
  );
}

function gradeFor(score: number, verified: boolean): TrustGrade {
  if (!verified) return "UNVERIFIED";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

function gapIsMaterial(reported: number, verified: number) {
  const absoluteGap = Math.abs(reported - verified);
  const denominator = Math.max(Math.abs(verified), 1);
  return absoluteGap >= 5 && absoluteGap / denominator >= 0.25;
}

/**
 * Rates the completeness and provenance of performance evidence. High return does
 * not add points, so the result cannot be presented as an investment ranking.
 */
export function assessStrategyTrust(evidence: StrategyPerformanceEvidence): TrustAssessment {
  const warnings: TrustWarning[] = [];
  const verified = evidence.verified;
  const metrics = verified?.metrics ?? evidence.selfReported?.metrics ?? null;
  const basis = verified?.source ?? (evidence.selfReported ? "self_reported" : "none");

  if (!verified && evidence.selfReported) {
    warnings.push({
      code: "self_report_only",
      severity: "critical",
      message: "성과가 작성자 자기신고값뿐이며 독립적으로 검증되지 않았습니다.",
    });
  }
  if (verified?.source === "verified_paper") {
    warnings.push({
      code: "paper_performance",
      severity: "warning",
      message: "모의운영 결과는 실제 체결·유동성·슬리피지와 다를 수 있습니다.",
    });
  }
  if (metrics && !validMetrics(metrics)) {
    warnings.push({ code: "implausible_metrics", severity: "critical", message: "성과 지표의 범위 또는 형식이 유효하지 않습니다." });
  }
  if (metrics?.dataFreshnessMinutes !== undefined && metrics.dataFreshnessMinutes > 24 * 60) {
    warnings.push({ code: "stale_data", severity: metrics.dataFreshnessMinutes > 7 * 24 * 60 ? "critical" : "warning", message: "검증 데이터가 24시간 이상 갱신되지 않았습니다." });
  }
  if (metrics && metrics.tradeCount < 30) {
    warnings.push({ code: "insufficient_trades", severity: "warning", message: "거래 수가 30건 미만이어서 결과 변동성이 클 수 있습니다." });
  }
  if (metrics && metrics.liveDays < 30) {
    warnings.push({ code: "insufficient_live_days", severity: "warning", message: "운영 기간이 30일 미만입니다." });
  }
  if (metrics && metrics.sampleSize < 30) {
    warnings.push({ code: "small_sample", severity: "warning", message: "표본 수가 30개 미만입니다." });
  }
  if (
    evidence.selfReported &&
    verified &&
    (gapIsMaterial(evidence.selfReported.metrics.netReturnPct, verified.metrics.netReturnPct) ||
      gapIsMaterial(evidence.selfReported.metrics.maxDrawdownPct, verified.metrics.maxDrawdownPct))
  ) {
    warnings.push({
      code: "reported_verified_gap",
      severity: "critical",
      message: "자기신고 성과와 검증 성과 사이에 큰 차이가 있어 조작·산식 차이를 확인해야 합니다.",
    });
  }
  if (!evidence.cohort?.includesInactiveStrategies || !evidence.cohort?.includesDelistedStrategies) {
    warnings.push({
      code: "survivorship_bias_risk",
      severity: "warning",
      message: "중단·비공개 전략을 포함한 전체 모집단이 아니어서 생존편향 가능성이 있습니다.",
    });
  }

  if (!metrics || !verified || !validMetrics(metrics)) {
    return {
      score: metrics && validMetrics(metrics) ? 15 : 0,
      grade: "UNVERIFIED",
      basis,
      warnings,
      evaluatedMetrics: metrics,
    };
  }

  let score = verified.source === "verified_live" ? 30 : 18;
  score += metrics.dataFreshnessMinutes <= 60 ? 15 : metrics.dataFreshnessMinutes <= 24 * 60 ? 10 : metrics.dataFreshnessMinutes <= 7 * 24 * 60 ? 4 : 0;
  score += points(metrics.tradeCount, 100, 18);
  score += points(metrics.liveDays, 180, 15);
  score += points(metrics.sampleSize, 100, 12);
  score += evidence.cohort?.includesInactiveStrategies && evidence.cohort?.includesDelistedStrategies ? 10 : 0;
  if (warnings.some((warning) => warning.code === "reported_verified_gap")) score -= 15;
  const roundedScore = Math.round(clamp(score, 0, 100));

  return {
    score: roundedScore,
    grade: gradeFor(roundedScore, true),
    basis,
    warnings,
    evaluatedMetrics: metrics,
  };
}

export function validateDistributionTerms(terms: StrategyDistributionTerms): DistributionValidation {
  const issues: string[] = [];
  if (!terms.termsVersion.trim()) issues.push("약관 버전이 필요합니다.");
  if (!Number.isInteger(terms.signalDelaySeconds) || terms.signalDelaySeconds < 0) issues.push("신호 지연 시간은 0 이상의 정수여야 합니다.");
  if (terms.licenseMode === "signal_only" && terms.exposesExactRules) issues.push("신호-only 라이선스는 정확한 전략 규칙을 공개할 수 없습니다.");
  if (terms.visibility === "public_summary" && terms.licenseMode === "replication" && !terms.exposesExactRules) issues.push("복제 라이선스는 구독자에게 실행 가능한 규칙을 제공해야 합니다.");
  return { valid: issues.length === 0, issues };
}
