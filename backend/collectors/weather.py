"""
기상청 시간별 강수 수집 (1시간마다)

    python -m collectors.weather

1. DB weather_grids 뷰에서 활성 장소들의 기상청 5km 격자(nx, ny) 목록을 받는다
2. 격자마다 초단기실황(최근 N시간)과 초단기예보(최신 발표 1회)를 동시에 호출한다
3. RN1(1시간 강수량)·PTY(강수형태)만 골라 record_precip RPC로 저장한다

실황을 최근 N시간 받는 이유: GitHub 예약 실행이 건너뛰어도 다음 실행이 빈 시각을 채운다.
같은 키는 덮어쓰므로 중복되지 않는다.

필요한 환경변수: SUPABASE_URL, SUPABASE_SECRET_KEY, DATA_GO_KR_KEY
  (공공데이터포털에서 '기상청_단기예보 조회서비스'를 따로 활용신청해야 같은 키로 호출된다)
선택: WEATHER_NCST_HOURS (실황을 몇 시간 전까지 받을지, 기본 3)

API: 공공데이터포털 15084084 기상청_단기예보 ((구)_동네예보) 조회서비스
     GET https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst  (초단기실황)
     GET https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst  (초단기예보)
"""

from __future__ import annotations

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import httpx

from collectors.common import (
    collector_run,
    get_client,
    normalize_key,
    now_kst,
    parse_kst,
    require_env,
    run_main,
    to_int,
)

COLLECTOR = "collect-weather"
BASE_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0"
NCST_URL = f"{BASE_URL}/getUltraSrtNcst"
FCST_URL = f"{BASE_URL}/getUltraSrtFcst"
CATEGORIES = ("RN1", "PTY")
TIMEOUT = 20.0
WORKERS = 8
RPC_CHUNK = 500

# 발표 후 API에 올라오기까지의 여유 (기상청 활용가이드 기준. 실황 매시 40분, 예보 매시 45분 이후)
NCST_DELAY = timedelta(minutes=40)
FCST_DELAY = timedelta(minutes=15)  # 예보는 HH:30 발표 → HH:45 이후 제공

log = logging.getLogger(COLLECTOR)


# --- 발표 시각 ---

def latest_ncst_base(now: datetime) -> datetime:
    """지금 받을 수 있는 가장 최근 실황 발표 시각 (정시)."""
    return (now - NCST_DELAY).replace(minute=0, second=0, microsecond=0)


def latest_fcst_base(now: datetime) -> datetime:
    """지금 받을 수 있는 가장 최근 초단기예보 발표 시각 (매시 30분)."""
    moment = now - FCST_DELAY
    base = moment.replace(minute=30, second=0, microsecond=0)
    return base if moment.minute >= 30 else base - timedelta(hours=1)


def ncst_bases(now: datetime, hours: int) -> list[datetime]:
    latest = latest_ncst_base(now)
    return [latest - timedelta(hours=i) for i in range(max(hours, 1))]


# --- 값 변환 ---

def parse_rain(value) -> float | None:
    """
    RN1 → mm. 실황은 실수('0', '1.5'), 예보는 범주 문자열로 온다.
      '강수없음' → 0, '1mm 미만' → 0.5, '30.0~50.0mm' → 40.0(가운데), '50.0mm 이상' → 50.0
    결측(±900 이상, -998.9 등)이나 읽을 수 없는 값은 None. 원문은 rain_text에 남는다.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in {"-", "null"}:
        return None
    if text == "강수없음":
        return 0.0
    if "미만" in text:
        return 0.5

    numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", text)]
    if not numbers:
        return None
    amount = (numbers[0] + numbers[1]) / 2 if "~" in text and len(numbers) >= 2 else numbers[0]
    if amount < 0 or amount >= 900:
        return None
    return round(amount, 1)


def parse_pty(value) -> int | None:
    code = to_int(value)
    return code if code is not None and 0 <= code <= 7 else None


# --- 응답 해석 ---

def extract_items(body: str) -> list[dict]:
    try:
        payload = json.loads(body)
    except ValueError:
        # 인증키 오류 등은 dataType=JSON이어도 XML로 온다
        message = re.search(r"<returnAuthMsg>([^<]+)</returnAuthMsg>|<resultMsg>([^<]+)</resultMsg>", body)
        detail = next((group for group in message.groups() if group), None) if message else body[:200]
        raise RuntimeError(f"기상청 API 오류: {detail}")

    response = payload.get("response", payload)
    header = response.get("header") or {}
    code = str(header.get("resultCode", "00"))
    if code not in {"00", "0", "0000"}:
        raise RuntimeError(f"기상청 API 오류: {code} {header.get('resultMsg')}")

    items = (response.get("body") or {}).get("items") or []
    if isinstance(items, dict):
        items = items.get("item") or []
    if isinstance(items, dict):
        items = [items]
    return items


def build_row(nx: int, ny: int, kind: str, target_at: datetime, base_at: datetime, values: dict) -> dict:
    rain_text = values.get("RN1")
    return {
        "nx": nx,
        "ny": ny,
        "kind": kind,
        "target_at": target_at.isoformat(),
        "base_at": base_at.isoformat(),
        "rain_mm": parse_rain(rain_text),
        "rain_text": None if rain_text is None else str(rain_text).strip(),
        "pty": parse_pty(values.get("PTY")),
        "raw": values,  # 필요한 항목 원문만 둔다 (전체 응답은 행이 많아 용량을 차지한다)
    }


def parse_ncst(items: list[dict], nx: int, ny: int) -> list[dict]:
    """초단기실황 → 행 1개 (관측 정시 = 발표 시각)."""
    values: dict[str, str] = {}
    base_at = None
    for item in items:
        if item.get("category") in CATEGORIES:
            values[item["category"]] = item.get("obsrValue")
            base_at = base_at or parse_kst(f"{item.get('baseDate')}{item.get('baseTime')}", "%Y%m%d%H%M")
    if base_at is None or not values:
        return []
    return [build_row(nx, ny, "obs", base_at, base_at, values)]


def parse_fcst(items: list[dict], nx: int, ny: int) -> list[dict]:
    """초단기예보 → 예보 시각마다 행 1개 (보통 6개)."""
    grouped: dict[tuple[datetime, datetime], dict[str, str]] = {}
    for item in items:
        if item.get("category") not in CATEGORIES:
            continue
        base_at = parse_kst(f"{item.get('baseDate')}{item.get('baseTime')}", "%Y%m%d%H%M")
        target_at = parse_kst(f"{item.get('fcstDate')}{item.get('fcstTime')}", "%Y%m%d%H%M")
        if base_at is None or target_at is None:
            continue
        grouped.setdefault((target_at, base_at), {})[item["category"]] = item.get("fcstValue")
    return [
        build_row(nx, ny, "fcst", target_at, base_at, values)
        for (target_at, base_at), values in sorted(grouped.items())
    ]


# --- 호출 ---

def fetch(http: httpx.Client, url: str, key: str, base: datetime, nx: int, ny: int) -> list[dict]:
    params = {
        "serviceKey": key,
        "pageNo": 1,
        "numOfRows": 100,  # 실황 8개, 예보 60개(10항목 × 6시간)
        "dataType": "JSON",
        "base_date": base.strftime("%Y%m%d"),
        "base_time": base.strftime("%H%M"),
        "nx": nx,
        "ny": ny,
    }
    last_error: Exception | None = None
    for _ in range(2):  # 기상청 API는 간헐적으로 끊기므로 한 번 더 시도한다
        try:
            response = http.get(url, params=params)
            if response.status_code != 200:
                raise RuntimeError(f"기상청 API HTTP {response.status_code}")
            return extract_items(response.text)
        except (httpx.HTTPError, RuntimeError) as exc:
            last_error = exc
    raise last_error  # type: ignore[misc]


def collect(key: str, grids: list[tuple[int, int]], now: datetime, ncst_hours: int) -> tuple[list[dict], list[str]]:
    jobs = [("obs", NCST_URL, base, nx, ny) for nx, ny in grids for base in ncst_bases(now, ncst_hours)]
    jobs += [("fcst", FCST_URL, latest_fcst_base(now), nx, ny) for nx, ny in grids]

    def run(job):
        kind, url, base, nx, ny = job
        try:
            items = fetch(http, url, key, base, nx, ny)
            parser = parse_ncst if kind == "obs" else parse_fcst
            return parser(items, nx, ny), None
        except Exception as exc:
            return [], f"{kind} ({nx},{ny}) {base:%m-%d %H:%M}: {exc}"

    rows: list[dict] = []
    errors: list[str] = []
    with httpx.Client(timeout=TIMEOUT) as http, ThreadPoolExecutor(WORKERS) as pool:
        for job_rows, error in pool.map(run, jobs):
            rows += job_rows
            if error:
                errors.append(error)
    return rows, errors


def main() -> None:
    key = normalize_key(require_env("DATA_GO_KR_KEY")["DATA_GO_KR_KEY"])
    ncst_hours = int(os.getenv("WEATHER_NCST_HOURS") or 3)
    client = get_client()

    with collector_run(client, COLLECTOR) as result:
        grid_rows = client.table("weather_grids").select("nx,ny").execute().data or []
        grids = sorted({(int(g["nx"]), int(g["ny"])) for g in grid_rows})
        if not grids:
            raise RuntimeError("수집할 격자가 없습니다. places에 장소가 있고 kma_nx·kma_ny가 채워졌는지 확인하세요")

        rows, errors = collect(key, grids, now_kst(), ncst_hours)
        if not rows:
            raise RuntimeError("받은 강수 자료가 없습니다. " + " / ".join(errors[:5]))

        # 같은 키가 한 번에 두 번 들어가면 upsert가 실패하므로 마지막 값만 남긴다
        rows = list({(r["nx"], r["ny"], r["kind"], r["target_at"], r["base_at"]): r for r in rows}.values())
        for start in range(0, len(rows), RPC_CHUNK):
            client.rpc("record_precip", {"p_rows": rows[start:start + RPC_CHUNK]}).execute()

        result["row_count"] = len(rows)
        log.info("격자 %d개, 강수 %d행 저장 (실패 호출 %d건)", len(grids), len(rows), len(errors))

        if errors:
            result["status"] = "partial"
            result["error"] = f"실패 {len(errors)}건: " + " / ".join(errors[:10])


if __name__ == "__main__":
    run_main(main)
