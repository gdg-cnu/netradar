
import asyncio
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from data.mock_places import MOCK_PLACES
from data.mock_zones import MOCK_ZONES
from kakao_mobility import get_directions
from schemas.route import Coordinates, RoutePlan, RouteRequest


router = APIRouter(prefix="/routes", tags=["Routes"])


# 우회 허용 비율
DETOUR_RATIOS = {
    "little": 1.15,
    "normal": 1.30,
    "much": 1.50,
}

# 경유지 탐색 설정
MIN_DISTANCE_KM = 0.3
MAX_CANDIDATES = 4
MAX_CONCURRENT_REQUESTS = 4

# 시연용 비용 모델
COST_PER_KM = 150
TIME_COST_PER_MINUTE = 150
DEFAULT_HOURLY_RATE = 25000
WAIT_MINUTES = 5


def distance_km(lat1, lng1, lat2, lng2):
    """두 좌표 사이의 직선거리(km)."""

    earth_radius = 6371

    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)

    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1))
        * cos(radians(lat2))
        * sin(dlng / 2) ** 2
    )

    return 2 * earth_radius * asin(
        min(1.0, sqrt(max(0.0, a)))
    )


def get_hourly_rate(place_id):
    """
    지역별 예상 순시급 조회.

    현재는 AI 예측 결과가 아닌 목데이터를 사용한다.
    """

    zone = MOCK_ZONES.get(place_id)

    if not zone:
        return DEFAULT_HOURLY_RATE

    trend = zone.get("trend", [])

    if not trend:
        return DEFAULT_HOURLY_RATE

    current = next(
        (item for item in trend if item.get("minutes") == 0),
        trend[0],
    )

    return max(
        0,
        float(
            current.get(
                "netHourly",
                DEFAULT_HOURLY_RATE,
            )
        ),
    )


def calculate_expected_earnings(
    hourly_rate,
    extra_minutes,
    extra_kilometers,
):
    """
    시연용 추가 수익 추정.

    실제 예상 수익 = 대기 시간 동안의 추정 수익
                  - 추가 이동 거리 비용
                  - 추가 이동 시간 비용

    실제 운행 수익을 보장하는 값은 아니다.
    """

    estimated_revenue = (
        hourly_rate * WAIT_MINUTES / 60
    )

    distance_cost = (
        extra_kilometers * COST_PER_KM
    )

    time_cost = (
        extra_minutes * TIME_COST_PER_MINUTE
    )

    return round(
        estimated_revenue
        - distance_cost
        - time_cost
    )


def select_candidates(request):
    """
    직선거리 기반으로 불필요한 경유지 후보를 제거한다.

    실제 도로 경로의 최종 우회 시간은
    카카오모빌리티 API로 다시 검증한다.
    """

    direct_distance = distance_km(
        request.origin.lat,
        request.origin.lng,
        request.destination.lat,
        request.destination.lng,
    )

    candidates = []

    for place in MOCK_PLACES:

        if place["id"] == request.destination.id:
            continue

        if place["id"] in request.excludeStopIds:
            continue

        origin_to_stop = distance_km(
            request.origin.lat,
            request.origin.lng,
            place["lat"],
            place["lng"],
        )

        stop_to_destination = distance_km(
            place["lat"],
            place["lng"],
            request.destination.lat,
            request.destination.lng,
        )

        if origin_to_stop < MIN_DISTANCE_KM:
            continue

        if stop_to_destination < MIN_DISTANCE_KM:
            continue

        # 경유지를 포함한 직선거리의 추가 이동량
        detour_distance = max(
            0,
            origin_to_stop
            + stop_to_destination
            - direct_distance,
        )

        # 사전 필터링용 우회 거리 비율
        detour_ratio = (
            origin_to_stop + stop_to_destination
        ) / max(direct_distance, MIN_DISTANCE_KM)

        # 지나치게 멀리 떨어진 후보 제외
        # 직선거리 비율은 참고용이며 최종 판단은 도로 시간 기준
        max_precheck_ratio = (
            DETOUR_RATIOS[request.detour] + 0.5
        )

        if detour_ratio > max_precheck_ratio:
            continue

        hourly_rate = get_hourly_rate(place["id"])

        # 높은 시급과 적은 직선 우회를 우선 탐색
        preliminary_score = (
            hourly_rate * WAIT_MINUTES / 60
            - detour_distance * COST_PER_KM
        )

        candidates.append({
            "place": place,
            "hourly_rate": hourly_rate,
            "preliminary_score": preliminary_score,
            "detour_distance": detour_distance,
        })

    candidates.sort(
        key=lambda item: (
            -item["preliminary_score"],
            item["detour_distance"],
        )
    )

    return candidates[:MAX_CANDIDATES]


async def evaluate_candidate(
    request,
    candidate,
    direct,
    semaphore,
):
    """
    경유지 하나에 대해 실제 도로 경로를 조회하고
    우회 시간과 비용을 계산한다.
    """

    place = candidate["place"]

    stop = Coordinates(
        lat=place["lat"],
        lng=place["lng"],
    )

    async with semaphore:
        try:
            route = await get_directions(
                request.origin,
                request.destination,
                [stop],
            )
        except HTTPException:
            return None

    if len(route.get("coordinates", [])) < 2:
        return None

    max_minutes = (
        direct["minutes"]
        * DETOUR_RATIOS[request.detour]
    )

    # 최종 우회 시간 검증
    if route["minutes"] > max_minutes:
        return None

    extra_minutes = max(
        0,
        route["minutes"] - direct["minutes"],
    )

    extra_kilometers = max(
        0,
        route["kilometers"] - direct["kilometers"],
    )

    hourly_rate = candidate["hourly_rate"]

    expected_earnings = calculate_expected_earnings(
        hourly_rate,
        extra_minutes,
        extra_kilometers,
    )

    # 예상 추가 수익에서 우회 부담을 함께 반영
    # 아래 점수는 실제 통계 모델이 아닌 휴리스틱이다.
    score = (
        expected_earnings
        - extra_minutes * 10
        - extra_kilometers * 20
    )

    return {
        "place": place,
        "route": route,
        "hourly_rate": hourly_rate,
        "earnings": expected_earnings,
        "score": score,
        "extra_minutes": extra_minutes,
        "extra_kilometers": extra_kilometers,
    }


def create_plan(
    request,
    direct,
    recommended,
    stops,
    earnings,
):
    """
    프론트엔드 RoutePlan 타입과 호환되는 응답 생성.
    """

    return {
        "id": str(uuid4()),
        "generatedAt": int(
            datetime.now(timezone.utc).timestamp() * 1000
        ),
        # 실제 API 실행 모드.
        # 수익 데이터는 여전히 목데이터 기반이다.
        "demo": False,
        "origin": request.origin,
        "destination": request.destination,
        "detour": request.detour,
        "excludeStopIds": request.excludeStopIds,
        "direct": {
            "minutes": direct["minutes"],
            "kilometers": direct["kilometers"],
            "earnings": 0,
        },
        "recommended": {
            "minutes": recommended["minutes"],
            "kilometers": recommended["kilometers"],
            "earnings": earnings,
        },
        "stops": stops,
        "directPath": direct["coordinates"],
        "recommendedPath": recommended["coordinates"],
    }


@router.post(
    "/recommendations",
    response_model=RoutePlan,
)
async def recommend_route(request: RouteRequest):
    """
    실제 도로 기반 경유지 추천.

    1. 기본 경로 조회
    2. 후보 경유지 사전 필터링
    3. 후보 경로 병렬 조회
    4. 우회 시간 제한 검사
    5. 추가 수익과 우회 부담을 고려해 추천
    """

    # 1. 기본 경로
    direct = await get_directions(
        request.origin,
        request.destination,
    )

    if len(direct.get("coordinates", [])) < 2:
        raise HTTPException(
            status_code=502,
            detail="기본 경로 좌표를 받지 못했습니다.",
        )

    # 2. 후보 필터링
    candidates = select_candidates(request)

    if not candidates:
        return create_plan(
            request,
            direct,
            direct,
            [],
            0,
        )

    # 3. 실제 도로 경로 병렬 조회
    semaphore = asyncio.Semaphore(
        MAX_CONCURRENT_REQUESTS
    )

    results = await asyncio.gather(
        *[
            evaluate_candidate(
                request,
                candidate,
                direct,
                semaphore,
            )
            for candidate in candidates
        ],
        return_exceptions=True,
    )

    # 4. 성공한 후보만 추출
    valid_routes = []

    for result in results:
        if isinstance(result, BaseException):
            continue

        if result is None:
            continue

        if result["earnings"] <= 0:
            continue

        valid_routes.append(result)

    # 추천 경유지가 없으면 직접 경로 반환
    if not valid_routes:
        return create_plan(
            request,
            direct,
            direct,
            [],
            0,
        )

    # 5. 최종 추천 점수 기준 정렬
    valid_routes.sort(
        key=lambda item: (
            -item["score"],
            -item["earnings"],
            item["route"]["minutes"],
            item["route"]["kilometers"],
        )
    )

    best = valid_routes[0]

    selected = best["place"]

    stops = [
        {
            **selected,
            "waitMinutes": WAIT_MINUTES,
            "expectedHourlyRate": best["hourly_rate"],
        }
    ]

    return create_plan(
        request=request,
        direct=direct,
        recommended=best["route"],
        stops=stops,
        earnings=max(0, best["earnings"]),
    )
