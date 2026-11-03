
from typing import Literal

from pydantic import BaseModel


class ForecastPoint(BaseModel):
    minutes: Literal[0, 30, 60]
    grossRevenue: float
    fuelCost: float
    idleCost: float
    netHourly: float
    passengers: int


class ForecastZone(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    h3Index: str
    reason: str
    trend: list[ForecastPoint]


class ForecastResponse(BaseModel):
    generatedAt: str
    metric: Literal["hourly", "passengers"]
    horizon: Literal[0, 30, 60]
    zones: list[ForecastZone]
