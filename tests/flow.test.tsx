// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen as ui } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "../app/page";
import { DEFAULT_OPERATION_SNAPSHOT, type OperationSnapshot } from "../lib/operations";
import { DEFAULT_MARKETPLACE_SNAPSHOT, type MarketplaceSnapshot } from "../lib/marketplace";

describe("BlockTrade 핵심 사용자 흐름", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("약관과 위험 고지 후 계정·본인 인증을 거쳐 빈 대시보드로 이동한다", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관용 콘솔 체험" }));
    expect(ui.getByRole("heading", { name: "시작하기 전 약관에 동의해주세요" })).toBeTruthy();

    await user.click(ui.getByRole("button", { name: "전체 동의 (선택 항목 포함)" }));
    await user.click(ui.getByRole("button", { name: "동의하고 시작하기 →" }));
    expect(ui.getByRole("heading", { name: "투자 손실 가능성 고지" })).toBeTruthy();

    await user.click(ui.getByRole("button", { name: /위 내용을 모두 이해했습니다/ }));
    await user.type(ui.getByLabelText("위험 고지 확인 문구"), "이해했습니다");
    await user.click(ui.getByRole("button", { name: "동의하고 계속" }));

    await user.type(ui.getByLabelText("닉네임"), "정훈");
    await user.type(ui.getByLabelText("이메일"), "tester@example.com");
    await user.type(ui.getByLabelText("비밀번호", { selector: "input" }), "secure123");
    await user.type(ui.getByLabelText("비밀번호 확인"), "secure123");
    await user.click(ui.getByRole("button", { name: "회원가입" }));

    expect(ui.getByRole("heading", { name: "본인 인증" })).toBeTruthy();
    await user.type(ui.getByLabelText("성명"), "정훈");
    await user.type(ui.getByLabelText("생년월일"), "19900101");
    await user.click(ui.getByRole("button", { name: "KT" }));
    await user.type(ui.getByLabelText("휴대폰 번호"), "01012345678");
    await user.click(ui.getByRole("button", { name: "인증번호 받기" }));
    await user.type(ui.getByLabelText("인증번호"), "123456");
    await user.click(ui.getByRole("button", { name: "인증 완료" }));

    expect(ui.getByRole("heading", { name: "모의 운영을 시작할 준비가 됐어요" })).toBeTruthy();
    expect(ui.getByRole("button", { name: "첫 전략 만들기" })).toBeTruthy();
  });

  it("검증되지 않은 예시 백테스트는 모의 운영 전환을 차단한다", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: /카카오로 로그인/ }));
    await user.click(ui.getAllByRole("button", { name: "전략 빌더" })[0]);
    await user.click(ui.getByRole("button", { name: "백테스팅 실행 →" }));
    const lockedTransition = ui.getByRole("button", { name: "검증 완료 후 모의 운영 가능" });
    expect((lockedTransition as HTMLButtonElement).disabled).toBe(true);
    expect(ui.getByRole("heading", { name: "검증 5개 항목 미충족" })).toBeTruthy();
    expect(ui.getByText(/모든 항목이 서버 검증을 통과/)).toBeTruthy();
  });

  it("데모 계정 기능과 미연동 보안 기능을 구분해 보여준다", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: "비밀번호 찾기" }));
    expect(ui.getByRole("status").textContent).toContain("비밀번호 재설정 안내");
    await user.click(ui.getByRole("button", { name: /구글로 로그인/ }));
    await user.click(ui.getAllByRole("button", { name: /설정/ })[0]);
    expect((ui.getByRole("button", { name: "비밀번호 변경 준비 중" }) as HTMLButtonElement).disabled).toBe(true);
    expect((ui.getByRole("button", { name: "연동 준비 중" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("대시보드 체결 카드와 알림 상세가 체결 내역으로 연결된다", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => "blob:demo");
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: /카카오로 로그인/ }));
    await user.click(ui.getByRole("button", { name: "모의 주문 7건 보기" }));
    expect(ui.getByRole("heading", { name: "체결 내역" })).toBeTruthy();
    await user.click(ui.getByRole("button", { name: "매도" }));
    await user.type(ui.getByLabelText("체결 내역 검색"), "ETH");
    expect(ui.getByText("T-250314-02")).toBeTruthy();
    await user.click(ui.getByRole("button", { name: "CSV 내보내기" }));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();

    await user.click(ui.getByRole("button", { name: "← 대시보드" }));
    await user.click(ui.getAllByRole("button", { name: "알림" })[0]);
    await user.click(ui.getByRole("button", { name: /DCA 비트코인 적립 — 매수 체결/ }));
    expect(ui.getByRole("heading", { name: "알림 상세" })).toBeTruthy();
    await user.click(ui.getByRole("button", { name: "체결 내역 보기" }));
    expect(ui.getByRole("heading", { name: "체결 내역" })).toBeTruthy();
  });

  it("전략 보관함 템플릿과 실패 분석 개선안이 빌더에 반영된다", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: /구글로 로그인/ }));
    await user.click(ui.getAllByRole("button", { name: "전략 빌더" })[0]);
    await user.click(ui.getByRole("button", { name: "전략 보관함" }));
    expect(ui.getByRole("heading", { name: "전략 보관함" })).toBeTruthy();
    await user.click(ui.getAllByRole("button", { name: "이 전략으로 편집" })[1]);
    expect(ui.getByText("RSI 30 이하")).toBeTruthy();

    await user.click(ui.getByRole("button", { name: "백테스팅 실행 →" }));
    await user.click(ui.getByRole("button", { name: "실패 구간 분석" }));
    expect(ui.getByRole("heading", { name: "실패 구간 분석" })).toBeTruthy();
    await user.click(ui.getByRole("button", { name: /거래 시간 제한/ }));
    await user.click(ui.getByRole("button", { name: "다음 시도 만들기 →" }));
    expect(ui.getByText("09:00~18:00에만 실행")).toBeTruthy();
  });

  it("프로필·멤버십·고객지원 상세 화면이 설정과 상태를 공유한다", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: /카카오로 로그인/ }));
    await user.click(ui.getByRole("button", { name: "프로필 편집" }));
    const nickname = ui.getByLabelText("닉네임");
    await user.clear(nickname);
    await user.type(nickname, "블록정훈");
    await user.click(ui.getByRole("button", { name: "변경사항 저장" }));
    expect(ui.getByText("블록정훈")).toBeTruthy();

    await user.click(ui.getByRole("button", { name: "플랜 화면 보기" }));
    await user.click(ui.getByRole("button", { name: "프로 선택" }));
    expect(ui.getByText("현재 플랜")).toBeTruthy();
    await user.click(ui.getByRole("button", { name: "← 설정" }));
    expect(ui.getByText("프로 플랜 화면 예시입니다. 실제 결제와 구독은 아직 연결되지 않았습니다.")).toBeTruthy();

    await user.click(ui.getByRole("button", { name: "고객지원 열기" }));
    await user.type(ui.getByLabelText("도움말 검색"), "API 키");
    await user.click(ui.getByRole("button", { name: /API 키에 출금 권한/ }));
    expect(ui.getByText(/출금 권한이 포함된 키는 연결하지 않도록/)).toBeTruthy();
    await user.type(ui.getByLabelText("답변 받을 이메일"), "tester@example.com");
    await user.type(ui.getByLabelText("문의 내용"), "거래소 연동 상태를 확인해주세요");
    await user.click(ui.getByRole("button", { name: "문의 접수" }));
    expect(ui.getByRole("status").textContent).toContain("문의가 접수되었습니다");
  });

  it("운영센터에서 전략 일시정지와 확인형 긴급 중단이 안전하게 동작한다", async () => {
    const user = userEvent.setup();
    let current = JSON.parse(JSON.stringify(DEFAULT_OPERATION_SNAPSHOT)) as OperationSnapshot;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const command = JSON.parse(String(init.body)) as { action: string; strategyId?: string };
        if (command.action === "pause_strategy") {
          current = { ...current, strategies: current.strategies.map((strategy) => strategy.id === command.strategyId ? { ...strategy, status: "paused" } : strategy), version: current.version + 1 };
        }
        if (command.action === "emergency_stop") {
          current = { ...current, settings: { ...current.settings, emergencyStatus: "stopped" }, strategies: current.strategies.map((strategy) => ({ ...strategy, status: "stopped" })), version: current.version + 1 };
        }
      }
      return { ok: true, status: 200, json: async () => ({ snapshot: current }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: /카카오로 로그인/ }));
    await user.click(ui.getByRole("button", { name: "운영센터" }));
    expect(ui.getByRole("heading", { name: "모의 운영센터" })).toBeTruthy();
    await ui.findByText("서버 저장됨");

    await user.click(ui.getAllByRole("button", { name: "일시정지 검토" })[0]);
    const pauseButton = ui.getByRole("button", { name: "PAPER 전략 일시정지" });
    expect((pauseButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(ui.getByRole("button", { name: /대상과 PAPER 영향 범위를 확인했습니다/ }));
    expect((pauseButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(pauseButton);
    expect(await ui.findByText(/DCA 비트코인 적립을 일시정지했습니다/)).toBeTruthy();

    await user.click(ui.getByRole("button", { name: "데모 중단 검토" }));
    const stopButton = ui.getByRole("button", { name: "모든 데모 상태 중단" });
    expect((stopButton as HTMLButtonElement).disabled).toBe(true);
    await user.type(ui.getByPlaceholderText("긴급중단"), "긴급중단");
    expect((stopButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(stopButton);
    expect(await ui.findByText("PAPER 상태 중단")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("가격 변동 퍼센트의 기준과 거래 비율을 블록 안에서 명확히 설정한다", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: /카카오로 로그인/ }));
    await user.click(ui.getAllByRole("button", { name: "전략 빌더" })[0]);

    await user.click(ui.getByRole("button", { name: /ETH가 최근 4시간 시가 대비 2.5% 상향 돌파하면 설정/ }));
    await user.selectOptions(ui.getByLabelText("대상 코인"), "BTC");
    await user.selectOptions(ui.getByLabelText("관찰 기간"), "1h");
    await user.selectOptions(ui.getByLabelText("비교 기준"), "previous_close");
    await user.selectOptions(ui.getByLabelText("방향"), "down");
    await user.selectOptions(ui.getByLabelText("평가 가격"), "candle_close");
    await user.selectOptions(ui.getByLabelText("신호 확정"), "two_closes");
    await user.selectOptions(ui.getByLabelText("빈 캔들 처리"), "skip");
    await user.selectOptions(ui.getByLabelText("재실행 제한"), "cooldown_30m");
    const threshold = ui.getByLabelText("가격 변화율");
    await user.clear(threshold);
    await user.type(threshold, "3.5");
    await user.tab();
    expect(ui.getByText("BTC가 최근 1시간 직전 종가 대비 3.5% 하향 돌파하면")).toBeTruthy();
    expect((ui.getByLabelText("신호 확정") as HTMLSelectElement).value).toBe("two_closes");
    expect((ui.getByLabelText("재실행 제한") as HTMLSelectElement).value).toBe("cooldown_30m");

    await user.click(ui.getByRole("button", { name: /보유 자산의 30% 매도 설정/ }));
    const ratio = ui.getByLabelText("거래 실행 비율");
    await user.clear(ratio);
    await user.type(ratio, "40");
    await user.tab();
    expect(ui.getByText("보유 자산의 40% 매도")).toBeTruthy();
  });

  it("모든 주요 블록을 선택한 자리에서 3%·5%와 세부 기준까지 수정한다", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: /카카오로 로그인/ }));
    await user.click(ui.getAllByRole("button", { name: "전략 빌더" })[0]);

    await user.click(ui.getByRole("button", { name: /＋ 고점 대비 낙폭 %/ }));
    await user.click(ui.getByRole("button", { name: "5%로 설정" }));
    expect(ui.getByText(/고점 대비 낙폭이 5% 초과하면/)).toBeTruthy();

    await user.click(ui.getByRole("button", { name: /＋ RSI 지표/ }));
    await user.clear(ui.getByLabelText("RSI 임계값"));
    await user.type(ui.getByLabelText("RSI 임계값"), "25");
    expect(ui.getByText(/RSI\(14\)가 25 이하일 때/)).toBeTruthy();

    await user.click(ui.getByRole("button", { name: /＋ 시간 조건/ }));
    await user.click(ui.getByRole("button", { name: "토" }));
    expect(ui.getByText(/월·화·수·목·금·토 09:00~18:00에만 실행/)).toBeTruthy();

    await user.click(ui.getByRole("button", { name: /＋ 금액 지정 매수/ }));
    await user.clear(ui.getByLabelText("주문 원화 금액"));
    await user.type(ui.getByLabelText("주문 원화 금액"), "250000");
    expect(ui.getByText("₩250,000 금액 지정 매수")).toBeTruthy();

    await user.click(ui.getByRole("button", { name: /＋ 앱 알림/ }));
    await user.clear(ui.getByLabelText("알림 중복 제한 시간"));
    await user.type(ui.getByLabelText("알림 중복 제한 시간"), "60");
    expect(ui.getByText("앱 알림 · 60분 중복 제한")).toBeTruthy();
  });

  it("전략 마켓에서 플랜과 위험 기준을 확인해 원본 비공개 사용권을 활성화하고 전략을 게시한다", async () => {
    const user = userEvent.setup();
    let current = JSON.parse(JSON.stringify(DEFAULT_MARKETPLACE_SNAPSHOT)) as MarketplaceSnapshot;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const command = JSON.parse(String(init.body)) as { action: string; strategyId?: string; riskLimit?: number; allocation?: number; listing?: { name: string; description: string; category: string; risk: "낮음" | "보통" | "높음"; priceMonthly: number; visibility: "public" | "subscribers" | "signal_only"; conditionSummary: string; blocks: string[] } };
        if (command.action === "subscribe" && command.strategyId) {
          current = { ...current, subscriptions: [{ strategyId:command.strategyId, status:"active", riskLimit:command.riskLimit || 3, allocation:command.allocation || 20, monthlyPrice:0, profitSharePct:10, deliveryMode:"server_execution", sourceAccess:false, createdAt:"2026-07-13" }] };
        }
        if (command.action === "publish" && command.listing) {
          current = { ...current, strategies:[...current.strategies, { id:"market-user-test", creatorName:"정훈", isMine:true, ...command.listing, profitSharePct:10, creatorFeeSplitPct:80, platformFeeSplitPct:20, deliveryMode:"server_execution", sourceAccess:"owner_only", performanceSettlement:"locked", return90d:0, maxDrawdown:0, winRate:0, liveDays:0, tradeCount:0, trustScore:0, verification:"검증 대기", status:"listed", subscribers:0, updatedAt:"2026.07.13" }], creator:{ listedCount:1, activeSubscribers:0, estimatedPerformanceFee:0, estimatedCreatorPayout:0 } };
        }
      }
      return { ok:true, status:200, json:async () => ({ snapshot:current }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Home />);

    await user.click(ui.getByRole("button", { name: "기관 전용 접속" }));
    await user.click(ui.getByRole("button", { name: /구글로 로그인/ }));
    await user.click(ui.getAllByRole("button", { name: "전략 마켓" })[0]);
    expect(await ui.findByRole("heading", { name: "BTC 저변동 적립식" })).toBeTruthy();
    expect(ui.queryByText("BTC 전일 변동폭 0.5배 돌파")).toBeNull();
    await user.click(ui.getAllByRole("button", { name: "검증 정보 보기" })[2]);
    expect(ui.getByText("조건·수치·블록은 구매자 화면과 API에 전송되지 않습니다.")).toBeTruthy();
    await user.click(ui.getByRole("button", { name: "플랜 선택하기" }));
    await user.click(ui.getByRole("button", { name: "프로 선택" }));
    await user.click(ui.getAllByRole("button", { name: "전략 마켓" })[0]);
    await user.click(ui.getAllByRole("button", { name: "검증 정보 보기" })[2]);
    await user.click(ui.getByRole("button", { name: /위험·성과보수 기준을 확인했습니다/ }));
    await user.click(ui.getByRole("button", { name: "모의 사용권 활성화" }));
    expect(await ui.findByText("사용권 활성")).toBeTruthy();
    expect(ui.queryByText("BTC 전일 변동폭 0.5배 돌파")).toBeNull();

    await user.click(ui.getByRole("button", { name: "← 전략 마켓" }));
    await user.click(ui.getByRole("button", { name: "판매자 센터" }));
    await user.click(ui.getByRole("button", { name: "원본 비공개로 검증 요청" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[1]?.body || "").includes('\"action\":\"publish\"'))).toBe(true));
    expect(await ui.findByRole("heading", { name: "ETH 기준가 변동 전략" })).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[1]?.body || "").includes('"action":"subscribe"'))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[1]?.body || "").includes('"action":"publish"'))).toBe(true);
  });
});
