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
import { AppOnboarding, type AppStage } from "./onboarding";
import { Icon, type IconName } from "../icons";
import { useCountUp } from "../count-up";

type MobileTab = "home" | "operate" | "orders" | "alerts" | "settings";
type OrderFilter = "all" | "open" | "completed" | "failed";
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const TABS: { id: MobileTab; icon: IconName; label: string }[] = [
  { id: "home", icon: "home", label: "홈" },
  { id: "operate", icon: "activity", label: "운영" },
  { id: "orders", icon: "receipt", label: "주문" },
  { id: "alerts", icon: "bell", label: "알림" },
  { id: "settings", icon: "settings", label: "설정" },
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
const SPLASH_MS = 1200;
const SESSION_KEY = "blocktrade.app.session";

function readSession() {
  try { return window.localStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
}

function writeSession(active: boolean) {
  try {
    if (active) window.localStorage.setItem(SESSION_KEY, "1");
    else window.localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable: the session lasts for this visit only */ }
}

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
  const [stage, setStage] = useState<AppStage | "app">("splash");
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
    const timer = window.setTimeout(() => setStage(readSession() ? "app" : "login"), SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, []);

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

  const closeEmergency = () => {
    setEmergencyOpen(false);
    setEmergencyPhrase("");
  };

  const confirmEmergency = async () => {
    if (emergencyPhrase !== "긴급중단") return;
    await perform({ action: "emergency_stop", cancelOpenOrders }, "모든 모의 전략을 중단했습니다");
    closeEmergency();
  };

  const installApp = async () => {
    if (!installPrompt) { showToast("브라우저 메뉴에서 ‘홈 화면에 추가’를 선택해주세요"); return; }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") showToast("BlockTrade 앱을 설치했습니다");
    setInstallPrompt(null);
  };

  const goStage = (next: AppStage) => {
    setStage(next);
    window.scrollTo({ top: 0 });
  };

  const completeOnboarding = (message: string) => {
    writeSession(true);
    setTab("home");
    setSelectedOrderId("");
    setStage("app");
    showToast(message);
  };

  const logout = () => {
    writeSession(false);
    setStage("login");
  };

  const selectedOrder = snapshot.orders.find((order) => order.id === selectedOrderId) ?? null;
  const runningCount = snapshot.strategies.filter((strategy) => strategy.status === "running").length;
  const openOrderCount = snapshot.orders.filter((order) => OPEN_ORDER_STATUS.includes(order.status)).length;
  const pnlToday = snapshot.strategies.reduce((sum, strategy) => sum + strategy.pnlToday, 0);
  const toastView = toast && <div className={styles.toast} role="status"><Icon name="check" size={16} />{toast}</div>;

  if (stage !== "app") return <><AppOnboarding stage={stage} go={goStage} complete={completeOnboarding} notify={showToast} />{toastView}</>;

  return <main className={styles.appShell}>
    <header className={styles.appHeader}>
      <Link className={styles.brand} href="/mobile" aria-label="BlockTrade 앱 홈"><span>BT</span><strong>BlockTrade</strong></Link>
      <span className={`${styles.syncPill} ${syncState === "synced" ? styles.syncOk : styles.syncWait}`}><i />{syncState === "synced" ? "동기화됨" : syncState === "loading" ? "연결 중" : "연결 실패"}</span>
    </header>
    <section className={styles.appContent} key={`${tab}-${selectedOrderId}`}>
      {syncState !== "synced" ? <SyncPanel state={syncState} retry={() => { setSyncState("loading"); setReloadToken((value) => value + 1); }} /> : <>
        {tab === "home" && <HomeTab snapshot={snapshot} runningCount={runningCount} openOrderCount={openOrderCount} pnlToday={pnlToday} go={switchTab} openOrder={openOrder} />}
        {tab === "operate" && <OperateTab snapshot={snapshot} busy={busy} onCommand={perform} openOrder={openOrder} openEmergency={() => setEmergencyOpen(true)} />}
        {tab === "orders" && (selectedOrder ? <OrderDetail order={selectedOrder} busy={busy} goBack={() => setSelectedOrderId("")} onCommand={perform} /> : <OrdersTab orders={snapshot.orders} filter={orderFilter} setFilter={setOrderFilter} openOrder={openOrder} />)}
        {tab === "alerts" && <AlertsTab snapshot={snapshot} unread={unread} markRead={() => setUnread(0)} openOrder={openOrder} notify={showToast} />}
        {tab === "settings" && <SettingsTab installApp={installApp} logout={logout} />}
      </>}
    </section>
    <nav className={styles.bottomNav} aria-label="앱 주요 메뉴">
      {TABS.map((item) => <button type="button" key={item.id} className={tab === item.id ? styles.activeTab : ""} onClick={() => switchTab(item.id)} aria-current={tab === item.id ? "page" : undefined}><span className={styles.navIcon}><Icon name={item.icon} /></span><strong>{item.label}</strong>{item.id === "alerts" && unread > 0 && <em aria-label={`읽지 않은 알림 ${unread}개`}>{unread}</em>}</button>)}
    </nav>
    {emergencyOpen && <div className={styles.sheetBackdrop} role="presentation">
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="mobile-emergency-title">
        <i className={styles.grabber} aria-hidden="true" />
        <header><span className={styles.sheetIcon}><Icon name="power" /></span><div><small>안전 제어</small><h2 id="mobile-emergency-title">모의 운영 상태 중단</h2></div></header>
        <p>앱과 웹에 저장된 모든 데모 전략의 새 상태 생성을 중단합니다.</p>
        <button type="button" className={styles.optionRow} aria-pressed={cancelOpenOrders} onClick={() => setCancelOpenOrders((value) => !value)}><span><strong>모의 미체결 상태도 취소 처리</strong><small>실제 거래소에는 취소 요청을 보내지 않습니다.</small></span><i className={cancelOpenOrders ? `${styles.switch} ${styles.switchOn}` : styles.switch}><b /></i></button>
        <label className={styles.sheetField}>확인을 위해 <b>긴급중단</b>을 입력하세요<input autoFocus value={emergencyPhrase} onChange={(event) => setEmergencyPhrase(event.target.value)} placeholder="긴급중단" /></label>
        <div className={styles.sheetActions}><button type="button" className={styles.secondaryButton} onClick={closeEmergency}>돌아가기</button><button type="button" className={styles.dangerButton} disabled={emergencyPhrase !== "긴급중단" || busy !== ""} onClick={confirmEmergency}>모든 데모 상태 중단</button></div>
      </section>
    </div>}
    {toastView}
  </main>;
}

function SectionTitle({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <header className={styles.sectionTitle}><div><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

function SyncPanel({ state, retry }: { state: "loading" | "error"; retry: () => void }) {
  return <section className={styles.syncPanel} role={state === "error" ? "alert" : "status"}>
    <span className={state === "error" ? `${styles.syncIcon} ${styles.syncIconError}` : styles.syncIcon}><Icon name={state === "loading" ? "refresh" : "wifiOff"} size={26} /></span>
    <h1>{state === "loading" ? "운영 데이터를 확인하고 있어요" : "운영 데이터를 불러오지 못했어요"}</h1>
    <p>{state === "loading" ? "확인 전에는 예시 수치와 제어 버튼을 표시하지 않습니다." : "오래된 데모 데이터를 실제 상태처럼 보여주지 않도록 화면을 잠갔습니다."}</p>
    {state === "error" && <button type="button" className={styles.primaryButton} onClick={retry}><Icon name="refresh" size={18} />다시 연결</button>}
  </section>;
}

function StateIcon({ status }: { status: "running" | "paused" | "stopped" }) {
  return <span className={`${styles.stateIcon} ${styles[status]}`}><Icon name={status === "running" ? "activity" : status === "paused" ? "pause" : "power"} size={18} /></span>;
}

function HomeTab({ snapshot, runningCount, openOrderCount, pnlToday, go, openOrder }: { snapshot: OperationSnapshot; runningCount: number; openOrderCount: number; pnlToday: number; go: (tab: MobileTab) => void; openOrder: (id: string) => void }) {
  const latestOrder = snapshot.orders[0];
  const nav = useCountUp(48.2);
  const pnl = useCountUp(pnlToday);
  const exposure = useCountUp(62.4);
  const meters = [["총 익스포저", "62.4%", "80%", 78, false], ["일일 손실", `${snapshot.settings.currentLoss}%`, `${snapshot.settings.dailyLossLimit}%`, Math.min(100, snapshot.settings.currentLoss / snapshot.settings.dailyLossLimit * 100), false], ["거래소 집중도", "58.0%", "65%", 89, true]] as const;
  return <>
    <SectionTitle title="펀드 통제" description="승인·위험·주문 상태를 한눈에 확인합니다" action={<span className={styles.paperBadge}><Icon name="lock" size={14} />모의 운용</span>} />
    <article className={styles.hero}>
      <header><small>예시 순자산가치</small><span className={styles.heroBadge}><i />위험검사 활성</span></header>
      <h2>₩{nav.toFixed(1)}억</h2>
      <div className={styles.heroStats}><span><small>일일 손익</small><b>{money(Math.round(pnl))}</b></span><span><small>총 익스포저</small><b>{exposure.toFixed(1)}%</b></span></div>
      <svg className={styles.heroSpark} viewBox="0 0 160 48" aria-hidden="true"><defs><linearGradient id="spark" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#60a5fa" stopOpacity=".45" /><stop offset="1" stopColor="#60a5fa" stopOpacity="0" /></linearGradient></defs><path d="M0 40 C18 36 24 30 40 32 S64 18 80 22 S104 8 120 12 S146 4 160 2 V48 H0 Z" fill="url(#spark)" /><path d="M0 40 C18 36 24 30 40 32 S64 18 80 22 S104 8 120 12 S146 4 160 2" fill="none" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" /></svg>
    </article>
    <section className={styles.quickGrid}>
      <button type="button" onClick={() => go("operate")}><span className={styles.iconBubble}><Icon name="clipboard" /></span><span><small>승인 대기</small><strong>2건</strong><em>실행 전략 {runningCount}개</em></span><Icon name="chevronRight" size={18} /></button>
      <button type="button" onClick={() => go("orders")}><span className={styles.iconBubble}><Icon name="scale" /></span><span><small>대사 예외</small><strong>1건</strong><em>진행 주문 {openOrderCount}건</em></span><Icon name="chevronRight" size={18} /></button>
    </section>
    <section className={styles.card}>
      <header className={styles.cardHeader}><div><h2>리스크 한도 사용률</h2><p>승인 한도 대비 현재 사용량</p></div><span className={`${styles.chip} ${styles.chipAmber}`}>경고 3건</span></header>
      {meters.map(([label, value, limit, width, warning]) => <div className={styles.meterRow} key={label}><div><span>{label}</span><b>{value} <small>/ {limit}</small></b></div><i className={styles.meter}><b className={warning ? styles.meterWarn : ""} style={{ width: `${width}%` }} /></i></div>)}
    </section>
    <section className={styles.card}>
      <header className={styles.cardHeader}><div><h2>승인 전략 상태</h2><p>웹 기관 콘솔과 공유되는 모의 운영 상태</p></div><button type="button" className={styles.textButton} onClick={() => go("operate")}>전체 보기</button></header>
      <div className={styles.rowList}>{snapshot.strategies.slice(0, 3).map((strategy) => <article key={strategy.id} className={styles.strategyRow}><StateIcon status={strategy.status} /><div><strong>{strategy.name}</strong><small>{strategy.market} · {strategy.lastSignalAt}</small></div><span className={`${styles.pnlChip} ${strategy.pnlToday >= 0 ? styles.up : styles.down}`}>{money(strategy.pnlToday)}</span></article>)}</div>
    </section>
    {latestOrder && <section className={styles.card}>
      <header className={styles.cardHeader}><div><h2>최근 모의 주문</h2><p>거래소 체결이 아닌 모의 주문 상태</p></div><span className={styles.chip}>모의</span></header>
      <button type="button" className={styles.orderRow} onClick={() => openOrder(latestOrder.id)}><div><strong>{latestOrder.market}</strong><small>{latestOrder.strategyName}</small></div><span className={`${styles.statusBadge} ${statusClass(latestOrder.status)}`}>{ORDER_STATUS_LABEL[latestOrder.status]}</span><Icon name="chevronRight" size={18} /></button>
    </section>}
    <section className={styles.lockCard}><span className={styles.lockIcon}><Icon name="lock" /></span><div><strong>실거래 실행 잠금</strong><p>승인·보안 저장소·섀도 운영·대사 통제가 충족되지 않았습니다.</p></div><span className={styles.lockCount}>3/10 충족</span></section>
  </>;
}

function OperateTab({ snapshot, busy, onCommand, openOrder, openEmergency }: { snapshot: OperationSnapshot; busy: string; onCommand: (input: OperationCommandInput, message: string) => Promise<void>; openOrder: (id: string) => void; openEmergency: () => void }) {
  const openOrderItem = snapshot.orders.find((order) => OPEN_ORDER_STATUS.includes(order.status));
  const stopped = snapshot.settings.emergencyStatus === "stopped";
  return <>
    <SectionTitle title="모의 운영" description="서버에 저장된 데모 전략 상태를 제어합니다" action={<button type="button" className={styles.emergencyButton} onClick={openEmergency}><Icon name="power" size={16} />데모 상태 중단</button>} />
    <article className={`${styles.healthCard} ${stopped ? styles.healthStopped : ""}`}>
      <div className={styles.healthHead}><span className={styles.healthIcon}><Icon name={stopped ? "circleX" : "shield"} /></span><span><strong>{stopped ? "데모 상태 중단" : "모의 운영 정상"}</strong><small>실제 거래소 주문 없음 · 데모 상태</small></span></div>
      <div className={styles.healthStats}><div><small>일일 손실</small><b>{snapshot.settings.currentLoss}%</b></div><div><small>손실 한도</small><b>{snapshot.settings.dailyLossLimit}%</b></div></div>
      <i className={styles.meter}><b className={styles.meterWarn} style={{ width: `${Math.min(100, snapshot.settings.currentLoss / snapshot.settings.dailyLossLimit * 100)}%` }} /></i>
    </article>
    <section className={styles.card}>
      <header className={styles.cardHeader}><div><h2>전략 제어</h2><p>정지 상태는 웹에도 바로 반영됩니다</p></div></header>
      <div className={styles.controlList}>{snapshot.strategies.map((strategy) => <article className={styles.controlCard} key={strategy.id}>
        <header><span className={`${styles.statusChip} ${styles[strategy.status]}`}><i />{strategy.status === "running" ? "실행 중" : strategy.status === "paused" ? "일시정지" : "중단"}</span><span className={styles.chip}>위험 {strategy.risk}</span></header>
        <h3>{strategy.name}</h3><p>{strategy.market} · 최근 신호 {strategy.lastSignalAt}</p>
        <div className={styles.metricRow}><div><small>오늘 손익</small><b className={strategy.pnlToday >= 0 ? styles.upText : styles.downText}>{money(strategy.pnlToday)}</b></div><div><small>노출</small><b>{strategy.exposure}</b></div></div>
        <div className={styles.cardActions}>
          {strategy.status === "running" ? <button type="button" className={styles.pauseButton} disabled={busy !== ""} onClick={() => onCommand({ action: "pause_strategy", strategyId: strategy.id }, `${strategy.name}을 일시정지했습니다`)}><Icon name="pause" size={16} />일시정지</button> : strategy.status === "paused" ? <button type="button" className={styles.resumeButton} disabled={busy !== ""} onClick={() => onCommand({ action: "resume_strategy", strategyId: strategy.id }, `${strategy.name}을 재개했습니다`)}><Icon name="play" size={16} />전략 재개</button> : <button type="button" className={styles.secondaryButton} disabled>중단됨</button>}
          <button type="button" className={styles.secondaryButton} onClick={() => { const order = snapshot.orders.find((item) => item.strategyId === strategy.id); if (order) openOrder(order.id); }}><Icon name="list" size={16} />주문 보기</button>
        </div>
      </article>)}</div>
    </section>
    {openOrderItem && <section className={styles.card}>
      <header className={styles.cardHeader}><div><h2>진행 중 주문</h2><p>서버의 데모 상태를 표시합니다</p></div></header>
      <button type="button" className={styles.activeOrder} onClick={() => openOrder(openOrderItem.id)}><div><strong>{openOrderItem.market} · {openOrderItem.side === "buy" ? "매수" : "매도"}</strong><small>{openOrderItem.strategyName}</small></div><b>{openOrderItem.filledRatio}%</b><i className={styles.meter}><b className={styles.meterOk} style={{ width: `${openOrderItem.filledRatio}%` }} /></i><span>상세 추적<Icon name="chevronRight" size={16} /></span></button>
    </section>}
  </>;
}

function OrdersTab({ orders, filter, setFilter, openOrder }: { orders: OperationOrder[]; filter: OrderFilter; setFilter: (filter: OrderFilter) => void; openOrder: (id: string) => void }) {
  const filtered = useMemo(() => orders.filter((order) => { if (filter === "open") return OPEN_ORDER_STATUS.includes(order.status); if (filter === "completed") return ["filled", "cancelled"].includes(order.status); if (filter === "failed") return order.status === "failed"; return true; }), [filter, orders]);
  return <>
    <SectionTitle title="주문" description="주문 접수부터 최종 체결까지 추적합니다" />
    <div className={styles.filterTabs}>{([["all", "전체"], ["open", "진행 중"], ["completed", "완료"], ["failed", "실패"]] as [OrderFilter, string][]).map(([id, label]) => <button type="button" key={id} className={filter === id ? styles.filterActive : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    <section className={styles.orderList}>{filtered.map((order) => <button type="button" key={order.id} onClick={() => openOrder(order.id)}>
      <div className={styles.orderTop}><span className={order.side === "buy" ? styles.buyBadge : styles.sellBadge}>{order.side === "buy" ? "매수" : "매도"}</span><strong>{order.market}</strong><small>{order.createdAt}</small></div>
      <p>{order.strategyName}</p>
      <div className={styles.orderBottom}><span>{order.amount} · {order.price}</span><b className={`${styles.statusBadge} ${statusClass(order.status)}`}>{ORDER_STATUS_LABEL[order.status]}</b></div>
      {OPEN_ORDER_STATUS.includes(order.status) && <i className={styles.meter}><b className={styles.meterOk} style={{ width: `${order.filledRatio}%` }} /></i>}
    </button>)}</section>
    {filtered.length === 0 && <div className={styles.emptyState}><span className={styles.iconBubble}><Icon name="receipt" /></span><strong>해당 주문이 없습니다</strong><p>다른 상태 필터를 선택해보세요.</p></div>}
  </>;
}

function OrderDetail({ order, busy, goBack, onCommand }: { order: OperationOrder; busy: string; goBack: () => void; onCommand: (input: OperationCommandInput, message: string) => Promise<void> }) {
  const canCancel = OPEN_ORDER_STATUS.includes(order.status);
  const reached = order.status === "filled" ? 4 : order.filledRatio > 0 ? 3 : OPEN_ORDER_STATUS.includes(order.status) ? 2 : 1;
  return <>
    <button type="button" className={styles.backButton} onClick={goBack}><Icon name="chevronLeft" size={18} />주문 목록</button>
    <SectionTitle title="주문 상태 추적" description={`${order.id} · ${order.market}`} />
    <article className={styles.orderHero}><div><span className={order.side === "buy" ? styles.buyBadge : styles.sellBadge}>{order.side === "buy" ? "매수" : "매도"}</span><strong>{order.market}</strong></div><h2>{order.amount}</h2><p>{order.strategyName}</p><span className={`${styles.statusBadge} ${statusClass(order.status)}`}>{ORDER_STATUS_LABEL[order.status]}</span></article>
    <section className={styles.card}>
      <header className={styles.cardHeader}><div><h2>처리 단계</h2><p>서버에 저장된 모의 상태를 표시합니다</p></div></header>
      <ol className={styles.timeline}>{["전략 신호", "거래소 접수", order.status === "failed" ? "주문 실패" : "체결 진행", "최종 완료"].map((label, index) => <li key={label} className={index < reached ? styles.timelineDone : ""}><i>{index < reached ? <Icon name="check" size={14} /> : null}</i><span><strong>{label}</strong><small>{index === 0 ? order.createdAt : index === 1 ? "모의 주문 식별자" : index === 2 ? `${order.filledRatio}% 처리` : "대기 중"}</small></span></li>)}</ol>
    </section>
    <section className={styles.card}>
      <header className={styles.cardHeader}><div><h2>주문 정보</h2></div></header>
      <dl className={styles.infoList}><div><dt>주문 방식</dt><dd>{order.orderType === "market" ? "시장가" : "지정가"}</dd></div><div><dt>주문 가격</dt><dd>{order.price}</dd></div><div><dt>체결률</dt><dd>{order.filledRatio}%</dd></div><div><dt>마지막 갱신</dt><dd>{order.updatedAt}</dd></div></dl>
      {order.failureReason && <p className={styles.errorNote}><Icon name="alert" size={16} />{order.failureReason}</p>}
    </section>
    {canCancel && <button type="button" className={styles.dangerButton} disabled={busy !== ""} onClick={() => onCommand({ action: "cancel_order", orderId: order.id }, "미체결 잔량을 취소 처리했습니다")}>데모 취소 처리</button>}
    {order.status === "failed" && <button type="button" className={styles.primaryButton} disabled={busy !== ""} onClick={() => onCommand({ action: "retry_order", orderId: order.id }, "데모 상태를 재확인합니다")}><Icon name="refresh" size={18} />상태 다시 확인</button>}
  </>;
}

function AlertsTab({ snapshot, unread, markRead, openOrder, notify }: { snapshot: OperationSnapshot; unread: number; markRead: () => void; openOrder: (id: string) => void; notify: (message: string) => void }) {
  return <>
    <SectionTitle title="알림" description="주문·전략·보안 상태를 알려드립니다" action={unread > 0 ? <button type="button" className={styles.textButton} onClick={markRead}>모두 읽음</button> : undefined} />
    <section className={styles.alertList}>{snapshot.events.map((event, index) => {
      const tone = event.severity === "critical" ? styles.alertCritical : event.severity === "warning" ? styles.alertWarning : styles.alertNormal;
      return <button type="button" key={event.id} className={index < unread ? styles.unreadAlert : ""} onClick={() => { if (event.orderId) openOrder(event.orderId); else notify("알림 내용을 확인했습니다"); }}>
        <span className={`${styles.alertIcon} ${tone}`}><Icon name={event.severity === "critical" ? "circleX" : event.severity === "warning" ? "alert" : "circleCheck"} size={20} /></span>
        <div><span><strong>{event.eventType === "emergency_stop" ? "긴급 중단" : event.eventType.includes("order") ? "주문 상태" : "전략 알림"}</strong><time>{event.createdAt}</time></span><p>{event.message}</p>{event.orderId && <small>주문 상세 보기<Icon name="chevronRight" size={14} /></small>}</div>
      </button>;
    })}</section>
  </>;
}

function SettingsTab({ installApp, logout }: { installApp: () => Promise<void>; logout: () => void }) {
  return <>
    <SectionTitle title="설정" description="설치형 웹앱의 제공 범위와 연결 상태를 확인합니다" />
    <section className={styles.profileCard}><span className={styles.avatar}>정</span><div><strong>정훈</strong><span>데모 계정 · 모의 운영</span></div><Link href="/">웹 열기<Icon name="external" size={14} /></Link></section>
    <h2 className={styles.groupTitle}>앱 기능 준비 상태</h2>
    <section className={styles.settingGroup}>
      <button type="button" disabled aria-disabled="true"><span className={styles.rowIcon}><Icon name="bell" size={18} /></span><span><strong>푸시 알림</strong><small>실제 앱 알림 연동 후 제공</small></span><i className={styles.switch}><b /></i></button>
      <button type="button" disabled aria-disabled="true"><span className={styles.rowIcon}><Icon name="fingerprint" size={18} /></span><span><strong>생체 인증 잠금</strong><small>네이티브 인증 연동 후 제공</small></span><i className={styles.switch}><b /></i></button>
    </section>
    <h2 className={styles.groupTitle}>연결 상태</h2>
    <section className={styles.settingGroup}>
      <article><span className={styles.rowIcon}><Icon name="shield" size={18} /></span><span><strong>운영 모드</strong><small>실제 주문이 없는 안전한 환경</small></span><b className={styles.chip}>모의 운영</b></article>
      <article><span className={styles.rowIcon}><Icon name="scale" size={18} /></span><span><strong>거래소 연결</strong><small>현재 사용자별 키 저장소 미연결</small></span><b className={`${styles.chip} ${styles.chipRed}`}>미연결</b></article>
    </section>
    <button type="button" className={styles.installCard} onClick={installApp}><span className={styles.iconBubble}><Icon name="download" /></span><span><strong>BlockTrade 설치형 웹앱</strong><small>홈 화면에서 앱 형태로 실행하세요</small></span><Icon name="chevronRight" size={18} /></button>
    <button type="button" className={styles.logoutButton} onClick={logout}><Icon name="logout" size={18} />앱 로그아웃</button>
    <p className={styles.securityNote}>현재 화면은 네이티브 iOS·Android 앱이 아닌 설치형 웹앱입니다. 민감한 API 키와 비밀번호는 저장하지 않습니다.</p>
  </>;
}
