
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client


ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_PATH)


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """기존 사용자 인증 및 프로필용 클라이언트."""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")

    if not url or not key:
        raise ValueError(
            "Supabase 공개 연결 정보가 설정되지 않았습니다."
        )

    return create_client(url, key)


@lru_cache(maxsize=1)
def get_supabase_admin() -> Client:
    """
    서버 전용 데이터베이스 클라이언트.

    반드시 검증된 사용자 ID와 소유권 조건을
    적용한 백엔드 코드에서만 사용한다.
    """
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SECRET_KEY")

    if not url or not key:
        raise ValueError(
            "Supabase 서버 전용 연결 정보가 설정되지 않았습니다."
        )

    return create_client(url, key)
