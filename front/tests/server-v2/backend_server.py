"""Run the production FastAPI app with a fixed clock and read-only allowlist."""
import os
import sys
from datetime import datetime
from pathlib import Path

# Prevent dotenv or inherited shell secrets from reaching this isolated test server.
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
for key in (
    "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
    "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "KAKAO_MOBILITY_REST_API_KEY",
):
    os.environ[key] = ""

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))

import uvicorn
from fastapi.responses import JSONResponse
from main import app
from services.clock import KST, get_now

app.dependency_overrides[get_now] = lambda: datetime(2026, 11, 20, 22, 0, tzinfo=KST)


@app.middleware("http")
async def public_reads_only(request, call_next):
    path = request.url.path
    allowed = path in {
        "/health", "/api/v1/config", "/api/v1/heatmap",
        "/api/v1/events", "/api/v1/alerts/top",
    } or (path.startswith("/api/v1/places/") and path != "/api/v1/places/search")
    if request.method != "GET" or not allowed:
        return JSONResponse({"detail": "Read-only test boundary"}, status_code=405)
    return await call_next(request)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8177, log_level="warning", access_log=False)
