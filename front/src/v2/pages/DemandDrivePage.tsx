import { useEffect, useState } from 'react'
import { getStorageScope } from '../../utils/storage'
import { navigateTo } from '../../utils/navigation'
import { createDemandSnapshot } from '../services/demand'
import {
  applyDemandDriveAction,
  createDemandPlan,
  DEMAND_DRIVE_EVENT,
  demandWaitSeconds,
  placeOrigin,
  readDemandDrive,
  readDemandTrips,
} from '../services/drive'
import type { DemandDriveAction, DemandDrivePhase } from '../types/drive'
import DemandConnection from '../components/route/DemandConnection'
import '../styles/drive.css'

const phaseLabels: Record<DemandDrivePhase, string> = {
  travelling: '경유지로 이동 중',
  waiting: '승객 대기 중',
  onboard: '승객 탑승 중',
  next: '다음 이동 준비',
  finished: '목업 운행 완료',
}
function clockLabel(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

export default function DemandDrivePage() {
  const [account] = useState(getStorageScope)
  const [state, setState] = useState(() => readDemandDrive(account))
  const [snapshot] = useState(createDemandSnapshot)
  const [now, setNow] = useState(Date.now)
  const [fare, setFare] = useState('')
  const [dropoffId, setDropoffId] = useState('')
  const [error, setError] = useState('')
  const [confirmFinish, setConfirmFinish] = useState(false)
  useEffect(() => {
    const refresh = () => setState(readDemandDrive(account))
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    window.addEventListener(DEMAND_DRIVE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener(DEMAND_DRIVE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [account])
  function act(action: DemandDriveAction) {
    if (!state) return false
    try {
      const next = applyDemandDriveAction(state.id, state.revision, action, account)
      setState(next)
      setNow(Date.now())
      setError('')
      return true
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '운행 기록을 저장하지 못했어요.',
      )
      return false
    }
  }
  function dropoff() {
    const amount = fare.trim() === '' ? null : Number(fare)
    if (
      amount !== null &&
      (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000)
    ) {
      setError('요금은 0~1,000,000원 사이의 정수로 입력하거나 비워 두세요.')
      return
    }
    const place = snapshot.places.find((item) => item.id === dropoffId)
    if (!place) {
      setError('하차 예시 장소를 선택해 주세요.')
      return
    }
    if (act({ type: 'dropoff', fare: amount, location: placeOrigin(place) })) {
      setFare('')
      setDropoffId('')
    }
  }
  function reroute() {
    if (!state) return
    try {
      const plan = createDemandPlan(
        {
          origin: state.lastLocation,
          destination: state.plan.destination,
          destinationId: state.plan.destinationId,
          detour: state.plan.detour,
          targetPlaceId: null,
        },
        createDemandSnapshot(),
      )
      act({ type: 'reroute', plan })
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '다음 장소를 추천하지 못했어요.',
      )
    }
  }
  if (!state)
    return (
      <main className="page-shell v2-motion-page">
        <section className="panel v2-motion-card v2-motion-empty">
          <span className="eyebrow">V2 목업 운행</span>
          <h1>진행 중인 목업 운행이 없어요</h1>
          <p>출발지를 선택하고 수요 기반 동선을 추천받아 주세요.</p>
          <button className="primary-button" onClick={() => navigateTo('route')}>
            동선 추천으로
          </button>
        </section>
      </main>
    )
  if (state.phase === 'finished') {
    const trip = readDemandTrips(account).find((item) => item.id === state.id)
    const recorded =
      trip?.fareRecordedCount ?? state.visits.filter((visit) => visit.fareRecorded).length
    return (
      <main className="page-shell v2-motion-page">
        <section className="panel v2-motion-card v2-drive-summary">
          <span className="eyebrow">이 브라우저에 저장한 목업 기록</span>
          <h1>목업 운행을 마쳤어요</h1>
          <p>완료 기록은 같은 계정의 리플레이에서 다시 볼 수 있어요.</p>
          <dl className="v2-motion-stats">
            <div>
              <dt>방문한 장소</dt>
              <dd>{state.visits.length}곳</dd>
            </div>
            <div>
              <dt>탑승 기록</dt>
              <dd>{state.passengers}회</dd>
            </div>
            <div>
              <dt>입력한 요금 합계</dt>
              <dd>
                {recorded > 0 ? `${state.fare.toLocaleString('ko-KR')}원` : '미입력'}
              </dd>
            </div>
            <div>
              <dt>운행 시간</dt>
              <dd>
                {trip?.durationMinutes ??
                  Math.round(((state.endedAt ?? now) - state.startedAt) / 60_000)}
                분
              </dd>
            </div>
          </dl>
          <p className="v2-footnote">
            요금 입력 {recorded}/{state.passengers}회 · 사용자가 입력한 목업 요금만
            합산합니다. 수익·비용 예측은 포함하지 않습니다.
          </p>
          <div className="v2-motion-actions">
            <button
              className="primary-button"
              onClick={() => navigateTo('replay', { tripId: state.id })}
            >
              리플레이에서 기록 보기
            </button>
            <button className="v2-secondary" onClick={() => navigateTo('route')}>
              새 동선 만들기
            </button>
          </div>
        </section>
      </main>
    )
  }
  const stop = state.plan.stops[state.stopIndex]
  const remaining = demandWaitSeconds(state, now)
  const recordedCount = state.visits.filter((visit) => visit.fareRecorded).length
  return (
    <main className="page-shell v2-motion-page">
      <header className="v2-motion-heading">
        <span className="eyebrow">운행 시뮬레이션 · V2 목업</span>
        <h1>{phaseLabels[state.phase]}</h1>
        <p>
          {state.plan.destinationName
            ? `${state.plan.destinationName} 방향`
            : '목적지 없이 수요 따라 이동'}{' '}
          · {Math.max(0, Math.floor((now - state.startedAt) / 60_000))}분 경과
        </p>
      </header>
      <p className="v2-motion-note">
        아래 버튼으로 이동·도착·탑승·하차를 모의 기록합니다. 실제 도로 길 안내나 자동 위치
        추적은 제공하지 않습니다.
      </p>
      <div className="v2-motion-grid">
        <section className="panel v2-motion-card">
          <DemandConnection plan={state.plan} currentIndex={state.stopIndex} />
        </section>
        <section
          className="panel v2-motion-card v2-drive-controls"
          aria-label="목업 운행 상태 변경"
        >
          <span className="v2-phase-chip">{phaseLabels[state.phase]}</span>
          <h2>{stop.name}</h2>
          <p className="v2-drive-message" role="status">
            {state.message}
          </p>
          {state.phase === 'travelling' && (
            <>
              <h3>장소에 도착하면 알려주세요</h3>
              <p>목업 도착을 기록하면 3분 대기를 시작합니다.</p>
              <div className="v2-motion-actions">
                <button
                  className="primary-button"
                  onClick={() => act({ type: 'arrive' })}
                >
                  목업: 경유지 도착
                </button>
                <button className="v2-secondary" onClick={() => act({ type: 'skip' })}>
                  이 장소 건너뛰기
                </button>
              </div>
            </>
          )}
          {state.phase === 'waiting' && (
            <>
              <h3>
                {remaining > 0 ? '승객을 기다리고 있어요' : '권장 대기 시간이 지났어요'}
              </h3>
              <div
                className={`v2-wait-timer ${remaining === 0 ? 'is-expired' : ''}`}
                role="timer"
                aria-label="남은 대기 시간"
              >
                {clockLabel(remaining)}
              </div>
              <p>
                남은 시간은 새로고침 후에도 복구됩니다. 시간이 지나도 탑승·이동을 자동
                기록하지 않습니다.
              </p>
              <div className="v2-motion-actions">
                <button
                  className="primary-button"
                  onClick={() => act({ type: 'pickup' })}
                >
                  목업: 승객 탑승
                </button>
                <button
                  className="v2-secondary"
                  disabled={state.waitExtensions >= 2}
                  onClick={() => act({ type: 'extend' })}
                >
                  2분 더 대기 ({state.waitExtensions}/2)
                </button>
                <button className="v2-text-button" onClick={() => act({ type: 'skip' })}>
                  탑승 없음 · 다음 장소
                </button>
              </div>
            </>
          )}
          {state.phase === 'onboard' && (
            <>
              <h3>하차 후 입력할 정보를 확인하세요</h3>
              <label className="v2-motion-field">
                하차 장소 (목업)
                <select
                  aria-label="하차 장소 (목업)"
                  value={dropoffId}
                  onChange={(event) => setDropoffId(event.target.value)}
                >
                  <option value="">예시 하차 장소 선택</option>
                  {snapshot.places.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="v2-motion-field">
                이번 운송 요금 (선택, 원)
                <input
                  aria-label="이번 운송 요금"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="1000000"
                  step="1"
                  value={fare}
                  placeholder="미입력 가능"
                  onChange={(event) => setFare(event.target.value)}
                />
              </label>
              <p className="v2-footnote">
                입력한 요금만 기록합니다. 비워 두면 미입력으로 저장하며 예상 수익으로
                채우지 않습니다.
              </p>
              <button className="primary-button" onClick={dropoff}>
                목업: 하차 기록
              </button>
              <p className="v2-footnote">승객 탑승 중에는 운행을 종료할 수 없습니다.</p>
            </>
          )}
          {state.phase === 'next' && (
            <>
              <h3>계속 수요를 따라 이동할까요?</h3>
              <p>마지막 예시 위치: {state.lastLocation.name}</p>
              <p>하차 장소 또는 마지막 도착 위치에서 새 예시 수요 지수를 확인합니다.</p>
              <div className="v2-motion-actions">
                <button className="primary-button" onClick={reroute}>
                  현재 기록 위치에서 다시 추천
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="v2-motion-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      <footer className="v2-drive-footer">
        <p>
          방문 {state.visits.length}곳 · 탑승 {state.passengers}회 · 입력 요금{' '}
          {recordedCount > 0 ? `${state.fare.toLocaleString('ko-KR')}원` : '미입력'}
        </p>
        <button
          className="v2-secondary"
          disabled={state.phase === 'onboard'}
          onClick={() => setConfirmFinish(true)}
        >
          운행 종료
        </button>
      </footer>
      {confirmFinish && (
        <section
          className="panel v2-motion-card v2-finish-confirm"
          aria-labelledby="v2-finish-title"
        >
          <h2 id="v2-finish-title">목업 운행을 마칠까요?</h2>
          <p>지금까지 기록한 방문·탑승·입력 요금을 저장합니다.</p>
          <div className="v2-motion-actions-inline">
            <button
              className="primary-button"
              disabled={state.phase === 'onboard'}
              onClick={() => {
                if (act({ type: 'finish' })) setConfirmFinish(false)
              }}
            >
              저장하고 운행 종료
            </button>
            <button className="v2-secondary" onClick={() => setConfirmFinish(false)}>
              계속 운행
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
