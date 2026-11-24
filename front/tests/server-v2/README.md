# Server V2 checks

Run from `front/` with Python 3.12 and the backend runtime dependencies installed:

```sh
python3.12 -m venv .cache/server-v2-python
.cache/server-v2-python/bin/python -m pip install -r ../backend/requirements.txt
NETRADAR_TEST_PYTHON=.cache/server-v2-python/bin/python npm run test:e2e:v2:server
```

An existing backend environment can also be selected:

```sh
NETRADAR_TEST_PYTHON=/path/to/venv/bin/python npm run test:e2e:v2:server
```

CI runs this suite in the `server-v2` E2E matrix job. Only that E2E job sets up
Python 3.12 and installs `backend/requirements.txt`; the other E2E suites need only
Node and Chromium. Failed runs upload Playwright traces and screenshots through
the shared artifact step.

The suite starts the actual `backend/main.py` app on localhost:8177, overrides only
the clock, clears external API credentials, disables dotenv, and permits the five
public GET endpoint families. It does not log in, mutate a database, or call an
external prediction service. Backend data is currently server mock data.

The frontend preview runs on localhost:5177. Playwright relays same-origin GETs to
FastAPI rather than relying on a deployment-specific ALLOWED_ORIGINS setting. Thus these tests
verify the real route responses and frontend HTTP adapter, not deployment CORS or
production authentication. Error and metadata cases explicitly transform those
real responses. The backend clock is fixed at 2026-11-20 22:00 KST; freshness cases
explicitly override response timestamps.

Service workers are blocked, matching the other API-interception E2E suites.
This keeps PWA caching from bypassing `page.route` and hiding request failures;
the suite does not test offline PWA caching or service-worker registration.
