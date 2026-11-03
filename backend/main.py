from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import forecast, profile, places, routes, trips


app = FastAPI(
    title="NetRadar API",
    description="택시 기사를 위한 예상 시급 및 동선 추천 서비스 API",
    version="1.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
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


app.include_router(forecast.router, prefix="/api/v1")
app.include_router(profile.router, prefix="/api/v1")
app.include_router(places.router, prefix="/api/v1")
app.include_router(routes.router, prefix="/api/v1")
app.include_router(trips.router, prefix="/api/v1")