
import os

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

KAKAO_URL = "https://apis-navi.kakaomobility.com/v1/directions"


async def get_directions(origin, destination, waypoints=None):
    api_key = os.getenv("KAKAO_MOBILITY_REST_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="카카오모빌리티 API 키가 설정되지 않았습니다.",
        )

    params = {
        "origin": f"{origin.lng},{origin.lat}",
        "destination": f"{destination.lng},{destination.lat}",
        "priority": "RECOMMEND",
    }

    if waypoints:
        params["waypoints"] = "|".join(
            f"{point.lng},{point.lat}" for point in waypoints
        )

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(
                KAKAO_URL,
                headers={"Authorization": f"KakaoAK {api_key}"},
                params=params,
            )
            response.raise_for_status()
            data = response.json()

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="경로 탐색 요청 시간이 초과되었습니다.",
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"카카오모빌리티 API 오류: {exc.response.status_code}",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="카카오모빌리티 API 연결에 실패했습니다.",
        )
    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="경로 탐색 응답을 해석할 수 없습니다.",
        )

    routes = data.get("routes", [])
    if not routes or routes[0].get("result_code") != 0:
        raise HTTPException(
            status_code=422,
            detail="해당 출발지와 목적지의 경로를 찾지 못했습니다.",
        )

    route = routes[0]
    summary = route["summary"]

    # 도로를 따라 지도에 표시할 경로 좌표
    coordinates = []

    for section in route.get("sections", []):
        for road in section.get("roads", []):
            vertexes = road.get("vertexes", [])

            for i in range(0, len(vertexes) - 1, 2):
                point = [vertexes[i + 1], vertexes[i]]

                if not coordinates or coordinates[-1] != point:
                    coordinates.append(point)

    return {
        "minutes": round(summary["duration"] / 60, 2),
        "kilometers": round(summary["distance"] / 1000, 3),
        "coordinates": coordinates,
    }
