"""
인천공항 승객예고(출·입국장별) 수집 (1시간마다)

    python -m collectors.airport

오늘(selectdate=0)·내일(selectdate=1)의 시간대별 T1·T2 입국장 합계를 받아
record_airport_arrivals RPC로 저장한다. DB 함수가 받은 날짜의 공항 이벤트를 다시 만든다.

필요한 환경변수: SUPABASE_URL, SUPABASE_SECRET_KEY, DATA_GO_KR_KEY
선택: AIRPORT_EVENT_RATIO (이벤트 기준값 = 그날 평균 × 배수, 기본 1.5)

API: 공공데이터포털 15095066 인천국제공항공사_승객예고-출·입국장별
     GET https://apis.data.go.kr/B551177/passgrAnncmt/getPassgrAnncmt
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from urllib.parse import unquote

import httpx

from collectors.common import collector_run, get_client, require_env, run_main, to_int

COLLECTOR = "collect-airport"
API_URL = "https://apis.data.go.kr/B551177/passgrAnncmt/getPassgrAnncmt"
TERMINAL_FIELDS = (("T1", "t1egsum1"), ("T2", "t2egsum1"))  # 입국장 합계
TIMEOUT = 30.0

log = logging.getLogger(COLLECTOR)


def normalize_key(key: str) -> str:
    """포털의 Encoding 키를 넣어도 되도록 디코딩한다. httpx가 다시 인코딩한다."""
    return unquote(key) if "%" in key else key


def extract_items(body: str) -> list[dict]:
    try:
        payload = json.loads(body)
    except ValueError:
        # 인증키 오류 등은 type=json이어도 XML로 온다
        message = re.search(r"<returnAuthMsg>([^<]+)</returnAuthMsg>|<resultMsg>([^<]+)</resultMsg>", body)
        detail = next((group for group in message.groups() if group), None) if message else body[:200]
        raise RuntimeError(f"인천공항 API 오류: {detail}")

    response = payload.get("response", payload)
    header = response.get("header") or {}
    code = str(header.get("resultCode", "00"))
    if code not in {"00", "0", "0000"}:
        raise RuntimeError(f"인천공항 API 오류: {code} {header.get('resultMsg')}")

    items = (response.get("body") or {}).get("items") or []
    if isinstance(items, dict):
        items = items.get("item") or []
    if isinstance(items, dict):
        items = [items]
    return items


def parse_items(items: list[dict]) -> list[dict]:
    """item 하나(날짜·시간대) → 터미널별 행 2개. 시간대가 'HH_HH'가 아닌 행(합계 등)은 건너뛴다."""
    rows = []
    for item in items:
        slot = re.fullmatch(r"(\d{1,2})_(\d{1,2})", str(item.get("atime") or "").strip())
        try:
            arrival_date = datetime.strptime(str(item.get("adate") or "").strip(), "%Y%m%d").date()
        except ValueError:
            continue
        if not slot or not 0 <= int(slot.group(1)) <= 23:
            continue

        for terminal, field in TERMINAL_FIELDS:
            rows.append(
                {
                    "terminal": terminal,
                    "arrival_date": arrival_date.isoformat(),
                    "hour": int(slot.group(1)),
                    "arrivals": to_int(item.get(field)),
                    "raw": item,
                }
            )
    return rows


def fetch(http: httpx.Client, key: str, selectdate: int) -> list[dict]:
    response = http.get(
        API_URL,
        params={
            "serviceKey": key,
            "numOfRows": 100,
            "pageNo": 1,
            "selectdate": selectdate,
            "type": "json",
        },
    )
    if response.status_code != 200:
        raise RuntimeError(f"인천공항 API HTTP {response.status_code}")
    return parse_items(extract_items(response.text))


def main() -> None:
    key = normalize_key(require_env("DATA_GO_KR_KEY")["DATA_GO_KR_KEY"])
    ratio = float(os.getenv("AIRPORT_EVENT_RATIO") or 1.5)
    client = get_client()

    with collector_run(client, COLLECTOR) as result:
        rows: list[dict] = []
        errors = []
        with httpx.Client(timeout=TIMEOUT) as http:
            for selectdate in (0, 1):
                try:
                    rows += fetch(http, key, selectdate)
                except Exception as exc:  # 내일 자료가 아직 없을 수 있으므로 하루씩 따로 처리
                    errors.append(f"selectdate={selectdate}: {exc}")

        if not rows:
            raise RuntimeError("받은 시간대가 없습니다. " + " / ".join(errors))

        # 같은 키가 한 번에 두 번 들어가면 upsert가 실패하므로 마지막 값만 남긴다
        rows = list({(r["terminal"], r["arrival_date"], r["hour"]): r for r in rows}.values())

        events = client.rpc(
            "record_airport_arrivals", {"p_rows": rows, "p_ratio": ratio}
        ).execute().data
        result["row_count"] = len(rows)
        log.info("시간대 %d행 저장, 공항 이벤트 %s개 생성", len(rows), events)

        if errors:
            result["status"] = "partial"
            result["error"] = " / ".join(errors)


if __name__ == "__main__":
    run_main(main)
