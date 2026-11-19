from datetime import datetime, timedelta, timezone


KST = timezone(timedelta(hours=9), name="KST")


def get_now() -> datetime:
    """현재 한국 시간. 테스트에서는 FastAPI dependency_overrides로 고정한다."""
    return datetime.now(KST)


def to_iso(value: datetime) -> str:
    """타임존이 포함된 ISO 문자열 (예: 2026-11-19T09:00:00+09:00)."""
    return value.astimezone(KST).isoformat(timespec="seconds")
