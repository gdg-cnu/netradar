from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


# 1. 서버 상태 확인
def test_health():
    response = client.get("/health")

    assert response.status_code == 200


# 2. 지역별 예상 시급 목록 조회
def test_forecast_zones():
    response = client.get(
        "/api/v1/forecast/zones",
        params={
            "metric": "hourly",
            "horizon": 0,
            "resolution": 8,
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert len(data["zones"]) == 2
    assert data["zones"][0]["id"] == "gangnam"


# 3. 30분 후 예상 시급 정렬 확인
def test_forecast_zones_after_30_minutes():
    response = client.get(
        "/api/v1/forecast/zones",
        params={
            "metric": "hourly",
            "horizon": 30,
            "resolution": 8,
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["zones"][0]["id"] == "gyodae"


# 4. 특정 지역 상세 조회
def test_forecast_zone_detail():
    response = client.get(
        "/api/v1/forecast/zones/gangnam"
    )

    assert response.status_code == 200

    data = response.json()

    assert data["name"] == "강남역"
    assert data["expectedHourlyProfit"] == 32000


# 5. 존재하지 않는 지역 조회
def test_forecast_zone_not_found():
    response = client.get(
        "/api/v1/forecast/zones/abc"
    )

    assert response.status_code == 404


# 6. 잘못된 예측 시간 입력
def test_invalid_horizon():
    response = client.get(
        "/api/v1/forecast/zones",
        params={"horizon": 15},
    )

    assert response.status_code == 422