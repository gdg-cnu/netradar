
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client


# backend/.env 파일 위치
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

# 환경변수 불러오기
load_dotenv(ENV_PATH)


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")

    if not url or not key:
        raise ValueError("Supabase 연결 정보가 설정되지 않았습니다.")

    return create_client(url, key)
