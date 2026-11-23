"""
서울 실시간 도시데이터 인구 수집 (10분마다)

    python -m collectors.citydata

1. data/seoul_places.json(121곳 영역)과 DB places를 비교해서 없거나 바뀐 장소를 넣는다
2. 121곳의 citydata_ppltn을 나눠서 동시에 호출한다
3. record_population RPC로 한 번에 저장한다 (실패한 장소는 is_missing = true)

필요한 환경변수: SUPABASE_URL, SUPABASE_SECRET_KEY, SEOUL_API_KEY
선택: CITYDATA_STORE_RAW=1 (응답 원문 저장. 행이 하루 1.7만 개라 DB 용량 때문에 기본은 끔)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from collectors.common import (
    collector_run,
    floor_10min,
    get_client,
    now_kst,
    parse_kst,
    require_env,
    run_main,
    to_int,
)

COLLECTOR = "collect-citydata"
API_URL = "http://openapi.seoul.go.kr:8088/{key}/json/citydata_ppltn/1/5/{area_cd}"
PLACES_FILE = Path(__file__).resolve().parent / "data" / "seoul_places.json"
CONGEST_LEVELS = {"여유", "보통", "약간 붐빔", "붐빔"}
WORKERS = 8
TIMEOUT = 15.0
RETRIES = 2

log = logging.getLogger(COLLECTOR)


# ---------- 장소 ----------

def load_seoul_places() -> list[dict]:
    return json.loads(PLACES_FILE.read_text(encoding="utf-8"))


def polygon_hash(place: dict) -> str:
    source = json.dumps([place["name"], place["category"], place["polygon"]], ensure_ascii=False)
    return hashlib.sha1(source.encode("utf-8")).hexdigest()


def sync_places(client, places: list[dict]) -> int:
    """파일과 DB가 다를 때만 upsert한다. 파일에서 빠진 장소는 지우지 않고 active = false."""
    existing = (
        client.table("places")
        .select("id,active,hash:raw->>sourceHash")
        .eq("type", "seoul_rtd")
        .execute()
        .data
    )
    db_state = {row["id"]: row for row in existing}

    changed = []
    for place in places:
        digest = polygon_hash(place)
        row = db_state.get(place["id"])
        if row is None or not row["active"] or row.get("hash") != digest:
            changed.append(
                {
                    "id": place["id"],
                    "name": place["name"],
                    "type": "seoul_rtd",
                    "area_type": place["category"],
                    "polygon": place["polygon"],
                    "has_population": True,
                    "active": True,
                    "raw": {"source": "OA-21778 서울시 주요 121장소 영역", "sourceHash": digest},
                }
            )

    for start in range(0, len(changed), 40):
        client.table("places").upsert(changed[start:start + 40], on_conflict="id").execute()

    file_ids = {place["id"] for place in places}
    gone = [place_id for place_id, row in db_state.items() if place_id not in file_ids and row["active"]]
    if gone:
        client.table("places").update({"active": False}).in_("id", gone).execute()

    if changed or gone:
        log.info("장소 동기화: 추가·변경 %d곳, 비활성 %d곳", len(changed), len(gone))
    return len(changed)


# ---------- 응답 파싱 ----------

def parse_response(area_cd: str, status_code: int, body: str, store_raw: bool) -> tuple[dict | None, str | None]:
    """정상이면 (행, None), 아니면 (None, 실패 사유)."""
    if status_code != 200:
        return None, f"HTTP {status_code}"

    try:
        payload = json.loads(body)
    except ValueError:
        # 인증키 오류 등은 json을 요청해도 XML로 온다: <RESULT><CODE>INFO-100</CODE>...
        code = re.search(r"<CODE>([^<]+)</CODE>", body)
        return None, code.group(1) if code else "JSON 아님"

    result = payload.get("RESULT") or {}
    code = result.get("RESULT.CODE") or result.get("CODE")
    items = payload.get("SeoulRtd.citydata_ppltn") or []
    if code != "INFO-000" or not items:
        return None, f"{code} {result.get('RESULT.MESSAGE') or result.get('MESSAGE') or ''}".strip()

    item = items[0]
    if item.get("AREA_CD") != area_cd:
        # 샘플 키는 어떤 장소를 요청해도 광화문·덕수궁(POI009)을 돌려준다
        return None, f"AREA_CD 불일치 (요청 {area_cd}, 응답 {item.get('AREA_CD')})"

    observed_at = parse_kst(item.get("PPLTN_TIME"), "%Y-%m-%d %H:%M")
    if observed_at is None:
        return None, "PPLTN_TIME 없음"

    forecast = None
    if item.get("FCST_YN") == "Y":
        forecast = []
        for entry in item.get("FCST_PPLTN") or []:
            forecast_time = parse_kst(entry.get("FCST_TIME"), "%Y-%m-%d %H:%M")
            if forecast_time is None:
                continue
            forecast.append(
                {
                    "time": forecast_time.isoformat(),
                    "min": to_int(entry.get("FCST_PPLTN_MIN")),
                    "max": to_int(entry.get("FCST_PPLTN_MAX")),
                    "congestLvl": entry.get("FCST_CONGEST_LVL"),
                }
            )

    pop_min = to_int(item.get("AREA_PPLTN_MIN"))
    pop_max = to_int(item.get("AREA_PPLTN_MAX"))
    if pop_min is None or pop_max is None:
        return None, "인구 값 없음"

    congest = item.get("AREA_CONGEST_LVL")
    row = {
        "place_id": area_cd,
        "observed_at": observed_at.isoformat(),
        "pop_min": pop_min,
        "pop_max": pop_max,
        "congest_lvl": congest if congest in CONGEST_LEVELS else None,
        "seoul_forecast": forecast,
        "is_replaced": item.get("REPLACE_YN") == "Y",
        "is_missing": False,
        "raw": item if store_raw else None,
    }
    return row, None


def missing_row(area_cd: str, fallback_time: datetime, reason: str) -> dict:
    return {
        "place_id": area_cd,
        "observed_at": fallback_time.isoformat(),
        "is_missing": True,
        "raw": {"error": reason},
    }


# ---------- 수집 ----------

def fetch_one(http: httpx.Client, key: str, area_cd: str, store_raw: bool) -> tuple[dict | None, str | None]:
    reason = None
    for _ in range(RETRIES):
        try:
            response = http.get(API_URL.format(key=key, area_cd=area_cd))
        except httpx.HTTPError as exc:
            reason = type(exc).__name__
            continue
        row, reason = parse_response(area_cd, response.status_code, response.text, store_raw)
        if row is not None or (reason and reason.startswith("INFO-100")):
            return row, reason  # 인증키 오류는 다시 시도해도 같다
    return None, reason


def collect(key: str, area_cds: list[str], fallback_time: datetime, store_raw: bool) -> tuple[list[dict], dict[str, str]]:
    rows: list[dict] = []
    errors: dict[str, str] = {}
    with httpx.Client(timeout=TIMEOUT) as http, ThreadPoolExecutor(WORKERS) as pool:
        results = pool.map(lambda area_cd: (area_cd, fetch_one(http, key, area_cd, store_raw)), area_cds)
        for area_cd, (row, reason) in results:
            if row is None:
                errors[area_cd] = reason or "알 수 없음"
                rows.append(missing_row(area_cd, fallback_time, errors[area_cd]))
            else:
                rows.append(row)
    return rows, errors


def main() -> None:
    key = require_env("SEOUL_API_KEY")["SEOUL_API_KEY"]
    store_raw = os.getenv("CITYDATA_STORE_RAW", "").strip() in {"1", "true", "yes"}
    client = get_client()

    with collector_run(client, COLLECTOR) as result:
        places = load_seoul_places()
        sync_places(client, places)

        fallback_time = floor_10min(now_kst())
        rows, errors = collect(key, [place["id"] for place in places], fallback_time, store_raw)
        client.rpc("record_population", {"p_rows": rows}).execute()

        ok = len(rows) - len(errors)
        result["row_count"] = ok
        log.info("정상 %d곳, 실패 %d곳", ok, len(errors))

        if errors:
            sample = "; ".join(f"{k}: {v}" for k, v in list(errors.items())[:5])
            result["status"] = "partial"
            result["error"] = f"실패 {len(errors)}곳. {sample}"
        if ok == 0:
            raise RuntimeError(f"모든 장소 수집 실패. {result['error']}")


if __name__ == "__main__":
    run_main(main)
