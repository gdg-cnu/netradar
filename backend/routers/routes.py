from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter

from data.mock_places import MOCK_PLACES
from schemas.route import RoutePlan, RouteRequest


router = APIRouter(prefix="/routes", tags=["Routes"])


@router.post("/recommendations", response_model=RoutePlan)
def recommend_route(request: RouteRequest):

    # 실제 경로 탐색이 아닌 테스트용 추천 경유지
    candidates = [
        place
        for place in MOCK_PLACES
        if place["id"] != request.destination.id
        and place["id"] not in request.excludeStopIds
    ]

    # 허용 우회 정도에 따른 경유지 수
    stop_limits = {
        "little": 1,
        "normal": 2,
        "much": 3,
    }

    selected = candidates[:stop_limits[request.detour]]

    stops = [
        {
            **place,
            "waitMinutes": 5,
            "expectedHourlyRate": 25000,
        }
        for place in selected
    ]

    # 시연용 임의 수치
    return {
        "origin": request.origin,
        "destination": request.destination,
        "detour": request.detour,
        "excludeStopIds": request.excludeStopIds,
        "id": str(uuid4()),
        "generatedAt": int(
            datetime.now(timezone.utc).timestamp() * 1000
        ),
        "demo": True,
        "direct": {
            "minutes": 25,
            "kilometers": 10,
            "earnings": 0,
        },
        "recommended": {
            "minutes": 35,
            "kilometers": 13,
            "earnings": 12000,
        },
        "stops": stops,
    }