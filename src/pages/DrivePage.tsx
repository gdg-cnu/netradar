import { useState } from 'react'
import { useDrive } from '../hooks/useDrive'
import { useLocation } from '../hooks/useLocation'
import { demoDropoffLocation } from '../services/routes'
import { navigateTo } from '../utils/navigation'
import type { Place } from '../types/route'
import DriveSummary from '../components/drive/DriveSummary'
import PlaceSearch from '../components/route/PlaceSearch'
import '../styles/route.css'
import '../styles/drive.css'

const phaseLabels = {
  idle: '운행 대기',
  travelling: '경유지로 이동 중',
  waiting: '승객 대기 중',
  onboard: '승객 탑승 중',
  'needs-route': '다음 동선 추천',
  finished: '운행 완료',
}
function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
export default function DrivePage() {
  const drive = useDrive()
  const location = useLocation()
  const { state, pending, error, now } = drive
  const busy = pending || drive.needsRecovery
  const [fare, setFare] = useState('')
  const [fareError, setFareError] = useState('')
  const [dropoffPlace, setDropoffPlace] = useState<Place | null>(null)
  const [showDropoffSearch, setShowDropoffSearch] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [locationRequestedAt, setLocationRequestedAt] = useState<number | null>(null)
  const plan = state.plan
  const stop = plan?.stops[state.stopIndex]
  const demo = plan?.demo ?? false
  const freshDropoffPosition =
    locationRequestedAt !== null &&
    location.updatedAt !== null &&
    location.updatedAt >= Math.max(locationRequestedAt, state.onboardAt ?? 0)
      ? location.position
      : null
  const remaining = Math.max(0, Math.ceil(((state.waitUntil ?? now) - now) / 1000))
  const elapsed = Math.max(0, Math.floor((now - (state.startedAt ?? now)) / 1000))
  async function finish() {
    if (await drive.finish()) setConfirmFinish(false)
  }
  async function dropoff() {
    const parsed = Number(fare)
    if (
      fare.trim() === '' ||
      !Number.isInteger(parsed) ||
      parsed < 0 ||
      parsed > 1_000_000
    ) {
      setFareError('0원부터 1,000,000원 사이의 운송 요금을 입력해 주세요.')
      return
    }
    const point =
      dropoffPlace ??
      (demo && state.location
        ? demoDropoffLocation(state.location)
        : freshDropoffPosition)
    if (!point) {
      setFareError('하차 위치를 확인하거나 장소 검색으로 선택해 주세요.')
      return
    }
    setFareError('')
    if (await drive.dropoff(parsed, point)) {
      setFare('')
      setDropoffPlace(null)
      setShowDropoffSearch(false)
      setLocationRequestedAt(null)
    }
  }
  if (state.phase === 'idle' || !plan || !stop)
    return (
      <main className="page-shell drive-page">
        <section className="drive-empty panel">
          <span className="eyebrow">운행</span>
          <h1>진행 중인 운행이 없어요</h1>
          <p>목적지를 정하고 추천 동선으로 운행을 시작해 주세요.</p>
          <button className="primary-button" onClick={() => navigateTo('route')}>
            동선 추천으로
          </button>
        </section>
      </main>
    )
  if (state.phase === 'finished')
    return (
      <main className="page-shell drive-page">
        <DriveSummary
          state={state}
          onNewRoute={() => {
            drive.reset()
            navigateTo('route')
          }}
          onHistory={() => navigateTo('replay')}
        />
      </main>
    )

  return (
    <main className="page-shell drive-page">
      <header className="drive-heading">
        <div>
          <span className="eyebrow">{demo ? '데모 운행' : '운행 중'}</span>
          <h1>{phaseLabels[state.phase]}</h1>
          <p>
            {plan.destination.name} 방향 · {timeLabel(elapsed)} 경과
          </p>
        </div>
        <span className={`drive-status drive-status-${state.phase}`}>
          {pending ? '저장 중…' : phaseLabels[state.phase]}
        </span>
      </header>
      {demo && (
        <p className="nr-demo-note">
          실제 길 안내가 아닌 시뮬레이션입니다. 아래 데모 이벤트 버튼으로 도착·탑승·하차를
          진행해 보세요.
        </p>
      )}
      {!demo && (
        <p className="drive-safety-note">
          차량을 안전하게 정차한 상태에서 도착·탑승·하차를 기록해 주세요.
        </p>
      )}
      <div className="drive-layout">
        <section className="drive-route-card panel" aria-labelledby="drive-stop-title">
          <span className="drive-stop-caption">
            {state.phase === 'onboard' ? '탑승한 경유지' : '현재 경유지'}
          </span>
          <h2 id="drive-stop-title">{stop.name}</h2>
          <p>{stop.address}</p>
          <dl className="drive-stop-metrics">
            <div>
              <dt>예상 시급</dt>
              <dd>{stop.expectedHourlyRate.toLocaleString('ko-KR')}원</dd>
            </div>
            <div>
              <dt>권장 대기</dt>
              <dd>{stop.waitMinutes}분</dd>
            </div>
          </dl>
          <ol className="drive-timeline">
            {plan.stops.map((item, index) => (
              <li key={item.id} className={index === state.stopIndex ? 'current' : ''}>
                <span>{index + 1}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.address}</small>
                </div>
              </li>
            ))}
            <li>
              <span>도착</span>
              <div>
                <strong>{plan.destination.name}</strong>
                <small>최종 목적지</small>
              </div>
            </li>
          </ol>
          <p className="drive-coordinate-note">
            마지막 확인 위치 {state.location?.lat.toFixed(4)},{' '}
            {state.location?.lng.toFixed(4)}
            <br />
            {demo
              ? '경유지와 위치는 데모 데이터예요.'
              : '실제 도로 길 안내는 제공하지 않습니다.'}
          </p>
        </section>
        <section className="drive-control-card panel" aria-label="운행 상태 변경">
          <p className="drive-live-message" role="status">
            {state.lastMessage}
          </p>
          {state.phase === 'travelling' && (
            <>
              <h2>경유지에 도착하면 알려주세요</h2>
              <p>도착을 기록하면 권장 대기 시간이 시작돼요.</p>
              <div className="drive-actions">
                <button className="primary-button" disabled={busy} onClick={drive.arrive}>
                  {demo ? '데모: 경유지 도착' : '경유지 도착 기록'}
                </button>
                <button
                  className="nr-secondary-button"
                  disabled={busy}
                  onClick={drive.skip}
                >
                  경유지 건너뛰기
                </button>
              </div>
            </>
          )}
          {state.phase === 'waiting' && (
            <>
              <h2>
                {remaining > 0 ? '승객을 기다리고 있어요' : '권장 대기 시간이 지났어요'}
              </h2>
              <div
                className={`drive-timer ${remaining === 0 ? 'expired' : ''}`}
                role="timer"
                aria-label="남은 대기 시간"
              >
                {timeLabel(remaining)}
              </div>
              <p>
                {remaining > 0
                  ? '대기 시간은 화면을 새로고침해도 이어집니다.'
                  : '탑승이 없으면 다른 경유지를 추천받거나 대기를 연장해 주세요.'}
              </p>
              <div className="drive-actions">
                <button className="primary-button" disabled={busy} onClick={drive.pickup}>
                  {demo ? '데모: 승객 탑승' : '승객 탑승 기록'}
                </button>
                <button
                  className="nr-secondary-button"
                  disabled={busy || state.waitExtensions >= 2}
                  onClick={drive.extendWait}
                >
                  2분 더 대기 ({state.waitExtensions}/2)
                </button>
                <button className="nr-text-button" disabled={busy} onClick={drive.skip}>
                  탑승 없음 · 다음 동선 찾기
                </button>
              </div>
            </>
          )}
          {state.phase === 'onboard' && (
            <>
              <h2>승객 하차 후 요금을 기록해 주세요</h2>
              <p>하차한 위치를 기준으로 다음 동선을 추천해요.</p>
              <label className="field drive-fare">
                <span>이번 운송 요금 (원)</span>
                <input
                  aria-label="이번 운송 요금"
                  inputMode="numeric"
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  disabled={busy}
                  value={fare}
                  placeholder={demo ? '예: 14000' : '미터기 운송 요금 입력'}
                  onChange={(event) => setFare(event.target.value)}
                />
              </label>
              {demo ? (
                <p className="drive-coordinate-note">
                  데모에서는 현재 경유지 인근을 하차 위치로 사용해요.
                </p>
              ) : (
                <div className="drive-location">
                  <p>
                    {dropoffPlace
                      ? `하차 위치: ${dropoffPlace.name}`
                      : freshDropoffPosition
                        ? `현재 위치: ${freshDropoffPosition.lat.toFixed(4)}, ${freshDropoffPosition.lng.toFixed(4)}`
                        : '하차 위치를 확인해 주세요.'}
                  </p>
                  <button
                    className="nr-secondary-button"
                    disabled={busy || location.status === 'loading'}
                    onClick={() => {
                      setLocationRequestedAt(Date.now())
                      setDropoffPlace(null)
                      location.requestLocation()
                    }}
                  >
                    {location.status === 'loading' ? '위치 확인 중…' : '현재 위치 확인'}
                  </button>
                  <button
                    className="nr-text-button"
                    disabled={busy}
                    onClick={() => setShowDropoffSearch((v) => !v)}
                  >
                    하차 장소 직접 선택
                  </button>
                  {location.error && <p role="alert">{location.error}</p>}
                </div>
              )}
              {showDropoffSearch && (
                <PlaceSearch
                  label="하차 장소 검색"
                  disabled={busy}
                  onSelect={(place) => {
                    setDropoffPlace(place)
                    setShowDropoffSearch(false)
                  }}
                />
              )}
              {fareError && (
                <p className="nr-route-error" role="alert">
                  {fareError}
                </p>
              )}
              <button className="primary-button" disabled={busy} onClick={dropoff}>
                {demo ? '데모: 하차 기록' : '하차·운송 요금 기록'}
              </button>
              <p className="drive-coordinate-note">
                운행 종료는 승객 하차 후 사용할 수 있어요.
              </p>
            </>
          )}
          {state.phase === 'needs-route' && (
            <>
              <h2>이어서 어디로 이동할까요?</h2>
              <p>
                마지막 확인 위치에서 {plan.destination.name} 방향의 경유지를 새로 찾아요.
              </p>
              <button className="primary-button" disabled={busy} onClick={drive.reroute}>
                {pending ? '새 경유지 찾는 중…' : '현재 위치에서 다시 추천받기'}
              </button>
            </>
          )}
          {error && (
            <div className="nr-route-error" role="alert">
              <p>{error}</p>
              <button className="nr-text-button" disabled={pending} onClick={drive.retry}>
                실패한 요청 다시 시도
              </button>
            </div>
          )}
        </section>
      </div>
      <div className="drive-footer">
        <p>
          방문 {state.visitedStops}곳 · 탑승 {state.passengers}회 · 누적 수입{' '}
          {state.totals.revenue.toLocaleString('ko-KR')}원
        </p>
        <button
          className="nr-text-button"
          disabled={busy || state.phase === 'onboard'}
          onClick={() => setConfirmFinish(true)}
        >
          운행 종료
        </button>
      </div>
      {confirmFinish && (
        <section
          className="drive-confirm panel"
          role="region"
          aria-labelledby="finish-title"
        >
          <h2 id="finish-title">현재 운행을 마칠까요?</h2>
          <p>지금까지의 운행을 저장하고 종료합니다.</p>
          <div className="drive-confirm-actions">
            <button className="primary-button" disabled={busy} onClick={finish}>
              저장하고 운행 종료
            </button>
            <button
              className="nr-secondary-button"
              disabled={busy}
              onClick={() => setConfirmFinish(false)}
            >
              계속 운행
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
