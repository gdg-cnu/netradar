"""수집 스크립트의 파싱 규칙 테스트 (네트워크·DB 없이)."""

import json
from datetime import date, datetime

import pytest

from collectors import common
from collectors.airport import extract_items, normalize_key, parse_items
from collectors.citydata import load_seoul_places, parse_response
from collectors.common import KST, floor_10min, to_int
from collectors.weather import (
    extract_items as weather_extract_items,
    latest_fcst_base,
    latest_ncst_base,
    ncst_bases,
    parse_fcst,
    parse_ncst,
    parse_pty,
    parse_rain,
    pick_source,
)
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


# --- 기상청 강수 ---

@pytest.mark.parametrize(
    "value, expected",
    [
        ("강수없음", 0.0), ("1mm 미만", 0.5), ("1.0mm 미만", 0.5), ("2.0mm", 2.0),
        ("30.0~50.0mm", 40.0), ("50.0mm 이상", 50.0), ("0", 0.0), ("1.5", 1.5),
        ("-998.9", None), ("900", None), ("", None), (None, None), ("관측불가", None),
    ],
)
def test_parse_rain(value, expected):
    assert parse_rain(value) == expected


def test_parse_pty():
    assert parse_pty("0") == 0
    assert parse_pty("3") == 3
    assert parse_pty("-999") is None
    assert parse_pty(None) is None


def test_weather_base_times():
    at = lambda h, m: datetime(2026, 11, 24, h, m, tzinfo=KST)
    assert latest_ncst_base(at(14, 50)) == at(14, 0)
    assert latest_ncst_base(at(14, 39)) == at(13, 0)
    # 초단기예보는 실제로 정시 발표다 (2026-11-24 응답 확인)
    assert latest_fcst_base(at(14, 50)) == at(14, 0)
    assert latest_fcst_base(at(14, 29)) == at(13, 0)
    # 자정 직후는 전날 발표
    assert latest_fcst_base(datetime(2026, 11, 24, 0, 10, tzinfo=KST)) == datetime(2026, 11, 23, 23, 0, tzinfo=KST)
    assert ncst_bases(at(14, 50), 3) == [at(14, 0), at(13, 0), at(12, 0)]


def kma_body(items):
    return json.dumps({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
                                    "body": {"dataType": "JSON", "items": {"item": items}}}})


def test_parse_ncst():
    items = weather_extract_items(kma_body([
        {"baseDate": "20261124", "baseTime": "1400", "category": "PTY", "nx": 60, "ny": 127, "obsrValue": "1"},
        {"baseDate": "20261124", "baseTime": "1400", "category": "RN1", "nx": 60, "ny": 127, "obsrValue": "2.5"},
        {"baseDate": "20261124", "baseTime": "1400", "category": "T1H", "nx": 60, "ny": 127, "obsrValue": "8.1"},
    ]))
    rows = parse_ncst(items, 60, 127)
    assert len(rows) == 1
    row = rows[0]
    assert row["kind"] == "obs"
    assert row["target_at"] == row["base_at"] == "2026-11-24T14:00:00+09:00"
    assert (row["rain_mm"], row["rain_text"], row["pty"]) == (2.5, "2.5", 1)
    assert row["raw"] == {"PTY": "1", "RN1": "2.5"}


def test_parse_fcst_groups_by_target():
    def item(cat, time, value):
        return {"baseDate": "20261124", "baseTime": "1430", "category": cat,
                "fcstDate": "20261124", "fcstTime": time, "fcstValue": value, "nx": 60, "ny": 127}

    items = [item("RN1", "1500", "강수없음"), item("PTY", "1500", "0"),
             item("RN1", "1600", "1mm 미만"), item("PTY", "1600", "1"), item("SKY", "1600", "4")]
    rows = parse_fcst(items, 60, 127)
    assert [r["target_at"] for r in rows] == ["2026-11-24T15:00:00+09:00", "2026-11-24T16:00:00+09:00"]
    assert all(r["base_at"] == "2026-11-24T14:30:00+09:00" and r["kind"] == "fcst" for r in rows)
    assert [(r["rain_mm"], r["pty"]) for r in rows] == [(0.0, 0), (0.5, 1)]


def test_weather_api_errors():
    with pytest.raises(RuntimeError, match="SERVICE_KEY_IS_NOT_REGISTERED_ERROR"):
        weather_extract_items(
            "<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR"
            "</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>"
        )
    body = json.dumps({"response": {"header": {"resultCode": "03", "resultMsg": "NO_DATA"}}})
    with pytest.raises(RuntimeError, match="03 NO_DATA"):
        weather_extract_items(body)
    # 미등록 키는 HTTP 403과 함께 JSON 게이트웨이 오류로 온다 (2026-11-24 실제 응답)
    gateway = json.dumps({"OpenAPI_ServiceResponse": {"cmmMsgHeader": {
        "errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "returnAuthMsg": "등록되지 않은 서비스키",
        "returnReasonCode": "30"}}})
    with pytest.raises(RuntimeError, match="SERVICE_KEY_IS_NOT_REGISTERED_ERROR"):
        weather_extract_items(gateway)
    # API허브 인증 오류 (2026-11-24 실제 응답)
    hub = json.dumps({"result": {"status": 401, "message": "유효한 인증키가 아닙니다."}})
    with pytest.raises(RuntimeError, match="401 유효한 인증키가 아닙니다"):
        weather_extract_items(hub)


def test_weather_pick_source(monkeypatch):
    monkeypatch.setenv("KMA_API_KEY", "hubkey")
    monkeypatch.setenv("DATA_GO_KR_KEY", "portal%2Bkey")
    source = pick_source()
    assert (source.key_param, source.key) == ("authKey", "hubkey")
    assert source.base_url.startswith("https://apihub.kma.go.kr/")

    monkeypatch.delenv("KMA_API_KEY")
    source = pick_source()
    assert (source.key_param, source.key) == ("serviceKey", "portal+key")
    assert source.base_url.startswith("https://apis.data.go.kr/")

    monkeypatch.delenv("DATA_GO_KR_KEY")
    with pytest.raises(common.MissingConfig):
        pick_source()
