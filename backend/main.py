
from fastapi import FastAPI

app = FastAPI(
    title="NetRadar API",
    version="1.0.0"
)

@app.get("/")
def home():
    return {"message": "Welcome to NetRadar API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}
