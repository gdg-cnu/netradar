from datetime import datetime
from enum import IntEnum
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from schemas.demand import (
    AlertsResponse,
    AppConfig,
    EventsResponse,
    HeatmapResponse,
)
from services import demand
from services.clock import get_now


router = APIRouter(tags=["Demand"])


class Offset(IntEnum):
    NOW = 0
    AFTER_30_MIN = 30
    AFTER_60_MIN = 60


# 우회 허용 비율(%). 팀 결정 전까지 현재 코드(routes.py)와 같은 값
DETOUR_RATIOS = {"little": 15, "normal": 30, "much": 50}
MAX_STOPS = 3


def bbox_query(
    bbox: str | None = Query(
        default=None,
        description="west,south,east,north",
    ),
):
    try:
        return demand.parse_bbox(bbox)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def require_timezone(value: datetime | None, name: str) -> datetime | None:
    if value is not None and value.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail=f"{name}에는 타임존이 포함되어야 합니다.",
        )
    return value


# 수요 지도
@router.get("/heatmap", response_model=HeatmapResponse)
def get_heatmap(
    metric: Literal["surge", "population"] = "surge",
    offset: Offset = Offset.NOW,
    bbox=Depends(bbox_query),
    now: datetime = Depends(get_now),
):
    return demand.get_heatmap(now, metric, offset.value, bbox)


# 이벤트 타임라인
@router.get("/events", response_model=EventsResponse)
def get_events(
    start: datetime | None = Query(default=None, alias="from"),
    end: datetime | None = Query(default=None, alias="to"),
    type: Literal["airport", "concert", "last_train"] | None = None,
    bbox=Depends(bbox_query),
    now: datetime = Depends(get_now),
):
    start = require_timezone(start, "from")
    end = require_timezone(end, "to")

    if start and end and start >= end:
        raise HTTPException(
            status_code=422,
            detail="from은 to보다 이전이어야 합니다.",
        )

    return demand.get_events(now, start, end, bbox, type)


# 급증 알림
@router.get("/alerts/top", response_model=AlertsResponse)
def get_top_alerts(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    now: datetime = Depends(get_now),
):
    return demand.get_top_alerts(now, lat, lng)


# 프론트 설정값
@router.get("/config", response_model=AppConfig)
def get_config():
    return {
        "detourRatios": DETOUR_RATIOS,
        "offsets": [offset.value for offset in Offset],
        "maxStops": MAX_STOPS,
    }
