# v2 서버 수요 지도 확인

2026-11-19 병합된 백엔드의 공개 조회 API를 v2 화면에서 확인한다. 실제 구현 기준은 `backend/schemas/demand.py`, `backend/routers/demand.py`, `backend/routers/places.py`다. 향후 동선·운행·리플레이의 제안 계약까지 구현됐다고 가정하지 않는다.

## 실행

`front/.env.local`에서 아래 값을 설정하고 프런트 개발 서버를 다시 시작한다.

```dotenv
VITE_API_MODE=demo
VITE_DEMO_VERSION=v2
VITE_V2_DATA_SOURCE=api
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

프런트는 `front/`에서 `npm ci`, `npm run dev`, 백엔드는 README의 가상환경 설정 후 `backend/`에서 `uvicorn main:app --reload --port 8000`으로 켠다. 공개 조회에는 Supabase 키가 필요하지 않다. 이용 안내에 동의하고 **데모로 둘러보기**로 진입한다. 배포 시에는 해당 프런트 주소를 백엔드 CORS에 허용해야 한다.

- `VITE_V2_DATA_SOURCE=local`(기본): 기존 로컬 목업으로 동작한다.
- `VITE_V2_DATA_SOURCE=api`: 수요 지도·장소 상세·이벤트·알림·설정은 서버에서 읽는다. 요청 실패나 잘못된 응답을 로컬 목업 성공으로 바꾸지 않는다.
- `VITE_API_MODE=live`: 기존 v1 인증·프로필·운행 API 흐름을 유지한다. 이 변경은 live 전체를 v2로 전환하지 않는다.

## 연결 범위

| API | 화면 처리 |
| --- | --- |
| `GET /heatmap` | 지표·시점·지도 영역으로 조회, 서버 `range`/`populationRange` 색상과 `[경도, 위도]` 폴리곤 사용 |
| `GET /places/{id}` | 선택 장소의 예보 이유·시점별 추이·이벤트·승차대 조회, 404 및 오류 구분 |
| `GET /events` | 한국 시간 오늘 남은 공항·공연·막차 이벤트, 유형·영역 필터 |
| `GET /alerts/top` | 선택 출발 위치의 최대 3개 알림, 서버가 계산한 권장 출발·도착 시각·도착 지수 표시 |
| `GET /config` | 서버의 지원 시점 확인 |

현재 서버는 `source: mock`이며 화면에도 서버 예시 데이터로 표시한다. 향후 `source: model` 응답도 별도로 표시하지만 출처 필드만으로 실제 모델 성능·운영 검증 완료를 주장하지 않는다. 각 조회 결과의 생성 시각을 따로 평가하며 20분이 지난 예측은 회색으로 표시한다.

서버 장소 타입(`seoul_rtd`, `airport`, `venue`)과 이벤트 타입(`airport`, `concert`, `last_train`)은 구분한다. 인천공항·공연장처럼 인구가 없는 장소의 `population`과 `populationRange`는 `null` 그대로 보존한다. 인구 순위에서는 뒤로 배치하며, "인구 데이터 없음"으로 안내한다. 누락된 시점은 그래프에서 0명으로 채우거나 선으로 연결하지 않는다. 이벤트의 예상 유출 인원도 `null`이면 정보 없음으로 표시한다.

## 아직 연결하지 않은 범위

`/routes/recommend`, v2 운행 이벤트·저장, 사용자 설정 분리, `/replay/*`는 서버 구현과 계약 확정이 남았다. 서버 장소의 동선 추천·바로 출발은 준비 중으로 표시한다. 별도 동선·운행·리플레이 탭은 기존 로컬 목업을 유지하며 서버 장소·서버 기록이라고 표시하지 않는다. 기존 v1·v2 저장 데이터는 변환하거나 삭제하지 않는다.

로그인은 최신 팀 변경의 이메일·비밀번호 방식을 유지한다. 실제 인증 메일·운영 DB·외부 데이터 수집과 예측 검증은 별도다.

## 검증

`front/`에서 `npm run typecheck`, `npm test`, `npm run build`, `npm run format:check`, `npm run test:e2e:v2:server`를 실행한다. 기존 `test:e2e`, `test:e2e:live`, `test:e2e:v2`도 회귀 검증한다. 서버 E2E에는 백엔드 의존성이 설치된 Python이 필요하며 `NETRADAR_TEST_PYTHON`으로 해당 가상환경의 Python 실행 파일을 지정할 수 있다. 상세 테스트 구성은 `front/tests/server-v2/README.md`를 참고한다. 서버 테스트 설정은 외부 서비스 키 없이 공개 조회 경로만 검증하며 실제 계정 생성이나 운영 DB 쓰기를 하지 않는다.

기존 WBS는 구주제 항목이므로 이번 서버 조회 연동을 근거로 v2 전체 완료율을 올리지 않는다.
