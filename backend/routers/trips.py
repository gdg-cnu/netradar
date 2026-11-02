from datetime import datetime, timezone
from threading import Lock
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from schemas.route import Place


router = APIRouter(tags=["Trips"])

# 임시 메모리 저장소 (서버 재시작 시 초기화)
TRIPS: dict[str, dict[str, Any]] = {}
IDEMPOTENCY: dict[str, dict[str, Any]] = {}
LOCK = Lock()


class TripCreate(BaseModel):
    routeId: str
    destination: Place
    detour: Literal["little", "normal", "much"]


class TripCreated(BaseModel):
    id: str


class TripEvent(BaseModel):
    eventId: str
    type: Literal[
        "ARRIVE",
        "PICK_UP",
        "DROP_OFF",
        "SKIP",
        "EXTEND_WAIT",
        "RECOMMEND",
        "FINISH",
    ]
    occurredAt: int
    payload: dict[str, Any] = Field(default_factory=dict)


class DriveTotals(BaseModel):
    revenue: float
    cost: float
    extraProfit: float


class TripEventResponse(BaseModel):
    accepted: bool
    totals: DriveTotals | None = None


class TripRecord(BaseModel):
    id: str
    date: str
    startedAt: int
    endedAt: int
    destination: str
    stops: int
    passengers: int
    revenue: float
    cost: float
    extraProfit: float
    demo: bool = True


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def get_totals(trip: dict[str, Any]) -> dict[str, float]:
    return {
        "revenue": trip["revenue"],
        "cost": trip["cost"],
        "extraProfit": trip["extraProfit"],
    }


# 운행 시작
@router.post("/trips", response_model=TripCreated)
def create_trip(
    request: TripCreate,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    with LOCK:
        key = f"create:{idempotency_key}"

        if key in IDEMPOTENCY:
            cached = IDEMPOTENCY[key]

            if cached["request"] != request.model_dump():
                raise HTTPException(
                    status_code=409,
                    detail="같은 멱등성 키로 다른 요청을 보낼 수 없습니다.",
                )

            return cached["response"]

        trip_id = str(uuid4())

        TRIPS[trip_id] = {
            "id": trip_id,
            "routeId": request.routeId,
            "destination": request.destination.name,
            "detour": request.detour,
            "startedAt": now_ms(),
            "endedAt": None,
            "stops": 0,
            "passengers": 0,
            "revenue": 0.0,
            "cost": 0.0,
            "extraProfit": 0.0,
            "finished": False,
            "events": {},
        }

        result = {"id": trip_id}

        IDEMPOTENCY[key] = {
            "request": request.model_dump(),
            "response": result,
        }

        return result


# 운행 이벤트 기록
@router.post(
    "/trips/{trip_id}/events",
    response_model=TripEventResponse,
    response_model_exclude_none=True,
)
def create_trip_event(
    trip_id: str,
    event: TripEvent,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    with LOCK:
        if trip_id not in TRIPS:
            raise HTTPException(
                status_code=404,
                detail="운행 기록을 찾을 수 없습니다.",
            )

        trip = TRIPS[trip_id]
        key = f"event:{trip_id}:{idempotency_key}"

        if key in IDEMPOTENCY:
            cached = IDEMPOTENCY[key]

            if cached["request"] != event.model_dump():
                raise HTTPException(
                    status_code=409,
                    detail="같은 멱등성 키로 다른 이벤트를 보낼 수 없습니다.",
                )

            return cached["response"]

        if event.eventId in trip["events"]:
            previous = trip["events"][event.eventId]

            if previous["request"] != event.model_dump():
                raise HTTPException(
                    status_code=409,
                    detail="같은 이벤트 ID로 다른 내용을 보낼 수 없습니다.",
                )

            return previous["response"]

        if trip["finished"]:
            raise HTTPException(
                status_code=409,
                detail="이미 종료된 운행입니다.",
            )

        if event.type == "ARRIVE":
            trip["stops"] += 1

        elif event.type == "PICK_UP":
            trip["passengers"] += 1

        elif event.type == "DROP_OFF":
            fare = event.payload.get("fare", 0)

            if (
                not isinstance(fare, (int, float))
                or isinstance(fare, bool)
                or not 0 <= fare < float("inf")
            ):
                raise HTTPException(
                    status_code=422,
                    detail="요금은 0 이상의 유한한 숫자여야 합니다.",
                )

            trip["revenue"] += fare
            trip["extraProfit"] = trip["revenue"] - trip["cost"]

        elif event.type == "FINISH":
            trip["finished"] = True
            trip["endedAt"] = now_ms()

        result = {"accepted": True}

        if event.type in ("DROP_OFF", "FINISH"):
            result["totals"] = get_totals(trip)

        saved = {
            "request": event.model_dump(),
            "response": result,
        }

        trip["events"][event.eventId] = saved
        IDEMPOTENCY[key] = saved

        return result


# 월별 운행 기록 조회
@router.get("/me/trips", response_model=list[TripRecord])
def get_my_trips(month: str):

    try:
        selected_month = datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="month는 YYYY-MM 형식이어야 합니다.",
        )

    results = []

    with LOCK:
        for trip in TRIPS.values():
            if not trip["finished"]:
                continue

            started = datetime.fromtimestamp(
                trip["startedAt"] / 1000,
                tz=timezone.utc,
            )

            if (
                started.year != selected_month.year
                or started.month != selected_month.month
            ):
                continue

            results.append({
                "id": trip["id"],
                "date": started.strftime("%Y-%m-%d"),
                "startedAt": trip["startedAt"],
                "endedAt": trip["endedAt"],
                "destination": trip["destination"],
                "stops": trip["stops"],
                "passengers": trip["passengers"],
                "revenue": trip["revenue"],
                "cost": trip["cost"],
                "extraProfit": trip["extraProfit"],
                "demo": True,
            })

    return results