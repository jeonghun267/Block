import { describe, expect, it } from "vitest";
import { generateRuleBasedStrategyDraft, validateCopilotDraft } from "../lib/strategy-copilot";

describe("전략 코파일럿 안전 초안", () => {
  it("한국어 전략 설명을 가격 조건·실행 비율·손실 한도로 구조화한다", () => {
    const draft = generateRuleBasedStrategyDraft("BTC가 최근 4시간 고점에서 5% 하락하면 현금 10%를 매수하고 일일 손실 3%에서 중단해줘");
    expect(draft.title).toContain("BTC");
    expect(draft.blocks[0]).toMatchObject({
      kind: "condition",
      config: { type: "price_change", metric: "drawdown", asset: "BTC", threshold: 5, window: "4h" },
    });
    expect(draft.blocks[1]).toMatchObject({ kind: "action", config: { type: "ratio_trade", side: "buy", ratio: 10 } });
    expect(draft.blocks.some((block) => block.label.includes("일일 손실 3%"))).toBe(true);
    expect(draft.findings.some((finding) => finding.severity === "blocker")).toBe(false);
  });

  it("레버리지·파생상품 요구는 사람이 수정하기 전까지 차단한다", () => {
    const draft = generateRuleBasedStrategyDraft("BTC 선물 레버리지 10배로 4시간 5% 상승 시 현금 20% 매수해줘");
    expect(draft.findings).toContainEqual(expect.objectContaining({ severity: "blocker", code: "unsupported_leverage" }));
    expect(draft.confidence).toBe("low");
  });

  it("AI 구조화 결과의 실행 비율과 블록 수를 다시 검증한다", () => {
    const valid = generateRuleBasedStrategyDraft("ETH가 1시간 동안 3% 상승하면 보유 자산 20% 매도해줘");
    expect(validateCopilotDraft(valid).blocks.length).toBeGreaterThanOrEqual(2);
    const invalid = structuredClone(valid);
    const action = invalid.blocks.find((block) => block.config?.type === "ratio_trade");
    if (action?.config?.type === "ratio_trade") action.config.ratio = 101;
    expect(() => validateCopilotDraft(invalid)).toThrow(/실행 비율/);
  });
});
