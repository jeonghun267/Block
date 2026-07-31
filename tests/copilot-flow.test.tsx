// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "../app/page";
import { generateRuleBasedStrategyDraft } from "../lib/strategy-copilot";

describe("홈페이지 제품 탭과 AI 전략 코파일럿", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("세 업무 화면을 세로로 나열하지 않고 같은 자리에서 하나씩 전환한다", async () => {
    const user = userEvent.setup();
    render(<Home />);
    expect(screen.queryAllByRole("tabpanel")).toHaveLength(0);
    expect(screen.queryByText("대화에서 검증 가능한 전략 명세까지")).toBeNull();
    await user.click(screen.getByRole("button", { name:"제품 기능 보기" }));
    expect(screen.getByRole("tabpanel", { name:"플랫폼 화면" })).toBeTruthy();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByText("수익률보다 먼저 갖춰야 할 운용 통제")).toBeNull();
    await user.click(screen.getAllByRole("button", { name:"통제 체계" })[0]);
    expect(screen.getByRole("tabpanel", { name:"통제 체계 화면" })).toBeTruthy();
    expect(screen.queryByRole("tabpanel", { name:"플랫폼 화면" })).toBeNull();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByText("2인 승인 대기열")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name:"보안" })[0]);
    expect(screen.getByRole("tabpanel", { name:"보안 화면" })).toBeTruthy();
    expect(screen.queryByRole("tabpanel", { name:"통제 체계 화면" })).toBeNull();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByText("비밀정보 경계")).toBeTruthy();
    await user.click(screen.getByRole("button", { name:"제품 화면 닫기" }));
    expect(screen.queryAllByRole("tabpanel")).toHaveLength(0);
  });

  it("대화형 전략 초안을 블록 빌더에 적용하되 실행 권한은 주지 않는다", async () => {
    const user = userEvent.setup();
    const prompt = "BTC가 최근 4시간 고점에서 5% 하락하면 현금 10%를 매수하고 일일 손실 3%에서 중단해줘";
    const draft = generateRuleBasedStrategyDraft(prompt);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok:true,
      status:200,
      json:async () => ({ draft, generationMode:"rules", providerReady:false, auditRecorded:true, model:null, requestId:"copilot-test-1", notice:"검증 가능한 규칙 엔진 초안" }),
    } as Response)));
    render(<Home />);

    await user.click(screen.getByRole("button", { name:"기관 전용 접속" }));
    await user.click(screen.getByRole("button", { name:/구글로 로그인/ }));
    await user.click(screen.getAllByRole("button", { name:/AI 전략 코파일럿/ })[0]);
    expect(screen.getByText("AI 실행 권한 없음")).toBeTruthy();
    const input = screen.getByRole("textbox", { name:/전략 설명/ });
    await user.clear(input);
    await user.type(input, prompt);
    await user.click(screen.getByRole("button", { name:"블록 초안 생성" }));
    expect(await screen.findByRole("heading", { name:/BTC 낙폭 매수 전략/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name:"블록 빌더에 초안 적용" }));
    expect(screen.getByText(/BTC 최근 4시간 고점 대비 낙폭이 5%/)).toBeTruthy();
    expect(screen.getByText("사용 가능 원화의 10% 매수")).toBeTruthy();
  });
});
