# v2 수요 예보 목업 데이터
# 실제 수집 데이터·AI 예측 결과가 아닌 화면·API 확인용 예시입니다.
# 수집하기로 한 데이터(서울 실시간 도시데이터, 인천공항 승객예고, KOPIS, 막차 시각)로
# 실제 채울 수 있는 장소만 넣는다.


def _polygon(lat: float, lng: float) -> list[tuple[float, float]]:
    """장소 중심 주변의 근사 폴리곤. GeoJSON 규약 [경도, 위도], 닫힌 링."""
    return [
        (lng - 0.003, lat - 0.002),
        (lng + 0.002, lat - 0.0025),
        (lng + 0.0035, lat + 0.001),
        (lng + 0.0005, lat + 0.003),
        (lng - 0.0035, lat + 0.001),
        (lng - 0.003, lat - 0.002),
    ]


def _place(
    id: str,
    name: str,
    type: str,
    lat: float,
    lng: float,
    surge: tuple[int, int, int],
    population: tuple[int, int, int] | None,
    reasons: list[str],
    stand: str,
) -> dict:
    return {
        "id": id,
        "name": name,
        # seoul_rtd: 서울 실시간 도시데이터 장소, airport: 공항, venue: 공연장
        "type": type,
        "lat": lat,
        "lng": lng,
        "polygon": _polygon(lat, lng),
        # offset 0/30/60분 수요 지수
        "surge": dict(zip((0, 30, 60), surge)),
        # 실시간 인구가 없는 장소는 None
        "population": (
            dict(zip((0, 30, 60), population))
            if population is not None
            else None
        ),
        "reasons": reasons,
        "taxiStands": [
            {
                "name": stand,
                "description": "위치·운영 여부는 실제 데이터 연결 후 확인이 필요합니다.",
            }
        ],
    }


MOCK_DEMAND_PLACES: dict[str, dict] = {
    place["id"]: place
    for place in [
        _place(
            "incheon-t1",
            "인천공항 T1",
            "airport",
            37.4486,
            126.4512,
            (54, 91, 72),
            None,
            ["T1 입국 1,800명 예상 (예시)"],
            "인천공항 T1 1층 택시 승차장 (예시)",
        ),
        _place(
            "kspo-dome",
            "KSPO DOME",
            "venue",
            37.5193,
            127.1275,
            (36, 63, 95),
            None,
            ["KSPO DOME 공연 종료 예정, 좌석 15,000석 (예시)"],
            "올림픽공원 남문 택시 승차장 (예시)",
        ),
        _place(
            "hongdae",
            "홍대입구역",
            "seoul_rtd",
            37.5572,
            126.9245,
            (48, 76, 88),
            (31000, 34000, 29000),
            ["2호선 막차 이후 체류 인구 이동 가능성 (예시)"],
            "홍대입구역 9번 출구 인근 승차대 (예시)",
        ),
        _place(
            "gangnam",
            "강남역",
            "seoul_rtd",
            37.4979,
            127.0276,
            (62, 79, 74),
            (52000, 55000, 47000),
            ["막차 이후 상업 지역 이탈 집중 가정 (예시)"],
            "강남역 11번 출구 인근 승차대 (예시)",
        ),
        _place(
            "jamsil",
            "잠실역",
            "seoul_rtd",
            37.5133,
            127.1002,
            (41, 58, 66),
            (38000, 40000, 35000),
            ["잠실 일대 주말 체류 인구 이동 가정 (예시)"],
            "잠실역 8번 출구 인근 승차대 (예시)",
        ),
    ]
}
