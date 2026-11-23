"""
KOPIS 공연 정보 수집 (하루 1번)

    python -m collectors.kopis

1. 공연목록: 오늘부터 7일 뒤까지, 서울(signgucode=11). 100건씩 페이지를 넘기며 받는다
2. 공연상세: 공연마다 시설 ID(mt10id), 공연시간 안내(dtguidance), 러닝타임을 받는다
3. 공연시설상세: 처음 보거나 30일이 지난 시설만 받아 upsert_kopis_venue RPC로 장소에 연결한다
4. 회차(시작 시각) × 러닝타임으로 종료 시각을 계산하고, 좌석 수 기준 이상인 홀만 이벤트로 만든다
5. sync_concert_events RPC 한 번으로 앞으로 남은 공연 이벤트를 바꾼다

필요한 환경변수: SUPABASE_URL, SUPABASE_SECRET_KEY, KOPIS_API_KEY
선택: KOPIS_MIN_SEATS (이벤트로 만들 최소 좌석 수, 기본 1000), KOPIS_DAYS (기본 7)
"""

from __future__ import annotations

import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta

import httpx

from collectors.common import KST, collector_run, get_client, now_kst, require_env, run_main, to_int

COLLECTOR = "collect-kopis"
BASE_URL = "http://www.kopis.or.kr/openApi/restful"
PAGE_ROWS = 100
MAX_PAGES = 50
REQUEST_INTERVAL = 0.15   # 초당 10회 이상이면 차단된다는 보고가 있어 간격을 둔다
TIMEOUT = 20.0
DEFAULT_RUNTIME = 120
VENUE_REFRESH_DAYS = 30
EXIT_WINDOW = timedelta(minutes=30)

WEEKDAYS = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}

log = logging.getLogger(COLLECTOR)


# ---------- 파싱 (순수 함수, 테스트 대상) ----------

def parse_runtime(text: str | None) -> tuple[int, bool]:
    """'1시간 30분' → (90, False). 파싱 실패면 (기본 120, True)."""
    hours = re.search(r"(\d+)\s*시간", text or "")
    minutes = re.search(r"(\d+)\s*분", text or "")
    total = (int(hours.group(1)) * 60 if hours else 0) + (int(minutes.group(1)) if minutes else 0)
    if not 0 < total <= 600:
        return DEFAULT_RUNTIME, True
    return total, False


def parse_days(part: str) -> set[int]:
    """'화요일 ~ 금요일' → {1,2,3,4}, '토요일, 일요일' → {5,6}. HOL(공휴일)은 공휴일 달력이 없어 무시한다."""
    days: set[int] = set()
    for piece in re.split(r"[,/]", part):
        piece = piece.strip()
        span = re.fullmatch(r"([월화수목금토일])요일\s*~\s*([월화수목금토일])요일", piece)
        if span:
            day, last = WEEKDAYS[span.group(1)], WEEKDAYS[span.group(2)]
            days.add(day)
            while day != last:
                day = (day + 1) % 7
                days.add(day)
            continue
        single = re.fullmatch(r"([월화수목금토일])요일", piece)
        if single:
            days.add(WEEKDAYS[single.group(1)])
    return days


def parse_dtguidance(text: str | None) -> dict[int, list[tuple[int, int]]]:
    """
    '화요일 ~ 금요일(20:00), 토요일(15:00,17:30)' → {1: [(20,0)], ..., 5: [(15,0),(17,30)]}
    요일별 시작 시각. 하나도 못 읽으면 빈 dict.
    """
    schedule: dict[int, set[tuple[int, int]]] = {}
    for days_part, times_part in re.findall(r"([^()]*?)\(([^()]*)\)", text or ""):
        times = {
            (int(hour), int(minute))
            for hour, minute in re.findall(r"(\d{1,2}):(\d{2})", times_part)
            if int(hour) < 24 and int(minute) < 60
        }
        if not times:
            continue
        for day in parse_days(days_part.strip(" ,")):
            schedule.setdefault(day, set()).update(times)
    return {day: sorted(times) for day, times in schedule.items()}


def parse_kopis_date(text: str | None) -> date | None:
    try:
        return datetime.strptime((text or "").strip(), "%Y.%m.%d").date()
    except ValueError:
        return None


def build_sessions(
    schedule: dict[int, list[tuple[int, int]]],
    period_from: date,
    period_to: date,
    window_from: date,
    window_to: date,
) -> list[datetime]:
    """공연 기간과 수집 기간이 겹치는 날짜마다 요일이 맞는 회차 시작 시각(KST)."""
    sessions = []
    day = max(period_from, window_from)
    last = min(period_to, window_to)
    while day <= last:
        for hour, minute in schedule.get(day.weekday(), []):
            sessions.append(datetime(day.year, day.month, day.day, hour, minute, tzinfo=KST))
        day += timedelta(days=1)
    return sessions


def _normalize(name: str) -> str:
    return re.sub(r"\s+", "", name or "").lower()


def match_hall(facility_text: str | None, halls: list[dict]) -> dict | None:
    """
    공연상세의 fcltynm(예: '올림픽공원 (KSPO DOME(올림픽체조경기장))')에 이름이 들어 있는 홀.
    여러 개면 가장 긴 이름. 못 찾았는데 홀이 하나뿐이면 그 홀.
    """
    target = _normalize(facility_text or "")
    candidates = [hall for hall in halls if hall.get("name") and _normalize(hall["name"]) in target]
    if candidates:
        return max(candidates, key=lambda hall: len(hall["name"]))
    if len(halls) == 1:
        return halls[0]
    return None


def xml_text(element: ET.Element, tag: str) -> str | None:
    found = element.find(tag)
    if found is None or found.text is None:
        return None
    return found.text.strip() or None


# ---------- KOPIS 호출 ----------

class KopisClient:
    def __init__(self, key: str):
        self.key = key
        self.http = httpx.Client(timeout=TIMEOUT)

    def close(self) -> None:
        self.http.close()

    def get(self, path: str, **params) -> ET.Element:
        time.sleep(REQUEST_INTERVAL)
        last_error: Exception | None = None
        for _ in range(2):
            try:
                response = self.http.get(f"{BASE_URL}/{path}", params={"service": self.key, **params})
                response.raise_for_status()
                root = ET.fromstring(response.content)
                break
            except (httpx.HTTPError, ET.ParseError) as exc:
                last_error = exc
                time.sleep(1)
        else:
            raise RuntimeError(f"KOPIS {path.split('/')[0]} 호출 실패: {type(last_error).__name__}")

        error = root.find(".//returncode")
        if error is not None and (error.text or "").strip() not in {"", "00"}:
            raise RuntimeError(f"KOPIS 오류 {error.text}: {xml_text(root, './/errmsg')}")
        return root

    def list_performances(self, start: date, end: date) -> tuple[list[str], bool]:
        """(공연 ID 목록, 빠짐없이 받았는지)."""
        ids: list[str] = []
        for page in range(1, MAX_PAGES + 1):
            root = self.get(
                "pblprfr",
                stdate=start.strftime("%Y%m%d"),
                eddate=end.strftime("%Y%m%d"),
                cpage=page,
                rows=PAGE_ROWS,
                signgucode="11",
            )
            batch = [xml_text(db, "mt20id") for db in root.findall("db")]
            ids += [mt20id for mt20id in batch if mt20id]
            if len(batch) < PAGE_ROWS:
                return list(dict.fromkeys(ids)), True
        log.warning("공연목록이 %d페이지를 넘어 중단했습니다", MAX_PAGES)
        return list(dict.fromkeys(ids)), False

    def performance(self, mt20id: str) -> dict | None:
        db = self.get(f"pblprfr/{mt20id}").find("db")
        if db is None:
            return None
        return {
            tag: xml_text(db, tag)
            for tag in (
                "mt20id", "prfnm", "prfpdfrom", "prfpdto", "fcltynm", "mt10id",
                "prfruntime", "dtguidance", "prfstate", "genrenm", "updatedate",
            )
        }

    def facility(self, mt10id: str) -> dict | None:
        db = self.get(f"prfplc/{mt10id}").find("db")
        if db is None:
            return None
        halls = [
            {
                "mt13id": xml_text(hall, "mt13id"),
                "name": xml_text(hall, "prfplcnm"),
                "seats": to_int(xml_text(hall, "seatscale")),
            }
            for hall in db.findall("./mt13s/mt13")
            if xml_text(hall, "mt13id")
        ]
        return {
            "mt10id": mt10id,
            "name": xml_text(db, "fcltynm") or mt10id,
            "lat": _to_float(xml_text(db, "la")),
            "lng": _to_float(xml_text(db, "lo")),
            "seats": to_int(xml_text(db, "seatscale")),
            "halls": halls,
            "raw": {tag: xml_text(db, tag) for tag in ("fcltynm", "adres", "seatscale", "mt13cnt", "la", "lo")},
        }


def _to_float(text: str | None) -> float | None:
    try:
        return float(text) if text else None
    except ValueError:
        return None


# ---------- 시설 → 장소 ----------

def load_cached_venues(client) -> dict[str, dict]:
    rows = (
        client.table("venues")
        .select("mt10id,name,seats,place_id,refreshed_at,venue_halls(mt13id,name,seats)")
        .execute()
        .data
    )
    return {row["mt10id"]: row for row in rows}


def resolve_venue(client, kopis: KopisClient, mt10id: str, cache: dict[str, dict]) -> dict | None:
    cached = cache.get(mt10id)
    if cached and cached.get("place_id"):
        refreshed = datetime.fromisoformat(cached["refreshed_at"])
        if now_kst() - refreshed < timedelta(days=VENUE_REFRESH_DAYS):
            return {
                "place_id": cached["place_id"],
                "name": cached["name"],
                "seats": cached.get("seats"),
                "halls": cached.get("venue_halls") or [],
            }

    facility = kopis.facility(mt10id)
    if facility is None:
        return None

    place_id = client.rpc(
        "upsert_kopis_venue",
        {
            "p_mt10id": mt10id,
            "p_name": facility["name"],
            "p_lat": facility["lat"],
            "p_lng": facility["lng"],
            "p_seats": facility["seats"],
            "p_halls": facility["halls"],
            "p_raw": facility["raw"],
        },
    ).execute().data

    venue = {
        "place_id": place_id,
        "name": facility["name"],
        "seats": facility["seats"],
        "halls": facility["halls"],
    }
    cache[mt10id] = {**venue, "mt10id": mt10id, "venue_halls": facility["halls"],
                     "refreshed_at": now_kst().isoformat()}
    return venue


# ---------- 이벤트 ----------

def build_events(perf: dict, venue: dict, window_from: date, window_to: date,
                 now: datetime, min_seats: int) -> tuple[list[dict], str | None]:
    """(이벤트 목록, 건너뛴 사유)."""
    schedule = parse_dtguidance(perf.get("dtguidance"))
    if not schedule:
        return [], "dtguidance 파싱 실패"

    period_from = parse_kopis_date(perf.get("prfpdfrom"))
    period_to = parse_kopis_date(perf.get("prfpdto"))
    if not period_from or not period_to:
        return [], "공연 기간 없음"

    hall = match_hall(perf.get("fcltynm"), venue["halls"])
    if hall:
        seats, hall_name = hall.get("seats"), hall.get("name")
    elif not venue["halls"]:
        seats, hall_name = venue.get("seats"), None
    else:
        return [], "홀을 특정하지 못함"
    if seats is None:
        return [], "좌석 수 없음"
    if seats < min_seats:
        return [], None

    runtime, runtime_defaulted = parse_runtime(perf.get("prfruntime"))
    title = f"{hall_name or venue['name']} 공연 종료"

    events = []
    for start in build_sessions(schedule, period_from, period_to, window_from, window_to):
        end = start + timedelta(minutes=runtime)
        if end < now:
            continue
        events.append(
            {
                "id": f"concert-{perf['mt20id']}-{start:%Y%m%d%H%M}",
                "place_id": venue["place_id"],
                "source_ref": perf["mt20id"],
                "title": title,
                "peak_at": end.isoformat(),
                "ends_at": (end + EXIT_WINDOW).isoformat(),
                "expected_exits": seats,
                "raw": {
                    "prfnm": perf.get("prfnm"),
                    "startsAt": start.isoformat(),
                    "runtimeMinutes": runtime,
                    "runtimeDefaulted": runtime_defaulted,
                    "prfruntime": perf.get("prfruntime"),
                    "dtguidance": perf.get("dtguidance"),
                    "mt10id": perf.get("mt10id"),
                    "mt13id": hall.get("mt13id") if hall else None,
                    "hall": hall_name,
                    "genre": perf.get("genrenm"),
                },
            }
        )
    return events, None


def main() -> None:
    key = require_env("KOPIS_API_KEY")["KOPIS_API_KEY"]
    min_seats = int(os.getenv("KOPIS_MIN_SEATS") or 1000)
    days = int(os.getenv("KOPIS_DAYS") or 7)
    client = get_client()
    kopis = KopisClient(key)

    try:
        with collector_run(client, COLLECTOR) as result:
            now = now_kst()
            window_from = now.date()
            window_to = window_from + timedelta(days=days)

            mt20ids, complete = kopis.list_performances(window_from, window_to)
            log.info("공연목록 %d건 (완전=%s)", len(mt20ids), complete)

            venues_cache = load_cached_venues(client)
            processed: list[str] = []
            events: list[dict] = []
            skipped: dict[str, int] = {}
            failures = 0

            for mt20id in mt20ids:
                try:
                    perf = kopis.performance(mt20id)
                    if not perf or not perf.get("mt10id"):
                        skipped["상세 없음"] = skipped.get("상세 없음", 0) + 1
                        processed.append(mt20id)
                        continue
                    venue = resolve_venue(client, kopis, perf["mt10id"], venues_cache)
                except Exception as exc:
                    failures += 1
                    log.warning("%s 처리 실패: %s", mt20id, type(exc).__name__)
                    continue

                processed.append(mt20id)
                if not venue or not venue.get("place_id"):
                    skipped["시설 좌표 없음"] = skipped.get("시설 좌표 없음", 0) + 1
                    continue

                built, reason = build_events(perf, venue, window_from, window_to, now, min_seats)
                if reason:
                    skipped[reason] = skipped.get(reason, 0) + 1
                events += built

            full_sync = complete and failures == 0
            saved = client.rpc(
                "sync_concert_events",
                {"p_mt20ids": processed, "p_events": events, "p_full_sync": full_sync},
            ).execute().data

            result["row_count"] = saved
            log.info("공연 이벤트 %s개 저장 (full_sync=%s), 건너뜀 %s, 실패 %d건",
                     saved, full_sync, skipped, failures)

            if failures or not complete:
                result["status"] = "partial"
                result["error"] = f"상세 실패 {failures}건, 목록 완전={complete}"
            if mt20ids and failures == len(mt20ids):
                raise RuntimeError("모든 공연 상세 호출 실패")
    finally:
        kopis.close()


if __name__ == "__main__":
    run_main(main)
