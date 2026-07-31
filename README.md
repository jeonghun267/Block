# BlockTrade

BlockTrade는 조건·지표·주문 액션을 블록으로 조립하고, 백테스트와 모의 운영을 거쳐 전략 상태를 관리하는 반응형 웹/PWA 프로젝트입니다.

현재 공개 버전은 **실제 주문과 결제가 잠긴 제품 검증용 데모**입니다. 최종 제품 방향은 고객 자산과 출금 권한을 보관하지 않는 **비수탁형 기관용 가상자산 자동매매 운영체제(Non-custodial Institutional Crypto Trading OS)**입니다.

- Live site: https://blocktrade-webapp.popmin07.chatgpt.site
- Figma: https://www.figma.com/design/Dh9YfmsPqm5AoROSBUUwT7/UI-UX-%EC%88%98%EC%97%85?node-id=0-1

> 이 문서는 제품·기술 설계 자료이며 법률·투자 자문이 아닙니다. 실제 영업과 실거래 전에는 대상 국가, 고객 유형, 자산, 거래소와 수익모델에 맞는 서면 법률 검토가 필요합니다.

## 현재 구현 범위

### Web

- PC 첫 화면을 기관 제품 소개와 실제 제품 화면 탐색 구조로 재설계
- 상단 `플랫폼 / 통제 체계 / 보안` 메뉴를 각각의 실제 미리보기 화면과 연결
- 한국어 기반 AI 전략 코파일럿: 대화 → 구조화 초안 → 검증 → 블록 빌더 반영
- 기관 통제센터: 불변 전략 버전, 작성·승인 분리, 리스크 정책, 대사 예외와 감사 해시 체인
- 섀도 운용센터: 실제 업비트 공개 캔들 스냅샷 → 동일 표본 백테스트 → 최신 신호 → 사전 위험판정 → 내부 모의 체결 → 포지션·대사 증적
- 매분 기동되는 서버 스케줄러, D1 내구성 작업 큐, 임대 만료 복구, 지수형 재시도와 실패 격리
- 외부 Secret Broker를 통한 단기 KMS/Vault 자격증명 해석과 계정 지문 검증
- 업비트 법인계정 잔고·미체결·최근 종결 주문을 읽기 전용으로 수집하는 대사 원장
- 신뢰된 운영 계정 서명을 검증하는 서버 세션과 실제 런타임 상태 패널
- 시장 데이터·전략 버전·위험 정책·백테스트·주문 의도·체결·대사의 SHA-256 계보와 중복 실행 방지
- 랜딩, 로그인 데모, 약관, 투자 위험 고지, 가입·본인인증 흐름
- 반응형 자산 대시보드와 운영센터
- 모든 블록을 선택한 자리에서 수정하는 반응형 전략 빌더: PC 우측 고정 상세 패널, 태블릿·모바일 블록 하단 인라인 편집
- 가격 조건의 `1% / 3% / 5% / 10%` 빠른 선택과 직접 입력, 기준가·관측 구간·트리거·확정·반복 정책
- RSI 기간·임계값, 허용 요일·시간대, 전량·비율·금액 주문, 지정가 오프셋, 리밸런싱 목표 비중, 알림 중복 제한, 손절·익절 설정
- 블록별 수치 범위와 리밸런싱 합계 검증, 오류가 남아 있으면 기관 버전 저장·백테스트 차단
- 예시 백테스트, 실패 구간 분석과 전략 개선안 반영
- 전략 보관함과 전략 마켓 UI
- 체결 내역 검색·필터·CSV 내보내기
- 알림 상세, 프로필, 설정, 멤버십·수수료와 고객지원 화면

### App/PWA

- `/mobile` 모바일 전용 운영 화면
- 홈, 전략 상태, 모의 주문, 알림, 설정과 긴급중단 확인 흐름
- 데이터 동기화 실패 시 오래된 상태와 제어 버튼을 숨기는 fail-closed UI
- 터치 영역, 하단 내비게이션과 모바일 가독성 보완
- 설치 가능한 PWA 구조

현재 App은 네이티브 iOS/Android 앱이 아니라 PWA입니다. 인증된 기관 운영 흐름이 안정화된 뒤 네이티브 앱을 승인·알림·모니터링 중심으로 확장합니다.

## 구현된 안전 기반

- AI는 전략 초안만 생성하며 주문·승인·실거래 권한을 갖지 않음
- AI 결과를 신뢰하지 않고 서버 스키마와 위험 규칙으로 다시 검증
- 레버리지·선물·공매도·수익 보장 표현은 차단 사유로 분류
- 원문 대화는 감사 원장에 저장하지 않고 프롬프트 해시와 처리 결과만 기록
- 모델 키가 없는 환경에서는 안전 규칙 기반 초안 모드로 명확히 표시
- 운영 환경은 기본적으로 fail-closed
- API 키만 존재해도 실거래 모드가 열리지 않음
- 실거래는 운영자 스위치와 승인 계정까지 모두 일치해야 준비 상태가 됨
- 공개 거래소 API에서 직접 주문·취소 호출 차단
- 출금 기능과 출금 권한 사용 금지
- 주문 상태의 역방향 전이 차단
- 주문 중복 방지키와 요청 ID 사용
- 동일 시장 데이터 스냅샷과 동일 신호의 중복 섀도 실행 차단
- 업비트 공개 시세 API와 내부 시뮬레이터만 사용하는 섀도 경계 — 거래소 주문 API 호출 0건
- 시세 신선도·승인 전략·주문금액·현금·일일 손실·총 익스포저·단일자산 집중도를 주문 의도마다 서버에서 판정
- 긴급중단, 일일 손실, 거래소 상태, 하트비트 기반 실행 게이트
- 거래소 상태와 내부 종결 상태가 충돌하면 자동 수정하지 않고 수동 검토로 전환
- 예시 데이터, 모의 운영, 미연동 기능을 화면에서 명시
- 유료 전략 결제와 실제 정산은 결제·KYC·환불 체계 전까지 잠금
- 모든 마켓 전략은 `signal_only` 서버 실행 전용이며 비소유자 API에는 블록·임계값·정확한 조건을 반환하지 않음
- 공개 전략 이름·설명에 정확한 퍼센트, 주기, RSI 임계값과 배수를 넣지 못하도록 검증·가림 처리
- 비밀번호, 주민등록번호와 API 키를 브라우저 저장소에 보관하지 않음
- 브라우저에서 원시 거래소 키 입력을 받지 않고 KMS/Vault 참조값만 등록
- 법인 거래소 연결도 등록자와 독립 리스크·준법 승인자를 분리
- 읽기 전용 거래소 어댑터는 잔고·미체결·종결 주문 GET 경로만 허용하고 주문·취소·출금 경로를 거부
- 작업 임대 만료 시 안전하게 재등록하고 최대 재시도 초과 작업은 격리
- 운영 화면이 스케줄러 하트비트, 큐 적체, KMS 준비, 대사 증적과 감사 체인을 서버 원장에서 직접 표시

## 현재 한계

현재 버전은 **기관용 Paper Control Plane, 연속 섀도 실행 기반과 법인계정 읽기 전용 대사 경계를 갖춘 3단계 기반**이며, 아직 실거래 가능한 기관 운용 시스템은 아닙니다.

- 화면 전환이 단일 React 상태에 의존하여 실제 URL, 뒤로가기와 딥링크가 불완전함
- 운영 배포는 신뢰된 계정 서명을 서버에서 검증하지만, 회사 IdP·피싱 저항 MFA·최근 강한 재인증 정책은 외부 구성이 필요함
- 일반 전략 빌더 초안은 브라우저 `localStorage`에도 저장되며, 기관 제출본은 D1에 새 불변 버전으로 기록됨
- 일반 대시보드·기존 백테스트·체결 데이터 일부는 고정 예시이며, 새 섀도 운용센터의 기관 백테스트만 실제 공개 시세·전략 버전과 연결됨
- 매분 스케줄러와 내구성 Queue/Worker는 구현됐지만 거래소 WebSocket 원시 이벤트 저장소와 별도 장기 재생 파이프라인은 아직 없음
- D1의 `operation_*` 테이블은 기관 OMS 원장이 아니라 화면용 상태 프로젝션임
- 법인계정 읽기 전용 잔고·주문내역 대사는 구현됐지만 실제 주문 큐·체결 명령·계좌별 단일 실행권한은 의도적으로 잠겨 있음
- Secret Broker 경계는 구현됐지만 실제 Vault/KMS 테넌트, 키 회전·폐기 정책과 법인 자격증명은 운영사가 연결해야 함
- 플랫폼 플랜은 현재 클라이언트 데모 상태이며 결제사 웹훅 기반 서버 권한 원장과 아직 연결되지 않음
- 전략 원본은 D1 접근통제로 분리되지만 별도 KMS 기반 애플리케이션 암호화와 전용 실행 격리는 아직 없음
- 프로덕션 신규 사용자에게 예시 운영 데이터가 생성되는 경계를 제거해야 함
- 독립적인 감사 저장소, WORM 보존, SIEM·온콜·재해복구 환경은 외부 인프라와 조직 운영이 필요함

따라서 실제 API 키를 입력해 실거래를 시작하면 안 됩니다.

## AI 전략 코파일럿

코파일럿은 기존 블록 전략 제품을 대체하지 않습니다. 자연어 아이디어를 기존 전략 빌더가 이해할 수 있는 구조화 블록 초안으로 번역하는 입력 계층입니다.

```text
한국어 대화 → 구조화 전략 초안 → 서버 검증 → 블록 빌더
→ 불변 버전 저장 → 독립 승인 → 주문 전 위험검사 → 모의 운용
```

- 지원 초안: 자산, 시간봉, 진입·청산 조건, 주문 비중과 리스크 한도
- 출력 검증: 허용 자산·주기·연산자·수치 범위·필수 리스크 블록
- 차단 항목: 레버리지·파생상품·공매도, 수익 보장, 검증 불가능한 표현
- 실행 경계: 코파일럿은 주문을 만들거나 승인 결정을 내릴 수 없음
- 모델 장애 시: 규칙 기반 초안 모드로 전환하고 화면에 상태를 표시
- 데이터 최소화: 모델 요청에 계좌 비밀정보·API 키·고객 식별정보를 포함하지 않음

실제 모델 연결에는 Sites의 보안 환경설정에 `OPENAI_API_KEY`를 등록합니다. 채팅이나 브라우저 입력창으로 키를 전달하지 않습니다. 선택적으로 `OPENAI_STRATEGY_MODEL`을 설정할 수 있으며, 미설정 시 애플리케이션 기본 모델을 사용합니다.

## 기관·코인 헤지펀드 채택을 위한 목표 구조

### 1. 조직과 권한

다음 역할을 서버에서 분리하고 최소권한을 적용합니다.

- Fund Admin / Owner
- Portfolio Manager
- Trader
- Strategy Researcher
- Risk Officer
- Compliance Officer
- Operations
- Security Administrator
- Auditor / Read-only
- Execution Service Account

전략 작성자와 승인자, 거래 운영자와 감사 로그 관리자는 분리합니다. 관리자·승인자는 강한 MFA와 만료되는 권한을 사용하고 비상계정은 별도로 관리합니다.

### 2. 전략 레지스트리와 불변 버전

전략의 안정적인 ID와 수정 불가능한 버전을 분리합니다.

- `strategy_definitions`: 전략의 이름과 소유 조직
- `strategy_versions`: 스펙 JSON, 스키마 버전, SHA-256, 작성자와 생성 시각
- `strategy_version_state`: Draft, Review, Approved, Paper, Retired 상태 프로젝션
- `strategy_version_reviews`: 승인·거절 결정, 역할, 근거와 시각
- `backtest_runs`: 정확한 전략 버전, 엔진 버전, 데이터 스냅샷과 결과 해시

승인된 전략 버전은 UPDATE/DELETE하지 않습니다. 수정은 항상 새 버전을 생성하고 diff·테스트·승인을 다시 받습니다.

### 3. Maker–Checker 승인

다음 작업은 작성자와 승인자가 달라야 하며 자기 승인을 금지합니다.

- 전략 Paper/Live 승격
- 전략 코드·조건·파라미터 변경
- 리스크 한도 변경
- 거래소 키 등록·회전·폐기
- 실거래 활성화
- 긴급중단 해제

실거래 활성화와 긴급중단 해제는 Risk와 Compliance의 서로 다른 2인 승인을 기본값으로 합니다. 승인 시 전략 버전·해시·백테스트·Paper 결과·리스크 정책 버전을 고정합니다.

### 4. 독립적인 사전 위험검사

모든 자동·수동·재시도 주문은 거래소에 전송되기 전에 하나의 서버 Risk Gateway를 통과해야 합니다. 장애 시 통과시키지 않고 차단합니다.

- 허용 법인·계좌·거래소·종목·주문유형
- 주문별 최대 금액과 수량
- 전략·포트폴리오·계좌별 gross/net exposure
- 종목 집중도와 포지션 한도
- 일일 손실·최대 낙폭·레버리지 한도
- 가격 collar, 예상 슬리피지와 fat-finger 검사
- 시장 데이터 신선도와 거래소 시장 상태
- 최대 미체결 주문 수와 주문 속도
- 중복 신호·주문·재시도 방지
- restricted asset, self-trade와 시장질서 위험

법인 투자 한도 같은 규제 숫자를 코드에 고정하지 않고 `jurisdiction + legal entity + account + venue` 정책으로 버전화합니다.

### 5. Paper OMS와 실거래 OMS

첫 기관급 수직 흐름은 다음과 같습니다.

```text
전략 초안 → 불변 버전 → 검증·승인 → Risk Gateway
→ Paper 주문 의도 → 주문 상태·체결 → 거래소 대사 → 감사 기록
```

필수 원장:

- `deployments`: 전략 버전, 포트폴리오, 거래계좌, 정책과 실행 모드
- `order_intents`: 신호·전략 버전·주문 의도·중복방지키·리스크 결과
- `orders`: 내부 주문 ID, 거래소 주문 ID와 단조로운 상태 전이
- `fills`: 거래소 체결 ID, 정확한 수량·가격·수수료
- `risk_decisions`: 허용/거절, 코드, 입력 스냅샷과 해시
- `reconciliation_exceptions`: 내부·거래소·잔고 불일치와 해결 상태
- `command_receipts`: Idempotency-Key와 동일 응답 재생

금액과 수량은 IEEE-754 `REAL` 계산 대신 정규화된 decimal 문자열 또는 정수 최소단위를 사용합니다.

### 6. 거래소 대사

내부 주문·체결·취소와 거래소 응답, 잔고, 포지션과 수수료를 실시간 및 정기 배치로 비교합니다.

- 미확인·타임아웃 주문은 `unknown/suspense`로 격리
- 체결 여부가 확정될 때까지 신규 주문 자동동결 가능
- 거래소 체결 ID는 중복 저장 금지
- 종결 상태가 충돌하면 자동으로 되돌리지 않고 예외함으로 이동
- 담당자, SLA, 원인과 증거를 보관

### 7. 불변 감사 기록

모든 성공·거절·실패를 append-only 감사 이벤트로 남깁니다.

- 행위자, 역할, 세션, 조직과 출처
- 전략·코드·설정·정책 버전과 해시
- 승인자와 승인 당시 증거
- 요청 ID, client order ID와 exchange order ID
- 위험검사 입력·결과·거절 사유
- 주문·체결·취소·재시도 상태
- 관리자와 비밀정보 접근
- 이전 이벤트 해시와 현재 이벤트 해시

D1 해시 체인은 변조 탐지용이며 장기적으로 별도 보안 계정의 WORM/R2 저장소 또는 외부 앵커가 필요합니다.

### 8. Secrets와 거래소 연결

API 키는 브라우저·D1·로그·분석 도구에 평문으로 저장하지 않습니다.

- 사용자·거래소·계좌별 Vault/KMS envelope encryption
- 실행 서비스 계정만 짧은 시간 복호화
- 거래 전용·출금권한 OFF·IP allowlist·최소 권한
- 키 접근 감사, 자동 회전, revoke와 유출 대응 절차
- 실제 계좌 연결 전 ownership와 계좌 allowlist 확인

API 키 입력은 연결 설정일 뿐 실거래 통제 해제가 아닙니다.

### 9. Kill Switch와 장애 대응

- 전략, 포트폴리오, 계좌, 거래소와 전사 수준 중단
- 신규 주문 차단 → 미체결 취소 → 키 revoke 순서
- 미체결 취소 성공 여부와 잔여 주문 확인
- 재가동 전 원인·잔고·주문·시장 데이터 확인과 2인 승인
- 거래소 장애, stale data, runaway algo, 키 유출과 장부 불일치별 Runbook
- RTO/RPO, 온콜, 증거보존, 사고보고와 Postmortem
- 정기 Kill Drill, 복구 훈련과 통제 개선

### 10. 운용·리스크·투자자 보고

- 포트폴리오 NAV, 현금, 포지션, 실현/미실현 손익
- 거래소·종목·전략별 노출과 P&L attribution
- VaR, Expected Shortfall, stress/scenario와 drawdown
- 수수료·펀딩비·슬리피지 포함 성과
- Backtest/Paper/Shadow/Live 성과 분리
- 투자자·감사·세무 보고용 export와 데이터 계보
- 거래소·수탁·시장데이터 공급자 SLA와 상태

## 전략 마켓과 수익화 원칙

현재 제품에 반영한 기본 모델은 **플랫폼 플랜 + 원본 비공개 서버 실행 사용권 + 성과보수**입니다.

- Free: 전략 성과와 위험 정보 비교만 가능
- Pro / Gold: 타인 전략의 모의 실행 사용권 활성화와 전략 게시 가능
- 전략별 고정 월 구독료: 사용하지 않음
- 기본 성과보수: 순신규 실현이익의 10%
- 손실·회복 구간: 이전 최고 누적 실현이익을 회복하기 전까지 0원
- 정산 기준: 전략·계좌·정산 통화별 High-Water Mark, 월 단위 설계
- 성과보수 배분: 제작자 80%, 플랫폼 20%
- 제공 범위: 구매자는 실행 사용권·상태·성과만 받고 원본 블록, 임계값, 프롬프트와 코드를 받지 않음
- 실제 플랜 결제·성과보수 청구·제작자 정산: 법률·KYC·세무·결제사 웹훅 준비 전까지 잠금

성과보수 계산은 정수 통화 단위로 수행합니다.

```text
정산대상이익 = max(0, 현재 누적 실현이익 - 이전 최고수익기준선)
성과보수 = floor(정산대상이익 × 10%)
제작자 정산 = floor(성과보수 × 80%)
플랫폼 수익 = 성과보수 - 제작자 정산
다음 최고수익기준선 = max(이전 기준선, 현재 누적 실현이익)
```

전략을 공유·판매할 때는 추가로 다음을 강제합니다.

- Backtest, Paper, Shadow와 Live 성과를 절대 혼합하지 않음
- 기간, 표본 수, 최대 낙폭, 승률, 비용, 슬리피지와 수정 이력 표시
- 데이터 출처와 strategy version hash 공개
- Creator KYC, 이해상충, 개인거래·선행매매 정책
- self-trade, wash trading, spoofing와 pump 신호 모니터링
- 수익 보장·과장 표현 금지
- 유료 계약, 환불, 세금, 정산 원장과 분쟁 처리
- 구매·구독 여부와 관계없이 전략 원본은 제작자에게만 반환
- 실행 서비스는 사용권, 전략 버전, 계좌 위험 한도와 중단 상태를 매 요청마다 서버에서 확인
- 전략 원본 저장소, 구매자 조회 API와 실행 워커를 서로 다른 권한으로 분리

현재는 모의 사용권만 활성화할 수 있습니다. 실제 성과보수·자동실행은 서면 법률 검토와 결제·세무·Creator KYC, 서버 플랜 권한 원장, KMS 암호화와 격리 실행 워커 이후 feature flag로 엽니다.

## 운영사가 제품 밖에서 결정해야 할 것

1. 회사 자기자본만 운용하는지, 고객 자금을 모으는지
2. 전략 신호만 제공하는지, 고객 대신 주문을 판단·실행하는지
3. 고정 구독료인지, 성과보수·수익배분인지
4. 고객 자산·지갑·출금 권한을 보관하는지
5. 한국 법인·해외 법인 중 누구를 대상으로 하는지
6. 현물만 지원하는지, 선물·레버리지를 포함하는지
7. 지원 거래소·은행·수탁기관·시장데이터 공급자
8. CIO·Risk·Compliance·CISO·Operations·Audit 책임 분리
9. 가치평가·NAV·개인거래·이해상충·사고보고 정책
10. 법률·세무·회계감사·보험·BCP/DR 계약과 책임자

고객 운용권한 수임, 성과보수, 자금 모집, 주문 대행과 보관은 단순 소프트웨어와 법적 성격이 달라질 수 있습니다. 한국 대상 영업 전에는 사업모델별 서면 법률 검토와 VASP·자본시장 규제 해당 여부 확인이 필요합니다.

## 개발 로드맵

### Phase 0 — 제품·법률 경계

- 비수탁형 기관용 운영체제로 제품 정의
- 출금과 custody 영구 차단
- 대상 법인·국가·거래소·수익모델별 법률분류 메모
- 실거래와 유료 전략 마켓 feature flag 기본 OFF

### Phase 1 — Paper Fund Control Plane

- 실제 인증과 조직 멀티테넌시
- RBAC, 강한 MFA와 Maker–Checker
- 전략 레지스트리·불변 버전·diff·승인
- 버전형 리스크 정책과 append-only 감사 기록
- 실제 사용자에게 예시 전략·체결을 생성하지 않는 빈 상태

### Phase 2 — Paper OMS/Risk/Audit

- 동일 전략 버전으로 Builder → Backtest → Approval → Paper 연결
- Risk Gateway와 주문 의도 원장
- Paper 주문·체결·취소·재시도
- 주문 상태 전이·중복방지·감사 불변성 테스트

### Phase 3 — Shadow와 거래소 대사

- **구현:** 업비트 공개 캔들 180개 스냅샷, 원본 해시와 데이터 계보
- **구현:** 동일 표본 재현 백테스트, 최신 신호, 사전 위험판정과 중복방지
- **구현:** 내부 주문 의도·모의 주문·체결·포지션·주기 대사와 감사 증적
- **구현:** 20주기·7일·대사 예외 0건을 요구하는 섀도 기간 게이트
- **구현:** 매분 서버 스케줄러, D1 내구성 Queue/Worker, 임대 만료 복구, 지수형 재시도와 실패 격리
- **구현:** Secret Broker 기반 단기 자격증명과 업비트 법인계정 read-only 잔고·주문내역 대사
- **남음:** WebSocket 원시 시세·거래 이벤트 저장, 장기 재생과 공급자 이중화
- **외부 연결:** 실제 Vault/KMS, 출금·거래 권한이 없는 법인 API 키, 독립 승인자와 IP 허용목록

### Phase 4 — 제한적 Live

- 외부 Vault/KMS 운영 테넌트와 회전·폐기 자동화
- 승인 계좌·전략·정책·Paper/Shadow·재인증 게이트
- 낮은 주문 한도의 canary live
- 실제 Kill Switch, 장애훈련과 온콜

### Phase 5 — 기관 포트폴리오와 전략 마켓

- NAV·리스크·투자자·감사 보고
- Creator KYC, 성과 증빙과 시장질서 감시
- 법률·결제·세무·환불 준비 후 제한적 수익화

### Phase 6 — Native App

- 모니터링·알림·승인·비상중단 중심 iOS/Android 앱
- 기기 바인딩, 생체인증과 phishing-resistant MFA
- 모바일에서 고위험 설정·API 키 입력·대량 주문 제한

## 기관급 불변 테스트 기준

- 승인된 전략 버전은 수정·삭제되지 않음
- 전략 작성자는 자신의 버전을 승인할 수 없음
- 동일 조직의 승인된 전략·정책·Paper 배포만 주문 의도를 생성
- 동일 신호와 Idempotency-Key는 주문 의도와 outbox를 한 번만 생성
- 위험 거절, 긴급중단, stale data와 일일 손실 초과 시 거래소 호출 없음
- 종결 주문 상태는 다시 열리지 않음
- 누적 체결량은 주문량을 초과하지 않음
- 모든 성공·거절 명령에 actor/request-correlated 감사 이벤트 존재
- 조직·포트폴리오 격리가 모든 조회·변경에 적용
- 돈·수량은 정확한 decimal round-trip을 보장
- 오래된 row version으로 상태 변경 시 409 반환
- Vault ref, 운영자 스위치, 승인 계좌·배포, 재인증 없이는 live adapter 접근 불가

## 기술 스택

- React 19, TypeScript, Vinext/Vite
- Cloudflare Workers
- Cloudflare D1 + Drizzle ORM
- Vitest, Testing Library, Node test runner
- PWA manifest와 service worker

## 로컬 실행

요구사항: Node.js `>=22.13.0`

```bash
npm ci
npm run dev
```

주요 검사:

```bash
npm run lint
npm run test:ui
npm run test:buttons
npm run build
```

## 환경과 거래소 대사 게이트

현재 배포는 실거래를 허용하지 않습니다. 자세한 설정은 `INTEGRATION_SETUP.md`를 참고하세요.

- `APP_ENV=production`
- `ALLOW_DEMO_IDENTITY=false`
- `SECRET_BROKER_URL=https://<approved-secret-broker>`
- `SECRET_BROKER_SERVICE_TOKEN=<hosting-secret>`

브라우저와 D1에는 원시 키를 넣지 않습니다. 외부 KMS/Vault에서 조회 전용 자격증명을 관리하고, BlockTrade에는 계정 지문과 비밀정보 참조만 등록합니다. 이 값들이 존재해도 실거래 API는 열리지 않습니다.

디자인 기준은 [`DESIGN.md`](./DESIGN.md), 외부 연동 절차는 [`INTEGRATION_SETUP.md`](./INTEGRATION_SETUP.md), 보안 검증 범위는 [`docs/SECURITY_TESTING.md`](./docs/SECURITY_TESTING.md)를 따릅니다.

## 공식 설계 참고자료

- [NIST SP 800-53 Rev. 5 — 직무 분리·최소권한·감사](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)
- [NIST SP 800-63B-4 — 인증과 MFA](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [NIST CSF 2.0 — 보안 거버넌스와 사고 대응](https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf)
- [SEC Rule 15c3-5 — 주문 전 시장접근 위험통제](https://www.sec.gov/files/rules/final/2010/34-63241fr.pdf)
- [FINRA 15-09 — 알고리즘 거래 통제](https://www.finra.org/sites/default/files/notice_doc_file_ref/Notice_Regulatory_15-09.pdf)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Upbit 분 캔들 조회 API](https://docs.upbit.com/kr/reference/list-candles-minutes)
- [Upbit Open API 요청 수 제한](https://docs.upbit.com/kr/reference/rate-limits)
- [Upbit 계좌 잔고 조회](https://global-docs.upbit.com/reference/get-balance)
- [Upbit 미체결 주문 조회](https://global-docs.upbit.com/reference/list-open-orders)
- [Upbit 종결 주문 조회](https://global-docs.upbit.com/th/reference/list-closed-orders)
- [KoFIU 고객확인 CDD·EDD 안내](https://www.kofiu.go.kr/kor/policy/amls05.do)
- [KoFIU 가상자산사업자 신고 매뉴얼](https://www.kofiu.go.kr/cmn/file/downloadBoard.do?fileNm=202472010340328g.pdf&fileOrdrNo=2&ordrNo=209&seCd=0007)
- [금융위원회 가상자산이용자보호법 안내](https://www.fsc.go.kr/no010101/82682)
- [국가법령정보센터 가상자산 이용자 보호 등에 관한 법률](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=261099)
