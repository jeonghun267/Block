import { describe, expect, it } from "vitest";
import { approvalDecisionBlockers, buildLiveGates, validateStrategyVersionDefinition, type InstitutionMember, type InstitutionalApproval, type InstitutionalStrategyVersion } from "../lib/control-plane";

const maker: InstitutionMember = { memberKey:"maker@example.com", displayName:"작성자", role:"portfolio_manager", status:"active" };
const risk: InstitutionMember = { memberKey:"risk@example.com", displayName:"리스크", role:"risk_officer", status:"active" };
const version: InstitutionalStrategyVersion = { id:"sv-1", strategyKey:"btc", version:1, name:"BTC 전략", status:"pending_approval", source:"ai", createdBy:maker.memberKey, createdAt:"2026-07-20T00:00:00Z", contentHash:"abc", definition:{} };
const approval: InstitutionalApproval = { id:"ap-1", strategyVersionId:version.id, status:"pending", requestedBy:maker.memberKey, requiredRole:"risk_officer", decidedBy:null, decisionNote:null, createdAt:"2026-07-20T00:00:00Z", decidedAt:null };

describe("기관 통제 계층", () => {
  it("작성자의 자기 승인과 잘못된 승인 역할을 차단한다", () => {
    expect(approvalDecisionBlockers({ actor:maker, approval, version })).toEqual(expect.arrayContaining([expect.stringContaining("작성자와 승인자")]));
    expect(approvalDecisionBlockers({ actor:risk, approval, version })).toEqual([]);
  });

  it("내부 통제와 외부 계약이 필요한 실거래 게이트를 구분한다", () => {
    const gates = buildLiveGates({ members:[maker,risk], versions:[{...version,status:"approved"}], policy:{ id:"p1", version:1, status:"approved", maxGrossExposurePct:80, maxAssetConcentrationPct:40, maxDailyLossPct:3, maxOrderKrw:100_000_000, maxExchangeConcentrationPct:65, createdBy:"risk-author", approvedBy:risk.memberKey, createdAt:"2026-07-20T00:00:00Z" }, exceptions:[] });
    expect(gates.find((gate) => gate.code === "maker_checker_roles")?.ready).toBe(true);
    expect(gates.find((gate) => gate.code === "kms")).toMatchObject({ ready:false, external:true });
    expect(gates.find((gate) => gate.code === "legal_release")).toMatchObject({ ready:false, external:true });
  });

  it("기관 전략 정의의 크기와 비어 있는 내용을 검사한다", () => {
    expect(validateStrategyVersionDefinition({ blocks:[{ kind:"condition", label:"BTC 4시간 상승" }] })).toContain("blocks");
    expect(() => validateStrategyVersionDefinition(null)).toThrow(/비어/);
  });

  it("섀도 기간은 20주기·7일·대사 예외 0건을 모두 충족해야 통과한다", () => {
    const base = { members:[maker,risk], versions:[{...version,status:"approved" as const}], policy:null, exceptions:[] };
    expect(buildLiveGates({ ...base, shadowEvidence:{ cycleCount:19, firstCompletedAt:"2026-07-01T00:00:00Z", lastCompletedAt:"2026-07-10T00:00:00Z", exceptionCount:0 } }).find((gate) => gate.code === "shadow_period")?.ready).toBe(false);
    expect(buildLiveGates({ ...base, shadowEvidence:{ cycleCount:20, firstCompletedAt:"2026-07-01T00:00:00Z", lastCompletedAt:"2026-07-09T00:00:00Z", exceptionCount:0 } }).find((gate) => gate.code === "shadow_period")?.ready).toBe(true);
    expect(buildLiveGates({ ...base, shadowEvidence:{ cycleCount:20, firstCompletedAt:"2026-07-01T00:00:00Z", lastCompletedAt:"2026-07-09T00:00:00Z", exceptionCount:1 } }).find((gate) => gate.code === "shadow_period")?.ready).toBe(false);
  });
});
