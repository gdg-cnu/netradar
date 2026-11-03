
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from db.auth import get_current_user
from db.client import get_supabase_admin
from schemas.route import Place


router = APIRouter(tags=["Trips"])


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
    demo: bool = False


def parse_timestamp(value: str) -> int:
    """Supabase ISO 날짜를 밀리초 타임스탬프로 변환."""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return int(dt.timestamp() * 1000)


def require_uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=404,
            detail="운행 기록을 찾을 수 없습니다.",
        )


def get_existing_trip(user_id: str, key: str):
    """동일 사용자의 기존 운행 생성 요청 조회."""
    try:
        result = (
            get_supabase_admin()
            .table("trips")
            .select("id,request_payload")
            .eq("user_id", user_id)
            .eq("create_key", key)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="기존 운행 요청을 확인하지 못했습니다.",
        ) from exc

    return result.data[0] if result.data else None


@router.post("/trips", response_model=TripCreated)
def create_trip(
    request: TripCreate,
    idempotency_key: str = Header(
        min_length=1,
        alias="Idempotency-Key",
    ),
    user_id: str = Depends(get_current_user),
):
    """인증된 사용자의 운행을 DB에 생성한다."""
    request_data = request.model_dump(mode="json")

    previous = get_existing_trip(user_id, idempotency_key)

    if previous is not None:
        if previous["request_payload"] != request_data:
            raise HTTPException(
                status_code=409,
                detail="같은 멱등성 키로 다른 요청을 보낼 수 없습니다.",
            )
        return {"id": previous["id"]}

    trip_id = str(uuid4())

    payload = {
        "id": trip_id,
        "user_id": user_id,
        "create_key": idempotency_key,
        "request_payload": request_data,
        "route_id": request.routeId,
        "destination": request.destination.name,
        "detour": request.detour,
        "stops": 0,
        "passengers": 0,
        "revenue": 0,
        "cost": 0,
        "extra_profit": 0,
        "finished": False,
    }

    try:
        result = (
            get_supabase_admin()
            .table("trips")
            .insert(payload)
            .execute()
        )
    except Exception as exc:
        # 다른 요청이 동시에 생성했을 수 있으므로
        # DB의 고유 제약을 기준으로 기존 기록 재확인
        previous = get_existing_trip(user_id, idempotency_key)

        if previous is not None:
            if previous["request_payload"] != request_data:
                raise HTTPException(
                    status_code=409,
                    detail="같은 멱등성 키로 다른 요청을 보낼 수 없습니다.",
                )
            return {"id": previous["id"]}

        raise HTTPException(
            status_code=502,
            detail="운행 기록을 저장하지 못했습니다.",
        ) from exc

    if not result.data:
        raise HTTPException(
            status_code=502,
            detail="저장된 운행 기록을 확인하지 못했습니다.",
        )

    return {"id": trip_id}


@router.post(
    "/trips/{trip_id}/events",
    response_model=TripEventResponse,
    response_model_exclude_none=True,
)
def create_trip_event(
    trip_id: str,
    event: TripEvent,
    idempotency_key: str = Header(
        min_length=1,
        alias="Idempotency-Key",
    ),
    user_id: str = Depends(get_current_user),
):
    """
    DB 트랜잭션으로 이벤트를 기록한다.

    사용자의 운행 소유권과 중복 여부는
    record_trip_event 함수에서도 검사한다.
    """
    trip_id = require_uuid(trip_id)

    request_data = event.model_dump(mode="json")

    try:
        result = get_supabase_admin().rpc(
            "record_trip_event",
            {
                "p_trip_id": trip_id,
                "p_user_id": user_id,
                "p_event_id": event.eventId,
                "p_idempotency_key": idempotency_key,
                "p_event_type": event.type,
                "p_occurred_at": event.occurredAt,
                "p_payload": event.payload,
                "p_request": request_data,
            },
        ).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="운행 이벤트를 저장하지 못했습니다.",
        ) from exc

    data = result.data

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=502,
            detail="운행 이벤트 응답 형식이 올바르지 않습니다.",
        )

    error = data.get("error")

    if error == "not_found":
        raise HTTPException(
            status_code=404,
            detail="운행 기록을 찾을 수 없습니다.",
        )

    if error == "conflict":
        raise HTTPException(
            status_code=409,
            detail="같은 이벤트 ID 또는 멱등성 키가 이미 사용되었습니다.",
        )

    if error == "finished":
        raise HTTPException(
            status_code=409,
            detail="이미 종료된 운행입니다.",
        )

    if error == "invalid_fare":
        raise HTTPException(
            status_code=422,
            detail="요금은 0 이상의 유효한 숫자여야 합니다.",
        )

    if error or data.get("accepted") is not True:
        raise HTTPException(
            status_code=502,
            detail="운행 이벤트를 처리하지 못했습니다.",
        )

    return data


@router.get("/me/trips", response_model=list[TripRecord])
def get_my_trips(
    month: str,
    user_id: str = Depends(get_current_user),
):
    """인증된 사용자의 월별 운행 기록 조회."""
    try:
        if (
            len(month) != 7
            or month[4] != "-"
            or not month[:4].isdigit()
            or not month[5:].isdigit()
        ):
            raise ValueError()

        start = datetime.strptime(month, "%Y-%m").replace(
            tzinfo=timezone.utc
        )

    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="month는 YYYY-MM 형식이어야 합니다.",
        )

    if start.month == 12:
        end = start.replace(
            year=start.year + 1,
            month=1,
        )
    else:
        end = start.replace(month=start.month + 1)

    try:
        result = (
            get_supabase_admin()
            .table("trips")
            .select(
                "id,started_at,ended_at,destination,"
                "stops,passengers,revenue,cost,extra_profit"
            )
            .eq("user_id", user_id)
            .eq("finished", True)
            .gte("started_at", start.isoformat())
            .lt("started_at", end.isoformat())
            .order("started_at", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="운행 기록을 조회하지 못했습니다.",
        ) from exc

    records = []

    for trip in result.data or []:
        if not trip.get("ended_at"):
            continue

        started_at = datetime.fromisoformat(
            trip["started_at"].replace("Z", "+00:00")
        )

        records.append({
            "id": trip["id"],
            "date": started_at.strftime("%Y-%m-%d"),
            "startedAt": parse_timestamp(trip["started_at"]),
            "endedAt": parse_timestamp(trip["ended_at"]),
            "destination": trip["destination"],
            "stops": trip["stops"],
            "passengers": trip["passengers"],
            "revenue": float(trip["revenue"]),
            "cost": float(trip["cost"]),
            "extraProfit": float(trip["extra_profit"]),
            "demo": False,
        })

    return records
