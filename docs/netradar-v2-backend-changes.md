# 넷레이더 백엔드 수정 사항 (현재 코드 → v2)

- 작성일: 2026-11-19
- 기준: `netradar-v2-backend-changes(2nd ver).md`(수집 데이터 반영본), `netradar-v2-frontend-changes.md`, `netradar-v2-mock-preview.md`, 현재 `backend/` 코드, `supabase/schema.sql`, v2 프론트 목업 타입(`front/src/v2/types/`)
- 2nd ver가 참고한 `netradar-v2-backend.md`, `netradar-v2-ai-data.md`, `netradar-v2-data-essentials.md`는 저장소에 없다. 해당 내용은 2nd ver에 정리된 범위만 반영했다
- 이전 초안 대비 변경: 수집기·실데이터 테이블·예보 예약 작업·AI 모듈 연결 추가, 수집하지 않는 데이터(김포공항, 열차, 기상) 제거, 테이블 이름을 계획 문서와 통일, `supabase/schema.sql` 기준 DB 수정 항목 구체화, 프론트 목업과 달라지는 점 정리(11장)
- 응답 필드는 프론트 v2 목업과 함께 확정할 **제안안**이다
- 경로는 모두 `/api/v1` 접두사 기준
- 진행 상황 (2026-11-19): 14장 순서 3·4의 목업 기반 API(`/heatmap`, `/places/{id}`, `/events`, `/alerts/top`, `/config`) 구현 완료. v1 API는 그대로 둠. `/places/search`는 v1 동선 추천이 쓰는 `MOCK_PLACES`를 계속 검색함 (8.4 작업 때 교체)

---

## 1. 현재 상태와 v2 목표

| 항목 | 현재 코드 | v2 | 판단 |
|---|---|---|---|
| 데이터 | 강남 4곳 목업만 있음 | 수집기로 실데이터 적재 + 목업 병행 | **신규 (최우선)** |
| 예보 | 목업 고정값 | 10분마다 AI `predict()` 결과 저장 | 신규 |
| 핵심 지표 | 순시급, 승객 수, 매출·비용 | 수요 지수(0~100), 이탈 인원, 인구 | 교체 |
| 공간 단위 | 가짜 `h3Index` 4곳 | 장소 폴리곤 (서울 실시간 도시데이터 121곳 + 인천공항 + 공연장) | 교체 |
| 시점 | `horizon` 0/30/60 | `offset` 0/30/60 | 이름 변경 |
| 동선 | 목적지 필수, 시급 점수 | 목적지 선택, 도착 시점 수요 지수 점수 | 수정 |
| 운행 | 대문자 이벤트, 수익 합계 | 이벤트 타입 확정, 요금·승객 합계 | 수정 |
| 리플레이 | `GET /me/trips` | 달력 + 일별 예보·관측 비교 | 신규 |
| 프로필 | `/me/profile` 하나 | `/me`, `/me/places`, `/me/settings` | 분리 |
| 필드 표기 | camelCase | camelCase 유지 (프론트 v2 목업도 camelCase) | 유지 |

---

## 2. 데이터와 백엔드의 연결

8개 데이터 중 백엔드가 다루는 것은 5개다. 검증용 2개와 시간대별 택시 이용건수는 AI 파트가 노트북·설정값으로 처리한다. 기상 데이터는 수집하지 않으므로 날씨 보정은 하지 않는다.

| 데이터 | 파트 | 백엔드 처리 | 저장 위치 | 쓰는 API |
|---|---|---|---|---|
| 서울 실시간 도시데이터 | A | 수집기 (10분) | `realtime_pop_log`, 장소 경계는 `places` | `/heatmap`, `/places/{id}`, `/replay/*` |
| 지하철 막차 시각 | A | 1회 적재 (변경 시 갱신) | `last_trains` | `/events` (`last_train`) |
| 인천공항 승객예고 | B | 수집기 (1시간) | `demand_events` (`airport`) | `/events`, `/alerts/top` |
| KOPIS 공연 정보 | B | 수집기 (1일) | `demand_events` (`concert`), 공연장은 `places` | `/events`, `/alerts/top` |
| 국토부 표준노드링크 | B | AI 모듈이 그래프로 로드, 백엔드는 함수 호출 | AI 모듈 내부 | `/alerts/top`, `/routes/recommend` 이동시간 |
| 시간대별 택시 이용건수 | A | 없음 (AI 설정값) | - | - |
| 택시 OD 상위 10개소, 승차난 지점 | A·B | 없음 (검증용) | - | - |

---

## 3. 수집기 (1순위)

서울 실시간 도시데이터와 인천공항 승객예고는 과거 데이터를 제공하지 않는다. 수집을 시작한 날부터만 검증 데이터가 쌓이므로 다른 작업보다 먼저 띄운다.

| 수집기 | 주기 | 하루 호출 | 저장 | 비고 |
|---|---|---|---|---|
| 실시간 도시데이터 | 10분 | 121 × 144 ≈ 17,400 | `realtime_pop_log` | 1회 1장소, 호출 제한 없음 |
| 인천공항 승객예고 | 1시간 | 24 | `demand_events` | 개발 계정 일 1,000건 한도 |
| KOPIS 공연 | 1일 | 수십 | `demand_events`, `places` | XML 응답. 종료 시각은 공연 시작 + 러닝타임으로 계산, 좌석 수는 공연시설 정보에서 가져옴 |
| 막차 시각 | 1회 | 수십 | `last_trains` | 서울교통공사 1~9호선 |

- APScheduler로 구현, 실패 시 재시도, 누락은 `is_missing = true`
- 수집기는 API 서버가 꺼져도 계속 돌아야 하므로 상시 가동 환경에서 실행 (팀 결정 1). API 서버(uvicorn) 프로세스 안에서 돌리면 워커 수만큼 중복 실행되므로 **별도 프로세스**로 띄운다

---

## 4. 테이블

현재 DB 정의는 `supabase/schema.sql`(`profiles`, `trips`, `trip_events`, `record_trip_event`)에 있다. `backend/migrations/001~002`는 `profiles` 부분과 겹치므로 새 마이그레이션 위치를 한 곳으로 정한다 (팀 결정 9).

### 4.1 실데이터 테이블 (신규)

| 테이블 | 주요 컬럼 | 비고 |
|---|---|---|
| `places` | `id`, `name`, `type`(`seoul_rtd`, `airport`, `venue`), `polygon`, `lat`, `lng`, `capacity`, `area_type`, `has_population` | `has_population`: 실시간 인구가 있는 장소인지 (인천공항·공연장은 false일 수 있음) |
| `realtime_pop_log` | `place_id`, `observed_at`, `pop_min`, `pop_max`, `seoul_forecast`(jsonb), `is_missing` | 서울시 12시간 예측값도 같이 저장. `(place_id, observed_at)` 유니크 |
| `demand_events` | `id`, `place_id`, `type`, `title`, `peak_at`, `ends_at`, `expected_exits`, `source`, `raw`(jsonb) | 공항·공연. 수집기 재실행 시 중복되지 않도록 원본 기준 유니크 키 |
| `last_trains` | `line`, `station`, `direction`, `day_type`, `last_at`, `place_id` | 막차 이벤트는 요청 시 이 표로 생성 |
| `surge_predictions` | `place_id`, `base_time`, `offset_min`, `surge_index`, `expected_exits`, `reasons`(jsonb), `generated_at`, `source` | 리플레이의 예보 이력도 여기서 조회. `offset`은 PostgreSQL 예약어라 컬럼 이름은 `offset_min`으로 (API 필드는 `offset` 유지). `(place_id, base_time, offset_min)` 유니크 |

- 실데이터 테이블은 서버만 쓰므로 RLS를 켜고 `anon`·`authenticated` 권한을 주지 않는다 (백엔드는 service role로 접근)

### 4.2 기존 테이블 수정 (`supabase/schema.sql` 기준)

| 대상 | 현재 | 변경 |
|---|---|---|
| `trips.destination` | `TEXT NOT NULL` | nullable (바로 출발) |
| `trips` 추가 컬럼 | - | `origin_name`, `target_place_id`, `fare_recorded_count` |
| `trips.revenue`·`cost`·`extra_profit` | `record_trip_event`가 `extra_profit = revenue + fare - cost`로 갱신 | 결정 3에 따라 `fare` 하나로 정리하거나 보조값으로 유지 |
| `trip_events.event_type` | `CHECK (event_type IN ('ARRIVE','PICK_UP','DROP_OFF','SKIP','EXTEND_WAIT','RECOMMEND','FINISH'))` | 결정 4에서 정한 타입으로 CHECK 제약 교체 |
| `record_trip_event` 요금 처리 | `fare`가 숫자가 아니면 `invalid_fare` (즉 `null`도 거부) | `null` 허용, `null`이면 `fare_recorded_count`를 올리지 않음 |
| `record_trip_event` 합계 응답 | `revenue`, `cost`, `extraProfit` | `passengers`, `fare`, `fareRecordedCount` |
| `profiles` | `name`, `vehicle_type`, `notifications`, `favorites` | `surge_alerts BOOLEAN NOT NULL DEFAULT TRUE` 추가 |

---

## 5. 예보 예약 작업과 AI 모듈 연결

| 작업 | 주기 | 내용 |
|---|---|---|
| 예보 생성 | 10분 | `predict(base_time, [0, 30, 60])` → `surge_predictions` upsert |
| 실패 처리 | - | 직전 예보 유지, `generatedAt`으로 신선도 표시 (프론트는 20분 경과 시 회색) |

AI 모듈 인터페이스 (이동시간 함수 추가):

```python
def predict(base_time, offsets) -> list[dict]:
    """[{placeId, offset, surgeIndex, expectedExits, events, reasons}]"""

def travel_minutes(origin, place_id, base_time) -> int:
    """표준노드링크 기반 이동시간. /alerts/top, /routes/recommend에서 사용"""

def recommend_route(origin, destination, detour_ratio, base_time,
                    target_place_id=None, exclude_place_ids=()) -> dict:
    """POST /routes/recommend 응답 구조"""
```

AI 모듈이 완성되기 전에는 같은 시그니처의 목업 구현(직선거리 × 2.5 + 5분 등, 프론트 목업과 같은 식)을 쓰고, 설정으로 전환한다.

---

## 6. 공통 규칙

| 항목 | 규칙 |
|---|---|
| 필드 표기 | camelCase |
| 시각 | 타임존이 포함된 ISO 문자열 (`2026-11-19T09:00:00+09:00`). 동선의 밀리초 숫자 `generatedAt`도 ISO로 통일. 프론트는 타임존 없는 시각을 "신선도 확인 불가"로 표시함 |
| 좌표 | `polygon`은 GeoJSON 규약 `[경도, 위도]`, 닫힌 링. `path`(경로선)는 `[위도, 경도]`. 필드 이름으로 구분하고 테스트로 확인 |
| 출처 | `source: 'mock' \| 'model'` |
| 값 없음 | 구할 수 없는 값은 `0`이 아니라 `null` |
| CORS (`main.py`) | 현재 `GET, POST, PATCH, OPTIONS` → `PUT`, `DELETE` 추가 (`/me/places`) |
| 서비스 설명 (`main.py`) | "예상 시급 및 동선 추천" → "택시 수요 급증 예보" |

### 6.1 인증

회원가입·로그인은 프론트가 Supabase Auth로 직접 처리한다 (카카오 + 이메일, `front/src/services/auth.ts`). 백엔드에는 회원가입·로그인 API를 만들지 않는다. v2에서도 이 구조를 유지한다.

| 항목 | 현재 | v2 |
|---|---|---|
| 토큰 전달 | `Authorization: Bearer <Supabase access token>` | 유지 |
| 토큰 확인 | `backend/db/auth.py`의 `get_current_user`가 Supabase에 사용자 확인, 실패 시 401 | 유지. 인증이 필요한 새 API에 같은 의존성 사용 |
| DB 접근 | 프로필은 사용자 토큰으로 Supabase REST(RLS 적용), 운행은 service role | 유지. service role로 쓰는 쿼리는 반드시 `user_id`로 거른다 |
| 첫 로그인 | `GET /me/profile` 404 → 프론트가 프로필 등록 화면 → `PATCH /me/profile`로 생성 | `GET /me` 404 → 등록 화면 → `PATCH /me`로 생성. 404 의미를 바꾸지 않는다 |
| 회원 탈퇴 | 없음. `profiles`·`trips`는 `auth.users` 삭제 시 함께 삭제(`ON DELETE CASCADE`) | 탈퇴 API를 만들지 결정 (결정 11) |

API별 인증 필요 여부:

| 구분 | API | 비고 |
|---|---|---|
| 로그인 필요 | `/me`, `/me/places`, `/me/settings`, `/trips`, `/trips/{id}/events`, `/replay/calendar`, `/replay/days/{date}` | 사용자별 데이터. 다른 사용자 데이터 접근 시 404 (존재 여부를 드러내지 않음) |
| 로그인 불필요 | `/heatmap`, `/places/{id}`, `/places/search`, `/events`, `/alerts/top`, `/config` | 공개 예보 데이터. `/alerts/top`의 위치는 저장하지 않는다 |
| 결정 필요 | `/routes/recommend` | 현재 `/routes/recommendations`는 인증 없음. 카카오모빌리티·카카오 로컬 호출 비용이 들므로 인증을 걸거나 호출 제한 필요 (결정 10) |

---

## 7. 추가할 API

### 7.1 `GET /heatmap`

- 쿼리: `metric=surge|population`, `offset=0|30|60`, `bbox=west,south,east,north`(선택)
- 정렬: `surge`면 `surgeIndex`, `population`이면 `population` 내림차순 (`null`은 뒤로)

```json
{
  "generatedAt": "2026-11-19T22:00:00+09:00",
  "source": "mock",
  "metric": "surge",
  "offset": 30,
  "places": [
    {
      "id": "hongdae",
      "name": "홍대입구역",
      "type": "seoul_rtd",
      "lat": 37.5572,
      "lng": 126.9245,
      "polygon": [[126.920, 37.554], [126.929, 37.554], [126.929, 37.560], [126.920, 37.560], [126.920, 37.554]],
      "points": [
        { "offset": 0, "surgeIndex": 48, "population": 31000, "range": "moderate", "populationRange": "high" },
        { "offset": 30, "surgeIndex": 76, "population": 34000, "range": "high", "populationRange": "high" },
        { "offset": 60, "surgeIndex": 88, "population": 29000, "range": "high", "populationRange": "high" }
      ]
    },
    {
      "id": "incheon-t1",
      "name": "인천공항 T1",
      "type": "airport",
      "lat": 37.4486,
      "lng": 126.4512,
      "polygon": [[126.4482, 37.4466], [126.4532, 37.4461], [126.4535, 37.4510], [126.4485, 37.4512], [126.4482, 37.4466]],
      "points": [
        { "offset": 0, "surgeIndex": 54, "population": null, "range": "moderate", "populationRange": null },
        { "offset": 30, "surgeIndex": 91, "population": null, "range": "high", "populationRange": null },
        { "offset": 60, "surgeIndex": 72, "population": null, "range": "high", "populationRange": null }
      ]
    }
  ]
}
```

- `population`은 서울 실시간 도시데이터가 있는 장소만 값이 있다. 인천공항처럼 서울 밖이거나 121곳에 없는 장소는 `null`
- `population`은 관측 시점(offset 0)은 `realtime_pop_log`, 30·60분은 `seoul_forecast` 값으로 채운다. 출처가 다르므로 응답 설명에 명시한다
- `range`, `populationRange`: `low | moderate | high`. 프론트는 색을 이 값으로만 정하므로 구간 경계는 백엔드가 정한다
- `points`에 0/30/60을 모두 담을지, `offset` 하나만 담을지는 결정 2. 현재 프론트 목업은 전체를 받아 토글 시 재요청하지 않는 구조

### 7.2 `GET /places/{id}`

- `places.py`에서 `/search`를 먼저 등록 (FastAPI는 등록 순서대로 매칭하므로 늦게 두면 `search`가 id로 잡힘)
- 응답: 7.1의 장소 필드 + `generatedAt`, `source`, `reasons: string[]`, `taxiStands: {name, description}[]`, `events: DemandEvent[]`
- `reasons` 예: "T1 입국 1,800명 예상 (23:00~24:00)", "KSPO DOME 공연 종료 22:10, 좌석 15,000석", "2호선 막차 이후 체류 인구 3.1만 명"
- 없는 `id`는 404

### 7.3 `GET /events`

- 쿼리: `from`, `to`(기본: 지금 ~ 한국 시간 오늘 자정), `bbox`, `type=airport|concert|last_train`
- 기본 동작: 오늘이면서 `endsAt`이 지나지 않은 이벤트, `peakAt` 오름차순
- `last_train`은 `last_trains` 표에서 요청 시 생성 (요일 구분 `day_type` 반영)
- `from`, `to`는 타임존이 포함된 ISO만 허용 (없으면 422). 기간과 겹치는 이벤트(`endsAt ≥ from`, `peakAt < to`)를 돌려준다
- 응답: `{ generatedAt, source, events: DemandEvent[] }`

| 필드 | 타입 | 예시 |
|---|---|---|
| `id` | string | |
| `placeId` | string | `/heatmap` 장소 id와 일치 |
| `type` | string | `airport`, `concert`, `last_train` |
| `title` | string | "T1 입국 1,800명 예상", "KSPO DOME 공연 종료", "2호선 막차 출발" |
| `peakAt`, `endsAt` | ISO | |
| `expectedExits` | int \| null | 공항: 승객예고 인원, 공연: 좌석 수 기반 추정, 막차: 체류 인구 기반 추정 |
| `source` | string | "인천공항 승객예고", "KOPIS", "서울교통공사 막차 시각" |

### 7.4 `GET /alerts/top`

- 쿼리: `lat`, `lng`
- 최대 3건 (프론트 목업 로직과 같음)
  1. 오늘 남은 이벤트 중 피크 시작이 지금부터 60분 이내
  2. 이동시간 60분 이하, 도착 시각이 `endsAt` 이전
  3. `surgeIndexAtArrival` 내림차순, 같으면 `travelMinutes` 오름차순
- 이동시간은 5장의 `travel_minutes()` 사용
- 응답: `{ generatedAt, source, alerts: DemandAlert[] }`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id`, `placeId`, `reason` | string | |
| `travelMinutes` | int | |
| `recommendedDepartureAt` | ISO | `max(지금, peakStart − travelMinutes)` |
| `arrivalAt` | ISO | 지금 출발 시 도착 시각 |
| `peakStart`, `peakEnd` | ISO | |
| `surgeIndexAtArrival` | int | 도착까지 ≤15분 → offset 0, ≤45분 → 30, 그 외 → 60 |

### 7.5 `GET /config`

```json
{ "detourRatios": { "little": 15, "normal": 30, "much": 50 }, "offsets": [0, 30, 60], "maxStops": 3 }
```

프론트의 우회 비율 하드코딩(`15 | 30 | 50`)을 없애기 위한 API. 비율 값은 결정 5.

### 7.6 `GET /replay/calendar`, `GET /replay/days/{date}`

- `calendar?month=YYYY-MM`: `[{ date, tripCount, passengers, fare }]`
- `days/{date}` (`YYYY-MM-DD`, 한국 시간 기준):

```json
{
  "date": "2026-11-19",
  "trips": ["DemandTrip (8.3)"],
  "comparisons": [
    {
      "placeId": "hongdae",
      "name": "홍대입구역",
      "points": [
        { "time": "23:30", "forecastSurge": 76, "seoulForecastPopulation": 33000, "observedPopulation": 34200 },
        { "time": "00:30", "forecastSurge": 88, "seoulForecastPopulation": 30000, "observedPopulation": null }
      ]
    }
  ]
}
```

| 필드 | 출처 |
|---|---|
| `forecastSurge` | `surge_predictions` (우리 예보, 지수) |
| `seoulForecastPopulation` | `realtime_pop_log.seoul_forecast` (서울시 예측, 명) |
| `observedPopulation` | `realtime_pop_log` 관측값 (명). `is_missing`이면 `null` |

- 인구가 없는 장소(인천공항 등)는 `comparisons`에서 빼거나 인구 필드를 모두 `null`로
- 이 구조로 검증 V1(이탈 시점·규모)과 "서울시 예측 대비" 비교를 같은 데이터로 보여줄 수 있음
- `forecastSurge`(지수)와 인구(명)는 단위가 다르므로 프론트에서 같은 축에 그리지 않는다 (11장)

### 7.7 `/me`, `/me/places`, `/me/settings`

| API | 요청·응답 | DB |
|---|---|---|
| `GET`·`PATCH /me` | `{ name, vehicleType }` | `profiles.name`, `vehicle_type` |
| `GET`·`PUT /me/places` | `FavoritePlace[]` (현재 `favorites`와 같은 형식) | `profiles.favorites` |
| `GET`·`PATCH /me/settings` | `{ notifications, surgeAlerts }` | `profiles.notifications`, `surge_alerts` |

- `GET /me`는 프로필이 없으면 404, `PATCH /me`는 upsert (현재 `/me/profile` 동작 유지)

---

## 8. 수정할 API

### 8.1 `POST /routes/recommendations` → `POST /routes/recommend`

| 항목 | 현재 (`schemas/route.py`, `routers/routes.py`) | 변경 |
|---|---|---|
| `destination` | `Place` 필수 | `Place \| null` (없으면 바로 출발) |
| `targetPlaceId` | 없음 | 선택. 첫 경유지로 고정 |
| `excludeStopIds` | 있음 | `excludePlaceIds` |
| `detour` | `little/normal/much` → 1.15/1.30/1.50 | 값은 유지, 비율은 `/config`에서 |
| 경유지 수 | 1곳 | 우회 범위별 최대 1/2/3곳 |
| 후보 장소 | `MOCK_PLACES` 강남 4곳 | `places` 테이블 |
| 점수 | `get_hourly_rate` + `calculate_expected_earnings` | 도착 시점 수요 지수 내림차순 → 도착 시간 오름차순 |
| 경유지 응답 | `waitMinutes`, `expectedHourlyRate` | `placeId`, `name`, `lat`, `lng`, `travelMinutes`, `arrivalMinutes`, `forecastOffset`, `surgeIndexAtArrival`(60분 초과 시 `null`), `reason`, `waitMinutes` |
| `RouteMetrics.earnings` | 있음 | 결정 3 |
| 경로선 | 출발지 → 목적지 (카카오모빌리티) | 목적지 없으면 출발지 → 마지막 경유지. 이동시간 계산은 결정 6 |
| `generatedAt` | 밀리초 숫자 | ISO 문자열 |

### 8.2 `POST /trips`

| 항목 | 변경 |
|---|---|
| `destination` | 선택, DB nullable (4.2) |
| 추가 필드 | `originName`, `targetPlaceId` |
| `detour` | 8.1과 같은 표기 |

### 8.3 `POST /trips/{id}/events`

| 항목 | 변경 |
|---|---|
| 이벤트 `type` | v1 대문자(`PICK_UP`) / v2 프론트 소문자(`pickup`) / 명세 `boarded` 중 하나로 확정 (결정 4). DB CHECK 제약도 함께 변경 |
| `payload` | 타입별 정의. `dropoff`: `{ fare: number \| null, location }`, `reroute`: `{ planId }` |
| 요금 | `null` 허용 (현재는 422 `invalid_fare`) |
| 응답 `totals` | `passengers`, `fare`, `fareRecordedCount` |

운행 기록 형식 (프론트 `DemandTrip`, 리플레이 응답에도 사용): `id`, `date`, `startedAt`, `endedAt`, `originName`, `destinationName | null`, `stopNames[]`, `passengers`, `fare`, `fareRecordedCount`, `durationMinutes`, `visits[{ placeId, name, arrivedAt, pickedUp, fare, fareRecorded }]`

### 8.4 `GET /places/search`

- 검색 대상: `places` 테이블 + 일반 장소(카카오 로컬)
- 응답 형식(`id`, `name`, `address`, `lat`, `lng`) 유지

---

## 9. 목업 데이터

실데이터가 쌓이기 전까지 쓰는 목업. **수집하기로 한 데이터로 실제 채울 수 있는 장소·이벤트만** 넣는다.

| 파일 | 내용 |
|---|---|
| `data/mock_demand.py` (신규) | 5곳: 인천공항 T1(`airport`, 인구 `null`), KSPO DOME(`venue`), 홍대입구역·강남역·잠실역(`seoul_rtd`). 폴리곤, 0/30/60 지수, 인구, 이유, 승차대 |
| `data/mock_events.py` (신규) | 공항 입국 피크, 공연 종료, 막차. 시각은 요청 시점 기준으로 생성 (고정 시각이면 "오늘 남은 일정" 필터에 안 걸림) |
| `data/mock_places.py` | `mock_demand`와 id 일치 |

이전 초안의 김포공항, 서울역 열차 이벤트는 수집 데이터 범위 밖이므로 제외. 프론트 목업도 같은 장소로 맞춰야 한다 (11장).

---

## 10. 삭제 (프론트 live 모드 v2 전환 후)

> `VITE_API_MODE=live`일 때 프론트는 아직 v1 화면과 v1 API를 쓴다. 그 전까지는 v2 API를 추가해 v1과 함께 둔다.

| 대상 | 대체 |
|---|---|
| `GET /forecast/zones`, `/forecast/zones/{id}`, `schemas/forecast.py` | `/heatmap`, `/places/{id}` |
| `POST /routes/recommendations` | `/routes/recommend` |
| `GET /me/trips` | `/replay/*` |
| `GET`·`PATCH /me/profile` | `/me`, `/me/places`, `/me/settings` |
| `data/mock_zones.py` | `data/mock_demand.py` |
| 시급 관련 상수·함수 (`COST_PER_KM`, `TIME_COST_PER_MINUTE`, `DEFAULT_HOURLY_RATE`, `get_hourly_rate`, `calculate_expected_earnings`) | 결정 3에서 수익 표시를 빼면 삭제 |
| `tests/test_forecast.py` | 11장 테스트로 교체 |
| `/recommendations/top` (계획 문서) | `/alerts/top`으로 대체, 구현하지 않음 |

---

## 11. 프론트 v2 목업과 달라지는 점

수집 데이터를 반영하면서 현재 프론트 목업 타입(`front/src/v2/types/demand.ts`, `drive.ts`)과 달라진 부분이다. 백엔드 응답을 확정할 때 프론트도 함께 고쳐야 한다.

| 항목 | 현재 프론트 목업 | 이 문서 | 프론트 작업 |
|---|---|---|---|
| 장소 `type` | 이벤트 종류와 같은 값 (`airport`, `concert`, `train`, `last_train`) | 장소 종류 `seoul_rtd`, `airport`, `venue` | 장소 타입과 이벤트 타입 분리 |
| 이벤트 `type` | `train` 포함 4종 | `airport`, `concert`, `last_train` 3종 | `train` 필터·라벨 삭제 |
| 목업 장소 | 6곳 (인천공항 T1, 김포공항, 올림픽공원 공연장, 서울역, 홍대입구역, 강남역) | 5곳 (인천공항 T1, KSPO DOME, 홍대입구역, 강남역, 잠실역) | 목업 장소 교체 |
| `population`, `populationRange` | 항상 숫자·구간 | 인구 없는 장소는 `null` | `null` 표시 처리 ("인구 정보 없음"), 인구 정렬 시 뒤로 |
| `expectedExits` | 항상 숫자 | `int \| null` | `null` 처리 |
| 리플레이 비교 | `{ time, forecast, observed }` (둘 다 인구) | `{ time, forecastSurge, seoulForecastPopulation, observedPopulation }` | 지수와 인구를 다른 축이나 별도 표로 |
| 동선 `generatedAt` | 밀리초 숫자 | ISO 문자열 | 파싱 변경 |
| 우회 비율 | `15 \| 30 \| 50` 하드코딩 | `little/normal/much` + `/config` | `/config` 값으로 표시 |

---

## 12. 테스트

| 대상 | 확인할 것 |
|---|---|
| 수집기 | 응답 파싱, 누락 시 `is_missing`, 재시도, 재실행 시 중복 없음 |
| `/heatmap` | metric별 정렬(`null`은 뒤로), offset 0/30/60 외 422, bbox 필터, 폴리곤 닫힘·`[경도, 위도]`, `generatedAt` 타임존 |
| `/places/{id}` | 404, `/places/search`와 충돌 없음 |
| `/events` | 오늘 남은 일정, type 필터 3종, 막차 이벤트 생성 |
| `/alerts/top` | 60분 기준, 최대 3건, 정렬 |
| `/routes/recommend` | 목적지 없음, `targetPlaceId` 첫 경유지, 60분 초과 시 `null`, detour별 경유지 수 |
| `/trips` 이벤트 | 새 이벤트 타입, 요금 `null` 허용, 합계 필드 |
| `/replay/days` | 관측 없는 시점 `null`, 인구 없는 장소 처리 |
| 인증 | 로그인 필요 API에 토큰 없음·만료 시 401, 다른 사용자의 운행·기록 조회 시 404, 공개 API는 토큰 없이 200 |

---

## 13. 팀 결정 사항

1. 수집기 상시 가동 환경 (가장 먼저)
2. `/heatmap` 응답: `offset` 하나 vs 0/30/60 전체
3. 수익 표시: 동선 `earnings`, 운행 `revenue·cost·extraProfit` 삭제 vs 보조 지표
4. 운행 이벤트 타입 통일
5. 우회 비율: 50%(코드·프론트) vs 45%(명세)
6. 이동시간: 표준노드링크(AI 모듈) vs 카카오모빌리티 vs 근사치. 계획상 표준노드링크
7. 급증 알림 설정 저장: 서버 vs 브라우저 (현재 프론트는 브라우저 저장)
8. v1 API 제거 시점
9. 마이그레이션 위치: `supabase/` vs `backend/migrations/`
10. `/routes/recommend` 인증: 로그인 필요 vs 공개 + 호출 제한
11. 인증 범위: 이메일 로그인 유지 여부 (프론트 문서 결정 5), 회원 탈퇴 API 필요 여부

---

## 14. 작업 순서

| 순서 | 작업 |
|---|---|
| 1 | 실데이터 테이블 생성, 수집기 가동 (실시간 도시데이터, 인천공항 먼저) |
| 2 | 결정 2~5, 9 확정, 11장 내용을 프론트와 합의 |
| 3 | 목업(9장) 작성, `/heatmap`, `/places/{id}`, `/events` + 테스트 |
| 4 | `/alerts/top`, `/config` |
| 5 | `/routes/recommend` |
| 6 | `trips`·`trip_events`·`record_trip_event` 수정, `/trips` 수정 |
| 7 | `/me` 분리, `surge_alerts` |
| 8 | 예보 예약 작업으로 목업을 `predict()` 결과로 교체 |
| 9 | `/replay/*` |
| 10 | 프론트 live 모드 전환 후 v1 삭제 |
