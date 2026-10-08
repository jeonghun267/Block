"use client";

import { useState } from "react";
import { Icon, type IconName } from "../icons";
import styles from "./onboarding.module.css";

export type AppStage = "splash" | "login" | "terms" | "signup" | "verify" | "risk";

const SIGNUP_STEPS = ["약관 동의", "회원가입", "본인 인증", "투자 위험 고지"] as const;
const STEP_OF: Partial<Record<AppStage, number>> = { terms: 1, signup: 2, verify: 3, risk: 4 };
const REQUIRED_TERMS = ["서비스 이용약관", "개인정보 처리방침", "전자금융거래 이용약관"];
const OPTIONAL_TERMS = ["마케팅 정보 수신 동의", "제3자 정보 제공"];
const RISKS: [IconName, string, string][] = [
  ["trendingUp", "원금 손실 가능성", "가상자산은 가격 변동성이 매우 크며, 자동매매 결과 손실이 발생할 수 있어요."],
  ["activity", "알고리즘 한계", "백테스팅은 과거 데이터 기반 시뮬레이션이며 미래 수익률을 보장하지 않아요."],
  ["alert", "시스템 / 거래소 리스크", "API 응답 지연, 거래소 점검 등으로 의도치 않은 체결이 발생할 수 있어요."],
];

export function Splash() {
  return <main className={styles.splash} role="status" aria-label="BlockTrade 앱 시작 중">
    <div className={styles.splashGlow} aria-hidden="true" />
    <div className={styles.splashMark}><span>BT</span></div>
    <strong className={styles.splashName}>BlockTrade</strong>
    <small className={styles.splashTag}>기관 통제 앱</small>
    <footer className={styles.splashFooter}><i><b /></i><span>모의 운영 환경 · 실제 주문 없음</span></footer>
  </main>;
}

function Check({ on }: { on: boolean }) {
  return <i aria-hidden="true" className={on ? `${styles.check} ${styles.on}` : styles.check}>{on && <Icon name="check" size={14} />}</i>;
}

function AuthShell({ stage, title, lead, back, children, cta }: { stage: AppStage; title: string; lead: string; back?: () => void; children: React.ReactNode; cta: React.ReactNode }) {
  const step = STEP_OF[stage];
  return <main className={styles.authShell}>
    <header className={styles.appBar}>
      {back ? <button type="button" className={styles.back} onClick={back} aria-label="이전 단계"><Icon name="chevronLeft" size={24} /></button> : <span className={styles.barMark}>BT</span>}
      <strong>{step ? "회원가입" : "BlockTrade"}</strong>
      <span className={styles.barEnd}>{step ? "" : <em className={styles.paper}>모의</em>}</span>
    </header>
    {step && <ol className={styles.progress} aria-label="가입 단계">{SIGNUP_STEPS.map((label, index) => <li key={label} className={index + 1 < step ? styles.done : index + 1 === step ? styles.current : ""} aria-current={index + 1 === step ? "step" : undefined}><i /><span>{label}</span></li>)}</ol>}
    <section className={styles.authBody} key={stage}>
      {step && <p className={styles.stepLabel}>{SIGNUP_STEPS[step - 1]}</p>}
      <h1>{title}</h1><p className={styles.lead}>{lead}</p>{children}
    </section>
    <footer className={styles.ctaBar}>{cta}</footer>
  </main>;
}

function AppLogin({ go, complete, notify }: { go: (stage: AppStage) => void; complete: (message: string) => void; notify: (message: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const valid = /^\S+@\S+\.\S+$/.test(email) && password.length >= 8;
  return <AuthShell stage="login" title="기관 계정으로 로그인" lead="승인·알림·모니터링·긴급중단을 앱에서 처리합니다. 웹 기관 콘솔과 같은 계정을 사용합니다." cta={<>
    <button type="button" className={styles.primary} disabled={!valid} onClick={() => { setPassword(""); complete("데모 계정으로 로그인했습니다"); }}>로그인</button>
    <button type="button" className={styles.secondary} disabled aria-disabled="true"><Icon name="fingerprint" size={18} />생체 인증으로 로그인 · 연동 예정</button>
    <button type="button" className={styles.link} onClick={() => go("terms")}>처음이신가요? <b>가입하기</b></button>
  </>}>
    <label className={styles.field}>이메일<input type="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" /></label>
    <label className={styles.field}>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상" autoComplete="current-password" /></label>
    <button type="button" className={styles.textAction} onClick={() => notify("비밀번호 재설정 안내를 이메일로 보냈습니다")}>비밀번호를 잊으셨나요?</button>
  </AuthShell>;
}

function AppTerms({ go }: { go: (stage: AppStage) => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const all = [...REQUIRED_TERMS, ...OPTIONAL_TERMS];
  const allChecked = all.every((item) => checked[item]);
  const toggle = (item: string) => setChecked((state) => ({ ...state, [item]: !state[item] }));
  return <AuthShell stage="terms" title="약관에 동의해주세요" lead="BlockTrade는 자산을 보관하지 않으며 거래소 API로만 매매를 자동화합니다." back={() => go("login")} cta={<button type="button" className={styles.primary} disabled={!REQUIRED_TERMS.every((item) => checked[item])} onClick={() => go("signup")}>동의하고 계속</button>}>
    <button type="button" className={styles.agreeAll} aria-pressed={allChecked} onClick={() => setChecked(Object.fromEntries(all.map((item) => [item, !allChecked])))}><Check on={allChecked} />전체 동의 (선택 항목 포함)</button>
    <div className={styles.agreeList}>{all.map((item) => <button type="button" key={item} aria-pressed={!!checked[item]} onClick={() => toggle(item)}><Check on={!!checked[item]} /><span><b className={REQUIRED_TERMS.includes(item) ? styles.required : styles.optional}>{REQUIRED_TERMS.includes(item) ? "필수" : "선택"}</b>{" "}{item}</span><Icon name="chevronRight" size={18} className={styles.rowChevron} /></button>)}</div>
    <p className={styles.note}><Icon name="shield" size={16} />투자 위험 고지는 본인 인증을 마친 뒤 마지막 단계에서 직접 확인합니다.</p>
  </AuthShell>;
}

function AppSignup({ go }: { go: (stage: AppStage) => void }) {
  const [form, setForm] = useState({ nickname: "", email: "", password: "", confirm: "" });
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((state) => ({ ...state, [field]: event.target.value }));
  const valid = form.nickname.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(form.email) && form.password.length >= 8 && form.password === form.confirm;
  return <AuthShell stage="signup" title="계정 만들기" lead="모바일과 웹에서 함께 쓰는 운용 계정을 만듭니다." back={() => go("terms")} cta={<button type="button" className={styles.primary} disabled={!valid} onClick={() => { setForm((state) => ({ ...state, password: "", confirm: "" })); go("verify"); }}>다음</button>}>
    <label className={styles.field}>닉네임<input value={form.nickname} onChange={set("nickname")} placeholder="트레이더 닉네임" autoComplete="nickname" /></label>
    <label className={styles.field}>이메일<input type="email" inputMode="email" value={form.email} onChange={set("email")} placeholder="name@example.com" autoComplete="email" /></label>
    <label className={styles.field}>비밀번호<input aria-label="비밀번호" type="password" value={form.password} onChange={set("password")} placeholder="8자 이상 입력" autoComplete="new-password" /><small className={form.password.length >= 8 ? `${styles.hint} ${styles.hintOk}` : styles.hint}>{form.password.length >= 8 && <Icon name="check" size={13} />}8자 이상 · 영문/숫자 조합 권장</small></label>
    <label className={styles.field}>비밀번호 확인<input type="password" value={form.confirm} onChange={set("confirm")} placeholder="비밀번호를 다시 입력" autoComplete="new-password" /></label>
  </AuthShell>;
}

function AppVerify({ go, notify }: { go: (stage: AppStage) => void; notify: (message: string) => void }) {
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [carrier, setCarrier] = useState("SKT");
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const canSend = name.trim().length >= 2 && /^\d{8}$/.test(birth) && phone.replace(/\D/g, "").length >= 10;
  const send = () => { if (!canSend) return; setSent(true); notify("데모 인증번호 123456을 발송했습니다"); };
  const complete = () => { if (code !== "123456") { notify("인증번호를 확인해주세요"); return; } setCode(""); go("risk"); };
  return <AuthShell stage="verify" title="본인 인증" lead="금융 서비스 이용을 위해 실명을 확인합니다." back={() => go("signup")} cta={<button type="button" className={styles.primary} disabled={!sent || code.length !== 6} onClick={complete}>인증 완료</button>}>
    <label className={styles.field}>성명<input value={name} onChange={(event) => setName(event.target.value)} placeholder="이름 입력" autoComplete="name" /></label>
    <label className={styles.field}>생년월일<input inputMode="numeric" value={birth} onChange={(event) => setBirth(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="생년월일 8자리" autoComplete="bday" /></label>
    <div className={styles.secure}><Icon name="lock" size={18} /><span>주민등록번호는 받지 않습니다. 실서비스 KYC는 인증기관의 보안 화면에서 처리합니다.</span></div>
    <div className={styles.fieldLabel}>통신사</div>
    <div className={styles.carriers}>{["SKT", "KT", "LG U+", "알뜰폰"].map((item) => <button type="button" key={item} className={carrier === item ? styles.on : ""} aria-pressed={carrier === item} onClick={() => setCarrier(item)}>{item}</button>)}</div>
    <div className={styles.inline}><label className={styles.field}>휴대폰 번호<input inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^0-9-]/g, ""))} placeholder="010-1234-5678" autoComplete="tel" /></label><button type="button" disabled={!canSend} onClick={send}>{sent ? "재전송" : "인증번호 받기"}</button></div>
    {sent && <label className={`${styles.field} ${styles.reveal}`}>인증번호<input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="데모 번호 123456" autoComplete="one-time-code" /></label>}
  </AuthShell>;
}

function AppRisk({ go, complete }: { go: (stage: AppStage) => void; complete: (message: string) => void }) {
  const [understood, setUnderstood] = useState(false);
  const [phrase, setPhrase] = useState("");
  return <AuthShell stage="risk" title="투자 손실 가능성 고지" lead="본인 확인이 끝난 계정으로 아래 내용을 직접 확인해야 앱이 열립니다." back={() => go("verify")} cta={<button type="button" className={styles.primary} disabled={!understood || phrase.trim() !== "이해했습니다"} onClick={() => complete("가입을 마쳤습니다. 모의 운영 환경입니다")}>확인하고 시작하기</button>}>
    <div className={styles.riskList}>{RISKS.map(([icon, title, body]) => <article key={title}><i aria-hidden="true"><Icon name={icon} size={20} /></i><div><strong>{title}</strong><p>{body}</p></div></article>)}</div>
    <button type="button" className={styles.agreeAll} aria-pressed={understood} onClick={() => setUnderstood(!understood)}><Check on={understood} />위 내용을 모두 이해했습니다</button>
    <label className={styles.field}>확인 문구 입력<input value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder="이해했습니다" aria-label="위험 고지 확인 문구" /></label>
  </AuthShell>;
}

export function AppOnboarding({ stage, go, complete, notify }: { stage: AppStage; go: (stage: AppStage) => void; complete: (message: string) => void; notify: (message: string) => void }) {
  if (stage === "splash") return <Splash />;
  if (stage === "terms") return <AppTerms go={go} />;
  if (stage === "signup") return <AppSignup go={go} />;
  if (stage === "verify") return <AppVerify go={go} notify={notify} />;
  if (stage === "risk") return <AppRisk go={go} complete={complete} />;
  return <AppLogin go={go} complete={complete} notify={notify} />;
}
