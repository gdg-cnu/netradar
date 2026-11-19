# 넷레이더 프론트 수정 사항 (현재 코드 → v2)

- 기준: 현재 `front/src`·`front/tests` 코드, `netradar-v2-frontend.md`, `netradar-v2-backend.md`
- 작성일: 2026-11-16 (코드 대조 검토 반영: 2026-11-16)
- 아래 파일 경로는 모두 `front/src` 기준. 테스트는 `front/tests` 기준

## 1. 현재 코드 상태 요약

| 항목 | 현재 코드 | v2 계획서 | 판단 |
|---|---|---|---|
| 구조 | pages / components / hooks / services / types로 이미 분리 | 계층화 필요 | 완료. 추가 작업 없음 |
| 지도 | Leaflet + H3(해상도 8) 육각 격자 | 카카오맵, 장소 폴리곤 | Leaflet 유지, H3만 제거 (결정 필요 1) |
| 라우팅 | 해시 라우팅(`#/map`) 직접 구현 | react-router | 유지 가능 (결정 필요 2) |
| 목업 | `apiRequest`의 데모 모드 fallback | MSW | 유지 가능. 데모 데이터만 교체 |
| 서버 상태 | 훅마다 `useState` + `AbortController` | TanStack Query | 유지 가능 |
| 인증 | Supabase 이메일 로그인, 데모 로그인 (카카오 로그인 제거) | 카카오 로그인 | 이메일·비밀번호로 확정 |
| 필드 표기 | camelCase | API 명세는 snake_case | 백엔드와 통일 필요 (결정 필요 3, 최우선) |
| 핵심 지표 | 순시급(`netHourly`), 승객 수 | 수요 지수, 인구 | 교체 |
| 로컬 저장 | `drive`·`route-draft`·`trips`·`profile`을 localStorage에 저장, 읽을 때 검증 실패 시 버림 | - | 타입 변경 시 기존 저장값 처리 필요 (3.6) |

## 2. 그대로 쓰는 파일

| 파일 | 이유 |
|---|---|
| `services/api.ts`, `services/auth.ts` | 요청·인증·에러 처리 공통 로직 |
| `hooks/useAppSession.ts`, `hooks/useLocation.ts` | 세션, 위치 권한 |
| `utils/storage.ts`, `utils/assets.ts`, `utils/navigation.ts` | 공통 유틸 |
| `components/common/*` (TermsDialog 제외), `components/layout/Navigation.tsx` | 공통 UI (문구만 일부 수정) |
| `components/route/PlaceSearch.tsx` | 장소 검색 (`/places/search` 유지 시) |
| `pages/LoginPage.tsx` | 로그인 |

> `pages/MyPage.tsx`, `components/profile/FavoriteEditor.tsx`는 프로필 API 분리와 급증 알림 설정 때문에 수정 대상으로 이동 (3.5)

## 3. 수정할 파일

### 3.1 수요 지도 (가장 큰 변경)

| 파일 | 현재 | 변경 |
|---|---|---|
| `types/forecast.ts` | `ForecastMetric = 'hourly' \| 'passengers'`, `ForecastHorizon = 0 \| 30 \| 60`, `ForecastPoint`에 매출·연료비·공차비·순시급, `h3Index` | `metric: 'surge' \| 'population'`. 장소 단위로 `placeId`, `polygon`, `surgeIndex`, `expectedPop`, `reasons`, `events`. `horizon` → `offset` 값 범위 명세와 확인 |
| `services/forecast.ts` | `GET /forecast/zones?resolution=8`, H3 검증, 강남 7개 역 시급 데모 데이터 | `GET /heatmap?metric&offset&bbox`. H3 검증 삭제, 폴리곤 검증으로 교체. 데모 데이터를 공항·공연장·역·막차 장소로 교체. 정렬 기준을 `surgeIndex`로 |
| `hooks/useForecast.ts` | `(metric, horizon)` | `(metric, offset, bbox)`로 인자 변경. bbox 변경 시 재요청(디바운스) |
| `components/map/ForecastMap.tsx` | `cellToBoundary(h3Index)`로 육각형 그림, 순위 기반 색 | API의 `polygon`을 그대로 그림. 색은 응답 `range` 기준. 지도 이동 시 현재 bbox를 상위로 전달(`onBoundsChange`) |
| `components/map/ZoneDetails.tsx` | 순시급, 매출·비용 막대, 시급 추이 | `PlaceDetails`로 이름 변경. 예보 이유, 관련 이벤트, 시점별 수요 지수 추이, 근처 승차대, "바로 출발"·"동선 추천" 버튼. 매출·비용 막대 삭제. 동선 추천 이동 시 이미 넘기는 `zone` 파라미터를 `targetPlaceId`로 정리 |
| `pages/MapPage.tsx` | 제목 "어디에서 운행하면 좋을까요?", 지표 토글 "시급 보기/승객 수 보기", 추천 1위 버튼 | 제목·토글을 "수요 지수/인구"로. 추천 1위 버튼 자리에 급증 알림 카드(신규). 목록 문구 교체. bbox 상태 보관, 급증 알림용으로 `useLocation` 사용 |
| `data/navigation.ts` | 탭 이름 "시급 지도" | "수요 지도" |
| `styles/map.css` | 비용 막대(`cost-*`) 스타일 | 삭제, 알림 카드·이벤트 스타일 추가 |

### 3.2 동선 추천

| 파일 | 현재 | 변경 |
|---|---|---|
| `services/routes.ts` `recommendRoute` | `POST /routes/recommendations`, 목적지 없으면 에러 | 명세의 `POST /routes/recommend`와 이름 통일 (어느 쪽으로든). 목적지 없는 요청(바로 출발) 허용. 데모 동선 생성 로직도 목적지 없는 경우 처리 |
| `services/routes.ts` `createTrip` | 요청 본문에 `destination` 필수 | 목적지 선택값으로 |
| `types/route.ts` | `RouteStop.expectedHourlyRate`, `RouteMetrics.earnings`, `excludeStopIds`, `RouteRequest.destination` 필수 | `surgeIndexAtArrival`, 예상 추가 수익 대신 경유지 수요 요약, `excludePlaceIds`. `targetPlaceId` 추가. `destination`을 선택값으로 |
| `types/route.ts` 검증 함수 | `isRoutePlan`이 `isPlace(destination)`, `expectedHourlyRate`, `earnings` 검사 | 새 필드 기준으로 수정. `isDriveState`·`driveReducer`(START)가 `isRoutePlan`을 쓰므로 함께 영향 받음 |
| `types/route.ts` `DETOUR_OPTIONS` | 많이 = 50% | 명세는 45%. 한쪽으로 통일 (`GET /config`에서 받으면 해결) |
| `pages/RoutePage.tsx` | 시급 기준 문구, URL의 `zone`은 이름 대체용으로만 사용 | 수요 지수 기준 문구. 장소 상세에서 넘어온 `targetPlaceId` 처리 |
| `components/route/RouteResults.tsx` | `earnings` 비교, `expectedHourlyRate` 표시, `destination.name` | 수요 지수 기준 표시. 목적지 없는 동선 표시 |
| `components/route/RouteComparisonMap.tsx` | `plan.destination` 좌표로 도착 마커·경로 범위 계산 | 목적지 없을 때 마커 생략, 범위는 경유지 기준 |

### 3.3 운행 안내

| 파일 | 현재 | 변경 |
|---|---|---|
| `pages/DrivePage.tsx` | 도착·대기·탑승·하차·재추천 흐름 구현. `plan.destination.name`(110·158·308행), `stop.expectedHourlyRate`(138행) 사용 | 흐름 유지. 급증 알림에서 "바로 출발"로 진입하는 경우(경유지 1곳, 목적지 없음) 문구 처리. 경유지 지표를 수요 지수로 |
| `hooks/useDrive.ts` | 운행 기록 저장 시 `plan.destination.name`(124행), 재추천 시 `destination`·`excludeStopIds`(255·257행) | 목적지 없는 운행 지원, `excludePlaceIds`로 변경 |
| `components/drive/DriveSummary.tsx` | `destination.name`, `totals.extraProfit` 표시 | 목적지 없는 운행 문구, 결정 4에 따라 수익 표시 정리 |
| `types/route.ts` `DriveTotals`, `isDriveTotals` | `revenue`, `cost`, `extraProfit` | 요금 입력은 유지하되 "추가 수익" 표기는 제거하거나 보조로 (결정 4). 실제 모드에서 `DROP_OFF`·`FINISH`에 정산값을 필수로 요구하는 검증도 함께 결정 |
| `services/routes.ts` `sendTripEvent`, `types/route.ts` `DriveAction` | 이벤트 `type`을 `PICK_UP` 등 액션 이름 그대로 전송, `payload`에 액션 객체 전체 | 명세 값(`boarded` 등)으로 변환하는 매핑 추가, `payload` 형식 명세와 맞춤 |

### 3.4 리플레이

| 파일 | 현재 | 변경 |
|---|---|---|
| `services/history.ts` | `GET /me/trips?month=`, 로컬 저장 | 명세는 `GET /replay/calendar`, `GET /replay/days/{date}`. 경로 통일. `isTripRecord`·`exampleTrips` 새 필드 기준으로 |
| `types/history.ts` `TripRecord` | 매출·비용·추가 수익 중심, `destination` 필수 | 경유지별 예보 수요 지수와 실제 인구 변화 필드 추가. 목적지 없는 운행 대응 |
| `pages/ReplayPage.tsx` | `extraProfit` 합계(56행) | 예보 vs 실제 비교 요약. 결정 4에 따라 합계 지표 교체 |
| `components/replay/RideCard.tsx` | 수익 카드, `extraProfit` | 예보 vs 실제 비교 표시 추가 |

### 3.5 마이페이지·기타

| 파일 | 현재 | 변경 |
|---|---|---|
| `services/profile.ts` | `GET /me/profile` + `PATCH /me/profile` 한 번으로 전체 저장, `vehicleType`, 알림 1개 | 명세는 `/me`, `/me/places`, `/me/settings`. 저장 흐름을 여러 요청으로 분리하고 일부 실패 처리 추가. `isProfile` 검증 수정 |
| `types/profile.ts` | `vehicleType`, `notifications: boolean` | 명세 필드로 통일. 알림 설정에 "급증 알림" 항목 |
| `pages/MyPage.tsx` | 차종(205행)·알림 토글(320행), 단일 저장 | 분리된 API와 새 설정 필드 반영, 급증 알림 토글 추가 |
| `components/profile/FavoriteEditor.tsx` | 프로필 저장의 일부로 즐겨찾기 저장 | `/me/places` 기준으로 저장 확인 |
| `components/common/TermsDialog.tsx` | 데모 데이터 안내 문구 | 공개 데이터 출처(실시간 도시데이터, 공항, KOPIS 등)와 가정 안내 문구 |
| `App.tsx` 데모 배너 | "예시 예측과 운행 데이터" | 문구만 수정 |
| `services/routes.ts` 안내 문구 | `placeSearchNotice`, `routeEstimateNotice`가 샘플 장소 4곳·예상 수익 기준 | v2 데이터 출처 기준으로 수정 |
| `front/.env.example` | `VITE_ROUTE_ESTIMATE_SOURCE` 등 수익 기준 설명 | v2 기준으로 정리 |
| `README.md` | API 표가 v1 경로·타입 기준 | v2 경로·타입으로 갱신 |

### 3.6 로컬 저장 데이터 호환

| 대상 | 현재 | 변경 |
|---|---|---|
| `drive` (`hooks/useDrive.ts`) | `DriveState.version: 1`, 읽을 때 `isDriveState` 실패 시 버림 | 필드 변경 시 `version` 올림. 진행 중 운행을 버릴지 변환할지 결정 후 처리 |
| `route-draft` (`pages/RoutePage.tsx`) | `plan` 포함 저장 | 옛 `plan`은 검증 실패로 버려지는지 확인 |
| `trips` (`services/history.ts`) | 데모 모드 로컬 운행 기록 | 새 `TripRecord` 기준으로 변환 또는 초기화 |
| `profile` (`services/profile.ts`) | 데모 모드 로컬 프로필 | 새 필드 기준으로 변환 또는 기본값으로 |

## 4. 새로 만들 파일

| 파일 | 내용 | API |
|---|---|---|
| `types/alert.ts`, `services/alerts.ts`, `hooks/useAlerts.ts` | 급증 알림 데이터 | `GET /alerts/top?lat&lng` |
| `components/map/SurgeAlertCards.tsx` | 상위 1~3건, 출발 권장 시각, 도착 시점 지수 | |
| `types/event.ts`, `services/events.ts`, `hooks/useEvents.ts` | 이벤트 데이터 | `GET /events?from&to&bbox&type` |
| `components/map/EventTimeline.tsx` | 오늘 남은 공항 피크, 공연 종료, 막차. 유형 필터 | |
| `services/places.ts`, `components/map/PlaceDetails.tsx` | 장소 상세 | `GET /places/{id}` |
| `components/common/FreshnessBadge.tsx` | `generatedAt` 20분 경과 시 회색 표시 | |

## 5. 정리·삭제

| 대상 | 이유 |
|---|---|
| `h3-js` 의존성 | 장소 폴리곤으로 바뀌면 불필요. 단, 테스트 2개가 import 중이므로 테스트 교체 후 삭제 (7장) |
| `formatWon` 사용처 중 시급 표시 | 주 지표가 아님 (요금 입력에는 유지) |
| `services/forecast.ts`의 `knownServerMockZones` 등 서버 목업 호환 코드 | v1 백엔드 목업 전용 |

## 6. 백엔드와 맞춰야 할 API 경로

| 기능 | 현재 프론트 | v2 명세 | 비고 |
|---|---|---|---|
| 지도 | `/forecast/zones` | `/heatmap` | `offset` 값 범위 확인 |
| 장소 상세 | 없음 | `/places/{id}` | `/places/search`와 경로가 겹침. 백엔드에서 `search` 라우트를 먼저 등록하거나 상세를 `/place-details/{id}` 등으로 분리 |
| 동선 | `/routes/recommendations` | `/routes/recommend` | 목적지 없는 요청 허용 여부 |
| 운행 기록 조회 | `/me/trips?month=` | `/replay/calendar`, `/replay/days/{date}` | |
| 프로필 | `GET`·`PATCH /me/profile` | `/me`, `/me/places`, `/me/settings` | |
| 운행 | `/trips`, `/trips/{id}/events` | 같음 | 이벤트 `type` 값이 다름 (`PICK_UP` vs `boarded`). `payload` 형식, `destination` 선택 여부 확인 |
| 알림·이벤트 | 없음 | `/alerts/top`, `/events` | 신규 |

## 7. 테스트 수정

이 작업을 하면 `npm test`, `npm run test:e2e`, `npm run test:e2e:live`가 대부분 실패하므로 함께 수정한다.

| 파일 | 현재 | 변경 |
|---|---|---|
| `tests/forecast.test.ts` | H3 셀 검증(`cellToBoundary`, `isValidCell`), 시급 순위 | 폴리곤·`surgeIndex` 정렬 기준으로 재작성 |
| `tests/forecast-compatibility.test.ts`, `tests/fixtures/backend-zones.json` | v1 백엔드 목업(`mock-gangnam` 등) 호환, `h3-js` 사용 | v2 `/heatmap` 응답 fixture로 교체 |
| `tests/route.test.ts`, `tests/drive.test.ts` | `expectedHourlyRate`, `earnings`, `extraProfit`, 목적지 필수 | 새 필드, 목적지 없는 운행, 이벤트 타입 매핑 케이스 추가 |
| `tests/profile-settings.test.ts` | 단일 `/me/profile` | 분리된 프로필 API 기준 |
| `tests/e2e/frontend.spec.ts` | '승객 수 보기', '시급 지도', '이 구역으로 동선 추천' 등 화면 문구 | 바뀐 문구, 급증 알림·바로 출발 흐름 추가 |
| `tests/live/fixtures.ts`, `tests/live/backend-contract.spec.ts` | `/forecast/zones`, `/routes/recommendations`, `/me/trips`, `/me/profile` 가로채기 | v2 경로와 응답으로 교체 |

## 8. 팀 결정 사항

1. 지도: Leaflet 유지 vs 카카오맵 전환. 이미 Leaflet으로 지도·경로 비교가 구현되어 있어 유지를 권장
2. 라우팅·목업·서버 상태: 현재 방식(해시 라우팅, 데모 모드, useState) 유지 vs 계획서 방식(react-router, MSW, TanStack Query). 4주 일정상 유지를 권장
3. 필드 표기: camelCase(현재 프론트) vs snake_case(명세). snake_case로 가면 모든 응답 검증 함수(`isRoutePlan`, `isTripRecord`, `isProfile`, `normalizeForecastResponse`)와 타입을 고쳐야 해 사실상 서비스 계층 전체 재작성. 백엔드 응답을 camelCase로 맞추는 쪽을 권장하며 가장 먼저 확정
4. 시급·요금·추가 수익 표시를 보조 지표로 남길지. `RouteResults`, `DrivePage`, `DriveSummary`, `RideCard`, `ReplayPage`, `isDriveTotals`, 정산값 필수 검증의 범위가 달라지므로 작업 순서 5 전에 확정
5. 이메일 로그인 유지 여부 → 이메일·비밀번호만 사용, 카카오 로그인 제거로 확정
6. 기존 로컬 저장 데이터(진행 중 운행, 운행 기록) 처리: 버림 vs 변환 (3.6)

## 9. 작업 순서

| 순서 | 작업 |
|---|---|
| 1 | 6장 API 경로와 결정 3·4·6을 백엔드와 확정 |
| 2 | `types/forecast.ts`, `services/forecast.ts` 교체, 데모 데이터 작성, 관련 테스트 교체 |
| 3 | `ForecastMap` H3 제거·bbox 전달, `useForecast` 인자 변경, `PlaceDetails`, `MapPage` 문구·토글 교체 |
| 4 | 급증 알림 카드, 이벤트 타임라인 신규 |
| 5 | `types/route.ts` 목적지 선택값·검증 함수 수정, 동선·운행에 "바로 출발" 진입 추가, 이벤트 타입 매핑, 경로·필드명 통일, 저장 데이터 버전 올림 |
| 6 | 리플레이 예보 vs 실제, 프로필 API 분리·마이페이지 반영 |
| 7 | e2e·live 테스트, README·`.env.example`·안내 문구 정리, `h3-js` 삭제 |
