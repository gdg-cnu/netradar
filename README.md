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
```

단위 테스트는 예측 계산·H3 격자·순위·운행 상태 전이·저장 복구·계정 격리를 확인합니다.
브라우저 테스트는 데스크톱과 모바일에서 지도→격자 상세→동선→운행 종료→기록,
프로필·즐겨찾기 저장, 동의·로그아웃, 지도 타일 장애 대응을 확인합니다.

### WBS 구현 범위

| WBS                           | 프런트엔드 구현                                                                                                                | 실제 서비스 연결에서 남은 일                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 4.1 앱 골격·로그인·마이페이지 | 화면 라우트, URL·새로고침 복구, 동의 UI, Supabase 카카오 인증 진입점, 실제 위치 요청, API 공통 처리, 프로필·차종·즐겨찾기·기록 | Supabase/Kakao 설정, 확정 약관 연결, 인증·사용자 API 통합 검증 |
| 4.2 시급 지도                 | Leaflet 지도, H3 해상도 8 육각형, 시급/승객·시간 필터, 1위 추천, 구역 선택, 위치 표시, 타일 장애 시 대체 화면                  | 실제 예측 API·데이터 및 지도 운영 설정 검증                    |
| 4.3 격자 상세                 | 추천 이유, 매출·비용·순시급, 시간 추이, 동선 추천 연결, 다른 구역 탐색                                                         | 실제 계산 결과와 API 응답 검증                                 |
| 4.4 동선 설정·추천 결과       | 출발지·목적지 검색, 집·충전소, 우회 범위, 경유지, 기본/추천 시간·거리·수익 비교, 재추천·안내 시작                              | 실제 장소 검색·경로 추천 API 통합 검증                         |
| 4.5 운행 안내                 | 도착·대기 타이머·연장, 탑승/미탑승, 하차·요금, 재추천, 종료 요약, 상태 복구, 중복 동작 방지                                    | 운행 이벤트·멱등성·정산 API와 통합 검증                        |

진행률은 **프런트 구현과 로컬 검증 80% + 실제 인증/API 통합 검증 20%** 기준으로 평가합니다.
현재 4.1~4.5는 각 80%이며, 실제 서버 연결 검증 전에는 완료로 표시하지 않습니다.

### 데모와 실제 API 모드

`.env.local`에서 설정합니다. `.env.local`은 Git에 올라가지 않습니다.

| 변수                                 | 용도                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| `VITE_API_MODE=demo`                 | 로컬 예시 예측·경로 및 브라우저 저장 사용                       |
| `VITE_API_MODE=live`                 | 실제 API 사용. 실패 시 데모 데이터로 바뀌지 않음                |
| `VITE_API_BASE_URL`                  | 버전을 포함한 API 기본 주소, 예: `http://localhost:8000/api/v1` |
| `VITE_SUPABASE_URL`                  | Supabase 프로젝트 URL                                           |
| `VITE_SUPABASE_ANON_KEY`             | 브라우저 공개용 anon/publishable 키                             |
| `VITE_TERMS_URL`, `VITE_PRIVACY_URL` | 확정된 약관·개인정보 처리방침 HTTPS URL                         |

서비스 역할 키나 카카오 Client Secret을 `VITE_` 변수에 넣으면 안 됩니다. 해당 값은 서버/인증 제공자 설정에서 관리합니다.
실제 카카오 로그인은 Supabase의 Kakao 공급자, Kakao 앱 콜백, 배포 주소의 Redirect URL을 설정해야 합니다.
앱은 PKCE 방식의 Supabase 세션을 사용하고, API에 Bearer 토큰을 전달합니다.
인증과 약관 URL이 준비되지 않은 환경에서는 정식 로그인 버튼이 비활성화됩니다.

설정 참고: [Supabase 카카오 로그인](https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao).

### 백엔드 연결 계약 초안

아래 경로는 프런트엔드에서 사용 중인 **제안 계약**이며, 아직 팀의 OpenAPI 확정본이나 실제 서버로 검증되지 않았습니다.
모든 경로 앞에 `VITE_API_BASE_URL`이 붙습니다. 타입 파일이 요청/응답 구조의 기준입니다.

| 요청                                                       | 구조·용도                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /forecast/zones?metric=hourly&horizon=0&resolution=8` | `src/types/forecast.ts`의 `ForecastResponse`; H3 구역별 0/30/60분 예측                             |
| `GET /places/search?q=...`                                 | `src/types/route.ts`의 `Place[]`                                                                   |
| `POST /routes/recommendations`                             | `RouteRequest` → `RoutePlan`; 재추천 시 `excludeStopIds` 전달                                      |
| `POST /trips`                                              | `{routeId,destination,detour}` → `{id}`; `Idempotency-Key` 헤더                                    |
| `POST /trips/{id}/events`                                  | `{eventId,type,occurredAt,payload}` → `{accepted,totals?}`; 같은 키의 요청은 동일한 결과 반환 필요 |
| `GET /me/profile`                                          | `src/types/profile.ts`의 `UserProfile`                                                             |
| `PATCH /me/profile`                                        | 전체 `UserProfile` 저장 후 확정된 `UserProfile` 반환                                               |
| `GET /me/trips?month=YYYY-MM`                              | `src/types/history.ts`의 `TripRecord[]`                                                            |

운행 이벤트는 `ARRIVE`, `PICK_UP`, `DROP_OFF`, `SKIP`, `EXTEND_WAIT`, `RECOMMEND`, `FINISH`를 사용합니다.
실제 모드의 `DROP_OFF`·`FINISH` 응답에는 `{revenue,cost,extraProfit}` 정산값이 반드시 있어야 합니다.
API는 12초 타임아웃, 요청 취소, 401·403·네트워크 오류를 처리하며 잘못된 응답은 오류로 표시합니다.
API 서버는 프런트 출처의 CORS와 `Authorization`, `Idempotency-Key` 헤더를 허용해야 합니다.

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
