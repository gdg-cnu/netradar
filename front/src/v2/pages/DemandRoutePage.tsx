import { useEffect, useRef, useState } from 'react'
import { useRoute } from '../../hooks/useRoute'
import { useLocation } from '../../hooks/useLocation'
import { getStorageScope } from '../../utils/storage'
import { navigateTo } from '../../utils/navigation'
import { createDemandSnapshot } from '../services/demand'
import {
  createDemandPlan,
  DEMAND_DRIVE_EVENT,
  DETOUR_MOCK_NOTE,
  placeOrigin,
  readDemandDraft,
  readDemandDrive,
  saveDemandDraft,
  startDemandDrive,
} from '../services/drive'
import type { DemandDetour, DemandOrigin, DemandRouteDraft } from '../types/drive'
import DemandConnection from '../components/route/DemandConnection'
import '../styles/drive.css'

function replaceRouteParams(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString()
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}#/route${query ? `?${query}` : ''}`,
  )
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export default function DemandRoutePage() {
  const [account] = useState(getStorageScope)
  const [snapshot] = useState(createDemandSnapshot)
  const [draft, setDraft] = useState(() => readDemandDraft(account))
  const [drive, setDrive] = useState(() => readDemandDrive(account))
  const [error, setError] = useState('')
  const [requestedAt, setRequestedAt] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const startLock = useRef(false)
  const location = useLocation()
  const { params } = useRoute()
  const target = snapshot.places.find((place) => place.id === draft.targetPlaceId)
  const active = drive && drive.phase !== 'finished'
  const quick = params.quick === '1' || params.view === 'quick'
  const invalidHandoff = Boolean(
    (params.targetPlaceId &&
      !snapshot.places.some((place) => place.id === params.targetPlaceId)) ||
    (params.destination &&
      (!params.lat?.trim() ||
        !params.lng?.trim() ||
        !Number.isFinite(Number(params.lat)) ||
        !Number.isFinite(Number(params.lng)) ||
        Math.abs(Number(params.lat)) > 90 ||
        Math.abs(Number(params.lng)) > 180)),
  )

  function leaveQuickMode() {
    if (quick)
      replaceRouteParams(
        draft.targetPlaceId ? { targetPlaceId: draft.targetPlaceId } : {},
      )
  }

  function update(next: DemandRouteDraft) {
    try {
      saveDemandDraft(next, account)
      setDraft(next)
      setError('')
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '선택을 저장하지 못했어요.')
      return false
    }
  }
  useEffect(() => {
    const refresh = () => setDrive(readDemandDrive(account))
    window.addEventListener(DEMAND_DRIVE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(DEMAND_DRIVE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [account])
  useEffect(() => {
    const stored = readDemandDraft(account)
    if (params.targetPlaceId) {
      if (!snapshot.places.some((place) => place.id === params.targetPlaceId)) {
        setError('지도에서 선택한 장소를 찾지 못했어요. 아래에서 다시 선택해 주세요.')
        return
      }
      if (params.quick === '1' || stored.targetPlaceId !== params.targetPlaceId) {
        const next: DemandRouteDraft = {
          ...stored,
          targetPlaceId: params.targetPlaceId,
          plan: null,
          ...(params.quick === '1'
            ? { destination: null, destinationId: null, detour: 15 as const }
            : {}),
        }
        try {
          saveDemandDraft(next, account)
          setDraft(next)
          setError('')
          // Consume this navigation intent. Reload/back then restores the edited draft.
          if (params.quick === '1')
            replaceRouteParams({ targetPlaceId: params.targetPlaceId, view: 'quick' })
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : '선택을 저장하지 못했어요.')
        }
      }
    } else if (
      params.destination &&
      params.lat !== undefined &&
      params.lng !== undefined
    ) {
      const lat = Number(params.lat),
        lng = Number(params.lng)
      if (
        !params.lat.trim() ||
        !params.lng.trim() ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        setError('전달된 즐겨찾기 좌표를 확인하지 못했어요. 목적지를 다시 선택해 주세요.')
        return
      }
      const destination: DemandOrigin = {
        id: `favorite-${lat}-${lng}`,
        name: params.destination,
        lat,
        lng,
        kind: 'place',
      }
      if (
        stored.destinationId !== destination.id ||
        stored.destination?.name !== destination.name
      ) {
        const next = {
          ...stored,
          destination,
          destinationId: destination.id,
          targetPlaceId: null,
          plan: null,
        }
        try {
          saveDemandDraft(next, account)
          setDraft(next)
          setError('')
          replaceRouteParams({})
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : '선택을 저장하지 못했어요.')
        }
      } else {
        replaceRouteParams({})
      }
    }
  }, [
    account,
    params.targetPlaceId,
    params.quick,
    params.destination,
    params.lat,
    params.lng,
    snapshot,
  ])
  useEffect(() => {
    if (requestedAt === null || location.status === 'loading') return
    if (
      location.position &&
      location.updatedAt !== null &&
      location.updatedAt >= requestedAt
    ) {
      const origin: DemandOrigin = {
        id: 'current-position',
        name: '확인한 현재 위치',
        ...location.position,
        kind: 'current',
      }
      const next = { ...readDemandDraft(account), origin, plan: null }
      try {
        saveDemandDraft(next, account)
        setDraft(next)
        setError('')
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '위치를 저장하지 못했어요.')
      }
      setRequestedAt(null)
    } else if (location.status === 'denied' || location.status === 'unavailable') {
      setRequestedAt(null)
    }
  }, [account, requestedAt, location.status, location.position, location.updatedAt])

  function recommend() {
    if (invalidHandoff) return
    try {
      const plan = createDemandPlan(draft, createDemandSnapshot())
      update({ ...draft, plan })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '추천을 준비하지 못했어요.')
    }
  }
  function start() {
    if (startLock.current || !draft.plan || invalidHandoff) return
    startLock.current = true
    setStarting(true)
    try {
      startDemandDrive(draft.plan, account)
      navigateTo('drive')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '운행을 저장하지 못했어요.')
      startLock.current = false
      setStarting(false)
    }
  }

  return (
    <main className="page-shell v2-motion-page">
      <header className="v2-motion-heading">
        <span className="eyebrow">수요 기반 동선 · V2 목업</span>
        <h1>수요를 따라 다음 장소로</h1>
        <p>도착 시점의 예시 수요 지수로 최대 3곳을 연결합니다.</p>
      </header>
      <p className="v2-motion-note">
        목업 장소·수요·이동 시간을 사용하는 화면입니다. 실제 길 안내나 수익 예측을
        제공하지 않습니다.
      </p>
      {active && (
        <section className="v2-motion-banner">
          <p>진행 중인 목업 운행이 있어요. 새 운행 대신 이어서 진행합니다.</p>
          <button className="v2-secondary" onClick={() => navigateTo('drive')}>
            진행 중인 운행으로
          </button>
        </section>
      )}
      {quick && (
        <p className="v2-motion-banner">
          빠른 출발 준비: 목적지 없이 선택한 한 장소로 이동합니다. 출발지를 확인하고 목업
          운행을 시작해 주세요.
        </p>
      )}
      {invalidHandoff && (
        <section className="v2-motion-banner" role="alert">
          <p>전달된 장소를 확인할 수 없어 이전 동선으로 시작할 수 없습니다.</p>
          <button
            className="v2-secondary"
            onClick={() => {
              if (
                update({
                  ...draft,
                  targetPlaceId: null,
                  destination: null,
                  destinationId: null,
                  plan: null,
                })
              )
                navigateTo('route')
            }}
          >
            전달된 선택 지우기
          </button>
        </section>
      )}
      <div className="v2-motion-grid">
        <section className="panel v2-motion-card" aria-labelledby="v2-route-options">
          <h2 id="v2-route-options">동선 설정</h2>
          <label className="v2-motion-field">
            출발지 직접 선택
            <select
              aria-label="출발지 직접 선택"
              value={draft.origin?.kind === 'place' ? draft.origin.id : ''}
              onChange={(event) => {
                setRequestedAt(null)
                const place = snapshot.places.find(
                  (item) => item.id === event.target.value,
                )
                update({
                  ...draft,
                  origin: place ? placeOrigin(place) : null,
                  plan: null,
                })
              }}
            >
              <option value="">예시 출발지 선택</option>
              {snapshot.places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
          <div className="v2-motion-actions-inline">
            <button
              className="v2-secondary"
              disabled={location.status === 'loading'}
              onClick={() => {
                setRequestedAt(Date.now())
                location.requestLocation()
              }}
            >
              {location.status === 'loading' ? '위치 확인 중…' : '현재 위치 확인'}
            </button>
            {!draft.origin && (
              <button
                className="v2-text-button"
                onClick={() => {
                  const place = snapshot.places.find((item) => item.id === 'gangnam')
                  if (place) update({ ...draft, origin: placeOrigin(place), plan: null })
                }}
              >
                강남역 예시 출발지 사용
              </button>
            )}
          </div>
          <p className="v2-footnote">
            {draft.origin
              ? `선택한 출발지: ${draft.origin.name}`
              : '위치를 허용하지 않아도 예시 출발지를 직접 선택할 수 있어요.'}
          </p>
          {draft.origin?.kind === 'current' && (
            <p className="v2-footnote">
              마지막으로 확인한 좌표 {draft.origin.lat.toFixed(4)},{' '}
              {draft.origin.lng.toFixed(4)}입니다. 이동했다면 위치를 다시 확인해 주세요.
            </p>
          )}
          {location.error && (
            <p className="v2-motion-error" role="alert">
              {location.error}
            </p>
          )}
          <label className="v2-motion-field">
            목적지 (선택)
            <select
              aria-label="목적지 (선택)"
              value={draft.destinationId ?? ''}
              onChange={(event) => {
                const place = snapshot.places.find(
                  (item) => item.id === event.target.value,
                )
                if (
                  update({
                    ...draft,
                    destinationId: place?.id ?? null,
                    destination: place ? placeOrigin(place) : null,
                    plan: null,
                  })
                )
                  leaveQuickMode()
              }}
            >
              <option value="">목적지 없이 수요 따라 이동</option>
              {draft.destination &&
                !snapshot.places.some((place) => place.id === draft.destinationId) && (
                  <option value={draft.destination.id}>
                    {draft.destination.name} (즐겨찾기)
                  </option>
                )}
              {snapshot.places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
          {target && (
            <div className="v2-target-chip">
              <span>
                지도에서 선택: <b>{target.name}</b> · 첫 경유지
              </span>
              <button
                aria-label="선택한 첫 경유지 해제"
                onClick={() => {
                  if (update({ ...draft, targetPlaceId: null, plan: null }))
                    navigateTo('route')
                }}
              >
                해제
              </button>
            </div>
          )}
          <fieldset className="v2-detour">
            <legend>우회 허용 범위 (목업)</legend>
            <div>
              {([15, 30, 50] as DemandDetour[]).map((detour) => (
                <button
                  key={detour}
                  type="button"
                  aria-pressed={draft.detour === detour}
                  onClick={() => {
                    if (update({ ...draft, detour, plan: null })) leaveQuickMode()
                  }}
                >
                  {detour}%
                  <small>최대 {detour === 15 ? 1 : detour === 30 ? 2 : 3}곳</small>
                </button>
              ))}
            </div>
          </fieldset>
          <p className="v2-footnote">{DETOUR_MOCK_NOTE}</p>
          <button
            className="primary-button"
            disabled={invalidHandoff}
            onClick={recommend}
          >
            목업 동선 추천
          </button>
          {error && (
            <p className="v2-motion-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <section className="panel v2-motion-card" aria-label="동선 추천 결과">
          {draft.plan ? (
            <>
              <DemandConnection plan={draft.plan} />
              <p className="v2-footnote">
                도착 시각에서 가장 가까운 0·30·60분 예보를 사용하며, 60분을 넘으면 수요
                지수를 표시하지 않습니다. 목적지는 방향 참고용으로만 보존됩니다.
              </p>
              <button
                className="primary-button"
                disabled={starting || invalidHandoff}
                onClick={start}
              >
                {starting
                  ? '시작 중…'
                  : active
                    ? '진행 중인 운행 이어가기'
                    : '목업 운행 시작'}
              </button>
            </>
          ) : (
            <div className="v2-motion-empty">
              <span aria-hidden="true">↗</span>
              <h2>다음 이동을 준비하세요</h2>
              <p>
                출발지와 우회 범위를 정하면 장소 연결도가 나타납니다. 목적지는 비워 두어도
                됩니다.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
