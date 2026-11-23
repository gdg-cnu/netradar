"""
수집 스크립트 공통 기능: 환경변수, Supabase 클라이언트, 한국 시간, 숫자 변환, 실행 기록.

GitHub Actions에서는 저장소 Secrets가 환경변수로 들어온다.
로컬에서는 backend/.env를 읽는다 (python-dotenv가 설치돼 있을 때).
"""

from __future__ import annotations

import logging
import os
import sys
import traceback
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

KST = timezone(timedelta(hours=9), name="Asia/Seoul")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,
)
# httpx는 요청 URL을 INFO로 찍는다. 서울시 API는 인증키가 URL 경로에 들어가므로 끈다
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# 로그·오류 메시지에서 가릴 비밀값 (require_env가 채운다)
_SECRETS: set[str] = set()

try:  # 로컬 실행용. Actions에서는 Secrets가 환경변수로 들어오므로 없어도 된다
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass


class MissingConfig(RuntimeError):
    pass


def require_env(*names: str) -> dict[str, str]:
    values = {name: os.getenv(name, "").strip() for name in names}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise MissingConfig(
            "환경변수가 없습니다: " + ", ".join(missing)
            + " (GitHub 저장소 Settings → Secrets and variables → Actions에 등록)"
        )
    for name, value in values.items():
        if name != "SUPABASE_URL":
            _SECRETS.add(value)
    return values


def redact(text: str) -> str:
    """비밀값과 그 URL 인코딩 형태를 ***로 가린다. Actions는 원문만 가려주기 때문이다."""
    from urllib.parse import quote, quote_plus, unquote

    for secret in _SECRETS:
        for form in {secret, quote(secret, safe=""), quote_plus(secret), unquote(secret)}:
            if form:
                text = text.replace(form, "***")
    return text


def run_main(main) -> None:
    """수집 스크립트 진입점. 예외는 비밀값을 가린 로그만 남기고 종료 코드 1로 끝낸다."""
    try:
        main()
    except Exception:
        logging.getLogger("collector").error("수집 실패\n%s", redact(traceback.format_exc()))
        sys.exit(1)


def get_client():
    """service role(secret) 키를 쓰는 서버 전용 클라이언트."""
    from supabase import create_client

    env = require_env("SUPABASE_URL", "SUPABASE_SECRET_KEY")
    return create_client(env["SUPABASE_URL"], env["SUPABASE_SECRET_KEY"])


def now_kst() -> datetime:
    return datetime.now(KST)


def floor_10min(moment: datetime) -> datetime:
    moment = moment.astimezone(KST)
    return moment.replace(minute=moment.minute - moment.minute % 10, second=0, microsecond=0)


def parse_kst(text: str | None, fmt: str) -> datetime | None:
    """타임존 없는 한국 시간 문자열 → KST datetime. 실패하면 None."""
    if not text:
        return None
    try:
        return datetime.strptime(text.strip(), fmt).replace(tzinfo=KST)
    except ValueError:
        return None


def to_int(value: Any) -> int | None:
    """'40000', '15,000', 1800 → 정수. 바꿀 수 없으면 None (0으로 채우지 않는다)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


@contextmanager
def collector_run(client, collector: str) -> Iterator[dict]:
    """
    collector_runs에 시작·종료를 남긴다.
    블록 안에서 result['row_count'], result['status']('ok'|'partial'), result['error']를 채운다.
    예외가 나면 'failed'로 남기고 다시 던져서 Actions 실행도 실패로 표시되게 한다.
    """
    log = logging.getLogger(collector)
    result: dict[str, Any] = {"status": "ok", "row_count": None, "error": None}
    run_id = None

    try:
        response = client.table("collector_runs").insert({"collector": collector}).execute()
        run_id = response.data[0]["id"] if response.data else None
    except Exception:  # 기록 실패가 수집을 막지 않게 한다
        log.warning("collector_runs 시작 기록 실패\n%s", traceback.format_exc())

    try:
        yield result
    except Exception as exc:
        result["status"] = "failed"
        result["error"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        if result["error"]:
            result["error"] = redact(str(result["error"]))[:2000]
        log.info("결과: status=%s rows=%s error=%s", result["status"], result["row_count"], result["error"])
        if run_id is not None:
            try:
                client.table("collector_runs").update(
                    {
                        "finished_at": now_kst().isoformat(),
                        "status": result["status"],
                        "row_count": result["row_count"],
                        "error": result["error"],
                    }
                ).eq("id", run_id).execute()
            except Exception:
                log.warning("collector_runs 종료 기록 실패\n%s", traceback.format_exc())
