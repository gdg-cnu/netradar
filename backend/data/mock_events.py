# v2 이벤트 목업
# 실제 수집 데이터가 아닌 예시입니다.
# 고정 시각이면 "오늘 남은 일정" 필터에 걸리지 않으므로 요청 시각 기준으로 생성한다.

from datetime import datetime, timedelta

from services.clock import KST


MOCK_SOURCE = "목업 · 실제 수집 데이터 아님"


def build_mock_events(now: datetime) -> list[dict]:
    now = now.astimezone(KST)
    today = now.date()

    def at_kst(hour: int, minute: int) -> datetime:
        return datetime(
            today.year, today.month, today.day, hour, minute, tzinfo=KST
        )

    events = [
        # 인천공항 승객예고: 1시간 단위 입국 승객 피크
        {
            "placeId": "incheon-t1",
            "type": "airport",
            "title": "T1 입국 1,800명 예상",
            "peakAt": now + timedelta(minutes=30),
            "duration": 60,
            "expectedExits": 1800,
            "source": f"인천공항 승객예고 ({MOCK_SOURCE})",
        },
        # KOPIS: 공연 시작 + 러닝타임으로 계산한 종료 시각
        {
            "placeId": "kspo-dome",
            "type": "concert",
            "title": "KSPO DOME 공연 종료",
            "peakAt": now + timedelta(minutes=45),
            "duration": 30,
            "expectedExits": 12000,
            "source": f"KOPIS ({MOCK_SOURCE})",
        },
        # 막차: last_trains 표에서 생성하는 이벤트
        {
            "placeId": "hongdae",
            "type": "last_train",
            "title": "2호선 막차 출발",
            "peakAt": at_kst(23, 35),
            "duration": 30,
            "expectedExits": None,
            "source": f"서울교통공사 막차 시각 ({MOCK_SOURCE})",
        },
        {
            "placeId": "jamsil",
            "type": "last_train",
            "title": "2호선 막차 출발",
            "peakAt": at_kst(23, 40),
            "duration": 30,
            "expectedExits": None,
            "source": f"서울교통공사 막차 시각 ({MOCK_SOURCE})",
        },
        {
            "placeId": "gangnam",
            "type": "last_train",
            "title": "2호선 막차 출발",
            "peakAt": at_kst(23, 45),
            "duration": 30,
            "expectedExits": None,
            "source": f"서울교통공사 막차 시각 ({MOCK_SOURCE})",
        },
    ]

    return [
        {
            "id": f"{event['peakAt'].astimezone(KST).date()}-{event['placeId']}-{event['type']}",
            "placeId": event["placeId"],
            "type": event["type"],
            "title": event["title"],
            "peakAt": event["peakAt"],
            "endsAt": event["peakAt"] + timedelta(minutes=event["duration"]),
            "expectedExits": event["expectedExits"],
            "source": event["source"],
        }
        for event in events
    ]
