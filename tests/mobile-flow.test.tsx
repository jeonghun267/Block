// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen as ui } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MobileApp from "../app/mobile/page";
import { DEFAULT_OPERATION_SNAPSHOT, type OperationSnapshot } from "../lib/operations";

function response(snapshot: OperationSnapshot) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ snapshot }),
  } as Response);
}

describe("BlockTrade 연동 앱 흐름", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("blocktrade.app.session", "1");
    window.scrollTo = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => response(DEFAULT_OPERATION_SNAPSHOT)));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("웹 운영 데이터를 불러와 전략을 일시정지하고 주문 상세를 연다", async () => {
    const paused: OperationSnapshot = {
      ...DEFAULT_OPERATION_SNAPSHOT,
      strategies: DEFAULT_OPERATION_SNAPSHOT.strategies.map((strategy, index) => index === 0 ? { ...strategy, status: "paused" as const } : strategy),
    };
    const fetchMock = vi.fn((request: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return response(paused);
      return response(DEFAULT_OPERATION_SNAPSHOT);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MobileApp />);

    expect(await ui.findByText("동기화됨", {}, { timeout: 3000 })).toBeTruthy();
    await user.click(ui.getByRole("button", { name: "운영" }));
    expect(ui.getByRole("heading", { name: "모의 운영" })).toBeTruthy();
    await user.click(ui.getAllByRole("button", { name: "일시정지" })[0]);
    expect((await ui.findAllByRole("button", { name: "전략 재개" })).length).toBeGreaterThanOrEqual(2);

    await user.click(ui.getByRole("button", { name: "주문" }));
    await user.click(ui.getAllByRole("button", { name: /BTC\/KRW.*DCA 비트코인 적립/ })[0]);
    expect(ui.getByRole("heading", { name: "주문 상태 추적" })).toBeTruthy();
  });

  it("긴급 중단은 확인 문구 전에는 실행되지 않고 앱 설치 안내를 제공한다", async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await ui.findByText("동기화됨", {}, { timeout: 3000 });

    await user.click(ui.getByRole("button", { name: "운영" }));
    await user.click(ui.getByRole("button", { name: "데모 상태 중단" }));
    const stopButton = ui.getByRole("button", { name: "모든 데모 상태 중단" });
    expect((stopButton as HTMLButtonElement).disabled).toBe(true);
    await user.type(ui.getByPlaceholderText("긴급중단"), "긴급중단");
    expect((stopButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(ui.getByRole("button", { name: "돌아가기" }));

    await user.click(ui.getByRole("button", { name: "설정" }));
    await user.click(ui.getByRole("button", { name: /BlockTrade 설치형 웹앱/ }));
    expect(ui.getByRole("status").textContent).toContain("홈 화면에 추가");
  });

  it("처음 실행하면 스플래시 뒤 로그인에서 약관·회원가입·본인 인증·위험 고지 순서로 가입한다", async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    render(<MobileApp />);

    expect(ui.getByRole("status", { name: "BlockTrade 앱 시작 중" })).toBeTruthy();
    expect(await ui.findByRole("heading", { name: "기관 계정으로 로그인" }, { timeout: 3000 })).toBeTruthy();
    await user.click(ui.getByRole("button", { name: /가입하기/ }));

    expect(ui.getByRole("heading", { name: "약관에 동의해주세요" })).toBeTruthy();
    expect(ui.queryByText(/\[필수\] 투자 위험 고지/)).toBeNull();
    expect((ui.getByRole("button", { name: "동의하고 계속" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(ui.getByRole("button", { name: "전체 동의 (선택 항목 포함)" }));
    await user.click(ui.getByRole("button", { name: "동의하고 계속" }));

    expect(ui.getByRole("heading", { name: "계정 만들기" })).toBeTruthy();
    await user.type(ui.getByLabelText("닉네임"), "정훈");
    await user.type(ui.getByLabelText("이메일"), "ops@blocktrade.kr");
    await user.type(ui.getByLabelText("비밀번호"), "secure123");
    await user.type(ui.getByLabelText("비밀번호 확인"), "secure123");
    await user.click(ui.getByRole("button", { name: "다음" }));

    expect(ui.getByRole("heading", { name: "본인 인증" })).toBeTruthy();
    await user.type(ui.getByLabelText("성명"), "오정훈");
    await user.type(ui.getByLabelText("생년월일"), "19990101");
    await user.type(ui.getByLabelText("휴대폰 번호"), "01012345678");
    await user.click(ui.getByRole("button", { name: "인증번호 받기" }));
    await user.type(ui.getByLabelText("인증번호"), "123456");
    await user.click(ui.getByRole("button", { name: "인증 완료" }));

    expect(ui.getByRole("heading", { name: "투자 손실 가능성 고지" })).toBeTruthy();
    const start = ui.getByRole("button", { name: "확인하고 시작하기" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await user.click(ui.getByRole("button", { name: "위 내용을 모두 이해했습니다" }));
    await user.type(ui.getByLabelText("위험 고지 확인 문구"), "이해했습니다");
    await user.click(start);

    expect(await ui.findByText("동기화됨")).toBeTruthy();
    expect(window.localStorage.getItem("blocktrade.app.session")).toBe("1");
    await user.click(ui.getByRole("button", { name: "설정" }));
    await user.click(ui.getByRole("button", { name: "앱 로그아웃" }));
    expect(ui.getByRole("heading", { name: "기관 계정으로 로그인" })).toBeTruthy();
    expect(window.localStorage.getItem("blocktrade.app.session")).toBeNull();
  });

  it("운영 API가 실패하면 오래된 예시 수치와 제어 버튼을 숨긴다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    render(<MobileApp />);

    expect((await ui.findByRole("alert", {}, { timeout: 3000 })).textContent).toContain("운영 데이터를 불러오지 못했어요");
    expect(ui.queryByText("DCA 비트코인 적립")).toBeNull();
    expect(ui.getByRole("button", { name: "다시 연결" })).toBeTruthy();
  });
});
