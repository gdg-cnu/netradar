import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db.auth import get_current_user
from db.client import get_supabase
from schemas.profile import UserProfile


router = APIRouter(prefix="/me", tags=["Profile"])
security = HTTPBearer()


# Supabase 요청에 사용할 인증 정보
def get_auth_config(token: str):

    get_supabase()

    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_PUBLISHABLE_KEY"]

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {token}",
    }

    return url, headers


# 사용자 프로필 조회
@router.get("/profile", response_model=UserProfile)
def get_profile(
    user_id: str = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    url, headers = get_auth_config(credentials.credentials)

    try:
        response = httpx.get(
            f"{url}/rest/v1/profiles",
            params={
                "id": f"eq.{user_id}",
                "select": "name,vehicle_type,notifications,favorites",
            },
            headers=headers,
            timeout=10,
        )
        response.raise_for_status()

    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="프로필 데이터를 조회하지 못했습니다.",
        )

    records = response.json()

    if not records:
        raise HTTPException(
            status_code=404,
            detail="프로필이 아직 생성되지 않았습니다.",
        )

    profile = records[0]

    return {
        "name": profile["name"],
        "vehicleType": profile["vehicle_type"],
        "notifications": profile["notifications"],
        "favorites": profile["favorites"],
    }


# 사용자 프로필 수정
@router.patch("/profile", response_model=UserProfile)
def update_profile(
    profile: UserProfile,
    user_id: str = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    url, headers = get_auth_config(credentials.credentials)

    # 프론트엔드 형식을 DB 컬럼명으로 변환
    payload = {
        "id": user_id,
        "name": profile.name,
        "vehicle_type": profile.vehicleType,
        "notifications": profile.notifications,
        "favorites": [
            favorite.model_dump()
            for favorite in profile.favorites
        ],
    }

    # 프로필이 없으면 생성하고, 있으면 수정
    headers["Prefer"] = (
        "resolution=merge-duplicates,return=representation"
    )
    headers["Content-Type"] = "application/json"

    try:
        response = httpx.post(
            f"{url}/rest/v1/profiles",
            params={
                "on_conflict": "id",
                "select": "name,vehicle_type,notifications,favorites",
            },
            json=payload,
            headers=headers,
            timeout=10,
        )
        response.raise_for_status()

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"프로필 저장에 실패했습니다. DB 응답 코드: {exc.response.status_code}",
        )

    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Supabase 서버에 연결하지 못했습니다.",
        )

    records = response.json()

    if not records:
        raise HTTPException(
            status_code=502,
            detail="저장된 프로필을 확인하지 못했습니다.",
        )

    saved = records[0]

    return {
        "name": saved["name"],
        "vehicleType": saved["vehicle_type"],
        "notifications": saved["notifications"],
        "favorites": saved["favorites"],
    }