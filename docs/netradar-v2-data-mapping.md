# 넷레이더 v2 목업 → 실데이터 매핑

- 작성일: 2026-11-20
- 기준: 팀 수집 데이터 목록(파트 A·B), 현재 `backend/`·`front/` 코드, [`netradar-v2-backend-changes.md`](netradar-v2-backend-changes.md)(테이블·API 제안안), [`netradar-v2-mock-preview.md`](netradar-v2-mock-preview.md)
- 목적: 지금 쓰는 목업이 어디에 있고, **어떤 수집 데이터와 로직으로 바꿔야 하는지** 한곳에 정리한다
- 테이블 컬럼과 API 응답 필드의 자세한 내용은 백엔드 수정 사항 문서(4장, 7장)를 따른다. 이 문서는 "무엇을 무엇으로 바꾸는가"만 다룬다
- 수정 (2026-11-23): 수집 데이터를 **Supabase**에 저장하고 자동 수집은 **GitHub Actions** 예약 작업으로 돌리기로 했다. 테이블·저장 함수는 [`supabase/schema.sql`](../supabase/schema.sql) 11~21장에 반영했다. 공연시설은 `places.kopis_facility_id` 대신 `venues` 표로, 역 → 장소 연결은 `station_places` 표로 바꿨다
- 수정 (2026-11-24): 2026-11-20의 "기상 데이터는 수집하지 않는다" 결정을 바꿔 **기상청 시간별 강수**를 수집한다 (`collect-weather`, `precip_hourly`, 8.11). 강수는 5km 격자 단위라 `places`에 기상청 격자(`kma_nx`, `kma_ny`)를 추가했다

---

## 1. 수집 데이터 목록

### 파트 A: 실시간 인구·시간대

| 데이터 | 용도 | 수집 방식 | 저장 위치 | 구분 |
|---|---|---|---|---|
| 서울 실시간 도시데이터 | 장소 목록·경계, 막차 이후 체류 인구, 이벤트 후 실제 이탈 확인 | 상시 수집기 (10분) | `places`(장소·경계), `realtime_pop_log`(인구) | 서비스 |
| 지하철 막차 시각 | 막차 이후 이탈 시점 | 1회 적재, 시간표 변경 시 갱신 | `last_trains` | 서비스 |
| 서울시 시간대별 택시 이용건수 | 시간대 계수 | 1회 가공 (AI 설정값) | AI 모듈 설정 | AI 입력 |
| 서울시 심야 승차난 지점 목록 | 검증: 핫스팟 보조 정답 | 1회 | AI 노트북 | 검증 |
| 기상청 시간별 강수 (초단기실황·초단기예보) | 비 올 때 택시 수요 보정 | 상시 수집기 (1시간) | `precip_hourly` (격자 단위, `places.kma_nx`·`kma_ny`로 연결) | AI 입력 |

### 파트 B: 이벤트·이동

| 데이터 | 용도 | 수집 방식 | 저장 위치 | 구분 |
|---|---|---|---|---|
| 국토부 표준노드링크 | 이동시간, 출발 권장 시각, 동선 추천 | 1회 적재 (AI 모듈이 도로 그래프로 로드) | AI 모듈 내부 | 서비스 |
| 인천공항 승객예고 | 공항 입국 이탈 인원 | 상시 수집기 (1시간) | `demand_events` (`airport`) | 서비스 |
| KOPIS 공연 정보 | 공연 종료 시각과 규모 | 상시 수집기 (1일) | `demand_events` (`concert`), 공연장은 `places` | 서비스 |
| 일자별 택시 OD 상위 10개소 | 검증: 핫스팟 적중률 정답 | 1회 | AI 노트북 | 검증 |

### 상시 수집기 분담

| 구분 | 파트 A | 파트 B |
|---|---|---|
| 상시 수집기 | 실시간 도시데이터(10분) | 인천공항(1시간), KOPIS(1일) |
| 검증 데이터 | 승차난 지점 | 택시 OD 상위 10개소 |

기상청 강수 수집기(1시간)는 2026-11-24에 추가했고 담당 파트는 아직 정하지 않았다.

### 수집 실행 환경: GitHub Actions → Supabase

자동 수집은 GitHub Actions 예약 작업(`schedule`)이 Python 수집 스크립트를 실행하고, 스크립트가 Supabase에 저장한다. API 서버와 따로 돌아서 API 서버가 꺼져도 수집은 계속된다.

| 구성 | 역할 | 위치 |
|---|---|---|
| GitHub Actions 워크플로 | 정해진 시각에 수집 스크립트 실행 (cron 시각은 UTC). 수동 실행용 `workflow_dispatch`도 둔다 | `.github/workflows/collect-citydata.yml`, `collect-airport.yml`, `collect-kopis.yml`, `collect-weather.yml` |
| 수집 스크립트 (Python) | 원본 API 호출 → 파싱 → 저장 함수(RPC) 호출. 백엔드와 같은 `supabase`·`httpx` 패키지를 쓴다 | `backend/collectors/` (`citydata.py`, `airport.py`, `kopis.py`, `weather.py`) |
| 121곳 영역 | OA-21778 Shapefile을 JSON으로 바꿔 저장소에 둔다. `collect-citydata`가 실행마다 DB와 비교해서 없거나 바뀐 장소를 넣는다 | `backend/collectors/data/seoul_places.json` (변환: `collectors/tools/build_seoul_places.py`) |
| 인천공항 T1·T2 | 직접 그린 근사 영역 | `supabase/schema.sql` 11장 (스키마 실행 때 들어감) |
| 저장 함수 | 중복 방지·덮어쓰기 규칙·이벤트 생성을 DB 안에서 처리 | `supabase/schema.sql` 20장 |
| `collector_runs` | 실행마다 시작·종료·상태·행 수·오류를 남긴다 | `supabase/schema.sql` 19장 |

| 워크플로 | cron (UTC) | 한국 시간 | 저장 함수 |
|---|---|---|---|
| `collect-citydata` | `*/10 * * * *` | 10분마다 | `record_population(rows)` |
| `collect-airport` | `5 * * * *` | 매시 5분 | `record_airport_arrivals(rows, ratio)` |
| `collect-kopis` | `0 21 * * *` | 매일 06:00 | `upsert_kopis_venue(...)`, `sync_concert_events(mt20ids, events, full)` |
| `collect-weather` | `50 * * * *` | 매시 50분 | `record_precip(rows)` |

#### 처음 켜는 순서

1. Supabase SQL Editor에서 `supabase/schema.sql` 전체를 한 번 실행한다 (테이블·함수·인천공항 장소 생성)
2. GitHub 저장소 Settings → Secrets and variables → Actions에 아래 5개를 등록한다
3. 수집 파일을 `main`에 반영한다
4. Actions 탭에서 `Collect citydata` → Run workflow로 한 번 수동 실행한다. 첫 실행이 121곳 장소를 자동으로 넣는다
5. Supabase에서 `collector_runs`를 확인한다 (`status = ok`면 정상, `partial`이면 `error`에 실패 장소와 사유)

이후는 예약 시각마다 자동으로 돈다. 설정값(선택)은 워크플로 `env`에 넣는다: `AIRPORT_EVENT_RATIO`(기본 1.5), `KOPIS_MIN_SEATS`(기본 1000), `KOPIS_DAYS`(기본 7), `CITYDATA_STORE_RAW`(기본 끔), `WEATHER_NCST_HOURS`(기본 3).

비밀값은 GitHub 저장소의 Actions secrets에 둔다. 저장소에 커밋하지 않는다.

| Secret | 값 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SECRET_KEY` | service role(secret) 키. 백엔드 `.env`와 같은 이름 |
| `SEOUL_API_KEY` | 서울 열린데이터광장 인증키 (실시간 도시데이터, 막차) |
| `DATA_GO_KR_KEY` | 공공데이터포털 인증키 (인천공항, 기상청 단기예보). 같은 키라도 포털에서 **서비스마다 활용신청**을 해야 호출된다 |
| `KOPIS_API_KEY` | KOPIS 인증키 |

GitHub Actions 예약 작업의 제약과 대응:

| 제약 | 영향 | 대응 |
|---|---|---|
| 예약 시각보다 **수 분~수십 분 늦게** 시작하거나, GitHub가 붐비면 **건너뛴다** | 10분 간격 인구 로그에 빈 시각이 생긴다 | `observed_at`은 실행 시각이 아니라 원본 `PPLTN_TIME`을 쓰므로 값이 틀어지지는 않는다. 실행 자체가 없었던 시각은 행이 없고, 리플레이·API는 행이 없는 시각을 `null`로 본다. 수집률은 `collector_runs`로 확인한다 |
| 예약 작업은 **기본 브랜치(`main`)의 워크플로만** 돈다 | `dev`에만 올리면 수집이 시작되지 않는다 | 수집 워크플로는 먼저 `main`에 반영한다 |
| 공개 저장소는 **60일 동안 커밋이 없으면** 예약 작업이 자동으로 꺼진다 | 수집이 조용히 멈춘다 | 꺼지면 Actions 화면에서 다시 켠다. `collector_runs`의 마지막 실행 시각을 주기적으로 확인한다 |
| 비공개 저장소는 무료 사용량이 월 2,000분이고 **실행마다 1분 단위로 올림**된다 | 10분 수집만으로 하루 144회 × 1분 이상 ≈ 월 4,300분 이상이라 무료 사용량을 넘는다 | 저장소를 공개로 두거나(공개 저장소의 표준 러너는 무료), 비용을 감수한다 (결정 6) |
| 같은 워크플로가 겹쳐 돌 수 있다 | 앞 실행이 늦게 끝나면 다음 실행과 겹친다 | 워크플로마다 `concurrency` 그룹을 두고 `cancel-in-progress: false`로 겹치지 않게 한다 |

- 실시간 도시데이터는 1회 실행에 121곳을 8곳씩 동시에 호출한다 (로컬 측정 약 2초)
- ⚠️ GitHub 러너는 해외(Azure) IP다. 국내 공공 API가 해외 IP를 막는지 첫 수동 실행(`workflow_dispatch`)으로 먼저 확인한다
- ⚠️ **DB 용량**: 인구 로그는 하루 최대 약 1.7만 행(121곳 × 144회)이고 서울시 예측 12개를 함께 저장해서 한 행이 약 1KB다. 하루 약 17MB, 한 달 약 500MB로 Supabase 무료 한도(500MB)에 한 달 안에 닿는다. 그래서 인구 로그의 `raw`는 기본으로 저장하지 않는다. 장기 수집이면 유료 플랜이나 오래된 행 정리 규칙이 필요하다 (결정 8)
- 수집 로그에는 인증키가 찍히지 않게 한다 (httpx 요청 로그 끔, 오류 메시지에서 키와 URL 인코딩 형태를 가림)
- 막차 시각·역 → 장소 연결표는 아직 적재 스크립트가 없다 (1회 적재, 이벤트 API 작업 때 함께 만든다)
- 예보 생성(`predict()`)도 같은 방식(10분 워크플로)으로 돌릴 수 있지만, 예약 지연이 그대로 예보 지연이 된다. 프런트는 20분이 지나면 신선도를 회색으로 표시하므로 지연이 잦으면 다른 상시 환경을 검토한다 (결정 7)

기상청 시간별 강수는 1시간마다 수집한다(2026-11-24, 2026-11-20의 "수집하지 않음" 결정을 바꿈). 강수로 수요를 어떻게 보정할지는 AI 파트가 정한다 (3.4, 8.11).

서울 실시간 도시데이터와 인천공항 승객예고는 **과거 데이터를 제공하지 않는다**. 수집을 시작한 날부터만 리플레이·검증 데이터가 쌓이므로 다른 작업보다 먼저 수집기를 띄운다.

---

## 2. 전체 흐름

```
[수집 데이터]                     [수집·가공]               [DB]                     [API]
서울 실시간 도시데이터 ──10분──→ 인구 수집기 ───────→ realtime_pop_log ──┐
                      └─1회───→ 장소·경계 적재 ─────→ places ────────────┤
KOPIS 공연 정보 ────────1일───→ 이벤트 수집기 ─────→ demand_events ─────┤→ /heatmap
인천공항 승객예고 ──────1시간─→ 이벤트 수집기 ─────→ demand_events ─────┤  /places/{id}
지하철 막차 시각 ───────1회───→ 적재 ───────────────→ last_trains ───────┤  /events
기상청 시간별 강수 ─────1시간─→ 강수 수집기 ───────→ precip_hourly ─────┤  /alerts/top
위 DB + 시간대별 택시 이용건수 ─10분─→ AI predict() ─→ surge_predictions ─┤  /replay/*
                                                                          │
국토부 표준노드링크 ─────────────────→ AI travel_minutes() ───────────────┴→ /alerts/top
                                       AI recommend_route() ──────────────→ /routes/recommend

승차난 지점 · 택시 OD 상위 10개소 ──→ AI 검증 (서비스 API에는 쓰지 않음)
```

"인구 수집기"와 "이벤트 수집기"는 GitHub Actions 예약 작업이 실행하는 Python 스크립트(`backend/collectors/`)이고, 결과를 Supabase 저장 함수로 넣는다. "1회 적재"는 로컬 스크립트다.

---

## 3. 목업 → 실데이터 매핑

### 3.1 장소 (지도의 기본 단위)

| 현재 목업 | 바꿀 데이터 | 처리 로직 | 저장 → API |
|---|---|---|---|
| `backend/data/mock_demand.py` 장소 5곳 (`id`, `name`, `type`, `lat`, `lng`) | **서울 실시간 도시데이터** 장소 목록(121곳) + 인천공항 + **KOPIS** 공연장 | 1회 적재하고 장소 목록이 바뀌면 갱신한다. 출처별 `type`: `seoul_rtd` / `airport` / `venue`. 공연장 좌표는 KOPIS 공연시설 정보에서 가져오고, 121곳 밖에 있는 공연장만 `venue` 장소가 된다 (8.5) | `places` → `/heatmap`, `/places/{id}` |
| `_polygon()`: 중심 좌표 주변의 근사 6각형 | **서울 실시간 도시데이터**의 장소 영역 경계 | GeoJSON `[경도, 위도]` 닫힌 링으로 변환한다. 인천공항은 직접 그린 영역, 121곳 밖 공연장은 반경 200m 원(자동 생성)을 쓴다. 공간 검색용 `geom`은 트리거가 `polygon`에서 계산한다 | `places.polygon`, `places.geom` |
| `has_population` (목업에서는 인천공항만 `None`) | 출처로 판단 | `seoul_rtd`만 `true`. 인천공항·공연장(121곳에 포함되지 않은 경우)은 `false`이고 인구는 `null` | `places.has_population` |
| `taxiStands`: "○○ 인근 승차대 (예시)" | **미정** (수집 목록에 없음) | 아래 4장 참고 | `/places/{id}` |
| `backend/data/mock_places.py` 4곳 (검색용) | `places` 테이블 | `/places/search`가 `MOCK_PLACES` 대신 `places`에서 이름으로 검색한다 | `/places/search` |
| `front/src/v2/services/demand.ts` 장소 6곳 | 백엔드 `/heatmap` 응답 | 프런트가 목업 대신 API를 호출한다. 연동 전에는 백엔드 목업 5곳에 맞춘다. 김포공항(POI061)·서울역(POI033)은 121곳에 포함되므로 인구 장소(`seoul_rtd`)로는 남을 수 있지만, 공항·열차 이벤트는 수집하지 않는다 | — |

### 3.2 인구

| 현재 목업 | 바꿀 데이터 | 처리 로직 | 저장 → API |
|---|---|---|---|
| `population[0]` (현재 인구) | **서울 실시간 도시데이터** 실시간 인구(최소·최대 범위) | 10분마다 121곳을 수집한다. 응답이 없거나 실패하면 `is_missing = true`로 저장한다(0으로 채우지 않음). 화면 값은 범위의 중간값 또는 범위 그대로 (결정 3) | `realtime_pop_log` → `/heatmap`, `/places/{id}` |
| `population[30]`, `population[60]` (예상 인구) | **서울 실시간 도시데이터**가 함께 주는 서울시 인구 예측값 | 수집할 때 `seoul_forecast`(jsonb)로 함께 저장하고 +30·+60분 값을 꺼내 쓴다 | `realtime_pop_log.seoul_forecast` |
| 막차 이후 체류 인구, 이벤트 후 실제 이탈 | **서울 실시간 도시데이터** | 별도 수집 없이 위 로그를 시간순으로 비교해서 구한다(이탈 = 인구 감소량) | 리플레이, AI 검증 |
| 인천공항 `population: null` | — | 서울 밖이라 인구가 없다. 승객예고(3.3)로 대신한다 | — |

### 3.3 이벤트 (사람이 한꺼번에 나오는 시점)

| 현재 목업 (`backend/data/mock_events.py`) | 바꿀 데이터 | 처리 로직 | 저장 → API |
|---|---|---|---|
| `airport`: "T1 입국 1,800명 예상", `peakAt`, `expectedExits` | **인천공항 승객예고** (시간대별 입국 승객 수) | 1시간마다 수집한다. 터미널별로 입국 승객이 가장 많은 시간대를 `peakAt`, 그 인원을 `expectedExits`로 쓴다 | `demand_events` (`airport`) → `/events`, `/alerts/top` |
| `concert`: "KSPO DOME 공연 종료", `expectedExits: 12000` | **KOPIS 공연 정보** (공연장, 공연일시, 러닝타임) | 하루 1번 수집한다. 종료 시각 = 시작 시각 + 러닝타임. 규모는 공연장 좌석 수(`places.capacity`)로 추정한다. 러닝타임이 없으면 기본값을 쓰고 `raw`에 원본을 남긴다 | `demand_events` (`concert`) → `/events`, `/alerts/top` |
| `last_train`: 홍대입구·강남·잠실 막차 | **지하철 막차 시각** | 1회 적재한다. 요청할 때마다 오늘의 요일 구분(평일/토/휴일)에 맞는 막차로 이벤트를 만든다(`last_train_events()`). 역은 `station_places` 연결표로 장소에 연결한다 | `last_trains` + `station_places` → `/events` |
| 이벤트 출처 표시 `"(목업 · 실제 수집 데이터 아님)"` | 각 수집 출처 | `source`에 실제 출처 이름을 넣는다 | — |
| — | — | 원본 기준 유니크 키를 걸어서 수집기를 다시 돌려도 이벤트가 중복되지 않게 한다. 공항은 터미널·날짜, 공연은 `mt20id` 단위(`source_ref`)로 지우고 다시 만들어서, 구간이 바뀌거나 회차가 취소돼도 낡은 이벤트가 남지 않게 한다 | — |

### 3.4 수요 지수 (AI 파트)

| 현재 목업 | 바꿀 로직 | 입력 데이터 | 저장 → API |
|---|---|---|---|
| `backend/services/prediction.py`의 `predict()` → `surge[0/30/60]` 고정값 (0~100) | **AI 예측 모델**. 함수 모양 `predict(base_time, offsets)`는 유지하고 내용만 교체한다 | `realtime_pop_log`(인구·서울시 예측), `demand_events`, `last_trains`, `precip_hourly`(강수 실황·예보), **시간대별 택시 이용건수**(시간대 계수) | 10분마다 예보 생성 → `surge_predictions` → `/heatmap`, `/places/{id}` |
| `reasons` (고정 문구) | 예측에 크게 작용한 요인으로 이유 문장을 만든다 (예: "21:30 공연 종료 · 약 12,000명", "막차 이후 체류 인구 증가") | AI 모듈 출력 | `surge_predictions.reasons` |
| `generatedAt` (요청 시각) | 실제 예보 생성 시각 | 예보 예약 작업 | 프런트의 20분 신선도 판정에 쓰이므로 정확해야 한다. 생성에 실패하면 직전 예보를 유지한다 |
| `backend/services/demand.py` 구간 경계 (지수 70/40, 인구 3만/1.5만) | 확정된 급증 판정 기준 | **심야 승차난 지점**, **택시 OD 상위 10개소**로 적중률을 검증하며 보정한다 | `/config`로 내려주면 프런트에 값을 고정하지 않아도 된다 |
| `source: "mock"` | `source: "model"` | — | 프런트의 출처 표시가 자동으로 바뀐다 |

### 3.5 이동시간·동선

| 현재 목업 | 바꿀 로직 | 입력 데이터 | 쓰는 곳 |
|---|---|---|---|
| `prediction.travel_minutes()` = 직선거리 × 2.5 + 5분 | 도로 그래프 최단시간. 함수 모양 `travel_minutes(origin, place_id, base_time)`는 유지한다 | **국토부 표준노드링크** | `/alerts/top`(추천 출발 시각, 도착 시점 지수) |
| `front/src/v2/services/drive.ts` 동선 계획 (근사 시간·경유지) | AI `recommend_route()` 기반 v2 `/routes/recommend` | 표준노드링크 + `surge_predictions`(도착 시점 지수) | 동선 화면 |
| 출발 권장 시각 (목업: 피크 시각 − 근사 이동시간) | 피크 시각 − 표준노드링크 이동시간 | 표준노드링크 + `demand_events` | 급증 알림 |
| `DETOUR_RATIOS` 15/30/50%, `MAX_STOPS` 3 (`backend/routers/demand.py`) | 팀 결정 값 | — | `/config` |

현재 v1 동선은 카카오모빌리티 길찾기를 쓴다(`backend/kakao_mobility.py`). 수집 목록에 따르면 v2 이동시간은 표준노드링크로 하므로, 카카오는 표준노드링크가 준비되기 전 임시 대안으로만 남긴다 (결정 2).

### 3.6 리플레이·운행 기록

| 현재 목업 | 바꿀 데이터·로직 | 저장 → API |
|---|---|---|
| 프런트 "예시 리플레이" (예보 인구와 관측 인구 비교) | 같은 시각끼리 맞춰서 비교한다: 우리 예보 `surge_predictions`, 서울시 예측 `realtime_pop_log.seoul_forecast`, 실제 관측 `realtime_pop_log`. 관측이 없는 시점은 `null` | `/replay/calendar`, `/replay/days/{date}` (신규) |
| v2 모의 운행 (브라우저에만 저장) | 기존 `trips`·`trip_events` 테이블을 고쳐서 서버에 저장한다(백엔드 수정 사항 문서 4.2) | `/trips`, `/trips/{id}/events` |

### 3.7 검증 데이터 (서비스 API에는 쓰지 않음)

| 데이터 | 검증하는 것 | 방법 |
|---|---|---|
| 서울시 심야 승차난 지점 목록 | 심야 시간대에 상위로 예측한 장소가 실제 승차난 지점과 겹치는가 | 장소 폴리곤과 지점을 공간 매칭 → 상위 N곳 적중 비율 |
| 일자별 택시 OD 상위 10개소 | 그날 지수 상위 장소가 실제 택시 이용 상위 10개소와 겹치는가 (핫스팟 적중률) | 날짜별 예측 상위 10 vs 실제 상위 10 |
| 서울 실시간 도시데이터 (사후) | 이벤트 후 예측한 이탈 시점·규모가 실제 인구 감소와 맞는가 | `demand_events.peak_at`·`expected_exits` vs 인구 감소 시점·양 |

검증 결과는 3.4의 구간 경계와 모델 보정에 반영한다.

---

## 4. 수집 데이터로 채울 수 없는 부분

| 항목 | 현재 | 선택지 |
|---|---|---|
| **택시 승차대** (`/places/{id}`의 `taxiStands`) | 목업 문구 "○○ 인근 승차대 (예시)" | **미정**. ① 서울시 택시승차대 위치 데이터를 추가로 수집 ② 주요 장소만 직접 입력 ③ v2에서 항목을 뺀다. 정해질 때까지 목업 문구와 "실제 데이터 연결 후 확인 필요" 안내를 유지한다 (결정 1) |
| **김포공항 항공편, 서울역 열차 이벤트** | 프런트 목업에만 있음 | 수집 범위 밖이므로 프런트 목업에서 이벤트를 삭제한다. 두 장소 자체는 121곳(POI061, POI033)에 있어 인구 기반 장소로는 표시된다 |
| **실시간 교통 상황** | 없음 | 표준노드링크는 도로망 정보라 실시간 정체가 반영되지 않는다. 화면에 "평균 이동시간 기준"이라고 안내한다 |

---

## 5. v1 목업 (채우지 않고 정리할 대상)

v1 "예상 시급 지도"용 목업은 v2 주제와 맞지 않으므로 실데이터로 바꾸지 않는다. 프런트가 v2 live 모드로 넘어가면 v1 화면과 함께 지운다 (백엔드 수정 사항 문서 결정 8).

| 목업 | 쓰는 곳 | 처리 |
|---|---|---|
| `backend/data/mock_zones.py` 강남 4곳 (시급·연료비·승객 수, 가짜 `h3Index`) | `/forecast/zones`, v1 `/routes/recommend` 수익 계산 | 삭제 |
| `backend/routers/routes.py`의 수익 계산 (`get_hourly_rate`, 연료·시간 비용) | v1 `/routes/recommend` | 삭제. 카카오 경로 호출 코드는 임시 대안으로 쓸 수 있다 |
| 프런트 v1 데모 데이터 (`createDemoForecast`, `samplePlaces`, `exampleTrips`) | v1 데모 모드 | v1 화면과 함께 삭제 |

---

## 6. 작업 순서

| 순서 | 작업 | 담당 | 비고 |
|---|---|---|---|
| 1 | `supabase/schema.sql` 실행 (인천공항 T1·T2 장소 포함) | 백엔드 / A | 인구 로그가 `places`를 참조하므로 수집기보다 먼저 |
| 2 | **Actions secrets 5개 등록, 수집 워크플로를 `main`에 반영, 수동 실행으로 확인** | 백엔드 / A·B | 과거 데이터가 없으므로 가장 먼저. 121곳 장소는 첫 실행이 자동 적재. 해외 IP 차단 여부와 `collector_runs` 확인 (1장 "처음 켜는 순서") |
| 3 | 막차 시각·`station_places` 적재 | 백엔드 / A | 적재 스크립트 작성 필요. 121곳 밖 공연장은 KOPIS 수집 때 자동으로 `places`에 추가 |
| 4 | 프런트 v2를 백엔드 목업 API에 연결 (목업 장소 5곳으로 통일) | 프런트 | 1~3과 병렬로 진행 가능 |
| 5 | `/heatmap`·`/events`·`/places/*`가 목업 대신 DB를 읽도록 교체 | 백엔드 | 인구·이벤트는 실데이터, 수요 지수는 아직 목업 |
| 6 | 표준노드링크 그래프 로드, `travel_minutes()` 교체 | AI / B | |
| 7 | `predict()` 교체, 10분 예보 예약 작업 | AI / A·B | 시간대별 택시 이용건수로 시간대 계수 반영 |
| 8 | 검증 (승차난 지점, OD 상위 10개소), 구간 경계 확정 | AI | 수집 데이터가 며칠 이상 쌓인 뒤 |
| 9 | v2 `/routes/recommend`, `/replay/*` | 백엔드 | |
| 10 | 프런트 live 모드 전환, v1 목업·화면 삭제 | 프런트·백엔드 | |

---

## 7. 결정 필요 사항

1. **택시 승차대** (미정): 추가 수집 / 직접 입력 / 항목 제외
2. **이동시간 임시 대안**: 표준노드링크 준비 전까지 직선거리 근사치 vs 카카오모빌리티
3. **인구 표시**: 서울 실시간 도시데이터의 최소~최대 범위를 그대로 보여줄지, 중간값 하나로 보여줄지
4. **공연 규모 추정**: 공연장 좌석 수 그대로 vs 비율 보정 (매진 여부를 알 수 없음)
5. **급증 판정 기준**: 지수·인구 구간 경계 (검증 후 확정)
6. **저장소 공개 여부**: 비공개면 10분 수집만으로 GitHub Actions 무료 사용량(월 2,000분)을 넘는다 (1장 "수집 실행 환경")
7. **예보 생성 작업 실행 환경**: `predict()`를 GitHub Actions 10분 워크플로로 돌릴지, 지연이 적은 다른 상시 환경을 쓸지
8. **DB 용량**: 인구 로그가 한 달 약 500MB. Supabase 유료 플랜 / 오래된 로그 정리(예: 90일 지난 행의 `seoul_forecast` 비우기) / 수집 주기 조정

확정된 사항:
- 기상청 시간별 강수를 수집한다 (2026-11-24. 2026-11-20의 "기상 데이터는 수집하지 않는다"를 바꿈, 8.11)
- 수집 데이터는 Supabase에 저장하고, 자동 수집은 GitHub Actions 예약 작업으로 돌린다 (2026-11-23, 1장 "수집 실행 환경")

---

## 8. 수집 → 저장 → 응답 필드 매핑

각 수집 데이터의 **원본 필드 → 변환 규칙 → DB 컬럼 → API 응답 필드**를 정리한다. 확인 수준은 다음과 같이 표시한다.

| 표시 | 의미 |
|---|---|
| ✅ 호출 확인 | 2026-11-20 샘플 키로 실제 API를 호출해 응답에서 확인 |
| 📄 문서 확인 | 공식 명세 페이지·첨부 파일에서 확인 |
| ⚠️ 확인 필요 | 공식 문서에서 찾지 못함. 인증키 발급 후 실제 응답으로 확인 |

### 8.0 공통 변환 규칙

| 항목 | 규칙 |
|---|---|
| 시각 | 원본 시각은 모두 타임존이 없는 한국 시간이다. 저장할 때 `Asia/Seoul`을 붙여 `timestamptz`로 저장하고, API에서는 `+09:00`이 붙은 ISO 문자열로 내보낸다 |
| 숫자 | 원본 숫자는 문자열로 온다(`"40000"`, `"15,000"`). 쉼표를 지우고 정수로 바꾼다. 바꿀 수 없으면 `null` |
| 값 없음 | 구할 수 없는 값은 `0`이 아니라 `null`. 수집 실패는 `is_missing = true` |
| 원본 보관 | 모든 수집 행은 응답 원문을 `raw`(jsonb)에 보관한다. 파싱 규칙을 고친 뒤 다시 계산할 수 있게 하기 위해서다 |
| 중복 방지 | 수집 데이터마다 아래에 적은 유니크 키로 upsert한다. 수집기를 다시 돌려도 행이 늘지 않는다. 수집 스크립트는 테이블에 직접 쓰지 않고 `supabase/schema.sql` 20장의 저장 함수를 RPC로 호출한다 (덮어쓰기 규칙을 DB 한곳에 둔다) |
| 좌표 | 저장·API 모두 WGS84. 폴리곤은 GeoJSON `[경도, 위도]` 닫힌 링 |

#### 장소 ID 규칙 (출처마다 다른 ID를 `places.id` 하나로 묶기)

| 출처 | 원본 ID | `places.id` | 예 |
|---|---|---|---|
| 서울 실시간 도시데이터 | `AREA_CD` | 원본 그대로 | `POI014` (강남역) |
| 인천공항 | 터미널 | `ICN-T1`, `ICN-T2` | `ICN-T1` |
| KOPIS 공연시설 | `mt10id` | 121곳 영역 안이면 **그 장소에 연결**(겹치면 가장 작은 영역), 밖이면 `KOPIS-{mt10id}`. 연결 결과는 `venues.place_id` | KSPO DOME → `POI127` (올림픽공원) |
| 지하철역 | `STATION_CD` | `station_places` 연결표로 121곳 장소에 연결 (8.3) | 홍대입구 `0239` → `POI055` |

현재 목업 ID는 실데이터 ID로 바꾼다.

| 목업 ID | 실데이터 ID | 근거 |
|---|---|---|
| `gangnam` | `POI014` 강남역 | 121곳 영역 파일 ✅ |
| `hongdae` | `POI055` 홍대입구역(2호선) | 121곳 영역 파일 ✅ |
| `jamsil` | `POI119` 잠실역 | 121곳 영역 파일 ✅ |
| `kspo-dome` | `POI127` 올림픽공원 (공연장은 장소가 아니라 이벤트로 다룬다) | KSPO DOME은 올림픽공원 영역 안에 있다 |
| `incheon-t1` | `ICN-T1` | 장소 ID 규칙 |

121곳 영역은 **서로 겹친다**. 예를 들어 `POI005` 잠실 관광특구 안에 `POI119` 잠실역과 `POI109` 잠실종합운동장이 있다. 지도에 모두 그릴지, 겹치면 작은 영역을 위에 그릴지 정해야 한다 (8.9 결정 A).

---

### 8.1 서울 실시간 도시데이터: 장소·경계 (1회 적재) 📄 문서 확인

- 출처: [서울 열린데이터광장 OA-21778](https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do) 첨부 `서울시 주요 121장소 영역.zip` (2026-04-14 갱신)
- 형식: Shapefile, 좌표계 **WGS84**(`GCS_WGS_1984`, 변환 불필요), 도형 Polygon, 121개 행, 문자 인코딩 UTF-8
- 장소 코드는 연속되지 않는다(`POI001`~`POI127` 사이에 121개). 순번으로 다루지 않는다

| 원본 필드 | 변환 | `places` 컬럼 | API 필드 |
|---|---|---|---|
| `AREA_CD` | 그대로 | `id` | `id` |
| `AREA_NM` | 그대로 | `name` | `name` |
| `CATEGORY` | 그대로 (인구밀집지역 48, 공원 33, 발달상권 28, 관광특구 7, 고궁·문화유산 5) | `area_type` | — (필터에 쓸 수 있음) |
| geometry | 외곽 링을 `[경도, 위도]` 배열로 바꾼다. 첫 점과 끝 점이 같은지 확인 | `polygon` | `polygon` |
| geometry | 대표점(폴리곤 안쪽의 점). 단순 중심점은 오목한 영역에서 밖에 찍힐 수 있다 | `lat`, `lng` | `lat`, `lng` |
| — | 고정값 | `type = 'seoul_rtd'`, `has_population = true` | `type` |

장소 목록 파일이 갱신되면 다시 적재한다. 없어진 장소는 지우지 않고 `active = false`로 둔다(과거 리플레이 보존).

### 8.2 서울 실시간 도시데이터: 인구 (10분 수집) ✅ 호출 확인

- 요청: `http://openapi.seoul.go.kr:8088/{KEY}/json/citydata_ppltn/1/5/{AREA_CD}`
- 1회 호출에 장소 1곳. 121곳 × 10분 간격 = 하루 약 17,400회
- 샘플 키로는 `광화문·덕수궁`만 조회된다. 나머지 장소는 인증키가 필요하다

응답 예 (2026-11-20 호출, 일부):

```json
{"AREA_NM":"광화문·덕수궁","AREA_CD":"POI009","AREA_CONGEST_LVL":"약간 붐빔",
 "AREA_PPLTN_MIN":"40000","AREA_PPLTN_MAX":"42000","REPLACE_YN":"N",
 "PPLTN_TIME":"2026-11-20 18:30","FCST_YN":"Y",
 "FCST_PPLTN":[{"FCST_TIME":"2026-11-20 20:00","FCST_CONGEST_LVL":"보통",
                "FCST_PPLTN_MIN":"34000","FCST_PPLTN_MAX":"36000"}, "... 12개"]}
```

| 원본 필드 | 변환 | `realtime_pop_log` 컬럼 |
|---|---|---|
| `AREA_CD` | 그대로 | `place_id` |
| `PPLTN_TIME` (`"2026-11-20 18:30"`) | KST를 붙여 timestamptz로 | `observed_at` |
| `AREA_PPLTN_MIN`, `AREA_PPLTN_MAX` | 문자열 → 정수 | `pop_min`, `pop_max` |
| `AREA_CONGEST_LVL` (여유 / 보통 / 약간 붐빔 / 붐빔) | 그대로 | `congest_lvl` (**신규 컬럼 제안**) |
| `FCST_YN`, `FCST_PPLTN[]` | 항목마다 `{time, min, max, congestLvl}`로 바꿔 배열로 | `seoul_forecast` (jsonb) |
| `REPLACE_YN` | `Y`이면 대체값이 들어온 것으로 보고 표시한다 ⚠️ 정확한 의미는 매뉴얼로 확인 | `is_replaced` (**신규 컬럼 제안**) |
| 성별·연령·거주 비율 (`MALE_PPLTN_RATE`, `PPLTN_RATE_20` 등) | 저장하지 않음 (`raw`에만 남음) | — |

- 유니크 키: `(place_id, observed_at)`. 서울시가 `PPLTN_TIME`을 아직 갱신하지 않았으면 같은 값이 다시 오므로 upsert로 중복을 막는다
- 실패 처리: HTTP 오류이거나 `RESULT.CODE`가 `INFO-000`이 아니면 `observed_at` = 수집 시각을 10분 단위로 내린 값, `is_missing = true`, 인구 `null`로 저장한다
- 저장: 수집 스크립트가 121곳 결과를 배열 하나로 모아 `record_population(rows)`를 한 번 호출한다. 실패 행이 같은 시각의 **정상 관측값을 덮어쓰지 않고**, 정상 행은 실패 행을 덮어쓴다
- 최근값 조회: `latest_population` 뷰 (장소별 가장 최근 정상 관측값과 대표값 `population`)

**주의: 서울시 예측은 1시간 단위다.** 응답의 `FCST_TIME`은 정시(20:00, 21:00 …)이고, 샘플에서는 관측 시각 18:30 다음 예측이 20:00이었다. 화면의 +30분·+60분 값을 그대로 꺼낼 수 없으므로 아래처럼 계산한다.

| API 필드 (`/heatmap`, `/places/{id}`) | 계산 |
|---|---|
| `points[offset=0].population` | `observed_at`이 20분 이내인 가장 최근 행의 대표값. 대표값은 `round((pop_min + pop_max) / 2)` (결정 3). 20분 넘게 새 값이 없으면 `null` |
| `points[offset=30/60].population` | 목표 시각 = `observed_at + offset`. 관측값과 그 다음 `FCST_TIME` 값 사이를 **시간 비례로 선형 보간**한다. 예: 18:30 관측 41,000, 20:00 예측 35,000이면 19:00(+30)은 약 39,000 |
| `populationRange` | 두 가지 안 (8.9 결정 B): ① 서울시 혼잡도를 대응(여유 → `low`, 보통 → `moderate`, 약간 붐빔·붐빔 → `high`) ② 팀이 정한 인구 구간 경계. ①은 서울시 공식 기준이라 근거를 설명하기 쉽다 |
| 인구가 없는 장소 (`has_population = false`) | `population`, `populationRange` 모두 `null` |

### 8.3 지하철 막차 시각 (1회 적재, 시간표 변경 시 갱신) ✅ 호출 확인

- 출처: [서울 열린데이터광장 OA-110](https://data.seoul.go.kr/dataList/OA-110/A/1/datasetView.do) "역코드로 지하철 막차 시간표 검색"
- 요청: `http://openapi.seoul.go.kr:8088/{KEY}/json/SearchLastTrainTimeByIDService/{시작}/{끝}/{STATION_CD}/{WEEK_TAG}/{INOUT_TAG}`
- `WEEK_TAG`: 1 평일, 2 토요일, 3 휴일·일요일 / `INOUT_TAG`: 1 상행·내선, 2 하행·외선 (⚠️ 같은 기관의 유사 API 설명 기준. 매뉴얼로 확인)
- **범위: 서울교통공사 1~8호선만.** 9호선, 신분당선, 공항철도, 경의중앙선 등은 이 API에 없다

응답 예 (홍대입구, 평일, 상행·내선):

```json
{"FR_CODE":"239","STATION_CD":"0239","STATION_NM":"홍대입구","SUBWAYENAME":"을지로입구",
 "LEFTTIME":"24:49:00","WEEK_TAG":"1","INOUT_TAG":"1","WORK_DTTM":"2026-11-20 16:02:16.0"}
```

| 원본 필드 | 변환 | `last_trains` 컬럼 |
|---|---|---|
| `STATION_CD` | 그대로 | `station_cd` (**신규 컬럼 제안**. 역명보다 안정적인 키) |
| `STATION_NM` | 그대로 | `station` |
| `SUBWAYENAME` | 그대로 (행선지 역) | `direction` |
| `WEEK_TAG` | 1 → `weekday`, 2 → `saturday`, 3 → `holiday` | `day_type` |
| `INOUT_TAG` | 그대로 | `inout_tag` (**신규 컬럼 제안**) |
| `LEFTTIME` (`"24:49:00"`) | **24시를 넘겨 표기된다.** 운행일 0시 기준 분으로 저장한다 (24:49 → 1489분) | `last_at` (분, 정수) |
| 노선 | 이 응답에는 노선 필드가 없다. 역 검색 API나 역 코드표에서 채운다 | `line` |
| (역 → 장소 연결표) | 아래 규칙 | `station_places.place_id` |

- 유니크 키: `(station_cd, day_type, inout_tag, direction)`
- 같은 역·방향에 행선지별로 막차가 여러 개 온다(샘플: 을지로입구행 24:49, 성수행 24:33). 이벤트는 **역·방향마다 가장 늦은 막차 하나**로 만든다
- **역 → 장소 연결**: 역 좌표는 수집 목록에 없다. 121곳 중 역 이름이 들어간 장소(예: `홍대입구역(2호선)`)를 역명으로 대응시킨 **연결표를 손으로 만든다**. 대상이 수십 곳이라 한 번 만들면 된다. 막차를 다시 적재해도 연결이 지워지지 않도록 `last_trains`와 분리된 `station_places (station_cd, station, place_id)`에 둔다. 연결표에 없는 역은 이벤트를 만들지 않는다
- 이벤트 생성: `/events`가 `last_train_events(운행일, day_type)`를 호출한다. 아래 표의 계산을 DB 함수가 한다

| API 필드 (`/events`) | 계산 |
|---|---|
| `id` | `last_train-{station_cd}-{inout_tag}-{운행일}` (역마다 방향 2개라 `inout_tag`를 넣어야 겹치지 않는다) |
| `placeId` | 연결표의 `place_id` |
| `type` | `last_train` |
| `title` | `"{역명} 막차 {HH:MM}"` |
| `peakAt` | 운행일 0시 + `last_at`분. 24시를 넘으면 다음 날 날짜가 된다 (예: 11-20 운행일 1489분 → 11-21 00:49) |
| `endsAt` | `peakAt` + 30분 (막차 이후 이탈 구간. 필요하면 조정) |
| `expectedExits` | `null` (막차 데이터에는 인원이 없다. 막차 이후 체류 인구는 8.2 로그로 AI가 판단한다) |
| (요일 구분 선택) | 오늘이 평일/토요일/휴일인지 판단해야 한다. **공휴일 달력은 수집 목록에 없다** (8.9 결정 C) |

### 8.4 인천공항 승객예고 (1시간 수집) 📄 문서 확인 · 영문 필드명 ⚠️

- 출처: [공공데이터포털 15095066 인천국제공항공사_승객예고-출·입국장별](https://www.data.go.kr/data/15095066/openapi.do)
- 요청: `https://apis.data.go.kr/B551177/passgrAnncmt` (하위 오퍼레이션 경로는 ⚠️ 활용가이드로 확인)
- 요청 변수: `serviceKey`(필수), `numOfRows`(필수), `pageNo`(필수), `selectdate`(0 = 오늘, 1 = 내일), `type`(`json`)
- 갱신: 인천공항 누리집 기준 예고 자료는 매일 17시에 갱신되고 입국은 D+1까지 제공된다. API 갱신 주기는 "실시간"으로 표기되어 있다
- 호출 한도: 개발계정 하루 1,000회 (1시간마다 2일치 = 하루 48회로 충분)

응답 항목 (공식 페이지의 한글 항목명. **영문 필드명은 페이지에 없다**):

| 응답 항목 | 사용 | 변환 |
|---|---|---|
| 표출일자 | ✅ | 날짜 |
| 시간대 (1시간 단위, 예: 00~01시) | ✅ | 구간 시작 시각 = 날짜 + 시작 시 (KST) |
| T1 입국장 동편(A,B), 서편(E,F), 입국심사(C), (D) | 저장만 (`raw`) | — |
| **T1 입국장 합계** | ✅ | `ICN-T1`의 시간대별 입국 인원 |
| T2 입국장1, 입국장2 | 저장만 (`raw`) | — |
| **T2 입국장 합계** | ✅ | `ICN-T2`의 시간대별 입국 인원 |
| T1·T2 출국장, 출국장 합계 | 쓰지 않음 (출국 승객은 택시 하차 수요) | — |

시간대별 입국 인원을 이벤트로 바꾸는 규칙:

1. 터미널·날짜마다 24개 시간대의 입국 인원을 만든다. 시간대 원본은 별도 표(`airport_arrivals`, **신규 제안**)에 저장하고 유니크 키는 `(terminal, date, hour)`
2. **기준값 이상인 시간대가 이어진 구간 하나를 이벤트 하나**로 만든다. 기준값은 그날 평균 × 1.5 등으로 정한다 (8.9 결정 D)
3. 각 이벤트를 다음처럼 채운다

| API 필드 (`/events`) | 계산 |
|---|---|
| `id` | `airport-{terminal}-{date}-{구간 시작 시}` |
| `placeId` | `ICN-T1` / `ICN-T2` |
| `type` | `airport` |
| `title` | `"T1 입국 {구간 최대 인원}명 예상"` |
| `peakAt` | 구간에서 인원이 가장 많은 시간대의 시작 시각 + 30분 (시간대의 가운데) |
| `endsAt` | 구간 마지막 시간대의 끝 시각 |
| `expectedExits` | 구간의 시간대별 입국 인원 합계. 택시 이용 비율은 AI가 계수로 반영한다 (화면에는 입국 인원으로 표시) |
| `source` | `"인천공항 승객예고"` |

17시 갱신 전후로 값이 바뀔 수 있으므로 1시간마다 다시 받아 같은 키로 덮어쓴다. 덮어쓴 뒤 이벤트도 다시 만든다.

- 저장: 수집 스크립트가 `record_airport_arrivals(rows, ratio)`를 호출한다. 시간대를 upsert한 뒤 받은 터미널·날짜마다 `rebuild_airport_events()`가 그날의 공항 이벤트를 지우고 위 규칙으로 다시 만든다. `ratio` 기본값은 1.5 (결정 D)
- 이벤트 `raw`에 구간 시작·끝·피크 시, 기준값, 배수를 남긴다

`places`에는 `ICN-T1`, `ICN-T2`를 직접 넣는다(`type = 'airport'`, 영역은 터미널 주변을 손으로 그림, `has_population = false`). 현재 목업에는 T1만 있다.

### 8.5 KOPIS 공연 정보 (1일 수집) 📄 문서 확인

- 출처: [KOPIS 오픈API 가이드](https://kopis.or.kr/por/cs/openapi/openApiList.do?menuId=MNU_00074). 응답은 XML

| 서비스 | 요청 | 주요 변수 |
|---|---|---|
| 공연목록 | `http://www.kopis.or.kr/openApi/restful/pblprfr` | `service`(키), `stdate`·`eddate`(`yyyyMMdd`, **최대 31일**), `cpage`, `rows`(**최대 100건**), `prfstate`(공연상태 코드), `signgucode`(시도 코드, 서울 = `11`) |
| 공연상세 | `.../pblprfr/{mt20id}` | `service` |
| 공연시설상세 | `.../prfplc/{mt10id}` | `service` |

수집 순서 (매일 1회):

1. **공연목록**: 오늘부터 7일 뒤까지, `signgucode=11`. 100건이 넘으면 `cpage`를 넘기며 받는다
2. **공연상세**: 목록의 `mt20id`마다 호출한다. `updatedate`(최종수정일)가 저장값과 같으면 건너뛴다
3. **공연시설상세**: 처음 보는 `mt10id`만 호출한다. 시설 정보는 한 달에 한 번 갱신한다
4. 호출 사이에 간격을 둔다 (공식 한도는 찾지 못했다. 초당 10회 이상이면 차단된다는 커뮤니티 보고가 있다)

공연시설 → 장소:

한 장소에 공연시설이 여러 개 있을 수 있다(올림픽공원 `POI127` 안에 KSPO DOME, 올림픽홀, 핸드볼경기장 등). 그래서 `places`에 시설 ID 컬럼 하나를 두지 않고 `venues` 표에서 시설 → 장소를 연결한다. 수집 스크립트는 시설마다 `upsert_kopis_venue(...)`를 호출하고, 아래 연결·생성은 함수가 한다.

| 원본 필드 (공연시설상세) | 변환 | 저장 |
|---|---|---|
| `mt10id` | 그대로 | `venues.mt10id` |
| `fcltynm` | 그대로 | `venues.name`, 새 장소일 때 `places.name` |
| `la`, `lo` (위도, 경도 문자열) | 실수로 바꿔 **121곳 영역 안에 있는지 검사**한다(`find_place_at()`, 겹치면 가장 작은 영역). 안이면 그 장소에 연결하고, 밖이면 `KOPIS-{mt10id}` 장소를 새로 만든다 (`type = 'venue'`, 영역 = 좌표 중심 반경 200m 원, `has_population = false`). 한 번 연결되면 다시 검사하지 않는다 | `venues.lat`·`lng`·`place_id`, `places` |
| `mt13s[]` (`mt13id`, `prfplcnm`, `seatscale`) | 공연장(홀)별 좌석 수. `"15,000"` → 15000 | `venue_halls` |
| `seatscale` (시설 전체 객석 수) | 홀 좌석 수가 없을 때만 쓴다 | `venues.seats` |

공연 → 이벤트:

| 원본 필드 (공연상세) | 변환 |
|---|---|
| `mt20id` | 공연 ID |
| `prfnm` | 공연명 |
| `prfpdfrom`, `prfpdto` (`"2021.08.21"`) | 공연 기간 (날짜) |
| `mt10id`, `mt13id` | 시설 → 장소, 홀 → 좌석 수 |
| `dtguidance` (예: `"화요일 ~ 금요일(20:00), 토요일(15:00,17:30,20:00), 일요일(15:30,18:00)"`) | **요일별 시작 시각 목록으로 파싱**한다. 공연 기간 안의 날짜마다 요일이 맞으면 회차를 만든다 |
| `prfruntime` (예: `"1시간 30분"`) | **분으로 파싱**한다 (90). 실패하면 기본 120분을 쓰고 표시해 둔다 |
| `prfstate` | 응답은 `"공연중"` 같은 글자다. 요청할 때는 코드(`01`, `02` 등)를 쓴다 ⚠️ 코드별 의미는 가이드 표로 확인 |

| API 필드 (`/events`) | 계산 |
|---|---|
| `id` | `concert-{mt20id}-{회차 시작 yyyyMMddHHmm}` (유니크 키) |
| `placeId` | 공연시설의 장소 (121곳 안이면 그 장소. 예: KSPO DOME → `POI127`) |
| `type` | `concert` |
| `title` | `"{공연장명} 공연 종료"` |
| `peakAt` | 회차 시작 + `prfruntime` = **공연 종료 시각** |
| `endsAt` | `peakAt` + 30분 (퇴장 구간) |
| `expectedExits` | 홀 좌석 수(`mt13s[].seatscale`). 매진 여부는 알 수 없다 (결정 4) |
| `source` | `"KOPIS"`. 화면에 출처 "(재)예술경영지원센터 공연예술통합전산망"을 표기한다 ⚠️ 이용 조건 확인 |

저장: 수집 스크립트가 모든 공연의 회차를 모아 `sync_concert_events(mt20ids, events, full)`를 **한 번** 호출한다. 받은 공연의 **앞으로 남은 회차를 지우고 새 목록으로 바꾼다**. 공연 목록을 빠짐없이 받았고 상세 호출 실패가 없으면(`full = true`) 목록에서 사라진(취소된) 공연의 미래 회차도 지운다. 지난 회차는 리플레이·검증용으로 남는다.

홀 특정: 공연상세의 `fcltynm`(예: `올림픽공원 (KSPO DOME(올림픽체조경기장))`)에 이름이 들어 있는 홀을 고른다(여러 개면 가장 긴 이름). 못 찾았는데 홀이 하나뿐이면 그 홀, 홀이 여러 개인데 특정하지 못하면 이벤트를 만들지 않고 로그에 남긴다. 공연상세에는 홀 ID(`mt13id`)가 없다.

`dtguidance`는 사람이 쓴 문장이라 공연마다 형식이 다를 수 있다. 파싱하지 못한 공연은 이벤트를 만들지 않고 로그에 남겨서, 규칙을 보강하거나 직접 입력한다. 소규모 공연까지 모두 넣으면 이벤트가 너무 많아지므로 **좌석 수 기준 이상인 홀만** 이벤트로 만든다 (8.9 결정 E).

### 8.6 국토부 표준노드링크 (AI 모듈, 1회 적재) 📄 문서 확인

- 출처: 국가교통정보센터 표준노드링크 (`MOCT_LINK`, `MOCT_NODE` Shapefile). 속성 정의는 [국토교통부고시 제2023-22호 지능형교통체계 표준노드·링크 구축기준](https://www.codil.or.kr/filebank/moct2014//202301/MOCT3000_0.PDF?nserialno=3000)
- 좌표계는 공식 자료에서 확인하지 못했다. 다운로드 후 `.prj` 파일로 확인하고 WGS84로 변환해서 쓴다 ⚠️

| 원본 필드 (`MOCT_LINK`) | 의미 | 사용 |
|---|---|---|
| `LINK_ID` | 링크 식별자 (2023 고시 기준 10자리 문자) | 그래프 간선 ID |
| `F_NODE`, `T_NODE` | 시작·종료 노드 | 간선의 방향 |
| `LENGTH` | 링크 길이 (필수 항목) | 이동시간 계산 |
| `MAX_SPD` | 최고 제한속도 (**선택 항목이라 비어 있을 수 있다**) | 이동시간 계산 |
| `ROAD_RANK` | 도로 등급 | `MAX_SPD`가 없을 때 등급별 기본 속도 |
| `LANES` | 차로 수 | 보조 |

| 함수·필드 | 계산 |
|---|---|
| `travel_minutes(origin, place_id, base_time)` | 출발 좌표와 장소 대표점을 각각 가장 가까운 노드에 붙이고 최단시간 경로를 찾는다. 간선 시간 = `LENGTH / 속도`. 속도는 `MAX_SPD`, 없으면 `ROAD_RANK`별 기본값을 쓰고 시간대 혼잡 계수(AI 설정값)를 곱한다 |
| `/alerts/top`의 `travelMinutes`, `recommendedDepartureAt` | `travelMinutes` = 위 결과, `recommendedDepartureAt` = 피크 시각 − `travelMinutes` |

실시간 정체는 반영되지 않는다. 화면에 "평균 이동시간 기준"이라고 안내한다.

### 8.7 AI 입력·검증 데이터 (파일, 1회) ⚠️ 명세 미확인

아래 데이터는 이번에 공식 명세를 확인하지 않았다. 파일을 받은 뒤 컬럼을 확인하고 이 표를 채운다.

| 데이터 | 장소·시간 연결 | 결과물 |
|---|---|---|
| 서울시 시간대별 택시 이용건수 | 요일 × 시간대 | `(요일, 시)` → 계수 표. `predict()`와 이동시간 혼잡 계수에 쓴다 |
| 서울시 심야 승차난 지점 목록 | 지점 좌표가 들어 있는 121곳 장소 (영역 안 검사) | 장소별 "승차난 지점 있음" 정답표 |
| 일자별 택시 OD 상위 10개소 | 지점명 또는 좌표 → 121곳 장소 | 날짜별 상위 10 장소 정답표. 적중률 = 예측 상위 10과 겹치는 수 / 10 |

### 8.8 DB → API 응답 매핑 요약

응답 필드 이름은 현재 `backend/schemas/demand.py` 기준이다.

| API | 응답 필드 | 출처 |
|---|---|---|
| `/heatmap`, `/places/{id}` | `id`, `name`, `type`, `lat`, `lng`, `polygon` | `places` (8.1, 8.4, 8.5) |
| | `points[].surgeIndex` | `surge_predictions.surge_index` (가장 최근 `base_time`, `offset_min` = offset) |
| | `points[].range` | `surge_index` + 급증 판정 기준 (결정 5) |
| | `points[].population`, `populationRange` | `latest_population` 뷰 / `realtime_pop_log` (8.2 계산 규칙) |
| | `generatedAt` | `surge_predictions.generated_at` |
| | `source` | `surge_predictions.source` (`mock` / `model`) |
| `/places/{id}` | `reasons` | `surge_predictions.reasons` |
| | `events` | 아래 `/events`를 그 장소로 거른 것 |
| | `taxiStands` | 미정 (4장) |
| `/events` | `id`, `placeId`, `type`, `title`, `peakAt`, `endsAt`, `expectedExits`, `source` | `demand_events` (8.4, 8.5) + `last_train_events(운행일, day_type)` (8.3) |
| `/alerts/top` | `travelMinutes`, `recommendedDepartureAt`, `arrivalAt` | `travel_minutes()` (8.6) |
| | `peakStart`, `peakEnd`, `reason` | 이벤트의 `peakAt`·`endsAt`, 예보 `reasons` |
| | `surgeIndexAtArrival` | 도착 시각에 해당하는 offset의 `surge_index` |
| `/replay/days/{date}` (신규) | `forecastSurge` | `surge_predictions` (그날의 `base_time`별) |
| | `seoulForecastPopulation` | `realtime_pop_log.seoul_forecast` (8.2 보간 규칙) |
| | `observedPopulation` | `realtime_pop_log` 대표값. `is_missing`이면 `null` |

### 8.9 이 장에서 새로 생긴 결정 사항

| | 결정 | 선택지 |
|---|---|---|
| A | 겹치는 121곳 영역 표시 | 모두 표시(작은 영역을 위에) / 겹치는 큰 영역(관광특구 등) 제외 |
| B | `populationRange` 기준 | 서울시 혼잡도 4단계 대응 / 팀 인구 구간 경계 |
| C | 공휴일 판단 (막차 `WEEK_TAG`) | 공휴일 API 추가 수집 / 연간 공휴일 표를 직접 관리 |
| D | 공항 이벤트 기준값 | 그날 평균 × 배수 / 고정 인원 / 상위 N개 시간대 |
| E | 공연 이벤트 대상 | 좌석 수 기준(예: 1,000석 이상) / 전체 |
| F | 1~8호선 밖 노선 막차 | 이번 범위에서 제외 / 다른 운영기관 데이터 추가 |

### 8.10 확인에 쓴 자료

- 서울 실시간 도시데이터: [OA-21778 데이터셋 페이지](https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do), 첨부 `서울시 주요 121장소 영역.zip`, 샘플 키 호출 `citydata_ppltn` (2026-11-20)
- 지하철 막차: [OA-110 데이터셋 페이지](https://data.seoul.go.kr/dataList/OA-110/A/1/datasetView.do), 샘플 키 호출 `SearchLastTrainTimeByIDService` (2026-11-20)
- 인천공항 승객예고: [공공데이터포털 15095066](https://www.data.go.kr/data/15095066/openapi.do), [인천공항 입국 승객 예고 안내](https://www.airport.kr/ap_ko/883/subview.do)
- KOPIS: [KOPIS 오픈API 가이드](https://kopis.or.kr/por/cs/openapi/openApiList.do?menuId=MNU_00074)
- 표준노드링크: [국토교통부고시 제2023-22호](https://www.codil.or.kr/filebank/moct2014//202301/MOCT3000_0.PDF?nserialno=3000), [공공데이터포털 15025526](https://www.data.go.kr/data/15025526/fileData.do)
- 기상청 강수: [공공데이터포털 15084084](https://www.data.go.kr/data/15084084/openapi.do) (2026-11-24, 서비스 주소·요청 변수·발표 시각 형식 확인)

### 8.11 기상청 시간별 강수 (1시간 수집) 📄 문서 확인 · 오퍼레이션 경로·값 범주 ⚠️

- 출처: [공공데이터포털 15084084 기상청_단기예보 ((구)_동네예보) 조회서비스](https://www.data.go.kr/data/15084084/openapi.do)
- 요청: `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst`(초단기실황), `.../getUltraSrtFcst`(초단기예보). 오퍼레이션 경로는 데이터셋 페이지에 없어 ⚠️ 활용가이드로 확인
- 요청 변수: `serviceKey`, `pageNo`, `numOfRows`, `dataType`(`JSON`), `base_date`(`YYYYMMDD`), `base_time`, `nx`, `ny`. 실황 `base_time`은 정시(`1400`), 초단기예보는 30분 단위(`1430`) 📄
- 제공 시각: 실황은 매시 40분 이후, 초단기예보는 매시 45분 이후 ⚠️ (활용가이드 기준, 데이터셋 페이지에는 없음). 그래서 매시 50분에 돌고, 실행 시각에서 받을 수 있는 발표 시각을 거꾸로 계산한다
- 호출 한도: 데이터셋 페이지에 표기 없음 ⚠️. 1회 실행 호출 수 = 격자 수 × (실황 3 + 예보 1)
- 단기예보(최대 3일, `getVilageFcst`)는 받지 않는다. 예보 범위가 0/30/60분이라 초단기예보 6시간이면 충분하다

장소 연결: 강수는 장소가 아니라 **5km 격자** 단위로 온다.

| 단계 | 규칙 |
|---|---|
| 장소 → 격자 | `places` 트리거가 대표점(`lat`, `lng`)을 기상청 Lambert 변환식(`kma_grid()`)으로 바꿔 `kma_nx`, `kma_ny`에 넣는다. 서울시청 (37.5665, 126.9780) → (60, 127) |
| 수집 대상 | `weather_grids` 뷰 = 활성 장소들의 격자를 중복 없이 모은 목록. 121곳은 서로 가까워서 격자 수가 장소 수보다 훨씬 적다 |
| 장소별 강수 | `places`와 `precip_hourly`(또는 `latest_precip` 뷰)를 `(kma_nx, kma_ny) = (nx, ny)`로 조인 |

| 원본 필드 | 변환 | `precip_hourly` 컬럼 |
|---|---|---|
| (요청한 격자) | 그대로 | `nx`, `ny` |
| 실황 / 예보 | `obs` / `fcst` | `kind` |
| 실황 `baseDate`+`baseTime` | KST. 그 시각까지 1시간 누적 강수 | `target_at` = `base_at` |
| 예보 `fcstDate`+`fcstTime` | KST. 예보 대상 1시간 | `target_at` |
| 예보 `baseDate`+`baseTime` | KST. 발표 시각 | `base_at` |
| `RN1` (`obsrValue`·`fcstValue`) | 아래 규칙으로 mm 숫자 | `rain_mm` |
| `RN1` 원문 | 그대로 | `rain_text` |
| `PTY` | 0~7 정수, 범위 밖이면 `null` | `pty` (0 없음, 1 비, 2 비/눈, 3 눈, 5 빗방울, 6 빗방울눈날림, 7 눈날림) |
| `RN1`·`PTY` 원문 | `{"RN1": ..., "PTY": ...}` | `raw` (전체 응답은 행이 많아 저장하지 않는다) |

`RN1` → `rain_mm` 규칙. 실황은 실수로 온다(📄 "RN1 … 실수로 제공"). 예보는 범주 문자열로 오는데 범주 표기는 ⚠️ 첫 실제 응답으로 확인한다.

| 원문 | `rain_mm` |
|---|---|
| `강수없음` | 0 |
| `1mm 미만` | 0.5 |
| `2.0mm` 등 숫자 | 그 값 |
| `30.0~50.0mm` | 40.0 (구간 가운데) |
| `50.0mm 이상` | 50.0 |
| 결측(±900 이상, `-998.9` 등), 읽을 수 없는 값 | `null` |

- 유니크 키: `(nx, ny, kind, target_at, base_at)`. 같은 시각의 예보도 **발표마다 따로 쌓는다**. 학습·검증 때 "그 시점에 알 수 있던 예보"를 쓰기 위해서다. 최신 발표값만 필요하면 `latest_precip` 뷰를 쓴다
- 저장: 수집 스크립트가 `record_precip(rows)`를 호출한다. 결측 행은 같은 키의 정상값을 덮어쓰지 않는다
- 실황은 실행마다 최근 3시간(`WEATHER_NCST_HOURS`)을 다시 받는다. 예약 실행이 건너뛰어도 다음 실행이 빈 시각을 채운다
- 용량: 하루 행 수 ≈ 격자 수 × 24 × (예보 6 + 실황 1). 격자 50개면 하루 약 8,400행, 한 행 약 200B라 하루 약 2MB

