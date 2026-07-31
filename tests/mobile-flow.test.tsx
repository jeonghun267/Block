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

    expect(await ui.findByText("동기화됨")).toBeTruthy();
    await user.click(ui.getByRole("button", { name: "02 운영" }));
    expect(ui.getByRole("heading", { name: "모의 운영" })).toBeTruthy();
    await user.click(ui.getAllByRole("button", { name: "일시정지" })[0]);
    expect((await ui.findAllByRole("button", { name: "전략 재개" })).length).toBeGreaterThanOrEqual(2);

    await user.click(ui.getByRole("button", { name: "03 주문" }));
    await user.click(ui.getAllByRole("button", { name: /BTC\/KRW.*DCA 비트코인 적립/ })[0]);
    expect(ui.getByRole("heading", { name: "주문 상태 추적" })).toBeTruthy();
  });

  it("긴급 중단은 확인 문구 전에는 실행되지 않고 앱 설치 안내를 제공한다", async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await ui.findByText("동기화됨");

    await user.click(ui.getByRole("button", { name: "02 운영" }));
    await user.click(ui.getByRole("button", { name: "데모 상태 중단" }));
    const stopButton = ui.getByRole("button", { name: "모든 데모 상태 중단" });
    expect((stopButton as HTMLButtonElement).disabled).toBe(true);
    await user.type(ui.getByPlaceholderText("긴급중단"), "긴급중단");
    expect((stopButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(ui.getByRole("button", { name: "돌아가기" }));

    await user.click(ui.getByRole("button", { name: "05 설정" }));
    await user.click(ui.getByRole("button", { name: /BlockTrade 설치형 웹앱/ }));
    expect(ui.getByRole("status").textContent).toContain("홈 화면에 추가");
  });

  it("운영 API가 실패하면 오래된 예시 수치와 제어 버튼을 숨긴다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    render(<MobileApp />);

    expect((await ui.findByRole("alert")).textContent).toContain("운영 데이터를 불러오지 못했어요");
    expect(ui.queryByText("DCA 비트코인 적립")).toBeNull();
    expect(ui.getByRole("button", { name: "다시 연결" })).toBeTruthy();
  });
});
