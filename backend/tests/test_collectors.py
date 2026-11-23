"""수집 스크립트의 파싱 규칙 테스트 (네트워크·DB 없이)."""

import json
from datetime import date, datetime

import pytest

from collectors import common
from collectors.airport import extract_items, normalize_key, parse_items
from collectors.citydata import load_seoul_places, parse_response
from collectors.common import KST, floor_10min, to_int
from collectors.kopis import (
    build_events,
    build_sessions,
    match_hall,
    parse_dtguidance,
    parse_runtime,
)


# --- 공통 ---

@pytest.mark.parametrize(
    "value, expected",
    [("40000", 40000), ("15,000", 15000), (1800, 1800), ("", None), (None, None), ("-", None), ("12.0", 12)],
)
def test_to_int(value, expected):
    assert to_int(value) == expected


def test_floor_10min():
    moment = datetime(2026, 11, 20, 18, 37, 12, tzinfo=KST)
    assert floor_10min(moment) == datetime(2026, 11, 20, 18, 30, tzinfo=KST)


def test_redact_hides_plain_and_url_encoded_secret(monkeypatch):
    monkeypatch.setattr(common, "_SECRETS", {"ab+c/d=="})
    text = "key=ab+c/d== url=ab%2Bc%2Fd%3D%3D"
    assert "ab" not in common.redact(text)


# --- 서울 실시간 도시데이터 ---

def citydata_body(area_cd="POI009", code="INFO-000"):
    return json.dumps(
        {
            "SeoulRtd.citydata_ppltn": [
                {
                    "AREA_NM": "광화문·덕수궁",
                    "AREA_CD": area_cd,
                    "AREA_CONGEST_LVL": "약간 붐빔",
                    "AREA_PPLTN_MIN": "40000",
                    "AREA_PPLTN_MAX": "42000",
                    "REPLACE_YN": "N",
                    "PPLTN_TIME": "2026-11-20 18:30",
                    "FCST_YN": "Y",
                    "FCST_PPLTN": [
                        {"FCST_TIME": "2026-11-20 20:00", "FCST_CONGEST_LVL": "보통",
                         "FCST_PPLTN_MIN": "34000", "FCST_PPLTN_MAX": "36000"}
                    ],
                }
            ],
            "RESULT": {"RESULT.CODE": code, "RESULT.MESSAGE": "정상 처리되었습니다."},
        },
        ensure_ascii=False,
    )


def test_citydata_parse_ok():
    row, reason = parse_response("POI009", 200, citydata_body(), store_raw=False)
    assert reason is None
    assert row["observed_at"] == "2026-11-20T18:30:00+09:00"
    assert (row["pop_min"], row["pop_max"]) == (40000, 42000)
    assert row["congest_lvl"] == "약간 붐빔"
    assert row["seoul_forecast"] == [
        {"time": "2026-11-20T20:00:00+09:00", "min": 34000, "max": 36000, "congestLvl": "보통"}
    ]
    assert row["raw"] is None


def test_citydata_rejects_other_area_from_sample_key():
    row, reason = parse_response("POI014", 200, citydata_body("POI009"), store_raw=False)
    assert row is None and "불일치" in reason


def test_citydata_xml_error_body():
    body = "<RESULT><CODE>INFO-100</CODE><MESSAGE><![CDATA[인증키가 유효하지 않습니다.]]></MESSAGE></RESULT>"
    row, reason = parse_response("POI009", 200, body, store_raw=False)
    assert row is None and reason == "INFO-100"


def test_seoul_places_file():
    places = load_seoul_places()
    assert len(places) == 121
    ids = {place["id"] for place in places}
    assert {"POI014", "POI055", "POI119", "POI127"} <= ids
    for place in places:
        ring = place["polygon"]
        assert ring[0] == ring[-1] and len(ring) >= 4
        lng, lat = ring[0]
        assert 126.7 < lng < 127.3 and 37.4 < lat < 37.8


# --- 인천공항 ---

def test_airport_items_and_rows():
    body = json.dumps(
        {
            "response": {
                "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
                "body": {
                    "items": [
                        {"adate": "20261120", "atime": "22_23", "t1egsum1": "1,800", "t2egsum1": "900"},
                        {"adate": "20261120", "atime": "합계", "t1egsum1": "30000", "t2egsum1": "20000"},
                    ]
                },
            }
        },
        ensure_ascii=False,
    )
    rows = parse_items(extract_items(body))
    assert [(r["terminal"], r["arrival_date"], r["hour"], r["arrivals"]) for r in rows] == [
        ("T1", "2026-11-20", 22, 1800),
        ("T2", "2026-11-20", 22, 900),
    ]


def test_airport_single_item_dict_shape():
    body = json.dumps({"response": {"header": {"resultCode": "00"},
                                    "body": {"items": {"item": {"adate": "20261121", "atime": "00_01",
                                                                "t1egsum1": "10", "t2egsum1": ""}}}}})
    rows = parse_items(extract_items(body))
    assert rows[0]["hour"] == 0 and rows[1]["arrivals"] is None


def test_airport_xml_error():
    body = "<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>"
    with pytest.raises(RuntimeError, match="SERVICE_KEY_IS_NOT_REGISTERED_ERROR"):
        extract_items(body)


def test_airport_encoded_key_is_decoded():
    assert normalize_key("ab%2Bc%3D%3D") == "ab+c=="
    assert normalize_key("abc+def==") == "abc+def=="


# --- KOPIS ---

@pytest.mark.parametrize(
    "text, expected",
    [("1시간 30분", (90, False)), ("100분", (100, False)), ("2시간", (120, False)),
     ("", (120, True)), (None, (120, True)), ("미정", (120, True))],
)
def test_parse_runtime(text, expected):
    assert parse_runtime(text) == expected


def test_parse_dtguidance():
    schedule = parse_dtguidance(
        "화요일 ~ 금요일(20:00), 토요일(15:00,17:30,20:00), 일요일(15:30,18:00), HOL(14:00)"
    )
    assert schedule[1] == schedule[4] == [(20, 0)]
    assert 0 not in schedule  # 월요일 공연 없음
    assert schedule[5] == [(15, 0), (17, 30), (20, 0)]
    assert schedule[6] == [(15, 30), (18, 0)]


def test_parse_dtguidance_wrapping_range_and_failure():
    assert set(parse_dtguidance("금요일 ~ 월요일(19:00)")) == {4, 5, 6, 0}
    assert parse_dtguidance("공연 시간 추후 공지") == {}


def test_build_sessions_respects_period_and_window():
    schedule = {5: [(19, 0)]}  # 토요일
    sessions = build_sessions(schedule, date(2026, 11, 1), date(2026, 11, 28),
                              date(2026, 11, 20), date(2026, 11, 27))
    assert sessions == [datetime(2026, 11, 21, 19, 0, tzinfo=KST)]


def test_match_hall():
    halls = [{"mt13id": "FC1-01", "name": "KSPO DOME(올림픽체조경기장)", "seats": 15000},
             {"mt13id": "FC1-02", "name": "올림픽홀", "seats": 3000}]
    assert match_hall("올림픽공원 (KSPO DOME(올림픽체조경기장))", halls)["mt13id"] == "FC1-01"
    assert match_hall("올림픽공원 (올림픽홀)", halls)["mt13id"] == "FC1-02"
    assert match_hall("올림픽공원 (핸드볼경기장)", halls) is None
    assert match_hall("아무 이름", halls[:1])["mt13id"] == "FC1-01"


def test_build_events():
    perf = {"mt20id": "PF1", "prfnm": "콘서트", "prfpdfrom": "2026.11.21", "prfpdto": "2026.11.21",
            "fcltynm": "올림픽공원 (KSPO DOME(올림픽체조경기장))", "mt10id": "FC1",
            "prfruntime": "1시간 50분", "dtguidance": "토요일(19:30)"}
    venue = {"place_id": "POI127", "name": "올림픽공원", "seats": 30000,
             "halls": [{"mt13id": "FC1-01", "name": "KSPO DOME(올림픽체조경기장)", "seats": 15000}]}
    now = datetime(2026, 11, 20, 6, 0, tzinfo=KST)
    events, reason = build_events(perf, venue, date(2026, 11, 20), date(2026, 11, 27), now, 1000)
    assert reason is None
    assert events == [
        {
            "id": "concert-PF1-202611211930",
            "place_id": "POI127",
            "source_ref": "PF1",
            "title": "KSPO DOME(올림픽체조경기장) 공연 종료",
            "peak_at": "2026-11-21T21:20:00+09:00",
            "ends_at": "2026-11-21T21:50:00+09:00",
            "expected_exits": 15000,
            "raw": events[0]["raw"],
        }
    ]

    small = {**venue, "halls": [{"mt13id": "FC1-01", "name": "KSPO DOME(올림픽체조경기장)", "seats": 300}]}
    assert build_events(perf, small, date(2026, 11, 20), date(2026, 11, 27), now, 1000) == ([], None)
