from fastapi import APIRouter, Query

from data.mock_places import MOCK_PLACES
from schemas.route import Place


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