from datetime import datetime, timezone
from enum import IntEnum
from typing import Literal

from fastapi import APIRouter, HTTPException

from data.mock_zones import MOCK_ZONES
from schemas.forecast import ForecastResponse, ForecastZone


class Horizon(IntEnum):
    NOW = 0
    AFTER_30_MIN = 30
    AFTER_60_MIN = 60


class Resolution(IntEnum):
    H3_LEVEL_8 = 8


router = APIRouter(prefix="/forecast", tags=["Forecast"])


# 선택한 시간대의 예측값 가져오기
def get_prediction_at_horizon(zone: dict, horizon: int):

    for prediction in zone["trend"]:
        if prediction["minutes"] == horizon:
            return prediction

    raise ValueError("해당 시간대의 예측 데이터가 없습니다.")


# 지역별 예상 시급 목록 조회 API
@router.get("/zones", response_model=ForecastResponse)
def get_forecast_zones(
    metric: Literal["hourly", "passengers"] = "hourly",
    horizon: Horizon = Horizon.NOW,
    resolution: Resolution = Resolution.H3_LEVEL_8,
):

    zones = list(MOCK_ZONES.values())

    # 정렬 기준 설정
    if metric == "hourly":
        sort_key = "netHourly"
    else:
        sort_key = "passengers"

    # 선택한 시간대의 예측값을 기준으로 내림차순 정렬
    zones.sort(
        key=lambda zone: get_prediction_at_horizon(
            zone, horizon.value
        )[sort_key],
        reverse=True,
    )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "metric": metric,
        "horizon": horizon.value,
        "zones": [
            ForecastZone.model_validate(zone)
            for zone in zones
        ],
    }


# 특정 지역 상세 조회 API
@router.get("/zones/{zone_id}")
def get_forecast_zone_detail(zone_id: str):

    if zone_id not in MOCK_ZONES:
        raise HTTPException(
            status_code=404,
            detail="해당 지역을 찾을 수 없습니다.",
        )

    zone = MOCK_ZONES[zone_id]

    return {
        **zone,
        "zoneId": zone_id,
        "expectedHourlyProfit": zone["trend"][0]["netHourly"],
    }