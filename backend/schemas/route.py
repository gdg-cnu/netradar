from typing import Literal

from pydantic import BaseModel, Field


class Coordinates(BaseModel):
    lat: float
    lng: float


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