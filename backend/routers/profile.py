
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db.auth import get_current_user
from db.client import get_supabase
from schemas.profile import UserProfile


router = APIRouter(prefix="/me", tags=["Profile"])
security = HTTPBearer()


@router.get("/profile", response_model=UserProfile)
def get_profile(
    user_id: str = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    # Supabase 연결 설정 확인
    get_supabase()

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_PUBLISHABLE_KEY"]
    token = credentials.credentials

    # 로그인한 사용자의 권한으로 DB 조회
    try:
        response = httpx.get(
            f"{url}/rest/v1/profiles",
            params={
                "id": f"eq.{user_id}",
                "select": "name,vehicle_type,notifications",
            },
            headers={
                "apikey": key,
                "Authorization": f"Bearer {token}",
            },
            timeout=10,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="프로필 데이터를 조회하지 못했습니다."
        )

    records = response.json()

    if not records:
        raise HTTPException(
            status_code=404,
            detail="프로필이 아직 생성되지 않았습니다."
        )

    profile = records[0]

    return {
        "name": profile["name"],
        "vehicleType": profile["vehicle_type"],
        "notifications": profile["notifications"],
        "favorites": [],
    }
