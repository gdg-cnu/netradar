
-- ============================================
-- NetRadar Database Schema
-- profiles / trips / trip_events
-- ============================================

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
