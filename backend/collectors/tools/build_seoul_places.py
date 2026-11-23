"""
서울시 주요 121장소 영역 Shapefile → collectors/data/seoul_places.json

장소 목록이 갱신됐을 때만 다시 실행한다. 결과 JSON은 저장소에 커밋하고,
collect-citydata가 실행될 때마다 DB의 places와 비교해서 맞춘다.

    pip install pyshp
    python -m collectors.tools.build_seoul_places "<압축 푼 경로>/서울시 주요 121장소 영역.shp"

출처: 서울 열린데이터광장 OA-21778 첨부 '서울시 주요 121장소 영역.zip' (좌표계 WGS84)
"""

import json
import sys
from pathlib import Path

import shapefile  # pyshp

OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "seoul_places.json"


def ring_area(ring: list) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def outer_ring(geometry: dict) -> list:
    """구멍은 버리고 바깥 링 하나만 쓴다. 여러 조각이면 가장 큰 조각."""
    if geometry["type"] == "Polygon":
        return geometry["coordinates"][0]
    if geometry["type"] == "MultiPolygon":
        return max((polygon[0] for polygon in geometry["coordinates"]), key=ring_area)
    raise ValueError(f"지원하지 않는 도형: {geometry['type']}")


def main(shp_path: str) -> None:
    reader = shapefile.Reader(shp_path, encoding="utf-8")
    places = []

    for shape_record in reader.shapeRecords():
        record = shape_record.record.as_dict()
        ring = [
            [round(lng, 6), round(lat, 6)]
            for lng, lat in outer_ring(shape_record.shape.__geo_interface__)
        ]
        if ring[0] != ring[-1]:
            ring.append(ring[0])

        places.append(
            {
                "id": record["AREA_CD"].strip(),
                "name": record["AREA_NM"].strip(),
                "category": record["CATEGORY"].strip(),
                "polygon": ring,
            }
        )

    places.sort(key=lambda place: place["id"])
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(places, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"{len(places)}곳 → {OUT_PATH}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
