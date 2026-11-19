"""
AI 모듈 인터페이스의 목업 구현.

AI 모듈이 완성되면 같은 시그니처의 실제 구현(surge_predictions 조회,
표준노드링크 기반 이동시간)으로 교체한다. 현재 값은 모두 예시다.
"""

from datetime import datetime
from math import asin, cos, radians, sin, sqrt

from data.mock_demand import MOCK_DEMAND_PLACES


SOURCE = "mock"
OFFSETS = (0, 30, 60)


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """두 좌표 사이의 직선거리(km)."""
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    )
    return 2 * 6371 * asin(min(1.0, sqrt(max(0.0, a))))


def predict(base_time: datetime, offsets=OFFSETS) -> list[dict]:
    """[{placeId, offset, surgeIndex, population}] (목업: 고정값)."""
    return [
        {
            "placeId": place["id"],
            "offset": offset,
            "surgeIndex": place["surge"][offset],
            "population": (
                place["population"][offset]
                if place["population"] is not None
                else None
            ),
        }
        for place in MOCK_DEMAND_PLACES.values()
        for offset in offsets
    ]


def travel_minutes(origin: dict, place_id: str, base_time: datetime) -> int:
    """
    출발지 → 장소 이동시간(분).

    목업: 직선거리 × 2.5 + 5분 (프론트 목업과 같은 식).
    실제 도로 경로가 아니다.
    """
    place = MOCK_DEMAND_PLACES[place_id]
    km = distance_km(origin["lat"], origin["lng"], place["lat"], place["lng"])
    return max(5, round(km * 2.5 + 5))
