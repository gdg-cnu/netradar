import { useCallback, useEffect, useMemo, useState } from 'react'
import FreshnessBadge from '../../components/common/FreshnessBadge'
import { useFreshness } from '../../hooks/useFreshness'
import { useLocation } from '../../hooks/useLocation'
import { navigateTo } from '../../utils/navigation'
import { useSurgeAlertsEnabled } from '../hooks/useSurgeAlertsEnabled'
import DemandMap from '../components/map/DemandMap'
import EventTimeline from '../components/map/EventTimeline'
import PlaceDetails from '../components/map/PlaceDetails'
import SurgeAlerts from '../components/map/SurgeAlerts'
import {
  createDemandAlerts,
  demandPoint,
  eventTypeLabels,
  filterDemandEvents,
  getDemandSnapshot,
  rangeColor,
} from '../services/demand'
import type {
  Bounds,
  DemandMetric,
  DemandOffset,
  DemandSnapshot,
  EventType,
} from '../types/demand'
import '../styles/map.css'

export default function DemandMapPage() {
  const [snapshot, setSnapshot] = useState<DemandSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [metric, setMetric] = useState<DemandMetric>('surge')
  const [offset, setOffset] = useState<DemandOffset>(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pendingBounds, setPendingBounds] = useState<Bounds | null>(null)
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [boundsOnly, setBoundsOnly] = useState(true)
  const [resetToken, setResetToken] = useState(0)
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number } | null>(
    null,
  )
  const [eventType, setEventType] = useState<EventType | 'all'>('all')
  const [now, setNow] = useState(Date.now)
  const freshness = useFreshness(snapshot?.generatedAt)
  const location = useLocation()
  const surgeAlertsEnabled = useSurgeAlertsEnabled()
  const [originId, setOriginId] = useState('sample')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    getDemandSnapshot({ signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setSnapshot(data)
          setNow(Date.now())
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : '목업 예측을 불러오지 못했습니다.',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [attempt])

  useEffect(() => {
    const timer = window.setTimeout(() => setBounds(pendingBounds), 300)
    return () => window.clearTimeout(timer)
  }, [pendingBounds])

  useEffect(() => {
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, 60_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  const selectPlace = useCallback((id: string) => {
    setSelectedId(id)
    setFocusRequest((previous) => ({ id, token: (previous?.token ?? 0) + 1 }))
  }, [])
  const places = snapshot?.places ?? []
  const selected = places.find((place) => place.id === selectedId) ?? places[0]
  const visiblePlaces = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ko-KR').replace(/\s/g, '')
    return (snapshot?.places ?? [])
      .filter((place) => {
        const matchesQuery = `${place.name}${eventTypeLabels[place.type]}`
          .toLocaleLowerCase('ko-KR')
          .replace(/\s/g, '')
          .includes(term)
        const inBounds =
          !boundsOnly ||
          !bounds ||
          (place.lng >= bounds.west &&
            place.lng <= bounds.east &&
            place.lat >= bounds.south &&
            place.lat <= bounds.north)
        return matchesQuery && inBounds
      })
      .sort((a, b) =>
        metric === 'surge'
          ? demandPoint(b, offset).surgeIndex - demandPoint(a, offset).surgeIndex
          : demandPoint(b, offset).population - demandPoint(a, offset).population,
      )
  }, [snapshot, query, bounds, boundsOnly, metric, offset])
  const events = snapshot ? filterDemandEvents(snapshot, { type: eventType, now }) : []
  const placeEvents = snapshot
    ? filterDemandEvents(snapshot, { now }).filter(
        (event) => event.placeId === selected?.id,
      )
    : []
  const originPlace = places.find((place) => place.id === originId)
  const origin =
    originId === 'current' && location.position ? location.position : originPlace
  const originLabel =
    originId === 'current' && location.position
      ? '내 위치'
      : (originPlace?.name ?? '강남역 (예시)')
  const alerts = snapshot
    ? createDemandAlerts(snapshot, origin ?? undefined)
        .filter((alert) => Date.parse(alert.peakEnd) >= now)
        .slice(0, 3)
    : []

  return (
    <main className="v2-demand-page" data-freshness={freshness}>
      <header className="v2-demand-page-heading">
        <div>
          <span className="v2-demand-eyebrow">NETRADAR / DEMAND MAP</span>
          <h1>어디로 향하면 좋을까요?</h1>
          <p>이벤트와 주변 인구로, 다음 목적지를 미리 살펴보세요.</p>
        </div>
        <span className="v2-demand-chip">V2 화면 목업</span>
      </header>
      <p className="v2-demand-mock-notice">
        모든 수요·인구·이벤트는 시연용 목업입니다. 실제 운행 판단이나 수익을 보장하는
        정보가 아닙니다.
      </p>
      <div className="v2-demand-freshness-row">
        <div id="v2-demand-freshness">
          {snapshot && (
            <FreshnessBadge status={freshness} generatedAt={snapshot.generatedAt} />
          )}
        </div>
        <button
          className="v2-demand-secondary"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
          aria-label="예측 새로고침"
        >
          {loading ? '불러오는 중…' : '예측 새로고침'}
        </button>
      </div>
      {error && (
        <div className="v2-demand-error" role="alert">
          <p>
            {error}
            {snapshot && ' 이전에 불러온 목업을 표시하고 있습니다.'}
          </p>
          <button onClick={() => setAttempt((value) => value + 1)} disabled={loading}>
            다시 시도
          </button>
        </div>
      )}
      {loading && !snapshot && (
        <p className="v2-demand-empty" role="status">
          수요 지도 목업을 불러오는 중이에요…
        </p>
      )}
      {snapshot && (
        <>
          {surgeAlertsEnabled ? (
            <>
              <label className="v2-demand-origin">
                알림 출발 위치
                <select
                  value={originId}
                  onChange={(event) => setOriginId(event.target.value)}
                >
                  <option value="sample">강남역 (예시)</option>
                  <option value="current" disabled={!location.position}>
                    {location.position ? '내 위치' : '내 위치 (권한 필요)'}
                  </option>
                  {places.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              </label>
              <SurgeAlerts
                alerts={alerts}
                places={places}
                onSelect={selectPlace}
                originLabel={originLabel}
              />
            </>
          ) : (
            <div className="v2-demand-empty">
              <p>급증 알림이 꺼져 있습니다. 마이페이지에서 켤 수 있어요.</p>
              <button onClick={() => navigateTo('mypage')}>마이페이지로 이동</button>
            </div>
          )}
          <div className="v2-demand-layout">
            <div className="v2-demand-explorer">
              <section className="v2-demand-map-panel" aria-label="수요 지도 탐색">
                <div className="v2-demand-toolbar">
                  <div className="v2-demand-filter-row">
                    <div
                      className="v2-demand-segmented"
                      role="group"
                      aria-label="예측 지표"
                    >
                      {(['surge', 'population'] as const).map((value) => (
                        <button
                          key={value}
                          aria-pressed={metric === value}
                          onClick={() => setMetric(value)}
                        >
                          {value === 'surge' ? '수요 지수' : '예상 인구'}
                        </button>
                      ))}
                    </div>
                    <div
                      className="v2-demand-segmented"
                      role="group"
                      aria-label="예측 시점"
                    >
                      {([0, 30, 60] as const).map((value) => (
                        <button
                          key={value}
                          aria-pressed={offset === value}
                          onClick={() => setOffset(value)}
                        >
                          {value ? `+${value}분` : '지금'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="v2-demand-search-row">
                    <label className="v2-demand-search">
                      <span>장소 검색</span>
                      <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="공항, 공연장, 역 이름"
                      />
                    </label>
                    <button
                      className="v2-demand-secondary"
                      onClick={() => {
                        setOriginId('current')
                        location.requestLocation()
                      }}
                      disabled={location.status === 'loading'}
                    >
                      {location.status === 'loading' ? '위치 확인 중…' : '내 위치'}
                    </button>
                  </div>
                  <p
                    className="v2-demand-caption"
                    role={location.error ? 'status' : undefined}
                  >
                    {location.error
                      ? '위치를 확인할 수 없어요. 장소 검색이나 지도에서 직접 지역을 선택해 주세요.'
                      : location.position
                        ? '내 위치를 지도에 표시했어요. 알림의 이동 시간은 목업 예시입니다.'
                        : '위치 권한 없이도 장소 검색과 지도 이동으로 지역을 선택할 수 있어요.'}
                  </p>
                </div>
                <DemandMap
                  places={places}
                  metric={metric}
                  offset={offset}
                  selectedId={selected?.id}
                  freshness={freshness}
                  onSelect={selectPlace}
                  onBoundsChange={setPendingBounds}
                  position={location.position}
                  focusRequest={focusRequest}
                  resetToken={resetToken}
                />
                <div className="v2-demand-map-footer">
                  <label>
                    <input
                      type="checkbox"
                      checked={boundsOnly}
                      onChange={(event) => setBoundsOnly(event.target.checked)}
                    />
                    지도 안의 장소만 보기
                  </label>
                  <button
                    onClick={() => {
                      setResetToken((value) => value + 1)
                      setFocusRequest(null)
                      setBoundsOnly(false)
                    }}
                  >
                    전체 장소 보기
                  </button>
                </div>
              </section>
              <section
                className="v2-demand-place-list"
                aria-label="장소별 수요 예측"
                aria-describedby="v2-demand-freshness"
                aria-busy={loading}
              >
                <div className="v2-demand-section-heading">
                  <h2>장소별 수요 예측</h2>
                  <span className="v2-demand-caption">{visiblePlaces.length}개 장소</span>
                </div>
                <p className="v2-demand-caption">
                  색상은 목업 응답의 {metric === 'surge' ? '수요 지수' : '인구'} 구간을
                  나타내요. 지도를 이동하면 목록이 바뀝니다.
                </p>
                {visiblePlaces.length ? (
                  <ol>
                    {visiblePlaces.map((place) => {
                      const point = demandPoint(place, offset)
                      const range =
                        metric === 'surge' ? point.range : point.populationRange
                      return (
                        <li key={place.id}>
                          <button
                            aria-pressed={selected?.id === place.id}
                            aria-controls="v2-place-detail"
                            onClick={() => selectPlace(place.id)}
                          >
                            <span
                              className="v2-demand-range-dot"
                              style={{
                                background:
                                  freshness === 'fresh' ? rangeColor(range) : '#6b7280',
                              }}
                              aria-hidden="true"
                            />
                            <span className="v2-demand-place-name">
                              <strong>{place.name}</strong>
                              <small>
                                {eventTypeLabels[place.type]} ·{' '}
                                {range === 'high'
                                  ? '높음'
                                  : range === 'moderate'
                                    ? '보통'
                                    : '낮음'}
                              </small>
                            </span>
                            <b>
                              {metric === 'surge'
                                ? point.surgeIndex
                                : point.population.toLocaleString('ko-KR')}
                              <small>{metric === 'surge' ? ' / 100' : '명'}</small>
                            </b>
                            <span aria-hidden="true">›</span>
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <div className="v2-demand-empty">
                    <p>
                      {places.length
                        ? '이 지도 범위와 검색어에 맞는 장소가 없어요.'
                        : '표시할 장소 예측이 없어요.'}
                    </p>
                    {places.length > 0 && (
                      <button
                        onClick={() => {
                          setQuery('')
                          setBoundsOnly(false)
                          setResetToken((value) => value + 1)
                          setFocusRequest(null)
                        }}
                      >
                        검색 초기화 · 전체 장소 보기
                      </button>
                    )}
                  </div>
                )}
              </section>
              <EventTimeline
                events={events}
                places={places}
                type={eventType}
                onTypeChange={setEventType}
                onSelect={selectPlace}
              />
            </div>
            {selected ? (
              <PlaceDetails
                place={selected}
                metric={metric}
                offset={offset}
                events={placeEvents}
              />
            ) : (
              <aside className="v2-place-details">
                <h2>장소 상세 예측</h2>
                <p className="v2-demand-empty">목록에서 장소를 선택해 주세요.</p>
              </aside>
            )}
          </div>
        </>
      )}
    </main>
  )
}
