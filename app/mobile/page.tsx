"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_OPERATION_SNAPSHOT,
  type OperationCommandInput,
  type OperationOrder,
  type OperationSnapshot,
  type OrderRunStatus,
} from "../../lib/operations";
import { loadOperationSnapshot, sendOperationCommand } from "../../lib/client/operations-api";
import styles from "./mobile.module.css";

type MobileTab = "home" | "operate" | "orders" | "alerts" | "settings";
type OrderFilter = "all" | "open" | "completed" | "failed";
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const TABS: { id: MobileTab; icon: string; label: string }[] = [
  { id: "home", icon: "01", label: "홈" },
  { id: "operate", icon: "02", label: "운영" },
  { id: "orders", icon: "03", label: "주문" },
  { id: "alerts", icon: "04", label: "알림" },
  { id: "settings", icon: "05", label: "설정" },
];

const ORDER_STATUS_LABEL: Record<OrderRunStatus, string> = {
  queued: "대기",
  submitted: "접수",
  partially_filled: "부분 체결",
  filled: "체결 완료",
  cancelled: "취소",
  failed: "실패",
};

const OPEN_ORDER_STATUS: OrderRunStatus[] = ["queued", "submitted", "partially_filled"];

function money(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₩${Math.abs(value).toLocaleString("ko-KR")}`;
}

function statusClass(status: OrderRunStatus) {
  if (status === "filled") return styles.success;
  if (status === "failed") return styles.danger;
  if (status === "cancelled") return styles.neutral;
  return styles.info;
}

export default function MobileApp() {
  const [tab, setTab] = useState<MobileTab>("home");
  const [snapshot, setSnapshot] = useState<OperationSnapshot>(DEFAULT_OPERATION_SNAPSHOT);
  const [syncState, setSyncState] = useState<"loading" | "synced" | "error">("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all");
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyPhrase, setEmergencyPhrase] = useState("");
  const [cancelOpenOrders, setCancelOpenOrders] = useState(true);
  const [unread, setUnread] = useState(2);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadOperationSnapshot(controller.signal)
      .then((payload) => {
        setSnapshot(payload);
        setSyncState("synced");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSyncState("error");
      });
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    const captureInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", captureInstall);
    return () => window.removeEventListener("beforeinstallprompt", captureInstall);
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const perform = async (input: OperationCommandInput, successMessage: string) => {
    if (syncState !== "synced") {
      showToast("운영 데이터 연결을 먼저 복구해주세요");
      return;
    }
    setBusy(input.action);
    try {
      const payload = await sendOperationCommand(input);
      setSnapshot(payload.snapshot);
      setSyncState("synced");
      showToast(successMessage);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "잠시 후 다시 시도해주세요");
      setSyncState("error");
    } finally {
      setBusy("");
    }
  };

  const openOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setTab("orders");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const switchTab = (next: MobileTab) => {
    setTab(next);
    setSelectedOrderId("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const confirmEmergency = async () => {
    if (emergencyPhrase !== "긴급중단") return;
    await perform({ action: "emergency_stop", cancelOpenOrders }, "모든 모의 전략을 중단했습니다");
    setEmergencyOpen(false);
    setEmergencyPhrase("");
  };

  const installApp = async () => {
    if (!installPrompt) { showToast("브라우저 메뉴에서 ‘홈 화면에 추가’를 선택해주세요"); return; }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") showToast("BlockTrade 앱을 설치했습니다");
    setInstallPrompt(null);
  };

  const selectedOrder = snapshot.orders.find((order) => order.id === selectedOrderId) ?? null;
  const runningCount = snapshot.strategies.filter((strategy) => strategy.status === "running").length;
  const openOrderCount = snapshot.orders.filter((order) => OPEN_ORDER_STATUS.includes(order.status)).length;
  const pnlToday = snapshot.strategies.reduce((sum, strategy) => sum + strategy.pnlToday, 0);

  return <main className={`${styles.appShell} mobile-institutional`}>
    <header className={`${styles.appHeader} mobile-institutional-header`}>
      <Link className={styles.brand} href="/mobile" aria-label="BlockTrade 앱 홈"><span>BT</span><strong>BlockTrade <small>통제</small></strong></Link>
      <div className={styles.headerStatus}><b>모의 운용 동반 앱</b><i className={syncState === "synced" ? styles.liveDot : styles.waitDot} /><span>{syncState === "synced" ? "동기화됨" : syncState === "loading" ? "연결 중" : "연결 실패"}</span></div>
    </header>
    <section className={styles.appContent}>
      {syncState !== "synced" ? <SyncPanel state={syncState} retry={() => { setSyncState("loading"); setReloadToken((value) => value + 1); }} /> : <>
        {tab === "home" && <HomeTab snapshot={snapshot} runningCount={runningCount} openOrderCount={openOrderCount} pnlToday={pnlToday} go={switchTab} openOrder={openOrder} />}
        {tab === "operate" && <OperateTab snapshot={snapshot} busy={busy} onCommand={perform} openOrder={openOrder} openEmergency={() => setEmergencyOpen(true)} />}
        {tab === "orders" && (selectedOrder ? <OrderDetail order={selectedOrder} busy={busy} goBack={() => setSelectedOrderId("")} onCommand={perform} /> : <OrdersTab orders={snapshot.orders} filter={orderFilter} setFilter={setOrderFilter} openOrder={openOrder} />)}
        {tab === "alerts" && <AlertsTab snapshot={snapshot} unread={unread} markRead={() => setUnread(0)} openOrder={openOrder} notify={showToast} />}
        {tab === "settings" && <SettingsTab installApp={installApp} />}
      </>}
    </section>
    <nav className={styles.bottomNav} aria-label="앱 주요 메뉴">
      {TABS.map((item) => <button type="button" key={item.id} className={tab === item.id ? styles.activeTab : ""} onClick={() => switchTab(item.id)} aria-current={tab === item.id ? "page" : undefined}><span>{item.icon}</span><strong>{item.label}</strong>{item.id === "alerts" && unread > 0 && <i>{unread}</i>}</button>)}
    </nav>
    {emergencyOpen && <div className={styles.modalBackdrop} role="presentation"><section className={styles.emergencyModal} role="dialog" aria-modal="true" aria-labelledby="mobile-emergency-title"><header><span>중단</span><div><small>안전 제어</small><h2 id="mobile-emergency-title">모의 운영 상태 중단</h2></div></header><p>앱과 웹에 저장된 모든 데모 전략의 새 상태 생성을 중단합니다.</p><button type="button" className={styles.optionButton} aria-pressed={cancelOpenOrders} onClick={() => setCancelOpenOrders((value) => !value)}><i>{cancelOpenOrders ? "선택" : ""}</i><span><strong>모의 미체결 상태도 취소 처리</strong><small>실제 거래소에는 취소 요청을 보내지 않습니다.</small></span></button><label>확인을 위해 <b>긴급중단</b>을 입력하세요<input autoFocus value={emergencyPhrase} onChange={(event) => setEmergencyPhrase(event.target.value)} placeholder="긴급중단" /></label><div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={() => { setEmergencyOpen(false); setEmergencyPhrase(""); }}>돌아가기</button><button type="button" className={styles.dangerButton} disabled={emergencyPhrase !== "긴급중단" || busy !== ""} onClick={confirmEmergency}>모든 데모 상태 중단</button></div></section></div>}
    {toast && <div className={styles.toast} role="status"><span>완료</span>{toast}</div>}
  </main>;
}

function SectionTitle({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <header className={styles.sectionTitle}><div><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

function SyncPanel({ state, retry }: { state: "loading" | "error"; retry: () => void }) {
  return <section className={styles.syncPanel} role={state === "error" ? "alert" : "status"}><i>{state === "loading" ? "대기" : "오류"}</i><h1>{state === "loading" ? "운영 데이터를 확인하고 있어요" : "운영 데이터를 불러오지 못했어요"}</h1><p>{state === "loading" ? "확인 전에는 예시 수치와 제어 버튼을 표시하지 않습니다." : "오래된 데모 데이터를 실제 상태처럼 보여주지 않도록 화면을 잠갔습니다."}</p>{state === "error" && <button type="button" className={styles.fullPrimaryButton} onClick={retry}>다시 연결</button>}</section>;
}

function HomeTab({ snapshot, runningCount, openOrderCount, pnlToday, go, openOrder }: { snapshot: OperationSnapshot; runningCount: number; openOrderCount: number; pnlToday: number; go: (tab: MobileTab) => void; openOrder: (id: string) => void }) {
  const latestOrder = snapshot.orders[0];
  return <><SectionTitle title="펀드 통제" description="승인·위험·주문 상태를 확인하는 모의 운용 동반 앱" action={<span className={styles.paperBadge}>모의운용 잠금</span>} />
    <article className={`${styles.assetHero} mobile-fund-hero`}><small>예시 순자산가치</small><h2>₩48.2억</h2><div><span>일일 손익 <b>{money(pnlToday)}</b></span><span>총 익스포저 <b>62.4%</b></span></div><div className={styles.heroChart}><i /><i /><i /><i /><i /><i /><i /></div><footer><i /> 위험검사 활성</footer></article>
    <section className={`${styles.quickGrid} mobile-control-grid`}><button type="button" onClick={() => go("operate")}><i className={styles.blueIcon}>02</i><span><small>승인 대기 · 전략 {runningCount}</small><strong>2건</strong></span><b>›</b></button><button type="button" onClick={() => go("orders")}><i className={styles.blueIcon}>03</i><span><small>대사 예외 · 주문 {openOrderCount}</small><strong>1건</strong></span><b>›</b></button></section>
    <section className="mobile-risk-card"><header><div><h2>리스크 한도 사용률</h2><p>승인 한도 대비 현재 사용량</p></div><span>경고 3건</span></header>{[["총 익스포저","62.4%","80%"],["일일 손실",`${snapshot.settings.currentLoss}%`,`${snapshot.settings.dailyLossLimit}%`],["거래소 집중도","58.0%","65%"]].map((item,index) => <div key={item[0]}><span>{item[0]}</span><b>{item[1]} <small>/ {item[2]}</small></b><i><b className={index === 2 ? "warning" : ""} style={{width:index === 0 ? "78%" : index === 1 ? "23%" : "89%"}} /></i></div>)}</section>
    <section className={styles.mobilePanel}><header><div><h2>승인 전략 상태</h2><p>웹 기관 콘솔과 공유되는 모의 운영 상태</p></div><button type="button" onClick={() => go("operate")}>전체 보기</button></header><div className={styles.strategyList}>{snapshot.strategies.slice(0, 3).map((strategy) => <article key={strategy.id}><i className={`${styles.strategyDot} ${strategy.status === "running" ? styles.running : strategy.status === "paused" ? styles.paused : styles.stopped}`} /><div><strong>{strategy.name}</strong><small>{strategy.market} · {strategy.lastSignalAt}</small></div><span className={strategy.pnlToday >= 0 ? styles.greenText : styles.redText}>{money(strategy.pnlToday)}</span></article>)}</div></section>
    {latestOrder && <section className={styles.mobilePanel}><header><div><h2>최근 모의 주문</h2><p>거래소 체결이 아닌 모의 주문 상태</p></div><span className="mobile-paper-label">모의</span></header><button type="button" className={styles.latestOrder} onClick={() => openOrder(latestOrder.id)}><div><strong>{latestOrder.market}</strong><small>{latestOrder.strategyName}</small></div><span className={`${styles.statusBadge} ${statusClass(latestOrder.status)}`}>{ORDER_STATUS_LABEL[latestOrder.status]}</span><b>›</b></button></section>}
    <section className="mobile-live-lock"><i>잠금</i><div><strong>실거래 실행 잠금</strong><p>승인·보안 저장소·섀도 운영·대사 통제가 충족되지 않았습니다.</p></div><span>3 / 10</span></section></>;
}

function OperateTab({ snapshot, busy, onCommand, openOrder, openEmergency }: { snapshot: OperationSnapshot; busy: string; onCommand: (input: OperationCommandInput, message: string) => Promise<void>; openOrder: (id: string) => void; openEmergency: () => void }) {
  const openOrderItem = snapshot.orders.find((order) => OPEN_ORDER_STATUS.includes(order.status));
  return <><SectionTitle title="모의 운영" description="서버에 저장된 데모 전략 상태를 제어합니다" action={<button type="button" className={styles.emergencyButton} onClick={openEmergency}>데모 상태 중단</button>} /><article className={`${styles.healthCard} ${snapshot.settings.emergencyStatus === "stopped" ? styles.healthStopped : ""}`}><div><i /><span><strong>{snapshot.settings.emergencyStatus === "normal" ? "모의 운영 정상" : "데모 상태 중단"}</strong><small>{snapshot.settings.exchangeStatus === "connected" ? "실제 거래소 주문 없음 · 데모 상태" : "실제 거래소 주문 없음 · 데모 상태"}</small></span></div><dl><div><dt>일일 손실</dt><dd>{snapshot.settings.currentLoss}%</dd></div><div><dt>손실 한도</dt><dd>{snapshot.settings.dailyLossLimit}%</dd></div></dl><div className={styles.limitBar}><i style={{ width: `${Math.min(100, snapshot.settings.currentLoss / snapshot.settings.dailyLossLimit * 100)}%` }} /></div></article><section className={styles.mobilePanel}><header><div><h2>전략 제어</h2><p>정지 상태는 웹에도 바로 반영됩니다</p></div></header><div className={styles.controlList}>{snapshot.strategies.map((strategy) => <article className={styles.controlCard} key={strategy.id}><div className={styles.controlHeader}><span><i className={`${styles.strategyDot} ${strategy.status === "running" ? styles.running : strategy.status === "paused" ? styles.paused : styles.stopped}`} />{strategy.status === "running" ? "실행 중" : strategy.status === "paused" ? "일시정지" : "중단"}</span><small>위험 {strategy.risk}</small></div><h3>{strategy.name}</h3><p>{strategy.market} · 최근 신호 {strategy.lastSignalAt}</p><div className={styles.controlMetrics}><span>오늘 손익 <b className={strategy.pnlToday >= 0 ? styles.greenText : styles.redText}>{money(strategy.pnlToday)}</b></span><span>노출 <b>{strategy.exposure}</b></span></div><div className={styles.cardActions}>{strategy.status === "running" ? <button type="button" className={styles.pauseButton} disabled={busy !== ""} onClick={() => onCommand({ action: "pause_strategy", strategyId: strategy.id }, `${strategy.name}을 일시정지했습니다`)}>일시정지</button> : strategy.status === "paused" ? <button type="button" className={styles.resumeButton} disabled={busy !== ""} onClick={() => onCommand({ action: "resume_strategy", strategyId: strategy.id }, `${strategy.name}을 재개했습니다`)}>전략 재개</button> : <button type="button" className={styles.secondaryButton} disabled>중단됨</button>}<button type="button" className={styles.secondaryButton} onClick={() => { const order = snapshot.orders.find((item) => item.strategyId === strategy.id); if (order) openOrder(order.id); }}>주문 보기</button></div></article>)}</div></section>{openOrderItem && <section className={styles.mobilePanel}><header><div><h2>진행 중 주문</h2><p>서버의 데모 상태를 표시합니다</p></div></header><button type="button" className={styles.activeOrderCard} onClick={() => openOrder(openOrderItem.id)}><div><strong>{openOrderItem.market} · {openOrderItem.side === "buy" ? "매수" : "매도"}</strong><small>{openOrderItem.strategyName}</small></div><span>{openOrderItem.filledRatio}%</span><div className={styles.progress}><i style={{ width: `${openOrderItem.filledRatio}%` }} /></div><b>상세 추적 ›</b></button></section>}</>;
}

function OrdersTab({ orders, filter, setFilter, openOrder }: { orders: OperationOrder[]; filter: OrderFilter; setFilter: (filter: OrderFilter) => void; openOrder: (id: string) => void }) {
  const filtered = useMemo(() => orders.filter((order) => { if (filter === "open") return OPEN_ORDER_STATUS.includes(order.status); if (filter === "completed") return ["filled", "cancelled"].includes(order.status); if (filter === "failed") return order.status === "failed"; return true; }), [filter, orders]);
  return <><SectionTitle title="주문" description="주문 접수부터 최종 체결까지 추적합니다" /><div className={styles.filterTabs}>{([['all','전체'],['open','진행 중'],['completed','완료'],['failed','실패']] as [OrderFilter,string][]).map(([id, label]) => <button type="button" key={id} className={filter === id ? styles.filterActive : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><section className={styles.orderList}>{filtered.map((order) => <button type="button" key={order.id} onClick={() => openOrder(order.id)}><div className={styles.orderTop}><span className={order.side === "buy" ? styles.buyBadge : styles.sellBadge}>{order.side === "buy" ? "매수" : "매도"}</span><strong>{order.market}</strong><small>{order.createdAt}</small></div><p>{order.strategyName}</p><div className={styles.orderBottom}><span>{order.amount} · {order.price}</span><b className={`${styles.statusBadge} ${statusClass(order.status)}`}>{ORDER_STATUS_LABEL[order.status]}</b></div>{OPEN_ORDER_STATUS.includes(order.status) && <div className={styles.progress}><i style={{ width: `${order.filledRatio}%` }} /></div>}</button>)}</section>{filtered.length === 0 && <div className={styles.emptyState}><span>없음</span><strong>해당 주문이 없습니다</strong><p>다른 상태 필터를 선택해보세요.</p></div>}</>;
}

function OrderDetail({ order, busy, goBack, onCommand }: { order: OperationOrder; busy: string; goBack: () => void; onCommand: (input: OperationCommandInput, message: string) => Promise<void> }) {
  const canCancel = OPEN_ORDER_STATUS.includes(order.status);
  return <><button type="button" className={styles.backButton} onClick={goBack}>← 주문 목록</button><SectionTitle title="주문 상태 추적" description={`${order.id} · ${order.market}`} /><article className={styles.orderHero}><div><span className={order.side === "buy" ? styles.buyBadge : styles.sellBadge}>{order.side === "buy" ? "매수" : "매도"}</span><strong>{order.market}</strong></div><h2>{order.amount}</h2><p>{order.strategyName}</p><span className={`${styles.statusBadge} ${statusClass(order.status)}`}>{ORDER_STATUS_LABEL[order.status]}</span></article><section className={styles.mobilePanel}><header><div><h2>처리 단계</h2><p>서버에 저장된 모의 상태를 표시합니다</p></div></header><div className={styles.orderTimeline}>{["전략 신호", "거래소 접수", order.status === "failed" ? "주문 실패" : "체결 진행", "최종 완료"].map((label, index) => { const complete = order.status === "filled" || index < (order.filledRatio > 0 ? 3 : OPEN_ORDER_STATUS.includes(order.status) ? 2 : 1); return <div key={label} className={complete ? styles.timelineComplete : ""}><i>{index + 1}</i><span><strong>{label}</strong><small>{index === 0 ? order.createdAt : index === 1 ? "모의 주문 식별자" : index === 2 ? `${order.filledRatio}% 처리` : "대기 중"}</small></span></div>; })}</div></section><section className={styles.mobilePanel}><header><div><h2>주문 정보</h2></div></header><dl className={styles.orderInfo}><div><dt>주문 방식</dt><dd>{order.orderType === "market" ? "시장가" : "지정가"}</dd></div><div><dt>주문 가격</dt><dd>{order.price}</dd></div><div><dt>체결률</dt><dd>{order.filledRatio}%</dd></div><div><dt>마지막 갱신</dt><dd>{order.updatedAt}</dd></div></dl>{order.failureReason && <p className={styles.errorNote}>{order.failureReason}</p>}</section>{canCancel && <button type="button" className={styles.fullDangerButton} disabled={busy !== ""} onClick={() => onCommand({ action: "cancel_order", orderId: order.id }, "미체결 잔량을 취소 처리했습니다")}>데모 취소 처리</button>}{order.status === "failed" && <button type="button" className={styles.fullPrimaryButton} disabled={busy !== ""} onClick={() => onCommand({ action: "retry_order", orderId: order.id }, "데모 상태를 재확인합니다")}>상태 다시 확인</button>}</>;
}

function AlertsTab({ snapshot, unread, markRead, openOrder, notify }: { snapshot: OperationSnapshot; unread: number; markRead: () => void; openOrder: (id: string) => void; notify: (message: string) => void }) {
  return <><SectionTitle title="알림" description="주문·전략·보안 상태를 알려드립니다" action={unread > 0 ? <button type="button" className={styles.textButton} onClick={markRead}>모두 읽음</button> : undefined} /><section className={styles.alertList}>{snapshot.events.map((event, index) => <button type="button" key={event.id} className={index < unread ? styles.unreadAlert : ""} onClick={() => { if (event.orderId) openOrder(event.orderId); else notify("알림 내용을 확인했습니다"); }}><i className={event.severity === "critical" ? styles.criticalAlert : event.severity === "warning" ? styles.warningAlert : styles.normalAlert}>{event.severity === "critical" ? "중단" : event.severity === "warning" ? "주의" : "정상"}</i><div><span><strong>{event.eventType === "emergency_stop" ? "긴급 중단" : event.eventType.includes("order") ? "주문 상태" : "전략 알림"}</strong><time>{event.createdAt}</time></span><p>{event.message}</p>{event.orderId && <small>주문 상세 보기 ›</small>}</div></button>)}</section></>;
}

function SettingsTab({ installApp }: { installApp: () => Promise<void> }) {
  return <><SectionTitle title="설정" description="설치형 웹앱의 제공 범위와 연결 상태를 확인합니다" /><section className={styles.profileCard}><i>정</i><div><strong>정훈</strong><span>인증 없는 데모 프로필</span></div><Link href="/">웹 서비스 열기</Link></section><section className={styles.settingGroup}><h2>앱 기능 준비 상태</h2><button type="button" disabled aria-disabled="true"><span><strong>푸시 알림</strong><small>실제 앱 알림 연동 후 제공</small></span><i className={styles.switch}><b /></i></button><button type="button" disabled aria-disabled="true"><span><strong>생체 인증 잠금</strong><small>네이티브 인증 연동 후 제공</small></span><i className={styles.switch}><b /></i></button></section><section className={styles.settingGroup}><h2>연결 상태</h2><article><span><strong>운영 모드</strong><small>실제 주문이 없는 안전한 환경</small></span><b className={styles.paperBadge}>모의 운영</b></article><article><span><strong>거래소 연결</strong><small>현재 사용자별 키 저장소 미연결</small></span><b className={styles.redText}>미연결</b></article></section><button type="button" className={styles.installCard} onClick={installApp}><i>BT</i><span><strong>BlockTrade 설치형 웹앱</strong><small>홈 화면에서 앱 형태로 실행하세요</small></span><b>설치 ›</b></button><p className={styles.securityNote}>현재 화면은 네이티브 iOS·Android 앱이 아닌 설치형 웹앱입니다. 민감한 API 키와 비밀번호는 저장하지 않습니다.</p></>;
}
