from schemas.forecast import ForecastResponse
from datetime import datetime, timezone
from enum import IntEnum
from typing import Literal

from fastapi import APIRouter


class Horizon(IntEnum):
    NOW = 0
    AFTER_30_MIN = 30
    AFTER_60_MIN = 60


class Resolution(IntEnum):
    H3_LEVEL_8 = 8


router = APIRouter(prefix="/forecast", tags=["Forecast"])


@router.get("/zones", response_model=ForecastResponse)
def get_forecast_zones(
    metric: Literal["hourly", "passengers"] = "hourly",
    horizon: Horizon = Horizon.NOW,
    resolution: Resolution = Resolution.H3_LEVEL_8,
):
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "metric": metric,
        "horizon": horizon.value,
        "zones": [],
    }
