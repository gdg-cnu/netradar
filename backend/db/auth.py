
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db.client import get_supabase


security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> str:
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="로그인이 필요합니다."
        )

    token = credentials.credentials

    try:
        response = get_supabase().auth.get_user(token)
    except Exception:
        raise HTTPException(
            status_code=401,
            detail="유효하지 않거나 만료된 인증 정보입니다."
        )

    if response.user is None:
        raise HTTPException(
            status_code=401,
            detail="사용자를 확인할 수 없습니다."
        )

    return response.user.id
