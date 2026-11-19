from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from main import app
from services.clock import KST, get_now


# 2026-11-19 22:00 한국 시간으로 고정
FIXED_NOW = datetime(2026, 11, 19, 22, 0, tzinfo=KST)

GANGNAM = {"lat": 37.4979, "lng": 127.0276}
HONGDAE = {"lat": 37.5572, "lng": 126.9245}
SEOUL_BBOX = "126.76,37.41,127.19,37.72"


@pytest.fixture
def client():
    app.dependency_overrides[get_now] = lambda: FIXED_NOW
    yield TestClient(app)
    app.dependency_overrides.clear()


def ids(items):
    return [item["id"] for item in items]


# --- /heatmap ---


def test_heatmap_sorts_by_surge_at_offset(client):
    response = client.get("/api/v1/heatmap", params={"offset": 60})

    assert response.status_code == 200
    data = response.json()

    assert data["metric"] == "surge"
    assert data["offset"] == 60
    assert data["source"] == "mock"
    assert ids(data["places"]) == [
        "kspo-dome", "hongdae", "gangnam", "incheon-t1", "jamsil",
    ]


def test_heatmap_population_puts_null_last(client):
    response = client.get(
        "/api/v1/heatmap",
        params={"metric": "population", "offset": 0},
    )

    assert response.status_code == 200
    places = response.json()["places"]

    assert ids(places) == [
        "gangnam", "jamsil", "hongdae", "incheon-t1", "kspo-dome",
    ]

    airport = places[3]
    assert all(point["population"] is None for point in airport["points"])
    assert all(point["populationRange"] is None for point in airport["points"])


def test_heatmap_points_cover_all_offsets(client):
    place = client.get("/api/v1/heatmap").json()["places"][0]

    assert [point["offset"] for point in place["points"]] == [0, 30, 60]
    assert {point["range"] for point in place["points"]} <= {
        "low", "moderate", "high",
    }


def test_heatmap_polygon_is_closed_lng_lat(client):
    for place in client.get("/api/v1/heatmap").json()["places"]:
        polygon = place["polygon"]

        assert polygon[0] == polygon[-1]
        assert len(polygon) >= 4

        # [경도, 위도] 순서
        for lng, lat in polygon:
            assert 124 < lng < 132
            assert 33 < lat < 39


def test_heatmap_generated_at_has_timezone(client):
    generated_at = client.get("/api/v1/heatmap").json()["generatedAt"]

    assert generated_at == "2026-11-19T22:00:00+09:00"


def test_heatmap_bbox_filter(client):
    response = client.get("/api/v1/heatmap", params={"bbox": SEOUL_BBOX})

    assert response.status_code == 200
    assert "incheon-t1" not in ids(response.json()["places"])


@pytest.mark.parametrize(
    "params",
    [
        {"offset": 15},
        {"metric": "hourly"},
        {"bbox": "1,2,3"},
        {"bbox": "a,b,c,d"},
        {"bbox": "127,37,126,38"},
    ],
)
def test_heatmap_rejects_invalid_params(client, params):
    response = client.get("/api/v1/heatmap", params=params)

    assert response.status_code == 422


# --- /places/{id} ---


def test_place_detail(client):
    response = client.get("/api/v1/places/hongdae")

    assert response.status_code == 200
    data = response.json()

    assert data["id"] == "hongdae"
    assert data["generatedAt"] == "2026-11-19T22:00:00+09:00"
    assert data["reasons"]
    assert data["taxiStands"]
    assert [event["type"] for event in data["events"]] == ["last_train"]


def test_place_detail_not_found(client):
    response = client.get("/api/v1/places/unknown")

    assert response.status_code == 404


def test_place_search_is_not_treated_as_place_id(client):
    response = client.get("/api/v1/places/search", params={"q": "강남"})

    assert response.status_code == 200
    assert isinstance(response.json(), list)


# --- /events ---


def test_events_default_is_today_remaining(client):
    response = client.get("/api/v1/events")

    assert response.status_code == 200
    events = response.json()["events"]

    assert [event["placeId"] for event in events] == [
        "incheon-t1", "kspo-dome", "hongdae", "jamsil", "gangnam",
    ]
    assert events[0]["peakAt"] == "2026-11-19T22:30:00+09:00"
    assert events[0]["endsAt"] == "2026-11-19T23:30:00+09:00"


def test_events_type_filter(client):
    response = client.get("/api/v1/events", params={"type": "last_train"})

    events = response.json()["events"]

    assert len(events) == 3
    assert {event["type"] for event in events} == {"last_train"}
    assert all(event["expectedExits"] is None for event in events)


def test_events_from_to_window(client):
    response = client.get(
        "/api/v1/events",
        params={
            "from": "2026-11-19T23:00:00+09:00",
            "to": "2026-11-19T23:38:00+09:00",
        },
    )

    # 23:00 이후에도 진행 중인 공항(~23:30)·공연(~23:15)과 23:35 막차
    assert [event["placeId"] for event in response.json()["events"]] == [
        "incheon-t1", "kspo-dome", "hongdae",
    ]


@pytest.mark.parametrize(
    "params",
    [
        {"type": "train"},
        {"from": "2026-11-19T23:00:00"},
        {
            "from": "2026-11-19T23:00:00+09:00",
            "to": "2026-11-19T22:00:00+09:00",
        },
    ],
)
def test_events_rejects_invalid_params(client, params):
    response = client.get("/api/v1/events", params=params)

    assert response.status_code == 422


# --- /alerts/top ---


def test_alerts_within_60_minutes(client):
    response = client.get("/api/v1/alerts/top", params=GANGNAM)

    assert response.status_code == 200
    alerts = response.json()["alerts"]

    # 공항은 이동시간 60분 초과, 막차는 피크가 60분 뒤라 제외
    assert [alert["placeId"] for alert in alerts] == ["kspo-dome"]

    alert = alerts[0]
    assert alert["travelMinutes"] <= 45
    assert alert["surgeIndexAtArrival"] == 63
    assert alert["peakStart"] == "2026-11-19T22:45:00+09:00"
    assert alert["recommendedDepartureAt"] >= "2026-11-19T22:00:00+09:00"


def test_alerts_use_arrival_offset(client):
    alerts = client.get("/api/v1/alerts/top", params=HONGDAE).json()["alerts"]

    concert = next(alert for alert in alerts if alert["placeId"] == "kspo-dome")

    # 이동시간 45분 초과 → offset 60 지수
    assert concert["travelMinutes"] > 45
    assert concert["surgeIndexAtArrival"] == 95


def test_alerts_limit_and_sort(client):
    alerts = client.get("/api/v1/alerts/top", params=GANGNAM).json()["alerts"]

    assert len(alerts) <= 3
    assert alerts == sorted(
        alerts,
        key=lambda alert: (-alert["surgeIndexAtArrival"], alert["travelMinutes"]),
    )


def test_alerts_require_location(client):
    assert client.get("/api/v1/alerts/top").status_code == 422
    assert (
        client.get("/api/v1/alerts/top", params={"lat": 100, "lng": 127})
        .status_code
        == 422
    )


# --- /config ---


def test_config(client):
    response = client.get("/api/v1/config")

    assert response.status_code == 200
    assert response.json() == {
        "detourRatios": {"little": 15, "normal": 30, "much": 50},
        "offsets": [0, 30, 60],
        "maxStops": 3,
    }


# --- 인증 ---


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/heatmap",
        "/api/v1/places/hongdae",
        "/api/v1/events",
        "/api/v1/alerts/top?lat=37.4979&lng=127.0276",
        "/api/v1/config",
    ],
)
def test_public_apis_need_no_token(client, path):
    assert client.get(path).status_code == 200
