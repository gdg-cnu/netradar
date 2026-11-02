
from fastapi import FastAPI
from routers.forecast import router as forecast_router

app = FastAPI(
    title="NetRadar API",
    version="1.0.0"
)

app.include_router(
    forecast_router,
    prefix="/api/v1"
)

@app.get("/")
def home():
    return {"message": "Welcome to NetRadar API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}
