# 2026-2학기 Google Developer Groups on Campus 팀 프로젝트

## NetRadar · 넷레이더

택시 기사님을 위한 예상 시급 지도와 동선 추천 서비스의 반응형 React · TypeScript 프런트엔드입니다.
WBS 4.1~4.5의 화면과 상태 흐름을 구현했습니다. 기본 실행은 명시적으로 표시되는 **데모 모드**입니다.

### 실행

Node.js 24 LTS와 pnpm 11.25.0을 권장합니다. 최소 Node.js 버전은 22.12.0입니다.

```sh
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

이용·저장 안내를 확인한 뒤 **데모로 둘러보기**를 누르면 시작합니다.
실제 위치 권한을 거절해도 장소 검색으로 출발지를 선택할 수 있습니다.
데모 검색은 강남역·삼성역·신논현역·교대역·잠실역·서울역과 예시 충전소를 지원합니다.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm preview
# 처음 한 번 테스트용 Chromium 설치
pnpm exec playwright install chromium
pnpm test:e2e
# API 호출·인증 경로 검증 (실제 메일/계정/DB 대신 격리된 테스트 응답 사용)
pnpm test:e2e:live
```

단위 테스트는 예측 계산·H3 격자·순위·운행 상태 전이·저장 복구·계정 격리를 확인합니다.
브라우저 테스트는 데스크톱과 모바일에서 지도→격자 상세→동선→운행 종료→기록,
프로필·즐겨찾기 저장, 동의·로그아웃, 지도 타일 장애 대응을 확인합니다.
`test:e2e:live`는 실제 API 모드로 빌드하여 Bearer 헤더, 신규 프로필 404→등록·실패 후 재시도,
서버 예시 예측·경로선, 이메일 로그인·회원가입·인증 메일 대기·카카오 PKCE 이동을 검증합니다.
테스트의 인증 서버는 예약된 `.invalid` 도메인이며 외부 회원가입이나 메일 발송을 하지 않습니다.
실제 Supabase/Kakao 및 운영 DB 검증을 대신하지 않습니다.

### WBS 구현 범위

| WBS                           | 프런트엔드 구현                                                                                                                        | 실제 서비스 연결에서 남은 일                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 4.1 앱 골격·로그인·마이페이지 | 카카오·이메일 로그인/회원가입, 이메일 확인 안내, 라우트·새로고침 복구, 동의·위치 UI, Bearer 요청, 신규 프로필 등록, 차종·즐겨찾기·기록 | 실제 Supabase/Kakao/메일 설정, 확정 약관, 운영 사용자 API 검증 |
| 4.2 시급 지도                 | Leaflet·H3 해상도 8, 지표/시간 필터, 순위·위치·타일 장애 대응, 서버 예시 응답 호환과 구역별 출처 표시                                  | 실제 AI 예측 데이터·운영 지도 설정 검증                        |
| 4.3 격자 상세                 | 추천 이유, 매출·비용·순시급, 시간 추이, 동선 연결, 서버 예시값·선택 시간대 검증과 출처 안내                                            | 실제 모델 계산 결과와 운영 API 검증                            |
| 4.4 동선 설정·추천 결과       | 장소·즐겨찾기 검색, 15/30/50% 우회, 기본/추천 경로선 비교, 시간·거리·수익·경유지, 재추천·안내 시작, 예시 검색/수익 안내                | 실제 장소 검색·Kakao 도로 경로·운영 추천 품질 검증             |
| 4.5 운행 안내                 | 도착·대기 타이머·연장, 탑승/미탑승, 하차·요금, 재추천, 종료 요약, 상태 복구, 중복 동작 방지                                            | 운행 이벤트·멱등성·정산 API와 통합 검증                        |

진행률은 **프런트 구현·로컬 검증 80% + 백엔드 계약 대응·격리된 연동 검증 10% + 운영 인증/데이터 통합 검증 10%**로 나눠 평가합니다.
이전의 미완료 20%를 연동 계약 검증과 운영 검증으로 구분했습니다. 현재 4.1~4.4는 각 90%, 4.5는 80%입니다.
4.1의 인증·프로필과 4.4의 경로는 격리된 HTTP 응답으로 검증했고, 4.2·4.3은 로컬 FastAPI 예측 응답도 어댑터와 대조했습니다.
실제 인증·메일·외부 경로 제공자·운영 DB·AI 데이터 검증 전에는 완료로 표시하지 않습니다.

### 데모와 실제 API 모드

`.env.local`에서 설정합니다. `.env.local`은 Git에 올라가지 않습니다.

| 변수                                 | 용도                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `VITE_API_MODE=demo`                 | 로컬 예시 예측·경로 및 브라우저 저장 사용                                       |
| `VITE_API_MODE=live`                 | 실제 API 사용. 실패 시 데모 데이터로 바뀌지 않음                                |
| `VITE_API_BASE_URL`                  | 버전을 포함한 API 기본 주소, 예: `http://localhost:8000/api/v1`                 |
| `VITE_PLACE_SEARCH_SOURCE`           | `sample`: 현재 백엔드의 예시 장소 4곳 안내. 다른 서버의 출처를 모르면 `unknown` |
| `VITE_ROUTE_ESTIMATE_SOURCE`         | `sample`: 현재 백엔드의 수익은 예시 추정값임을 표시. 출처를 모르면 `unknown`    |
| `VITE_SUPABASE_URL`                  | Supabase 프로젝트 URL                                                           |
| `VITE_SUPABASE_ANON_KEY`             | 브라우저 공개용 anon/publishable 키                                             |
| `VITE_TERMS_URL`, `VITE_PRIVACY_URL` | 확정된 약관·개인정보 처리방침 HTTPS URL                                         |

서비스 역할 키나 카카오 Client Secret을 `VITE_` 변수에 넣으면 안 됩니다. 해당 값은 서버/인증 제공자 설정에서 관리합니다.
실제 카카오 로그인은 Supabase의 Kakao 공급자, Kakao 앱 콜백, 배포 주소의 Redirect URL을 설정해야 합니다.
이메일 로그인·회원가입은 같은 Supabase 프로젝트의 Email 공급자를 사용합니다. 회원가입 시 이름을 `user_metadata.full_name`에 전달합니다.
가입 응답에 세션이 없으면 확인 메일을 안내하고, 세션이 반환된 경우에는 앱으로 진입합니다.
현재 PKCE 구성에서는 Email 공급자의 이메일 확인을 켜고 실제 확인 링크 복귀까지 검증해야 합니다.
Supabase의 Site URL/Redirect URLs에 실제 앱 주소를 등록하고 메일 발신 설정을 구성해야 합니다.
비밀번호는 Supabase 인증 요청으로만 전송하며 앱의 프로필·운행 저장소에는 기록하지 않습니다.
앱은 PKCE 방식의 Supabase 세션을 사용하고, API에 Bearer 토큰을 전달합니다.
인증과 약관 URL이 준비되지 않은 환경에서는 정식 로그인 버튼이 비활성화됩니다.

설정 참고: [Supabase 카카오 로그인](https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao),
[이메일·비밀번호 인증](https://supabase.com/docs/guides/auth/passwords),
[Redirect URL 설정](https://supabase.com/docs/guides/auth/redirect-urls).

### 백엔드 연결 계약과 검증 범위

아래 경로는 `backend/`의 FastAPI 구현과 대조했습니다. 운영 서버·인증·외부 API까지 연결한 최종 검증은 아직 남아 있습니다.
모든 경로 앞에 `VITE_API_BASE_URL`이 붙습니다. 타입 파일이 요청/응답 구조의 기준입니다.

| 요청                                                       | 구조·용도                                                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /forecast/zones?metric=hourly&horizon=0&resolution=8` | `src/types/forecast.ts`의 `ForecastApiResponse`; 어댑터가 출처·표시 정보를 더해 `ForecastResponse`로 정규화             |
| `GET /places/search?q=...`                                 | `src/types/route.ts`의 `Place[]`                                                                                        |
| `POST /routes/recommendations`                             | `RouteRequest` → `RoutePlan`; `directPath/recommendedPath`는 선택적인 `[위도, 경도][]`, 재추천 시 `excludeStopIds` 전달 |
| `POST /trips`                                              | `{routeId,destination,detour}` → `{id}`; `Idempotency-Key` 헤더                                                         |
| `POST /trips/{id}/events`                                  | `{eventId,type,occurredAt,payload}` → `{accepted,totals?}`; 같은 키의 요청은 동일한 결과 반환 필요                      |
| `GET /me/profile`                                          | `UserProfile`; 404일 때만 마이페이지 최초 등록 폼을 표시하며 401/서버 오류는 구분                                       |
| `PATCH /me/profile`                                        | 전체 `UserProfile` 생성 또는 수정 후 확정값 반환. 성공 전 미등록 프로필·즐겨찾기를 저장된 것으로 취급하지 않음          |
| `GET /me/trips?month=YYYY-MM`                              | `src/types/history.ts`의 `TripRecord[]`                                                                                 |

운행 이벤트는 `ARRIVE`, `PICK_UP`, `DROP_OFF`, `SKIP`, `EXTEND_WAIT`, `RECOMMEND`, `FINISH`를 사용합니다.
실제 모드의 `DROP_OFF`·`FINISH` 응답에는 `{revenue,cost,extraProfit}` 정산값이 반드시 있어야 합니다.
API는 12초 타임아웃, 요청 취소, 401·403·네트워크 오류를 처리하며 잘못된 응답은 오류로 표시합니다.
API 서버는 프런트 출처의 CORS와 `Authorization`, `Idempotency-Key` 헤더를 허용해야 합니다.

현재 예측 API의 `mock-gangnam`, `mock-gyodae` 두 명시적 예시 구역에 한해 유효한 좌표로 표시용 H3를 계산합니다.
수익·시계열 값은 그대로 유지하며 지도·목록·상세에 **서버 예시 데이터**를 표시합니다.
일반 서버의 잘못된 H3는 오류이며 예시 데이터로 대체하지 않습니다.
서버의 선택 필드 `source`(`demo/mock/model/live/unknown`)와 `demo`도 프런트 어댑터가 지원하되,
미제공·`live`·`demo:false`만으로 실제 AI 예측이라고 단정하지 않습니다. 이 선택 필드는 현재 백엔드의 필수 계약이 아닙니다.
`provenance`, `geometrySource`는 프런트에서만 생성하는 표시용 정보입니다.

`live`는 API 통신 방식입니다. 현재 백엔드의 장소 4곳과 예상 수익은 예시 데이터이므로 `.env.example`의 출처 설정도 `sample`입니다.
경로선은 서버가 실제로 전달한 좌표만 그립니다. 경로 좌표가 없으면 위치만 표시하며 임의의 도로선을 생성하지 않습니다.
운행 저장에 필요한 `trips` 테이블과 `record_trip_event` 함수의 마이그레이션은 아직 저장소에 없습니다.
백엔드 담당자의 SQL 반영과 실제 DB 설정 후 4.5의 저장·멱등성·정산을 통합 검증해야 합니다.

### 저장과 제한 사항

- 데모 로그인, 프로필·즐겨찾기·알림 선호, 추천 초안·운행 상태·기록은 이 브라우저에 저장합니다. 앱 데이터는 버전·사용자별로 분리합니다.
- 위치 권한은 사용자의 버튼 클릭으로 요청합니다. 하차 위치는 새로운 위치 확인이나 직접 선택이 필요합니다.
- 대기 타이머는 종료 시각을 저장해 새로고침 후 이어지고, 완료 기록은 운행 ID로 중복 저장을 막습니다.
- 예시 기록은 명시적으로 선택했을 때만 표시하며 저장된 운행의 수익과 합산하지 않습니다.
- 알림 설정은 앱 선호 저장까지 구현했습니다. 푸시 알림 전송은 연결되지 않았습니다.
- 데모 경로·예측·비용·수익은 시연용입니다. 실제 도로 내비게이션이나 수익 예측으로 사용하지 않습니다.
- 실제 인증 성공/실패, 실제 추천 품질, 서버 정산, 서버와 클라이언트의 최종 상태 일치는 백엔드 연결 후 검증해야 합니다.
- 온라인 지도는 OpenStreetMap 타일과 출처 표시를 사용합니다. 타일을 읽지 못해도 구역 목록·상세·추천 흐름은 사용할 수 있습니다.
- 원본의 Figma 호스팅 폰트가 불러와지지 않으면 시스템 글꼴로 대체합니다.

### 폴더 구조

```text
public/assets/     원본 화면의 이미지·아이콘
src/
  components/     공통·지도·동선·운행·프로필·기록 UI
  hooks/          인증·라우트·위치·예측·운행 상태
  pages/          로그인·지도·동선·운행·기록·마이페이지
  services/       API 전송, 인증, 기능별 요청과 명시적 데모 데이터
  styles/         기능별 반응형 스타일
  types/          API 모델과 운행 상태 전이
  utils/          URL 전환·자산·사용자별 저장
  App.tsx         인증 상태별 화면 구성 및 화면 단위 지연 로딩
  main.tsx        React 진입점과 오류 경계
  index.css       원본 공통 스타일
 tests/            상태·계산 단위 테스트 및 e2e 브라우저 테스트
```

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Leaflet · H3 · Supabase Auth
