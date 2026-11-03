
from typing import Literal

from pydantic import BaseModel, Field


class Coordinates(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Place(Coordinates):
    id: str
    name: str
    address: str


class RouteMetrics(BaseModel):
    minutes: float
    kilometers: float
    earnings: float


class RouteStop(Place):
    waitMinutes: float
    expectedHourlyRate: float


class RouteRequest(BaseModel):
    origin: Coordinates
    destination: Place
    detour: Literal["little", "normal", "much"]
    excludeStopIds: list[str] = Field(default_factory=list)


class RoutePlan(RouteRequest):
    id: str
    generatedAt: int
    demo: bool
    direct: RouteMetrics
    recommended: RouteMetrics
    stops: list[RouteStop]

    # 지도 경로선 좌표: [위도, 경도]
    directPath: list[tuple[float, float]] = Field(
        default_factory=list
    )
    recommendedPath: list[tuple[float, float]] = Field(
        default_factory=list
    )
