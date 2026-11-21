import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import demand, forecast, profile, places, routes, trips


load_dotenv(Path(__file__).resolve().parent / ".env")


DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]


def get_allowed_origins() -> list[str]:
    """ALLOWED_ORIGINS(쉼표 구분)가 있으면 그 값만, 없으면 로컬 개발 주소를 허용한다."""
    raw = os.getenv("ALLOWED_ORIGINS", "")
    origins = [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]
    return origins or DEFAULT_ALLOWED_ORIGINS


app = FastAPI(
    title="NetRadar API",
    description="택시 기사를 위한 수요 급증 예보 및 동선 추천 서비스 API",
    version="1.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
    ],
)


@app.get("/")
def root():
    return {
        "message": "NetRadar API 서버가 정상 실행 중입니다."
    }


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(demand.router, prefix="/api/v1")
app.include_router(forecast.router, prefix="/api/v1")
app.include_router(profile.router, prefix="/api/v1")
app.include_router(places.router, prefix="/api/v1")
app.include_router(routes.router, prefix="/api/v1")
app.include_router(trips.router, prefix="/api/v1")