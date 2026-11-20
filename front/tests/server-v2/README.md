# Server V2 checks

Run from `front/` with the backend Python dependencies installed:

```sh
NETRADAR_TEST_PYTHON=/path/to/venv/bin/python npm run test:e2e:v2:server
```

The suite starts the actual `backend/main.py` app on localhost:8177, overrides only
the clock, clears external API credentials, disables dotenv, and permits the five
public GET endpoint families. It does not log in, mutate a database, or call an
external prediction service. Backend data is currently server mock data.

The frontend preview runs on localhost:5177. Playwright relays same-origin GETs to
FastAPI because production CORS currently allows only 5173/4173. Thus these tests
verify the real route responses and frontend HTTP adapter, not deployment CORS or
production authentication. Error and metadata cases explicitly transform those
real responses. All response clocks use 2026-11-20 22:00 KST.
