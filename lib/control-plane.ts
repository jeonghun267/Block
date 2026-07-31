export type InstitutionRole =
  | "portfolio_manager"
  | "researcher"
  | "risk_officer"
  | "compliance_officer"
  | "operations"
  | "auditor"
  | "administrator";

export type StrategyVersionStatus = "draft" | "pending_approval" | "approved" | "rejected" | "paper" | "shadow" | "suspended";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type Institution = {
  id: string;
  name: string;
  jurisdiction: string;
  operatingMode: "paper" | "shadow" | "live";
  createdAt: string;
};

export type InstitutionMember = {
  memberKey: string;
  displayName: string;
  role: InstitutionRole;
  status: "active" | "suspended";
};

export type InstitutionalStrategyVersion = {
  id: string;
  strategyKey: string;
  version: number;
  name: string;
  status: StrategyVersionStatus;
  source: "manual" | "ai";
  createdBy: string;
  createdAt: string;
  contentHash: string;
  definition: unknown;
};

export type InstitutionalApproval = {
  id: string;
  strategyVersionId: string;
  status: ApprovalStatus;
  requestedBy: string;
  requiredRole: "risk_officer" | "compliance_officer";
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type InstitutionalRiskPolicy = {
  id: string;
  version: number;
  status: "draft" | "approved" | "retired";
  maxGrossExposurePct: number;
  maxAssetConcentrationPct: number;
  maxDailyLossPct: number;
  maxOrderKrw: number;
  maxExchangeConcentrationPct: number;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
};

export type ReconciliationException = {
  id: string;
  kind: "order" | "fill" | "balance" | "position";
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved";
  summary: string;
  assignedRole: "operations" | "risk_officer";
  orderId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type AuditLedgerEvent = {
  id: string;
  sequence: number;
  previousHash: string;
  eventHash: string;
  eventType: string;
  actorKey: string;
  objectType: string;
  objectId: string;
  createdAt: string;
};

export type LiveGate = {
  code: string;
  label: string;
  ready: boolean;
  evidence: string;
  external: boolean;
};

export type ControlPlaneSnapshot = {
  institution: Institution;
  currentMember: InstitutionMember;
  members: InstitutionMember[];
  strategyVersions: InstitutionalStrategyVersion[];
  approvals: InstitutionalApproval[];
  riskPolicy: InstitutionalRiskPolicy | null;
  reconciliationExceptions: ReconciliationException[];
  auditEvents: AuditLedgerEvent[];
  liveGates: LiveGate[];
  serverTime: string;
};

export type ControlPlaneCommandInput =
  | { action: "create_strategy_version"; name: string; strategyKey?: string; source: "manual" | "ai"; definition: unknown }
  | { action: "submit_for_approval"; strategyVersionId: string; requiredRole: "risk_officer" | "compliance_officer" }
  | { action: "decide_approval"; approvalId: string; decision: "approve" | "reject"; note: string }
  | { action: "resolve_reconciliation"; exceptionId: string; note: string };

export type ControlPlaneCommand = ControlPlaneCommandInput & { requestId: string };

export const ROLE_LABELS: Record<InstitutionRole, string> = {
  portfolio_manager: "포트폴리오 매니저",
  researcher: "전략 연구원",
  risk_officer: "리스크 책임자",
  compliance_officer: "준법 책임자",
  operations: "운영 담당자",
  auditor: "감사 담당자",
  administrator: "기관 관리자",
};

export function canCreateStrategyVersion(role: InstitutionRole) {
  return role === "portfolio_manager" || role === "researcher" || role === "administrator";
}

export function approvalDecisionBlockers(input: {
  actor: InstitutionMember;
  approval: InstitutionalApproval;
  version: InstitutionalStrategyVersion;
}) {
  const blockers: string[] = [];
  if (input.actor.status !== "active") blockers.push("활성 상태의 구성원만 승인할 수 있습니다.");
  if (input.approval.status !== "pending") blockers.push("이미 처리된 승인 요청입니다.");
  if (input.approval.requestedBy === input.actor.memberKey || input.version.createdBy === input.actor.memberKey) blockers.push("작성자와 승인자는 같을 수 없습니다.");
  if (input.actor.role !== input.approval.requiredRole && input.actor.role !== "administrator") blockers.push(`필수 승인 역할은 ${ROLE_LABELS[input.approval.requiredRole]}입니다.`);
  return blockers;
}

export function buildLiveGates(input: {
  members: InstitutionMember[];
  versions: InstitutionalStrategyVersion[];
  policy: InstitutionalRiskPolicy | null;
  exceptions: ReconciliationException[];
  shadowEvidence?: { cycleCount: number; firstCompletedAt: string | null; lastCompletedAt: string | null; exceptionCount: number };
}) : LiveGate[] {
  const activeRoles = new Set(input.members.filter((member) => member.status === "active").map((member) => member.role));
  const shadowDays = input.shadowEvidence?.firstCompletedAt && input.shadowEvidence.lastCompletedAt
    ? Math.max(0, Math.floor((Date.parse(input.shadowEvidence.lastCompletedAt) - Date.parse(input.shadowEvidence.firstCompletedAt)) / 86_400_000))
    : 0;
  const shadowReady = (input.shadowEvidence?.cycleCount ?? 0) >= 20 && shadowDays >= 7 && (input.shadowEvidence?.exceptionCount ?? 0) === 0;
  return [
    { code: "approved_strategy", label: "승인된 전략 버전", ready: input.versions.some((version) => ["approved", "paper", "shadow"].includes(version.status)), evidence: "내부 전략 원장", external: false },
    { code: "approved_risk_policy", label: "승인된 리스크 정책", ready: input.policy?.status === "approved", evidence: input.policy ? `정책 v${input.policy.version}` : "정책 없음", external: false },
    { code: "maker_checker_roles", label: "작성·승인 역할 분리", ready: activeRoles.has("portfolio_manager") && activeRoles.has("risk_officer"), evidence: "기관 구성원 등록부", external: false },
    { code: "reconciliation_clear", label: "미해결 중요 대사 예외 없음", ready: !input.exceptions.some((item) => item.status !== "resolved" && ["high", "critical"].includes(item.severity)), evidence: "대사 예외 원장", external: false },
    { code: "shadow_period", label: "독립 섀도 운영 기간", ready: shadowReady, evidence: `${input.shadowEvidence?.cycleCount ?? 0}주기 · ${shadowDays}일 · 예외 ${input.shadowEvidence?.exceptionCount ?? 0}건`, external: false },
    { code: "kms", label: "보안 저장소·KMS 연동", ready: false, evidence: "외부 보안 저장소 필요", external: true },
    { code: "exchange_corporate", label: "거래소 법인계정 승인", ready: false, evidence: "거래소 계약 필요", external: true },
    { code: "incident_drill", label: "사고대응 훈련", ready: false, evidence: "운영 조직 훈련 필요", external: true },
    { code: "security_review", label: "외부 보안 검토", ready: false, evidence: "독립 보안기관 필요", external: true },
    { code: "legal_release", label: "법률·준법 출시 승인", ready: false, evidence: "관할 법률의견 필요", external: true },
  ];
}

export function validateStrategyVersionDefinition(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length < 10) throw new Error("전략 정의가 비어 있습니다.");
  if (serialized.length > 100_000) throw new Error("전략 정의는 100KB 이하여야 합니다.");
  return serialized;
}
