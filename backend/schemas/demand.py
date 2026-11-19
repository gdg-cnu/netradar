from typing import Literal

from pydantic import BaseModel


DemandRange = Literal["low", "moderate", "high"]
PlaceType = Literal["seoul_rtd", "airport", "venue"]
EventType = Literal["airport", "concert", "last_train"]
Source = Literal["mock", "model"]


class DemandPoint(BaseModel):
    offset: Literal[0, 30, 60]
    surgeIndex: int
    # 실시간 인구가 없는 장소(인천공항, 공연장 등)는 null
    population: int | None
    range: DemandRange
    populationRange: DemandRange | None


class HeatmapPlace(BaseModel):
    id: str
    name: str
    type: PlaceType
    lat: float
    lng: float
    # GeoJSON 규약 [경도, 위도], 닫힌 링
    polygon: list[tuple[float, float]]
    points: list[DemandPoint]


class HeatmapResponse(BaseModel):
    generatedAt: str
    source: Source
    metric: Literal["surge", "population"]
    offset: Literal[0, 30, 60]
    places: list[HeatmapPlace]


class TaxiStand(BaseModel):
    name: str
    description: str


class DemandEvent(BaseModel):
    id: str
    placeId: str
    type: EventType
    title: str
    peakAt: str
    endsAt: str
    expectedExits: int | None
    source: str


class PlaceDetail(HeatmapPlace):
    generatedAt: str
    source: Source
    reasons: list[str]
    taxiStands: list[TaxiStand]
    events: list[DemandEvent]


class EventsResponse(BaseModel):
    generatedAt: str
    source: Source
    events: list[DemandEvent]


class DemandAlert(BaseModel):
    id: str
    placeId: str
    reason: str
    travelMinutes: int
    recommendedDepartureAt: str
    arrivalAt: str
    peakStart: str
    peakEnd: str
    surgeIndexAtArrival: int


class AlertsResponse(BaseModel):
    generatedAt: str
    source: Source
    alerts: list[DemandAlert]


class AppConfig(BaseModel):
    detourRatios: dict[Literal["little", "normal", "much"], int]
    offsets: list[int]
    maxStops: int
