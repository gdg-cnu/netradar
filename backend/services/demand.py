from datetime import datetime, timedelta

from data.mock_demand import MOCK_DEMAND_PLACES
from data.mock_events import build_mock_events
from services import prediction
from services.clock import KST, to_iso


# 표시 구간 경계 (목업 기준, 확정된 급증 판정 기준 아님)
SURGE_HIGH = 70
SURGE_MODERATE = 40
POPULATION_HIGH = 30000
POPULATION_MODERATE = 15000

# 급증 알림 기준
ALERT_WINDOW_MINUTES = 60
ALERT_MAX_TRAVEL_MINUTES = 60
ALERT_LIMIT = 3


def surge_range(value: int) -> str:
    if value >= SURGE_HIGH:
        return "high"
    if value >= SURGE_MODERATE:
        return "moderate"
    return "low"


def population_range(value: int | None) -> str | None:
    if value is None:
        return None
    if value >= POPULATION_HIGH:
        return "high"
    if value >= POPULATION_MODERATE:
        return "moderate"
    return "low"


def offset_for_minutes(minutes: float) -> int:
    """도착까지 걸리는 시간에 해당하는 예보 시점."""
    if minutes <= 15:
        return 0
    if minutes <= 45:
        return 30
    return 60


def parse_bbox(value: str | None) -> tuple[float, float, float, float] | None:
    """'west,south,east,north' 문자열을 숫자로 변환. 형식이 틀리면 ValueError."""
    if value is None:
        return None
    parts = [float(part) for part in value.split(",")]
    if len(parts) != 4:
        raise ValueError("bbox는 west,south,east,north 형식이어야 합니다.")
    west, south, east, north = parts
    if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
        raise ValueError("bbox 범위가 올바르지 않습니다.")
    return west, south, east, north


def in_bbox(place: dict, bbox) -> bool:
    if bbox is None:
        return True
    west, south, east, north = bbox
    return west <= place["lng"] <= east and south <= place["lat"] <= north


def build_places(now: datetime) -> list[dict]:
    """예측 결과를 장소별 points로 묶는다."""
    predictions = prediction.predict(now)
    places = []

    for place in MOCK_DEMAND_PLACES.values():
        points = [
            {
                "offset": item["offset"],
                "surgeIndex": item["surgeIndex"],
                "population": item["population"],
                "range": surge_range(item["surgeIndex"]),
                "populationRange": population_range(item["population"]),
            }
            for item in predictions
            if item["placeId"] == place["id"]
        ]
        points.sort(key=lambda point: point["offset"])

        places.append({
            "id": place["id"],
            "name": place["name"],
            "type": place["type"],
            "lat": place["lat"],
            "lng": place["lng"],
            "polygon": place["polygon"],
            "points": points,
        })

    return places


def point_at(place: dict, offset: int) -> dict:
    return next(point for point in place["points"] if point["offset"] == offset)


def get_heatmap(now: datetime, metric: str, offset: int, bbox) -> dict:
    places = [place for place in build_places(now) if in_bbox(place, bbox)]

    def sort_key(place: dict):
        point = point_at(place, offset)
        if metric == "surge":
            return (0, -point["surgeIndex"], place["id"])
        # 인구가 없는 장소는 뒤로
        population = point["population"]
        if population is None:
            return (1, 0, place["id"])
        return (0, -population, place["id"])

    places.sort(key=sort_key)

    return {
        "generatedAt": to_iso(now),
        "source": prediction.SOURCE,
        "metric": metric,
        "offset": offset,
        "places": places,
    }


def serialize_event(event: dict) -> dict:
    return {
        **event,
        "peakAt": to_iso(event["peakAt"]),
        "endsAt": to_iso(event["endsAt"]),
    }


def default_event_window(now: datetime) -> tuple[datetime, datetime]:
    """기본값: 지금 ~ 한국 시간 오늘 자정."""
    local = now.astimezone(KST)
    midnight = datetime(
        local.year, local.month, local.day, tzinfo=KST
    ) + timedelta(days=1)
    return local, midnight


def list_events(
    now: datetime,
    start: datetime | None = None,
    end: datetime | None = None,
    bbox=None,
    event_type: str | None = None,
    place_id: str | None = None,
) -> list[dict]:
    default_start, default_end = default_event_window(now)
    start = start or default_start
    end = end or default_end

    events = []
    for event in build_mock_events(now):
        place = MOCK_DEMAND_PLACES.get(event["placeId"])
        if place is None:
            continue
        if event_type and event["type"] != event_type:
            continue
        if place_id and event["placeId"] != place_id:
            continue
        if not in_bbox(place, bbox):
            continue
        # 기간과 겹치는 이벤트: 아직 끝나지 않았고, 기간 안에 피크가 시작
        if event["endsAt"] < start or event["peakAt"] >= end:
            continue
        events.append(event)

    events.sort(key=lambda event: (event["peakAt"], event["id"]))
    return events


def get_events(now, start=None, end=None, bbox=None, event_type=None) -> dict:
    return {
        "generatedAt": to_iso(now),
        "source": prediction.SOURCE,
        "events": [
            serialize_event(event)
            for event in list_events(now, start, end, bbox, event_type)
        ],
    }


def get_place_detail(now: datetime, place_id: str) -> dict | None:
    source = MOCK_DEMAND_PLACES.get(place_id)
    if source is None:
        return None

    place = next(item for item in build_places(now) if item["id"] == place_id)

    return {
        **place,
        "generatedAt": to_iso(now),
        "source": prediction.SOURCE,
        "reasons": source["reasons"],
        "taxiStands": source["taxiStands"],
        "events": [
            serialize_event(event)
            for event in list_events(now, place_id=place_id)
        ],
    }


def get_top_alerts(now: datetime, lat: float, lng: float) -> dict:
    """
    급증 알림 상위 3건.

    1. 오늘 남은 이벤트 중 피크 시작이 지금부터 60분 이내
    2. 이동시간 60분 이하, 도착 시각이 이벤트 종료 전
    3. 도착 시점 수요 지수 내림차순, 같으면 이동시간 오름차순
    """
    places = {place["id"]: place for place in build_places(now)}
    origin = {"lat": lat, "lng": lng}
    limit = now + timedelta(minutes=ALERT_WINDOW_MINUTES)

    alerts = []
    for event in list_events(now):
        if event["peakAt"] > limit:
            continue

        minutes = prediction.travel_minutes(origin, event["placeId"], now)
        arrival = now + timedelta(minutes=minutes)

        if minutes > ALERT_MAX_TRAVEL_MINUTES or arrival > event["endsAt"]:
            continue

        place = places[event["placeId"]]
        departure = max(now, event["peakAt"] - timedelta(minutes=minutes))

        alerts.append({
            "id": f"alert-{event['id']}",
            "placeId": event["placeId"],
            "reason": event["title"],
            "travelMinutes": minutes,
            "recommendedDepartureAt": to_iso(departure),
            "arrivalAt": to_iso(arrival),
            "peakStart": to_iso(event["peakAt"]),
            "peakEnd": to_iso(event["endsAt"]),
            "surgeIndexAtArrival": point_at(
                place, offset_for_minutes(minutes)
            )["surgeIndex"],
        })

    alerts.sort(
        key=lambda alert: (
            -alert["surgeIndexAtArrival"],
            alert["travelMinutes"],
            alert["id"],
        )
    )

    return {
        "generatedAt": to_iso(now),
        "source": prediction.SOURCE,
        "alerts": alerts[:ALERT_LIMIT],
    }
