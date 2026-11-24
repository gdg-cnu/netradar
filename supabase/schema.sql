
-- ============================================
-- NetRadar Database Schema
-- 사용자: profiles / trips / trip_events
-- v2 실데이터: places / venues / venue_halls / station_places
--             realtime_pop_log / airport_arrivals / demand_events
--             last_trains / surge_predictions / collector_runs
--             precip_hourly (기상청 시간별 강수, 5km 격자 단위)
--
-- 여러 번 실행해도 되도록 작성했다 (IF NOT EXISTS, OR REPLACE).
-- 자동 수집은 GitHub Actions(.github/workflows/collect-*.yml)가 하고,
-- 수집 스크립트는 service role 키로 20장의 저장 함수를 RPC 호출한다.
-- ============================================

-- 0. 확장 (Supabase는 확장을 extensions 스키마에 둔다)
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- 1. 사용자 프로필 테이블
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY
        REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    vehicle_type TEXT NOT NULL DEFAULT 'LPG',
    notifications BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 즐겨찾기 컬럼
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS favorites JSONB
NOT NULL DEFAULT '[]'::jsonb;

-- v2: 급증 알림 설정
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS surge_alerts BOOLEAN
NOT NULL DEFAULT TRUE;


-- 2. 운행 기록 테이블
CREATE TABLE IF NOT EXISTS public.trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL
        REFERENCES auth.users(id) ON DELETE CASCADE,

    route_id TEXT NOT NULL,
    destination TEXT NOT NULL,
    detour TEXT NOT NULL
        CHECK (detour IN ('little', 'normal', 'much')),

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,

    stops INTEGER NOT NULL DEFAULT 0
        CHECK (stops >= 0),
    passengers INTEGER NOT NULL DEFAULT 0
        CHECK (passengers >= 0),

    revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
    cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    extra_profit NUMERIC(12, 2) NOT NULL DEFAULT 0,

    finished BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    create_key TEXT,
    request_payload JSONB
);

-- 기존 테이블에도 컬럼 추가
ALTER TABLE public.trips
ADD COLUMN IF NOT EXISTS create_key TEXT,
ADD COLUMN IF NOT EXISTS request_payload JSONB;

-- v2: 목적지 없이 바로 출발 허용, 출발지·목표 장소·요금 기록 횟수
-- (target_place_id의 FK는 places 생성 뒤 12장에서 건다)
ALTER TABLE public.trips
ALTER COLUMN destination DROP NOT NULL;

ALTER TABLE public.trips
ADD COLUMN IF NOT EXISTS origin_name TEXT,
ADD COLUMN IF NOT EXISTS target_place_id TEXT,
ADD COLUMN IF NOT EXISTS fare_recorded_count INTEGER
    NOT NULL DEFAULT 0 CHECK (fare_recorded_count >= 0);


-- 3. 운행 이벤트 테이블
CREATE TABLE IF NOT EXISTS public.trip_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    trip_id UUID NOT NULL
        REFERENCES public.trips(id) ON DELETE CASCADE,

    event_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_type TEXT NOT NULL
        CHECK (event_type IN (
            'ARRIVE', 'PICK_UP', 'DROP_OFF',
            'SKIP', 'EXTEND_WAIT',
            'RECOMMEND', 'FINISH'
        )),

    occurred_at BIGINT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    request JSONB,
    response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (trip_id, event_id),
    UNIQUE (trip_id, idempotency_key)
);

-- 기존 이벤트 테이블에도 요청 원본 컬럼 추가
ALTER TABLE public.trip_events
ADD COLUMN IF NOT EXISTS request JSONB;


-- 4. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_trips_user_started
ON public.trips (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_trip_events_trip
ON public.trip_events (trip_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_user_create_key
ON public.trips (user_id, create_key);


-- 5. Row Level Security 활성화
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_events ENABLE ROW LEVEL SECURITY;


-- 6. profiles 접근 권한
REVOKE ALL ON TABLE public.profiles
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.profiles
TO authenticated;

-- 기존 동일 이름 정책 제거 후 재생성
DROP POLICY IF EXISTS "profiles_select_own"
ON public.profiles;

DROP POLICY IF EXISTS "profiles_insert_own"
ON public.profiles;

DROP POLICY IF EXISTS "profiles_update_own"
ON public.profiles;

-- 본인 프로필 조회
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = id);

-- 본인 프로필 생성
CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) = id);

-- 본인 프로필 수정
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);


-- 7. 운행 테이블 접근 권한
REVOKE ALL ON public.trips, public.trip_events
FROM anon, authenticated;

GRANT SELECT ON public.trips, public.trip_events
TO authenticated;

DROP POLICY IF EXISTS "trips_select_own"
ON public.trips;

DROP POLICY IF EXISTS "trip_events_select_own"
ON public.trip_events;

-- 본인 운행 기록 조회
CREATE POLICY "trips_select_own"
ON public.trips
FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = user_id);

-- 본인 운행 이벤트 조회
CREATE POLICY "trip_events_select_own"
ON public.trip_events
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.trips t
        WHERE t.id = trip_id
          AND t.user_id = (SELECT auth.uid())
    )
);


-- 8. service_role 권한
GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.trips
TO service_role;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.trip_events
TO service_role;


-- 9. 운행 이벤트 처리 함수
CREATE OR REPLACE FUNCTION public.record_trip_event(
    p_trip_id UUID,
    p_user_id UUID,
    p_event_id TEXT,
    p_idempotency_key TEXT,
    p_event_type TEXT,
    p_occurred_at BIGINT,
    p_payload JSONB,
    p_request JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_trip public.trips%ROWTYPE;
    v_old_request JSONB;
    v_old_response JSONB;
    v_result JSONB;
    v_fare NUMERIC := 0;
BEGIN
    -- 동일 운행에 대한 동시 요청 직렬화
    SELECT *
    INTO v_trip
    FROM public.trips
    WHERE id = p_trip_id
      AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN '{"error":"not_found"}'::jsonb;
    END IF;

    -- 중복 이벤트 및 멱등성 확인
    SELECT request, response
    INTO v_old_request, v_old_response
    FROM public.trip_events
    WHERE trip_id = p_trip_id
      AND (
          event_id = p_event_id
          OR idempotency_key = p_idempotency_key
      )
    LIMIT 1;

    IF FOUND THEN
        IF v_old_request = p_request THEN
            RETURN v_old_response;
        END IF;

        RETURN '{"error":"conflict"}'::jsonb;
    END IF;

    -- 종료된 운행 확인
    IF v_trip.finished THEN
        RETURN '{"error":"finished"}'::jsonb;
    END IF;

    -- 하차 이벤트 요금 처리
    IF p_event_type = 'DROP_OFF' THEN
        IF p_payload ? 'fare' THEN
            IF jsonb_typeof(p_payload->'fare') <> 'number' THEN
                RETURN '{"error":"invalid_fare"}'::jsonb;
            END IF;

            v_fare := (p_payload->>'fare')::numeric;
        END IF;

        IF v_fare < 0 OR v_fare >= 100000000000 THEN
            RETURN '{"error":"invalid_fare"}'::jsonb;
        END IF;
    END IF;

    -- 운행 상태 업데이트
    UPDATE public.trips
    SET
        stops = stops +
            CASE
                WHEN p_event_type = 'ARRIVE' THEN 1
                ELSE 0
            END,

        passengers = passengers +
            CASE
                WHEN p_event_type = 'PICK_UP' THEN 1
                ELSE 0
            END,

        revenue = revenue + v_fare,
        extra_profit = revenue + v_fare - cost,

        finished = CASE
            WHEN p_event_type = 'FINISH' THEN TRUE
            ELSE finished
        END,

        ended_at = CASE
            WHEN p_event_type = 'FINISH' THEN NOW()
            ELSE ended_at
        END
    WHERE id = p_trip_id
    RETURNING * INTO v_trip;

    -- 기본 응답
    v_result := jsonb_build_object(
        'accepted', TRUE
    );

    -- 정산 정보 반환
    IF p_event_type IN ('DROP_OFF', 'FINISH') THEN
        v_result := v_result || jsonb_build_object(
            'totals', jsonb_build_object(
                'revenue', v_trip.revenue,
                'cost', v_trip.cost,
                'extraProfit', v_trip.extra_profit
            )
        );
    END IF;

    -- 이벤트 기록
    INSERT INTO public.trip_events (
        trip_id,
        event_id,
        idempotency_key,
        event_type,
        occurred_at,
        payload,
        request,
        response
    )
    VALUES (
        p_trip_id,
        p_event_id,
        p_idempotency_key,
        p_event_type,
        p_occurred_at,
        p_payload,
        p_request,
        v_result
    );

    RETURN v_result;
END;
$$;


-- 10. 함수 실행 권한 제한
REVOKE ALL ON FUNCTION public.record_trip_event(
    UUID, UUID, TEXT, TEXT, TEXT, BIGINT,
    JSONB, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_trip_event(
    UUID, UUID, TEXT, TEXT, TEXT, BIGINT,
    JSONB, JSONB
) TO service_role;


-- ============================================
-- v2 실데이터 (docs/netradar-v2-data-mapping.md 8장)
-- 수집은 GitHub Actions 예약 작업이 돌리는 Python 스크립트가 한다.
-- 모든 시각은 timestamptz. 원본의 타임존 없는 한국 시간은 '+09:00'을 붙여 넣는다.
-- ============================================

-- 11. 장소 (121곳 + 인천공항 + 121곳 밖 공연장)
CREATE TABLE IF NOT EXISTS public.places (
    id TEXT PRIMARY KEY,                -- POI014 / ICN-T1 / KOPIS-FC000001
    name TEXT NOT NULL,
    type TEXT NOT NULL
        CHECK (type IN ('seoul_rtd', 'airport', 'venue')),
    area_type TEXT,                     -- 121곳 CATEGORY (인구밀집지역, 공원 ...)

    polygon JSONB NOT NULL              -- GeoJSON [경도, 위도] 닫힌 링 (API 응답용)
        CHECK (jsonb_typeof(polygon) = 'array'),
    geom extensions.geometry(Geometry, 4326),  -- polygon에서 트리거로 계산 (공간 검색용)
    lat DOUBLE PRECISION NOT NULL,      -- 대표점 (폴리곤 안쪽 점). 비워서 넣으면 트리거가 채운다
    lng DOUBLE PRECISION NOT NULL,

    capacity INTEGER CHECK (capacity >= 0),  -- venue 장소의 객석 수
    has_population BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,    -- 목록에서 빠진 장소는 지우지 않고 false

    raw JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기상청 동네예보 격자 (대표점 lat·lng로 트리거가 계산). 강수 데이터와 잇는 키
ALTER TABLE public.places
ADD COLUMN IF NOT EXISTS kma_nx SMALLINT;

ALTER TABLE public.places
ADD COLUMN IF NOT EXISTS kma_ny SMALLINT;

CREATE INDEX IF NOT EXISTS idx_places_geom
ON public.places USING gist (geom);

CREATE INDEX IF NOT EXISTS idx_places_kma_grid
ON public.places (kma_nx, kma_ny);

-- 위경도 → 기상청 5km 격자 (Lambert 정각원추도법, 기상청 단기예보 API 활용가이드의 변환식)
-- 예: 서울시청(37.5665, 126.9780) → (60, 127)
CREATE OR REPLACE FUNCTION public.kma_grid(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    OUT nx SMALLINT,
    OUT ny SMALLINT
)
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
    d CONSTANT DOUBLE PRECISION := pi() / 180.0;
    re CONSTANT DOUBLE PRECISION := 6371.00877 / 5.0;   -- 지구 반경(km) / 격자 간격(km)
    slat1 CONSTANT DOUBLE PRECISION := 30.0 * d;        -- 표준위도 1
    slat2 CONSTANT DOUBLE PRECISION := 60.0 * d;        -- 표준위도 2
    olon CONSTANT DOUBLE PRECISION := 126.0 * d;        -- 기준점 경도
    olat CONSTANT DOUBLE PRECISION := 38.0 * d;         -- 기준점 위도
    sn DOUBLE PRECISION;
    sf DOUBLE PRECISION;
    ro DOUBLE PRECISION;
    ra DOUBLE PRECISION;
    theta DOUBLE PRECISION;
BEGIN
    sn := ln(cos(slat1) / cos(slat2))
        / ln(tan(pi() / 4 + slat2 / 2) / tan(pi() / 4 + slat1 / 2));
    sf := power(tan(pi() / 4 + slat1 / 2), sn) * cos(slat1) / sn;
    ro := re * sf / power(tan(pi() / 4 + olat / 2), sn);
    ra := re * sf / power(tan(pi() / 4 + p_lat * d / 2), sn);

    theta := p_lng * d - olon;
    IF theta > pi() THEN theta := theta - 2 * pi(); END IF;
    IF theta < -pi() THEN theta := theta + 2 * pi(); END IF;
    theta := theta * sn;

    nx := floor(ra * sin(theta) + 43 + 0.5)::SMALLINT;        -- 기준점 X = 43
    ny := floor(ro - ra * cos(theta) + 136 + 0.5)::SMALLINT;  -- 기준점 Y = 136
END;
$$;

-- polygon → geom 계산 (꼬인 도형은 ST_MakeValid로 고침), 대표점 계산, 기상청 격자 계산, updated_at 갱신
-- 대표점은 lat·lng가 비어 있거나, 폴리곤만 바뀌고 대표점은 그대로일 때 다시 구한다
-- PostGIS 함수가 내부에서 다른 함수를 스키마 없이 부르므로 search_path에 extensions를 둔다
CREATE OR REPLACE FUNCTION public.places_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = extensions
AS $$
DECLARE
    v_point extensions.geometry;
BEGIN
    NEW.geom := extensions.ST_MakeValid(
        extensions.ST_SetSRID(
            extensions.ST_GeomFromGeoJSON(
                jsonb_build_object(
                    'type', 'Polygon',
                    'coordinates', jsonb_build_array(NEW.polygon)
                )::text
            ),
            4326
        )
    );

    IF NEW.lat IS NULL OR NEW.lng IS NULL
       OR (TG_OP = 'UPDATE'
           AND NEW.polygon IS DISTINCT FROM OLD.polygon
           AND NEW.lat = OLD.lat AND NEW.lng = OLD.lng) THEN
        v_point := extensions.ST_PointOnSurface(NEW.geom);
        NEW.lat := extensions.ST_Y(v_point);
        NEW.lng := extensions.ST_X(v_point);
    END IF;

    SELECT g.nx, g.ny
    INTO NEW.kma_nx, NEW.kma_ny
    FROM public.kma_grid(NEW.lat, NEW.lng) AS g;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_places_before_write ON public.places;

CREATE TRIGGER trg_places_before_write
BEFORE INSERT OR UPDATE
ON public.places
FOR EACH ROW
EXECUTE FUNCTION public.places_before_write();

-- 격자 컬럼 추가 전에 들어간 장소 채우기 (트리거가 같은 값으로 다시 계산한다)
UPDATE public.places
SET kma_nx = (public.kma_grid(lat, lng)).nx,
    kma_ny = (public.kma_grid(lat, lng)).ny
WHERE kma_nx IS NULL
   OR kma_ny IS NULL;

-- 인천공항 터미널 (공식 경계가 없어 터미널 건물 주변을 직접 그린 근사 영역. 필요하면 고친다)
-- 121곳은 collect-citydata가 backend/collectors/data/seoul_places.json으로 자동 적재한다
INSERT INTO public.places (id, name, type, polygon, has_population)
VALUES
    ('ICN-T1', '인천공항 제1여객터미널', 'airport',
     '[[126.4440,37.4455],[126.4575,37.4455],[126.4575,37.4525],[126.4440,37.4525],[126.4440,37.4455]]',
     FALSE),
    ('ICN-T2', '인천공항 제2여객터미널', 'airport',
     '[[126.4265,37.4650],[126.4400,37.4650],[126.4400,37.4720],[126.4265,37.4720],[126.4265,37.4650]]',
     FALSE)
ON CONFLICT (id) DO NOTHING;

-- trips.target_place_id → places
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'trips_target_place_id_fkey'
    ) THEN
        ALTER TABLE public.trips
        ADD CONSTRAINT trips_target_place_id_fkey
        FOREIGN KEY (target_place_id) REFERENCES public.places(id);
    END IF;
END;
$$;


-- 12. KOPIS 공연시설·홀
-- 한 장소(예: POI127 올림픽공원)에 공연시설이 여러 개 있을 수 있어서
-- places에 시설 ID 컬럼을 두지 않고 별도 표로 연결한다
CREATE TABLE IF NOT EXISTS public.venues (
    mt10id TEXT PRIMARY KEY,
    name TEXT NOT NULL,                 -- fcltynm
    lat DOUBLE PRECISION,               -- la
    lng DOUBLE PRECISION,               -- lo
    seats INTEGER CHECK (seats >= 0),   -- 시설 전체 seatscale
    place_id TEXT REFERENCES public.places(id),
    raw JSONB,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.venue_halls (
    mt13id TEXT PRIMARY KEY,
    mt10id TEXT NOT NULL
        REFERENCES public.venues(mt10id) ON DELETE CASCADE,
    name TEXT NOT NULL,                 -- prfplcnm
    seats INTEGER CHECK (seats >= 0)    -- seatscale ("15,000" → 15000)
);

CREATE INDEX IF NOT EXISTS idx_venue_halls_venue
ON public.venue_halls (mt10id);


-- 13. 지하철역 → 장소 연결표 (손으로 관리)
-- last_trains를 다시 적재해도 연결이 지워지지 않도록 따로 둔다
CREATE TABLE IF NOT EXISTS public.station_places (
    station_cd TEXT PRIMARY KEY,        -- 0239
    station TEXT NOT NULL,              -- 홍대입구
    place_id TEXT NOT NULL
        REFERENCES public.places(id)    -- POI055
);


-- 14. 실시간 인구 (10분 수집)
CREATE TABLE IF NOT EXISTS public.realtime_pop_log (
    place_id TEXT NOT NULL
        REFERENCES public.places(id),
    observed_at TIMESTAMPTZ NOT NULL,   -- PPLTN_TIME. 실패 시 수집 시각을 10분 단위로 내린 값

    pop_min INTEGER CHECK (pop_min >= 0),
    pop_max INTEGER CHECK (pop_max >= 0),
    congest_lvl TEXT
        CHECK (congest_lvl IN ('여유', '보통', '약간 붐빔', '붐빔')),
    seoul_forecast JSONB,               -- [{time, min, max, congestLvl}] 1시간 단위
    is_replaced BOOLEAN NOT NULL DEFAULT FALSE,  -- REPLACE_YN = 'Y'
    is_missing BOOLEAN NOT NULL DEFAULT FALSE,

    raw JSONB,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (place_id, observed_at)
);

-- 리플레이(날짜별 조회)용
CREATE INDEX IF NOT EXISTS idx_realtime_pop_log_observed
ON public.realtime_pop_log (observed_at);

-- 장소별 가장 최근 관측값 (20분 신선도 판정은 API에서)
CREATE OR REPLACE VIEW public.latest_population
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (place_id)
    place_id,
    observed_at,
    pop_min,
    pop_max,
    ROUND((pop_min + pop_max) / 2.0)::INTEGER AS population,
    congest_lvl,
    seoul_forecast
FROM public.realtime_pop_log
WHERE NOT is_missing
ORDER BY place_id, observed_at DESC;


-- 15. 인천공항 시간대별 입국 인원 (1시간 수집)
CREATE TABLE IF NOT EXISTS public.airport_arrivals (
    terminal TEXT NOT NULL
        CHECK (terminal IN ('T1', 'T2')),
    arrival_date DATE NOT NULL,         -- 표출일자
    hour SMALLINT NOT NULL
        CHECK (hour BETWEEN 0 AND 23),  -- 시간대 시작 시
    arrivals INTEGER
        CHECK (arrivals >= 0),          -- 입국장 합계
    raw JSONB,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (terminal, arrival_date, hour)
);


-- 16. 수요 이벤트 (공항·공연)
CREATE TABLE IF NOT EXISTS public.demand_events (
    id TEXT PRIMARY KEY,                -- airport-T1-20261120-22 / concert-PF000001-202611201930
    place_id TEXT NOT NULL
        REFERENCES public.places(id),
    type TEXT NOT NULL
        CHECK (type IN ('airport', 'concert')),
    title TEXT NOT NULL,
    peak_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    expected_exits INTEGER
        CHECK (expected_exits >= 0),
    source TEXT NOT NULL,               -- '인천공항 승객예고' / 'KOPIS'
    source_ref TEXT NOT NULL,           -- 다시 만들 때의 묶음 단위: 'T1-2026-11-20' / mt20id

    raw JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (ends_at IS NULL OR ends_at >= peak_at)
);

CREATE INDEX IF NOT EXISTS idx_demand_events_peak
ON public.demand_events (peak_at);

CREATE INDEX IF NOT EXISTS idx_demand_events_place_peak
ON public.demand_events (place_id, peak_at);

CREATE INDEX IF NOT EXISTS idx_demand_events_source_ref
ON public.demand_events (type, source_ref);


-- 17. 지하철 막차 시각 (1회 적재, 시간표 변경 시 갱신)
CREATE TABLE IF NOT EXISTS public.last_trains (
    station_cd TEXT NOT NULL,           -- STATION_CD
    station TEXT NOT NULL,              -- STATION_NM
    line TEXT,                          -- 응답에 없음. 역 코드표에서 채움
    direction TEXT NOT NULL,            -- SUBWAYENAME (행선지)
    inout_tag SMALLINT NOT NULL
        CHECK (inout_tag IN (1, 2)),
    day_type TEXT NOT NULL
        CHECK (day_type IN ('weekday', 'saturday', 'holiday')),
    last_at SMALLINT NOT NULL
        CHECK (last_at BETWEEN 0 AND 2879), -- 운행일 0시 기준 분 (24:49 → 1489)
    raw JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (station_cd, day_type, inout_tag, direction)
);


-- 17-1. 기상청 시간별 강수 (1시간 수집, 기상청 단기예보 조회서비스)
-- 강수는 장소가 아니라 5km 격자 단위로 온다. 장소와는 places.kma_nx·kma_ny로 잇는다
--   obs  : 초단기실황 getUltraSrtNcst. 정시 관측, 직전 1시간 강수량(RN1)
--   fcst : 초단기예보 getUltraSrtFcst. 매시 발표, 앞으로 6시간의 1시간 강수량(RN1)
-- 같은 시각에 대한 예보가 발표마다 쌓이도록 base_at까지 키에 넣는다 (그때 알 수 있던 예보로 학습·검증)
CREATE TABLE IF NOT EXISTS public.precip_hourly (
    nx SMALLINT NOT NULL,
    ny SMALLINT NOT NULL,
    kind TEXT NOT NULL
        CHECK (kind IN ('obs', 'fcst')),
    target_at TIMESTAMPTZ NOT NULL,     -- obs: 관측 정시(그 직전 1시간 누적) / fcst: fcstDate+fcstTime
    base_at TIMESTAMPTZ NOT NULL,       -- 발표 시각 baseDate+baseTime (obs는 target_at과 같다)

    rain_mm NUMERIC(5, 1)
        CHECK (rain_mm >= 0),           -- RN1 숫자화. '강수없음' → 0, 결측(-998.9 등) → NULL
    rain_text TEXT,                     -- RN1 원문 ('강수없음', '1mm 미만', '30.0~50.0mm' ...)
    pty SMALLINT
        CHECK (pty BETWEEN 0 AND 7),    -- 강수형태 0 없음 1 비 2 비/눈 3 눈 5 빗방울 6 빗방울눈날림 7 눈날림

    raw JSONB,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (nx, ny, kind, target_at, base_at),
    CHECK (kind <> 'obs' OR base_at = target_at)
);

-- 리플레이(시간대별 조회)용
CREATE INDEX IF NOT EXISTS idx_precip_hourly_target
ON public.precip_hourly (target_at);

-- 수집할 격자 목록 (활성 장소의 격자를 중복 없이)
CREATE OR REPLACE VIEW public.weather_grids
WITH (security_invoker = true)
AS
SELECT
    kma_nx AS nx,
    kma_ny AS ny,
    ARRAY_AGG(id ORDER BY id) AS place_ids
FROM public.places
WHERE active
  AND kma_nx IS NOT NULL
  AND kma_ny IS NOT NULL
GROUP BY kma_nx, kma_ny;

-- 격자·종류·시각마다 가장 최근 발표값. target_at 조건을 걸어서 쓴다
CREATE OR REPLACE VIEW public.latest_precip
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (nx, ny, kind, target_at)
    nx,
    ny,
    kind,
    target_at,
    base_at,
    rain_mm,
    rain_text,
    pty
FROM public.precip_hourly
ORDER BY nx, ny, kind, target_at, base_at DESC;


-- 18. 수요 지수 예보 (AI 예약 작업이 10분마다 upsert)
CREATE TABLE IF NOT EXISTS public.surge_predictions (
    place_id TEXT NOT NULL
        REFERENCES public.places(id),
    base_time TIMESTAMPTZ NOT NULL,
    offset_min SMALLINT NOT NULL        -- offset은 예약어라 offset_min
        CHECK (offset_min IN (0, 30, 60)),
    surge_index SMALLINT
        CHECK (surge_index BETWEEN 0 AND 100),
    expected_exits INTEGER
        CHECK (expected_exits >= 0),
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL
        CHECK (source IN ('mock', 'model')),

    PRIMARY KEY (place_id, base_time, offset_min)
);

CREATE INDEX IF NOT EXISTS idx_surge_predictions_base_time
ON public.surge_predictions (base_time DESC);


-- 19. 수집 실행 기록 (실패 추적용)
CREATE TABLE IF NOT EXISTS public.collector_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    collector TEXT NOT NULL,            -- collect-citydata / collect-airport / collect-kopis / collect-weather
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'ok', 'partial', 'failed')),
    row_count INTEGER,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_collector_runs_collector_started
ON public.collector_runs (collector, started_at DESC);


-- 20. 수집기용 함수

-- 20.1 좌표가 들어 있는 121곳 장소 (겹치면 가장 작은 영역)
CREATE OR REPLACE FUNCTION public.find_place_at(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = extensions
AS $$
    SELECT p.id
    FROM public.places p
    WHERE p.type = 'seoul_rtd'
      AND p.active
      AND extensions.ST_Contains(
          p.geom,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)
      )
    ORDER BY extensions.ST_Area(p.geom)
    LIMIT 1;
$$;

-- 20.2 실시간 인구 저장
-- 실패 행(is_missing)은 같은 시각의 정상 관측값을 덮어쓰지 않는다
CREATE OR REPLACE FUNCTION public.record_population(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.realtime_pop_log AS l (
        place_id, observed_at, pop_min, pop_max, congest_lvl,
        seoul_forecast, is_replaced, is_missing, raw
    )
    SELECT
        r.place_id,
        r.observed_at,
        r.pop_min,
        r.pop_max,
        r.congest_lvl,
        r.seoul_forecast,
        COALESCE(r.is_replaced, FALSE),
        COALESCE(r.is_missing, FALSE),
        r.raw
    FROM jsonb_to_recordset(p_rows) AS r(
        place_id TEXT,
        observed_at TIMESTAMPTZ,
        pop_min INTEGER,
        pop_max INTEGER,
        congest_lvl TEXT,
        seoul_forecast JSONB,
        is_replaced BOOLEAN,
        is_missing BOOLEAN,
        raw JSONB
    )
    ON CONFLICT (place_id, observed_at) DO UPDATE
    SET
        pop_min = EXCLUDED.pop_min,
        pop_max = EXCLUDED.pop_max,
        congest_lvl = EXCLUDED.congest_lvl,
        seoul_forecast = EXCLUDED.seoul_forecast,
        is_replaced = EXCLUDED.is_replaced,
        is_missing = EXCLUDED.is_missing,
        raw = EXCLUDED.raw,
        collected_at = NOW()
    WHERE l.is_missing OR NOT EXCLUDED.is_missing;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- 20.3 공항 이벤트 다시 만들기 (터미널·날짜 단위)
-- 기준값 = 그날 평균 × p_ratio (결정 D). 기준값 이상이 이어진 구간 하나 = 이벤트 하나
CREATE OR REPLACE FUNCTION public.rebuild_airport_events(
    p_terminal TEXT,
    p_date DATE,
    p_ratio NUMERIC DEFAULT 1.5
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_ref TEXT := p_terminal || '-' || p_date::TEXT;
    v_count INTEGER;
BEGIN
    DELETE FROM public.demand_events
    WHERE type = 'airport'
      AND source_ref = v_ref;

    WITH hours AS (
        SELECT hour, arrivals
        FROM public.airport_arrivals
        WHERE terminal = p_terminal
          AND arrival_date = p_date
          AND arrivals IS NOT NULL
    ),
    threshold AS (
        SELECT AVG(arrivals) * p_ratio AS value
        FROM hours
    ),
    hot AS (
        SELECT
            h.hour,
            h.arrivals,
            h.hour - ROW_NUMBER() OVER (ORDER BY h.hour) AS grp
        FROM hours h
        CROSS JOIN threshold t
        WHERE h.arrivals >= t.value
    ),
    seg AS (
        SELECT
            MIN(hour) AS start_h,
            MAX(hour) AS end_h,
            SUM(arrivals) AS total,
            MAX(arrivals) AS peak_n,
            (ARRAY_AGG(hour ORDER BY arrivals DESC, hour))[1] AS peak_h
        FROM hot
        GROUP BY grp
    )
    INSERT INTO public.demand_events (
        id, place_id, type, title, peak_at, ends_at,
        expected_exits, source, source_ref, raw
    )
    SELECT
        FORMAT('airport-%s-%s-%s',
               p_terminal, TO_CHAR(p_date, 'YYYYMMDD'), LPAD(s.start_h::TEXT, 2, '0')),
        'ICN-' || p_terminal,
        'airport',
        FORMAT('%s 입국 %s명 예상', p_terminal, TO_CHAR(s.peak_n, 'FM999,999,990')),
        (p_date + MAKE_INTERVAL(hours => s.peak_h, mins => 30)) AT TIME ZONE 'Asia/Seoul',
        (p_date + MAKE_INTERVAL(hours => s.end_h + 1)) AT TIME ZONE 'Asia/Seoul',
        s.total,
        '인천공항 승객예고',
        v_ref,
        JSONB_BUILD_OBJECT(
            'startHour', s.start_h,
            'endHour', s.end_h,
            'peakHour', s.peak_h,
            'peakArrivals', s.peak_n,
            'threshold', ROUND((SELECT value FROM threshold)),
            'ratio', p_ratio
        )
    FROM seg s;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- 20.4 공항 시간대 저장 + 받은 날짜의 공항 이벤트 다시 만들기
CREATE OR REPLACE FUNCTION public.record_airport_arrivals(
    p_rows JSONB,                       -- [{terminal, arrival_date, hour, arrivals, raw}]
    p_ratio NUMERIC DEFAULT 1.5
)
RETURNS INTEGER                         -- 만든 이벤트 수
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_day RECORD;
    v_events INTEGER := 0;
BEGIN
    INSERT INTO public.airport_arrivals (terminal, arrival_date, hour, arrivals, raw)
    SELECT r.terminal, r.arrival_date, r.hour, r.arrivals, r.raw
    FROM jsonb_to_recordset(p_rows) AS r(
        terminal TEXT,
        arrival_date DATE,
        hour SMALLINT,
        arrivals INTEGER,
        raw JSONB
    )
    ON CONFLICT (terminal, arrival_date, hour) DO UPDATE
    SET
        arrivals = EXCLUDED.arrivals,
        raw = EXCLUDED.raw,
        collected_at = NOW();

    FOR v_day IN
        SELECT DISTINCT r.terminal, r.arrival_date
        FROM jsonb_to_recordset(p_rows) AS r(terminal TEXT, arrival_date DATE)
    LOOP
        v_events := v_events
            + public.rebuild_airport_events(v_day.terminal, v_day.arrival_date, p_ratio);
    END LOOP;

    RETURN v_events;
END;
$$;

-- 20.5 KOPIS 공연시설 저장
-- 121곳 영역 안이면 그 장소에 연결하고, 밖이면 반경 200m 원으로 venue 장소를 만든다
CREATE OR REPLACE FUNCTION public.upsert_kopis_venue(
    p_mt10id TEXT,
    p_name TEXT,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_seats INTEGER,
    p_halls JSONB,                      -- [{mt13id, name, seats}]
    p_raw JSONB
)
RETURNS TEXT                            -- 연결된 place_id (좌표가 없으면 NULL)
LANGUAGE plpgsql
SET search_path = extensions
AS $$
DECLARE
    v_place_id TEXT;
    v_circle extensions.geometry;
BEGIN
    SELECT v.place_id INTO v_place_id
    FROM public.venues v
    WHERE v.mt10id = p_mt10id;

    IF v_place_id IS NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
        v_place_id := public.find_place_at(p_lat, p_lng);

        IF v_place_id IS NULL THEN
            v_place_id := 'KOPIS-' || p_mt10id;
            v_circle := extensions.ST_Buffer(
                extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography,
                200
            )::extensions.geometry;

            INSERT INTO public.places (
                id, name, type, polygon, lat, lng, capacity, has_population
            )
            VALUES (
                v_place_id,
                p_name,
                'venue',
                (extensions.ST_AsGeoJSON(v_circle, 7)::JSONB) -> 'coordinates' -> 0,
                p_lat,
                p_lng,
                p_seats,
                FALSE
            )
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                capacity = EXCLUDED.capacity;
        END IF;
    END IF;

    INSERT INTO public.venues (mt10id, name, lat, lng, seats, place_id, raw, refreshed_at)
    VALUES (p_mt10id, p_name, p_lat, p_lng, p_seats, v_place_id, p_raw, NOW())
    ON CONFLICT (mt10id) DO UPDATE
    SET
        name = EXCLUDED.name,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        seats = EXCLUDED.seats,
        place_id = COALESCE(public.venues.place_id, EXCLUDED.place_id),
        raw = EXCLUDED.raw,
        refreshed_at = NOW();

    INSERT INTO public.venue_halls (mt13id, mt10id, name, seats)
    SELECT h.mt13id, p_mt10id, h.name, h.seats
    FROM jsonb_to_recordset(COALESCE(p_halls, '[]'::jsonb))
        AS h(mt13id TEXT, name TEXT, seats INTEGER)
    ON CONFLICT (mt13id) DO UPDATE
    SET name = EXCLUDED.name,
        seats = EXCLUDED.seats;

    RETURN v_place_id;
END;
$$;

-- 20.6 공연 회차 동기화 (KOPIS 수집 1회 = 호출 1회)
-- 받은 공연(p_mt20ids)의 앞으로 남은 회차를 지우고 p_events로 바꾼다.
-- p_full_sync = TRUE면(공연 목록을 빠짐없이 받은 경우) 목록에서 사라진 공연의 미래 회차도 지운다.
-- 지난 회차는 리플레이·검증용으로 남긴다
DROP FUNCTION IF EXISTS public.replace_concert_events(TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.sync_concert_events(
    p_mt20ids TEXT[],
    p_events JSONB,                     -- [{id, place_id, source_ref, title, peak_at, ends_at, expected_exits, raw}]
    p_full_sync BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM public.demand_events
    WHERE type = 'concert'
      AND peak_at >= NOW()
      AND (p_full_sync OR source_ref = ANY (p_mt20ids));

    INSERT INTO public.demand_events (
        id, place_id, type, title, peak_at, ends_at,
        expected_exits, source, source_ref, raw
    )
    SELECT
        e.id, e.place_id, 'concert', e.title, e.peak_at, e.ends_at,
        e.expected_exits, 'KOPIS', e.source_ref, e.raw
    FROM jsonb_to_recordset(p_events) AS e(
        id TEXT,
        place_id TEXT,
        source_ref TEXT,
        title TEXT,
        peak_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        expected_exits INTEGER,
        raw JSONB
    )
    WHERE e.peak_at >= NOW()
    ON CONFLICT (id) DO UPDATE
    SET
        place_id = EXCLUDED.place_id,
        title = EXCLUDED.title,
        peak_at = EXCLUDED.peak_at,
        ends_at = EXCLUDED.ends_at,
        expected_exits = EXCLUDED.expected_exits,
        raw = EXCLUDED.raw,
        updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- 20.7 운행일의 막차 이벤트 (/events 요청 시 호출)
-- 역·방향(inout_tag)마다 가장 늦은 막차 하나. day_type은 API가 공휴일 여부로 정해서 넘긴다 (결정 C)
CREATE OR REPLACE FUNCTION public.last_train_events(
    p_service_date DATE,
    p_day_type TEXT
)
RETURNS TABLE (
    id TEXT,
    place_id TEXT,
    type TEXT,
    title TEXT,
    peak_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    expected_exits INTEGER,
    source TEXT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH latest AS (
        SELECT DISTINCT ON (lt.station_cd, lt.inout_tag)
            lt.station_cd,
            lt.station,
            lt.inout_tag,
            lt.last_at,
            sp.place_id
        FROM public.last_trains lt
        JOIN public.station_places sp
          ON sp.station_cd = lt.station_cd
        WHERE lt.day_type = p_day_type
        ORDER BY lt.station_cd, lt.inout_tag, lt.last_at DESC
    ),
    timed AS (
        SELECT
            l.*,
            (p_service_date + MAKE_INTERVAL(mins => l.last_at))
                AT TIME ZONE 'Asia/Seoul' AS train_at
        FROM latest l
    )
    SELECT
        FORMAT('last_train-%s-%s-%s',
               t.station_cd, t.inout_tag, TO_CHAR(p_service_date, 'YYYYMMDD')),
        t.place_id,
        'last_train',
        FORMAT('%s 막차 %s',
               t.station, TO_CHAR(t.train_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI')),
        t.train_at,
        t.train_at + INTERVAL '30 minutes',
        NULL::INTEGER,
        '서울교통공사 막차 시각'
    FROM timed t
    ORDER BY t.train_at;
$$;

-- 20.8 기상청 강수 저장
-- 결측 행(rain_mm·pty 모두 NULL)은 같은 키의 정상값을 덮어쓰지 않는다
CREATE OR REPLACE FUNCTION public.record_precip(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.precip_hourly AS p (
        nx, ny, kind, target_at, base_at, rain_mm, rain_text, pty, raw
    )
    SELECT
        r.nx, r.ny, r.kind, r.target_at, r.base_at,
        r.rain_mm, r.rain_text, r.pty, r.raw
    FROM jsonb_to_recordset(p_rows) AS r(
        nx SMALLINT,
        ny SMALLINT,
        kind TEXT,
        target_at TIMESTAMPTZ,
        base_at TIMESTAMPTZ,
        rain_mm NUMERIC,
        rain_text TEXT,
        pty SMALLINT,
        raw JSONB
    )
    ON CONFLICT (nx, ny, kind, target_at, base_at) DO UPDATE
    SET
        rain_mm = EXCLUDED.rain_mm,
        rain_text = EXCLUDED.rain_text,
        pty = EXCLUDED.pty,
        raw = EXCLUDED.raw,
        collected_at = NOW()
    WHERE EXCLUDED.rain_mm IS NOT NULL
       OR EXCLUDED.pty IS NOT NULL
       OR (p.rain_mm IS NULL AND p.pty IS NULL);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;


-- 21. 실데이터 테이블 권한
-- 서버(service_role)만 읽고 쓴다. Supabase는 public 스키마의 새 테이블에
-- anon·authenticated 권한을 기본으로 주므로 명시적으로 회수한다
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_halls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realtime_pop_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airport_arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.last_trains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surge_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collector_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precip_hourly ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
    public.places, public.venues, public.venue_halls, public.station_places,
    public.realtime_pop_log, public.airport_arrivals, public.demand_events,
    public.last_trains, public.surge_predictions, public.collector_runs,
    public.precip_hourly,
    public.latest_population, public.weather_grids, public.latest_precip
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.places, public.venues, public.venue_halls, public.station_places,
    public.realtime_pop_log, public.airport_arrivals, public.demand_events,
    public.last_trains, public.surge_predictions, public.collector_runs,
    public.precip_hourly
TO service_role;

GRANT SELECT ON
    public.latest_population, public.weather_grids, public.latest_precip
TO service_role;

REVOKE ALL ON FUNCTION
    public.places_before_write(),
    public.kma_grid(DOUBLE PRECISION, DOUBLE PRECISION),
    public.record_precip(JSONB),
    public.find_place_at(DOUBLE PRECISION, DOUBLE PRECISION),
    public.record_population(JSONB),
    public.rebuild_airport_events(TEXT, DATE, NUMERIC),
    public.record_airport_arrivals(JSONB, NUMERIC),
    public.upsert_kopis_venue(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, JSONB, JSONB),
    public.sync_concert_events(TEXT[], JSONB, BOOLEAN),
    public.last_train_events(DATE, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.kma_grid(DOUBLE PRECISION, DOUBLE PRECISION),
    public.record_precip(JSONB),
    public.find_place_at(DOUBLE PRECISION, DOUBLE PRECISION),
    public.record_population(JSONB),
    public.rebuild_airport_events(TEXT, DATE, NUMERIC),
    public.record_airport_arrivals(JSONB, NUMERIC),
    public.upsert_kopis_venue(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, JSONB, JSONB),
    public.sync_concert_events(TEXT[], JSONB, BOOLEAN),
    public.last_train_events(DATE, TEXT)
TO service_role;
