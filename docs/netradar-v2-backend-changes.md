# 넷레이더 백엔드 수정 사항 (현재 코드 → v2)

- 기준: `docs/netradar-v2-frontend-changes.md`, `docs/netradar-v2-mock-preview.md`, 현재 `backend/` 코드, v2 프론트 목업 타입(`front/src/v2/types/demand.ts`, `front/src/v2/types/drive.ts`)
- 작성일: 2026-11-19
- 아래 응답 필드는 v2 프론트 목업 모델에 맞춘 **제안안**이다. 프론트 목업 타입도 확정된 계약이 아니므로, 백엔드·프론트가 이 문서를 보고 함께 확정한다.
- 경로는 모두 `/api/v1` 접두사 기준이다 (`main.py`의 `include_router(prefix="/api/v1")`).

## 1. 현재 백엔드 상태 요약

| 항목 | 현재 코드 | v2에서 필요한 것 | 판단 |
|---|---|---|---|
| 핵심 지표 | 순시급(`netHourly`), 승객 수, 매출·연료비·공차비 | 수요 지수(`surgeIndex`, 0~100), 인구(`population`, 명) | 교체 |
| 공간 단위 | 강남 일대 4곳, 가짜 `h3Index`(`mock-gangnam`) | 장소 단위 폴리곤 (공항·공연장·역 등) | 교체 |
| 시점 | `horizon` 0/30/60 | `offset` 0/30/60 | 이름 변경 |
| 동선 추천 | 목적지 필수, 경유지 1곳, 추가 수익 계산 | 목적지 선택, 경유지 최대 3곳, 도착 시점 수요 지수 | 수정 |
| 운행 | 목적지 필수, 이벤트 타입 대문자(`PICK_UP` 등), 수익 합계 | 목적지 선택, 이벤트 타입 v2 기준, 요금·승객 합계 | 수정 |
| 리플레이 | `GET /me/trips?month=` | 달력 + 일별 예보/관측 비교 | 신규 |
| 프로필 | `GET`·`PATCH /me/profile` 하나로 전체 저장 | `/me`, `/me/places`, `/me/settings` 분리, 급증 알림 설정 | 분리 |
| 알림·이벤트 | 없음 | `/alerts/top`, `/events` | 신규 |
| 필드 표기 | camelCase | 프론트 v2 목업도 camelCase | **camelCase 유지 권장** (프론트 문서 결정 3) |

## 2. 공통 수정

| 대상 | 현재 | 변경 |
|---|---|---|
| 응답 필드 표기 | camelCase | 유지. 새 API도 camelCase로 통일 |
| 생성 시각 | 예보는 ISO 문자열, 동선은 밀리초 숫자(`generatedAt: int`) | 예보·알림·이벤트는 **타임존이 포함된 ISO 문자열**(예: `2026-11-19T09:00:00+09:00`). 프론트가 `generatedAt` 기준 20분 경과 시 회색 처리하고, 타임존 없는 시각은 "신선도 확인 불가"로 표시함 |
| 좌표 규약 | 경로선 `[위도, 경도]` | 폴리곤은 GeoJSON 규약 `[경도, 위도]`, 닫힌 외곽 링(첫 점 = 마지막 점). 경로선은 기존 `[위도, 경도]` 유지 (프론트 지도 코드 기준) |
| 출처 표시 | `demo: bool` | `source: 'mock' \| 'model'` 등으로 데이터 출처 명시 (프론트 목업은 `source: 'mock'`) |
| `main.py` CORS | `GET, POST, PATCH, OPTIONS` | `/me/places`를 `PUT`/`DELETE`로 만들 경우 메서드 추가 |
| `main.py` 설명 | "예상 시급 및 동선 추천 서비스" | "택시 수요 급증 예보" 기준으로 수정 |

## 3. 추가할 API

### 3.1 `GET /heatmap` — 수요 지도

- 쿼리: `metric=surge|population`, `offset=0|30|60`, `bbox=west,south,east,north` (선택)
- 정렬: `metric=surge`면 `surgeIndex`, `population`이면 `population` 내림차순
- 응답 (프론트 `DemandPlace`·`DemandPoint` 기준):

```json
{
  "generatedAt": "2026-11-19T09:00:00+09:00",
  "source": "mock",
  "metric": "surge",
  "offset": 30,
  "places": [
    {
      "id": "incheon-t1",
      "name": "인천공항 T1",
      "type": "airport",
      "lat": 37.4486,
      "lng": 126.4512,
      "polygon": [[126.4482, 37.4466], [126.4532, 37.4461], "...", [126.4482, 37.4466]],
      "points": [
        { "offset": 0, "surgeIndex": 54, "population": 2400, "range": "moderate", "populationRange": "moderate" },
        { "offset": 30, "surgeIndex": 91, "population": 4800, "range": "high", "populationRange": "high" },
        { "offset": 60, "surgeIndex": 72, "population": 3200, "range": "high", "populationRange": "moderate" }
      ]
    }
  ]
}
```

- `type`: `airport | concert | train | last_train`
- `range`, `populationRange`: `low | moderate | high`. 색상은 프론트가 이 값으로만 정하므로 **구간 경계는 백엔드가 책임**진다
- 프론트는 시점 토글을 바꿀 때 재요청 없이 바꾸기 위해 `points`에 0/30/60을 모두 담는 형태를 쓴다. `offset` 하나만 내려줄지 결정 필요 (6장)

### 3.2 `GET /places/{id}` — 장소 상세

- `/places/search`와 경로가 겹치므로 **`places.py`에서 `/search` 라우트를 먼저 등록**한다 (FastAPI는 등록 순서대로 매칭)
- 응답: 3.1의 장소 필드 + 아래 필드

| 필드 | 타입 | 설명 |
|---|---|---|
| `reasons` | `string[]` | 예보 이유 (예: "T1 입국 1,800명 예상") |
| `taxiStands` | `{ name, description }[]` | 근처 승차대 |
| `events` | `DemandEvent[]` | 해당 장소의 오늘 이벤트 (3.3 형식) |

- 없는 `id`면 404

### 3.3 `GET /events` — 이벤트 타임라인

- 쿼리: `from`, `to` (ISO, 기본값: 지금 ~ 한국 시간 오늘 자정), `bbox` (선택), `type=airport|concert|train|last_train` (선택)
- 기본 동작: **한국 시간 기준 오늘**이면서 `endsAt`이 지나지 않은 이벤트, `peakAt` 오름차순
- 응답 항목 (프론트 `DemandEvent`):

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | |
| `placeId` | string | `/heatmap` 장소 id와 일치해야 함 |
| `type` | string | 위 4종 |
| `title` | string | 예: "KE902 도착 집중" |
| `peakAt`, `endsAt` | ISO string | 피크 시작·종료 |
| `expectedExits` | int | 예상 이탈 인원(명) |
| `source` | string | 데이터 출처 (공항 운항 정보, KOPIS 등) |

### 3.4 `GET /alerts/top` — 급증 알림

- 쿼리: `lat`, `lng` (기사 현재 위치)
- 최대 3건. 프론트 목업 로직 기준:
  1. 오늘 남은 이벤트 중 피크 시작이 **지금부터 60분 이내**인 것
  2. 이동 시간 60분 이하, 도착 시각이 `endsAt` 이전인 것만
  3. `surgeIndexAtArrival` 내림차순, 같으면 `travelMinutes` 오름차순
- 응답 항목 (프론트 `DemandAlert`):

| 필드 | 타입 | 설명 |
|---|---|---|
| `id`, `placeId`, `reason` | string | |
| `travelMinutes` | int | 현재 위치 → 장소 이동 시간 |
| `recommendedDepartureAt` | ISO | `max(지금, peakStart - travelMinutes)` |
| `arrivalAt` | ISO | 지금 출발 시 도착 시각 |
| `peakStart`, `peakEnd` | ISO | |
| `surgeIndexAtArrival` | int | 도착 시점에 해당하는 offset(≤15분→0, ≤45분→30, 그 외→60)의 수요 지수 |

- 이동 시간: 목업은 직선거리 × 2.5 + 5분이다. 실제 연동 시 카카오모빌리티 사용 여부 결정 (호출 비용·지연 고려)

### 3.5 `GET /replay/calendar`, `GET /replay/days/{date}` — 리플레이

- `GET /replay/calendar?month=YYYY-MM`: 운행이 있는 날짜 목록 `[{ date, tripCount, passengers, fare }]`
- `GET /replay/days/{date}` (`YYYY-MM-DD`, 한국 시간 기준):

```json
{
  "date": "2026-11-19",
  "trips": [ "DemandTrip 형식 (4.3 참고)" ],
  "comparisons": [
    {
      "placeId": "incheon-t1",
      "name": "인천공항 T1",
      "points": [
        { "time": "16:00", "forecast": 2976, "observed": 2797 },
        { "time": "17:00", "forecast": 4800, "observed": null }
      ]
    }
  ]
}
```

- `forecast`, `observed` 모두 **명 단위**. 관측이 없는 시점은 `0`이 아니라 **`null`**로 내려야 함 (프론트가 빈 구간으로 그림)
- 이를 위해 예보 결과와 관측 인구를 시점별로 저장하는 테이블이 필요 (5장)

### 3.6 `/me`, `/me/places`, `/me/settings` — 프로필 분리

| API | 요청·응답 | DB |
|---|---|---|
| `GET`·`PATCH /me` | `{ name, vehicleType }` | `profiles.name`, `vehicle_type` |
| `GET`·`PUT /me/places` | `FavoritePlace[]` (현재 `favorites`와 같은 형식) | `profiles.favorites` |
| `GET`·`PATCH /me/settings` | `{ notifications, surgeAlerts }` | `profiles.notifications`, **신규 `surge_alerts`** |

- 프로필이 없을 때 `GET /me`는 지금처럼 404, `PATCH /me`는 생성(upsert) 동작 유지
- 현재 v2 프론트는 급증 알림 설정을 브라우저에만 저장(`netradar:v2:<계정>:preferences`)한다. 서버 저장으로 옮길지 확인 필요

## 4. 수정할 API

### 4.1 `POST /routes/recommendations` → `POST /routes/recommend`

| 항목 | 현재 (`schemas/route.py`, `routers/routes.py`) | 변경 |
|---|---|---|
| 경로 | `/routes/recommendations` | `/routes/recommend` |
| `destination` | `Place` 필수 | `Place \| null`. 없으면 "바로 출발" (목적지 없는 동선) |
| `targetPlaceId` | 없음 | 추가 (선택). 장소 상세·급증 알림에서 넘어온 장소를 **첫 경유지로 고정** |
| `excludeStopIds` | 있음 | `excludePlaceIds`로 이름 변경 |
| `detour` | `little/normal/much` → 1.15/1.30/1.50 | 프론트 v2는 `15/30/50`(%)을 씀. 값은 같으니 표기만 통일. 경유지 수 상한: 15% → 1곳, 30% → 2곳, 50% → 3곳 (명세의 45%와 다름, 6장) |
| 후보 장소 | `MOCK_PLACES` 강남 4곳 | v2 장소 목록 (3.1과 같은 출처) |
| 점수 | `get_hourly_rate` + `calculate_expected_earnings` (시급·비용 모델) | **도착 시점 수요 지수** 내림차순 → 도착 시간 짧은 순 |
| 경유지 응답 (`RouteStop`) | `waitMinutes`, `expectedHourlyRate` | `placeId`, `name`, `lat`, `lng`, `travelMinutes`, `arrivalMinutes`, `forecastOffset`, `surgeIndexAtArrival`, `reason`, `waitMinutes` |
| `surgeIndexAtArrival` | 없음 | 도착이 60분을 넘으면 예보 범위 밖이므로 **`null`** |
| `RouteMetrics.earnings` | 추가 수익 | 삭제 또는 보조 지표 (결정 4) |
| 카카오 경로 조회 | 항상 출발지→목적지 | 목적지가 없으면 출발지→마지막 경유지로 조회 |

- 삭제 대상 상수·함수: `COST_PER_KM`, `TIME_COST_PER_MINUTE`, `DEFAULT_HOURLY_RATE`, `get_hourly_rate`, `calculate_expected_earnings` (결정 4에서 수익 표시를 빼기로 하면)

### 4.2 `POST /trips` — 운행 생성

| 항목 | 현재 | 변경 |
|---|---|---|
| `destination` | `Place` 필수, DB에 이름 저장 | 선택값. DB `trips.destination` nullable |
| 추가 필드 | - | `originName`, `targetPlaceId`(선택) |
| `detour` | `little/normal/much` | 4.1과 같은 표기로 통일 |

### 4.3 `POST /trips/{id}/events` — 운행 이벤트

| 항목 | 현재 | 변경 |
|---|---|---|
| 이벤트 `type` | `ARRIVE`, `PICK_UP`, `DROP_OFF`, `SKIP`, `EXTEND_WAIT`, `RECOMMEND`, `FINISH` | v2 프론트 액션은 `arrive`, `extend`, `pickup`, `skip`, `dropoff`, `reroute`, `finish`. 명세의 `boarded` 등과도 다르므로 **한 가지로 확정** (6장) |
| `payload` | 프론트 액션 객체 전체 | `dropoff`: `{ fare: number \| null, location }`, `reroute`: `{ planId }` 등 타입별로 정의 |
| 요금 | `invalid_fare`면 422 | 요금 미입력(`null`) 허용. 프론트는 `fareRecorded`로 입력 여부를 따로 셈 |
| 응답 `totals` | `revenue`, `cost`, `extraProfit` | `passengers`, `fare`, `fareRecordedCount` (결정 4) |
| DB 함수 `record_trip_event` | 위 이벤트 타입·합계 기준 | 새 타입·합계 기준으로 수정 |

- v2 운행 기록 형식 (프론트 `DemandTrip`, 리플레이 응답에도 사용): `id`, `date`, `startedAt`, `endedAt`, `originName`, `destinationName | null`, `stopNames[]`, `passengers`, `fare`, `fareRecordedCount`, `durationMinutes`, `visits[{ placeId, name, arrivedAt, pickedUp, fare, fareRecorded }]`

### 4.4 `GET /places/search` — 장소 검색

- 검색 대상을 `MOCK_PLACES`(강남 4곳)에서 v2 장소 목록 + 일반 장소 검색으로 확장
- 응답 형식(`Place`: `id`, `name`, `address`, `lat`, `lng`)은 유지

## 5. 데이터·DB 수정

| 대상 | 현재 | 변경 |
|---|---|---|
| `data/mock_zones.py` | 강남 4곳 시급·승객 수, 가짜 `h3Index` | 삭제 → `data/mock_demand.py` (신규): 프론트 목업과 같은 6곳(인천공항 T1, 김포공항, 올림픽공원 공연장, 서울역, 홍대입구역, 강남역)의 폴리곤·0/30/60 지수·인구·이유·승차대 |
| `data/mock_places.py` | 강남 4곳 | v2 장소 기준으로 교체 (id를 `mock_demand`와 일치시킴) |
| 이벤트 목업 | 없음 | `data/mock_events.py` (신규): 공항 피크·공연 종료·열차·막차 예시. 시각은 요청 시점 기준으로 생성 (고정 시각이면 "오늘 남은 일정" 필터에 안 걸림) |
| `profiles` 테이블 | `name`, `vehicle_type`, `notifications`, `favorites` | 마이그레이션 `003`: `surge_alerts BOOLEAN NOT NULL DEFAULT TRUE` 추가 |
| `trips` 테이블, `record_trip_event` 함수 | 코드에서 쓰지만 **`migrations/`에 정의가 없음** | 현재 정의를 마이그레이션 파일로 먼저 옮긴 뒤 수정: `destination` nullable, `origin_name`·`target_place_id`·`fare_recorded_count` 추가, `revenue`·`cost`·`extra_profit` 정리 (결정 4) |
| 예보·관측 이력 | 없음 | 리플레이용 테이블 신규 (예: `demand_forecasts(place_id, target_at, offset, surge_index, population)`, `population_observations(place_id, observed_at, population)`). 관측 누락은 행이 없거나 `null` |

## 6. 삭제할 API·코드

> **주의:** `VITE_API_MODE=live`일 때 프론트는 아직 v1 화면과 v1 API를 쓴다. 아래 항목은 **프론트 live 모드가 v2로 전환된 뒤** 삭제한다. 그 전까지는 v2 API를 새로 추가하고 v1과 함께 둔다.

| 대상 | 대체 |
|---|---|
| `GET /forecast/zones`, `GET /forecast/zones/{zone_id}` (`routers/forecast.py`) | `/heatmap`, `/places/{id}` |
| `schemas/forecast.py` (`ForecastPoint`, `ForecastZone`, `ForecastResponse`) | 새 heatmap 스키마 |
| `POST /routes/recommendations` | `/routes/recommend` |
| `GET /me/trips` | `/replay/calendar`, `/replay/days/{date}` |
| `GET`·`PATCH /me/profile` | `/me`, `/me/places`, `/me/settings` |
| `data/mock_zones.py` | `data/mock_demand.py` |
| `tests/test_forecast.py` | 새 API 테스트로 교체 (7장) |

## 7. 테스트

| 파일 | 현재 | 변경 |
|---|---|---|
| `tests/test_forecast.py` | `/forecast/zones` 정렬·horizon·상세·404 | `test_heatmap.py`: metric별 정렬, offset 검증(0/30/60 외 422), bbox 필터, 폴리곤 닫힘·좌표 순서, `generatedAt` 타임존 포함 |
| 신규 | - | `/places/{id}` 404와 `/places/search` 경로 충돌 없음, `/events` 오늘 남은 일정·type 필터, `/alerts/top` 60분 기준·최대 3건·정렬, `/routes/recommend` 목적지 없음·`targetPlaceId` 첫 경유지·60분 초과 시 `null`·detour별 경유지 수 |
| 프론트 fixture | `front/tests/fixtures/backend-*.json`은 v1 목업 스냅샷 | v2 응답이 확정되면 새 스냅샷 제공 (프론트 문서 7장) |

## 8. 팀 결정 사항

프론트 문서 8장과 겹치는 항목은 번호를 같이 적었다.

1. **필드 표기 (프론트 결정 3, 최우선):** camelCase 유지 권장. 프론트 v2 목업 타입이 이미 camelCase
2. **`/heatmap` 응답 범위:** `offset` 하나만 vs 0/30/60 전체(`points`). 프론트 목업은 전체를 받는 구조
3. **수익 표시 (프론트 결정 4):** 동선 `earnings`, 운행 `revenue·cost·extraProfit`을 지울지, 보조 지표로 남길지
4. **운행 이벤트 타입:** v1 대문자, v2 프론트 소문자, 명세 `boarded` 중 하나로 통일
5. **우회 비율:** 50%(현재 코드·프론트) vs 45%(명세). `GET /config`로 내려주면 프론트 하드코딩 제거 가능
6. **이동 시간 계산:** 알림·동선에서 카카오모빌리티 실제 경로를 쓸지, 근사치를 쓸지
7. **급증 알림 설정 저장 위치:** 서버(`/me/settings`) vs 브라우저
8. **v1 API 제거 시점:** 프론트 live 모드 v2 전환과 맞춤

## 9. 작업 순서

| 순서 | 작업 |
|---|---|
| 1 | 8장 결정 1~5 확정, `trips`·`record_trip_event` 정의를 마이그레이션으로 옮기기 |
| 2 | `data/mock_demand.py`, `data/mock_events.py` 작성, `/heatmap`, `/places/{id}`, `/events` 추가 + 테스트 |
| 3 | `/alerts/top` 추가 |
| 4 | `/routes/recommend` (목적지 선택, `targetPlaceId`, 수요 지수 점수) |
| 5 | `/trips` 목적지 선택, 이벤트 타입·합계 변경, DB 함수 수정 |
| 6 | `/me`, `/me/places`, `/me/settings` 분리, `surge_alerts` 마이그레이션 |
| 7 | 예보·관측 이력 테이블, `/replay/calendar`, `/replay/days/{date}` |
| 8 | 프론트 live 모드 v2 전환 후 6장의 v1 API·코드 삭제 |
