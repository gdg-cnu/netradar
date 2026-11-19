from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from data.mock_places import MOCK_PLACES
from schemas.demand import PlaceDetail
from schemas.route import Place
from services import demand
from services.clock import get_now


router = APIRouter(prefix="/places", tags=["Places"])


@router.get("/search", response_model=list[Place])
def search_places(q: str = Query(min_length=1)):

    keyword = q.strip().lower()

    results = [
        place
        for place in MOCK_PLACES
        if keyword in place["name"].lower()
        or keyword in place["address"].lower()
    ]

    return results


# 장소 상세 (v2)
# /search보다 뒤에 등록해야 "search"가 장소 id로 잡히지 않는다.
@router.get("/{place_id}", response_model=PlaceDetail)
def get_place_detail(
    place_id: str,
    now: datetime = Depends(get_now),
):
    place = demand.get_place_detail(now, place_id)

    if place is None:
        raise HTTPException(
            status_code=404,
            detail="해당 장소를 찾을 수 없습니다.",
        )

    return place
