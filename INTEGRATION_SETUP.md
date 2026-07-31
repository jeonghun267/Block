# BlockTrade 외부 연동 인계서

BlockTrade는 fail-closed입니다. 외부 자격증명이나 승인 증적이 없으면 조회·운영 명령을 열지 않으며, 현재 릴리스는 실거래를 항상 차단합니다.

## 운영 인증

운영 배포는 호스팅 계층이 서명한 사용자 식별자를 서버에서 검증합니다.

```text
APP_ENV=production
ALLOW_DEMO_IDENTITY=false
TRUSTED_IDENTITY_HEADER=oai-authenticated-user-email
```

프로덕션에서는 개발용 데모 계정을 허용하지 않습니다. 실제 회사 도입 시에는 회사 IdP, 피싱 저항 MFA, 최근 강한 재인증, 세션 만료와 비상계정을 별도 정책으로 연결해야 합니다.

## Secret Broker

원시 거래소 키는 브라우저, D1, 소스, 로그와 분석 도구에 저장하지 않습니다. 운영사가 관리하는 KMS/Vault 앞에 승인된 Secret Broker를 두고 다음 값만 호스팅 비밀정보로 설정합니다.

```text
SECRET_BROKER_URL=https://<approved-secret-broker>
SECRET_BROKER_SERVICE_TOKEN=<hosting-secret>
```

BlockTrade는 Broker의 아래 경로에서 5~15분 유효한 단기 자격증명을 요청합니다.

```text
POST /v1/exchange-credentials/resolve
Authorization: Bearer <service-token>
Content-Type: application/json

{
  "secretReference": "vault://blocktrade/upbit/corp-01",
  "institutionId": "<institution-id>",
  "connectionId": "<connection-id>",
  "purpose": "read_only_reconciliation"
}
```

응답에는 `accessKey`, `secretKey`, `credentialFingerprint`, `expiresAt`이 필요합니다. 서버는 승인 시 저장한 계정 지문과 응답 지문이 다르면 즉시 중단합니다. 응답 비밀정보는 D1이나 로그에 기록하지 않습니다.

## 법인 거래소 읽기 전용 대사

1. 거래소에서 별도 법인 API 키를 발급합니다.
2. 계좌 조회와 주문내역 조회만 허용합니다.
3. 주문 생성·취소·입금·출금 권한은 부여하지 않습니다.
4. 실행 Worker의 고정 IP만 허용합니다.
5. 원시 키를 KMS/Vault에 저장하고 계정 지문을 생성합니다.
6. BlockTrade의 `외부 연동` 화면에서 계정 이름, 지문, Secret Reference만 등록합니다.
7. 등록자가 아닌 Risk 또는 Compliance 담당자가 승인 근거와 함께 결정합니다.
8. 스케줄러 하트비트와 첫 대사 증적 해시를 기관 통제센터에서 확인합니다.

허용된 Upbit 경로는 다음 GET 요청뿐입니다.

```text
GET /v1/accounts
GET /v1/orders/open
GET /v1/orders/closed
```

코드의 읽기 전용 어댑터는 다른 경로와 GET 이외 메서드를 거부합니다.

## 연속 런타임

Cloudflare Worker는 매분 기동합니다. 실제 승인 주기가 도래한 작업만 큐에 넣습니다.

- 섀도 주기: 승인 배포의 `interval_minutes`
- 읽기 전용 대사: 5분
- 작업 임대: 150초
- 최대 재시도: 기본 5회
- 재시도: 지수형 지연, 최대 15분
- 만료 임대: 다음 스케줄러 주기에서 복구
- 최대 재시도 초과: `quarantined`

기관 통제센터는 하트비트, 대기·임대·재시도·격리 건수와 최근 작업을 서버 원장에서 표시합니다.

## 실거래

현재 코드의 기관 런타임 상태는 `liveTrading.allowed = false`로 고정돼 있습니다. 환경변수나 API 키만으로 해제할 수 없습니다.

실거래 단계에는 별도 변경으로 다음 기반을 추가 검증해야 합니다.

- 계좌별 단일 실행 리더와 주문 Outbox
- 주문 전 독립 Risk Gateway와 가격 보호
- 거래소 주문·체결 상태 대사와 미확인 주문 격리
- 최근 강한 재인증과 서로 다른 2인 승인
- 낮은 한도 Canary, Kill Drill, 온콜·SIEM·WORM 증적
- 서면 법률·준법·회계·세무 승인

## 전략 마켓 결제

플랫폼 플랜과 전략 성과보수는 화면·원장 설계만 있으며 실제 결제와 정산은 잠겨 있습니다. 결제사 웹훅, 환불, 고객·제작자 KYC, 세무, 정산 계좌와 관할권별 서면 검토 후 별도 기능 플래그로 열어야 합니다.

구매자는 전략 원본을 받지 않습니다. 서버는 사용권, 위험 한도와 중단 상태를 확인한 뒤 실행 결과만 반환합니다.
