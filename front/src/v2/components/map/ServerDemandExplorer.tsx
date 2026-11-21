import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFreshness } from '../../../hooks/useFreshness'
import { useLocation } from '../../../hooks/useLocation'
import { navigateTo } from '../../../utils/navigation'
import { useSurgeAlertsEnabled } from '../../hooks/useSurgeAlertsEnabled'
import {
  getServerAlerts,
  getServerConfig,
  getServerEvents,
  getServerHeatmap,
  getServerPlaceDetail,
} from '../../services/serverDemand'
import {
  demandPoint,
  eventTypeLabels,
  kstDateKey,
  rangeColor,
} from '../../services/demand'
import type {
  Bounds,
  DemandMetric,
  DemandOffset,
  DemandPlace,
  EventType,
} from '../../types/demand'
import type { ServerHeatmapPlace } from '../../types/serverDemand'
import DemandMap from './DemandMap'
import PlaceDetails from './PlaceDetails'
import EventTimeline from './EventTimeline'
import SurgeAlerts from './SurgeAlerts'
import DemandDataMetadata, { serverSourceLabel } from './DemandDataMetadata'

const viewPlace = (place: ServerHeatmapPlace): DemandPlace => ({
  ...place,
  reasons: [],
  taxiStands: [],
})
const emptyPlaces: DemandPlace[] = []
type Request<T> = ((signal: AbortSignal) => Promise<T>) | null
function useRemote<T>(request: Request<T>) {
  const [state, setState] = useState<{
    request: Request<T>
    data: T | null
    loading: boolean
    error: string
  }>({ request: null, data: null, loading: false, error: '' })
  useEffect(() => {
    if (!request) {
      setState({ request, data: null, loading: false, error: '' })
      return
    }
    const controller = new AbortController()
    setState({ request, data: null, loading: true, error: '' })
    request(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ request, data, loading: false, error: '' })
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            request,
            data: null,
            loading: false,
            error:
              cause instanceof Error ? cause.message : '서버 응답을 불러오지 못했습니다.',
          })
      })
    return () => controller.abort()
  }, [request])
  // Filters and selection may change before their effect runs. Never render the preceding request's data.
  return state.request === request
    ? state
    : { request, data: null, loading: Boolean(request), error: '' }
}
function RequestError({
  error,
  retry,
  name,
}: {
  error: string
  retry: () => void
  name: string
}) {
  return error ? (
    <div className="v2-demand-error" role="alert">
      <p>{error}</p>
      <button aria-label={name} onClick={retry}>
        다시 시도
      </button>
    </div>
  ) : null
}
function roundedBounds(value: Bounds): Bounds {
  return {
    west: +value.west.toFixed(6),
    south: +value.south.toFixed(6),
    east: +value.east.toFixed(6),
    north: +value.north.toFixed(6),
  }
}

export default function ServerDemandExplorer() {
  const [refresh, setRefresh] = useState(0)
  const [configRetry, setConfigRetry] = useState(0)
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [heatRetry, setHeatRetry] = useState(0)
  const [detailRetry, setDetailRetry] = useState(0)
  const [eventsRetry, setEventsRetry] = useState(0)
  const [alertsRetry, setAlertsRetry] = useState(0)
  const [metric, setMetric] = useState<DemandMetric>('surge')
  const [offset, setOffset] = useState<DemandOffset>(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [eventType, setEventType] = useState<EventType | 'all'>('all')
  const [pendingBounds, setPendingBounds] = useState<Bounds | null>(null)
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [boundsOnly, setBoundsOnly] = useState(true)
  const [resetToken, setResetToken] = useState(0)
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number } | null>(
    null,
  )
  const [originId, setOriginId] = useState('')
  const [locationRequestedAt, setLocationRequestedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now)
  const location = useLocation()
  const alertsEnabled = useSurgeAlertsEnabled()
  const day = kstDateKey(now)
  const queryBounds = boundsOnly ? (bounds ?? undefined) : undefined

  const config = useRemote(
    useCallback((signal: AbortSignal) => getServerConfig(signal), [configRetry, refresh]),
  )
  const supportedOffsets = config.data?.offsets ?? []
  const selectedOffset = supportedOffsets.includes(offset)
    ? offset
    : (supportedOffsets[0] ?? 0)
  const catalog = useRemote(
    useMemo(
      () =>
        config.data
          ? (signal: AbortSignal) =>
              getServerHeatmap({
                metric: 'surge',
                offset: config.data!.offsets[0],
                signal,
              })
          : null,
      [config.data, catalogRetry, refresh],
    ),
  )
  const heatmap = useRemote(
    useMemo(
      () =>
        config.data
          ? (signal: AbortSignal) =>
              getServerHeatmap({
                metric,
                offset: selectedOffset,
                bounds: queryBounds,
                signal,
              })
          : null,
      [config.data, metric, selectedOffset, queryBounds, heatRetry, refresh],
    ),
  )
  const detail = useRemote(
    useMemo(
      () =>
        selectedId
          ? (signal: AbortSignal) => getServerPlaceDetail(selectedId, signal)
          : null,
      [selectedId, detailRetry, refresh],
    ),
  )
  const events = useRemote(
    useCallback(
      (signal: AbortSignal) => {
        const requestNow = new Date()
        const from = requestNow.toISOString()
        const to = new Date(
          Date.parse(`${kstDateKey(requestNow)}T00:00:00+09:00`) + 86_400_000,
        ).toISOString()
        return getServerEvents({
          type: eventType === 'all' || eventType === 'train' ? undefined : eventType,
          from,
          to,
          bounds: queryBounds,
          signal,
        })
      },
      [day, eventType, queryBounds, eventsRetry, refresh],
    ),
  )

  const catalogPlaces = useMemo(
    () => catalog.data?.places.map(viewPlace) ?? emptyPlaces,
    [catalog.data],
  )
  const mapPlaces = useMemo(
    () => heatmap.data?.places.map(viewPlace) ?? emptyPlaces,
    [heatmap.data],
  )
  const lookupPlaces = useMemo(() => {
    const all = new Map(catalogPlaces.map((place) => [place.id, place]))
    mapPlaces.forEach((place) => {
      if (!all.has(place.id)) all.set(place.id, place)
    })
    if (detail.data) all.set(detail.data.id, detail.data)
    return [...all.values()]
  }, [catalogPlaces, mapPlaces, detail.data])
  const originPlace = catalogPlaces.find((place) => place.id === originId)
  const currentPosition =
    location.status === 'granted' &&
    location.position &&
    (locationRequestedAt === null ||
      (location.updatedAt !== null && location.updatedAt >= locationRequestedAt))
      ? location.position
      : null
  const origin = originId === 'current' ? currentPosition : originPlace
  const originLabel =
    originId === 'current' ? '확인한 내 위치' : (originPlace?.name ?? '')
  const originLat = origin?.lat
  const originLng = origin?.lng
  const alerts = useRemote(
    useMemo(
      () =>
        alertsEnabled && originLat !== undefined && originLng !== undefined
          ? (signal: AbortSignal) =>
              getServerAlerts({ lat: originLat, lng: originLng, signal })
          : null,
      [alertsEnabled, originLat, originLng, alertsRetry, refresh],
    ),
  )
  const freshness = useFreshness(heatmap.data?.generatedAt)
  const visiblePlaces = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ko-KR').replace(/\s/g, '')
    return mapPlaces.filter((place) =>
      `${place.name}${eventTypeLabels[place.type]}`
        .toLocaleLowerCase('ko-KR')
        .replace(/\s/g, '')
        .includes(term),
    )
  }, [mapPlaces, query])
  const visibleEvents =
    events.data?.events.filter((event) => Date.parse(event.endsAt) >= now) ?? []
  const visibleAlerts =
    alerts.data?.alerts.filter((alert) => Date.parse(alert.peakEnd) >= now) ?? []
  const selectPlace = useCallback((id: string) => {
    setSelectedId(id)
    setFocusRequest((previous) => ({ id, token: (previous?.token ?? 0) + 1 }))
  }, [])
  const onBoundsChange = useCallback((value: Bounds) => {
    const next = roundedBounds(value)
    setPendingBounds((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    )
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => setBounds(pendingBounds), 300)
    return () => window.clearTimeout(timer)
  }, [pendingBounds])
  useEffect(() => {
    if (!selectedId && heatmap.data?.places.length)
      setSelectedId(heatmap.data.places[0].id)
  }, [selectedId, heatmap.data])
  useEffect(() => {
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, 60_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  function requestLocation() {
    setLocationRequestedAt(Date.now())
    setOriginId('current')
    location.requestLocation()
  }
  function showAll() {
    setBoundsOnly(false)
    setQuery('')
    setFocusRequest(null)
    setResetToken((value) => value + 1)
  }

  return (
    <main className="v2-demand-page v2-server-demand-page" data-data-source="server">
      <header className="v2-demand-page-heading">
        <div>
          <span className="v2-demand-eyebrow">NETRADAR / DEMAND MAP</span>
          <h1>어디로 향하면 좋을까요?</h1>
          <p>서버에서 제공한 수요·인구·이벤트를 살펴보세요.</p>
        </div>
        <span className="v2-demand-chip">서버 수요 지도</span>
      </header>
      <p className="v2-demand-mock-notice">
        지도·장소 상세·이벤트·알림의 출처와 생성 시각을 각각 확인해 주세요. 서버 예시
        데이터는 실제 수요 관측값이 아닙니다.
      </p>
      <div className="v2-demand-freshness-row">
        <span className="v2-demand-caption">
          서버 동선 연동 준비 중 · 상단 동선/운행 메뉴는 별도의 로컬 시연입니다.
        </span>
        <button
          className="v2-demand-secondary"
          onClick={() => setRefresh((value) => value + 1)}
          aria-label="예측 새로고침"
        >
          예측 새로고침
        </button>
      </div>
      <section
        className="v2-server-config"
        data-api-section="config"
        aria-label="서버 지도 설정"
      >
        {config.loading && <p role="status">지원 시점을 확인하는 중이에요…</p>}
        <RequestError
          error={config.error}
          retry={() => setConfigRetry((value) => value + 1)}
          name="설정 다시 시도"
        />
        {config.data && (
          <p className="v2-demand-caption">
            서버 지원 예측 시점:{' '}
            {supportedOffsets.map((item) => (item ? `+${item}분` : '지금')).join(' · ')}
          </p>
        )}
      </section>
      {alertsEnabled ? (
        <>
          <div className="v2-server-origin-row">
            <label className="v2-demand-origin">
              알림 출발 위치
              <select
                aria-label="알림 출발 위치"
                value={originId}
                onChange={(event) => {
                  setLocationRequestedAt(null)
                  setOriginId(event.target.value)
                }}
              >
                <option value="">출발 위치를 선택해 주세요</option>
                <option value="current" disabled={!location.position}>
                  확인한 내 위치{!location.position ? ' (권한 필요)' : ''}
                </option>
                {catalogPlaces.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="v2-demand-secondary"
              disabled={location.status === 'loading'}
              onClick={requestLocation}
            >
              {location.status === 'loading' ? '위치 확인 중…' : '내 위치'}
            </button>
          </div>
          <RequestError
            error={catalog.error}
            retry={() => setCatalogRetry((value) => value + 1)}
            name="전체 장소 다시 시도"
          />
          {catalog.loading && (
            <p className="v2-demand-caption" role="status">
              출발지용 전체 장소 목록을 불러오는 중이에요…
            </p>
          )}
          {alerts.data ? (
            <SurgeAlerts
              alerts={visibleAlerts}
              places={lookupPlaces}
              onSelect={selectPlace}
              originLabel={originLabel}
              metadata={alerts.data}
              routeDisabled
            />
          ) : (
            <section
              className="v2-alert-section"
              data-api-section="alerts"
              data-freshness="unknown"
              aria-label="급증 알림"
            >
              <h2>지금 주목할 급증 알림</h2>
              {alerts.loading ? (
                <p role="status">급증 알림을 불러오는 중이에요…</p>
              ) : alerts.error ? (
                <RequestError
                  error={alerts.error}
                  retry={() => setAlertsRetry((value) => value + 1)}
                  name="급증 알림 다시 시도"
                />
              ) : (
                <p className="v2-demand-empty">
                  알림을 조회하려면 출발 위치를 선택해 주세요. 위치 권한 없이도 서버
                  장소를 직접 선택할 수 있어요.
                </p>
              )}
            </section>
          )}
        </>
      ) : (
        <div className="v2-demand-empty">
          <p>급증 알림이 꺼져 있습니다. 마이페이지에서 켤 수 있어요.</p>
          <button onClick={() => navigateTo('mypage')}>마이페이지로 이동</button>
        </div>
      )}
      <div className="v2-demand-layout">
        <div className="v2-demand-explorer">
          <section data-api-section="heatmap" data-freshness={freshness}>
            <div className="v2-demand-map-panel" aria-label="수요 지도 탐색">
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
                    {supportedOffsets.map((value) => (
                      <button
                        key={value}
                        aria-pressed={selectedOffset === value}
                        onClick={() => setOffset(value)}
                      >
                        {value ? `+${value}분` : '지금'}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="v2-demand-search">
                  <span>장소 검색</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="현재 조회 범위의 장소 이름"
                  />
                </label>
                <p
                  className="v2-demand-caption"
                  role={location.error ? 'status' : undefined}
                >
                  {location.error
                    ? '위치를 확인할 수 없어요. 알림 출발 위치를 직접 선택하거나 지도에서 지역을 살펴보세요.'
                    : location.position
                      ? '마지막으로 확인한 내 위치를 표시합니다. 이동했다면 위치를 다시 확인해 주세요.'
                      : '위치 권한 없이도 장소 검색과 지도 이동으로 지역을 선택할 수 있어요.'}
                </p>
                <div id="v2-demand-freshness">
                  {heatmap.data && (
                    <DemandDataMetadata metadata={heatmap.data} freshness={freshness} />
                  )}
                </div>
                {heatmap.loading && <p role="status">서버 지도를 불러오는 중이에요…</p>}
                <RequestError
                  error={heatmap.error}
                  retry={() => setHeatRetry((value) => value + 1)}
                  name="지도 다시 시도"
                />
              </div>
              <DemandMap
                places={mapPlaces}
                viewportPlaces={
                  catalog.data ? catalogPlaces : !queryBounds ? mapPlaces : emptyPlaces
                }
                focusPlaces={lookupPlaces}
                metric={metric}
                offset={selectedOffset}
                selectedId={selectedId ?? undefined}
                freshness={freshness}
                onSelect={selectPlace}
                onBoundsChange={onBoundsChange}
                position={location.position}
                focusRequest={focusRequest}
                resetToken={resetToken}
                sourceLabel={
                  heatmap.data ? serverSourceLabel(heatmap.data.source) : '서버 응답 대기'
                }
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
                <button onClick={showAll}>전체 장소 보기</button>
              </div>
            </div>
            <section
              className="v2-demand-place-list"
              aria-label="장소별 수요 예측"
              aria-busy={heatmap.loading}
              aria-describedby="v2-demand-freshness"
            >
              <div className="v2-demand-section-heading">
                <h2>장소별 수요 예측</h2>
                <span className="v2-demand-caption">{visiblePlaces.length}개 장소</span>
              </div>
              <p className="v2-demand-caption">
                색상은 서버가 제공한 {metric === 'surge' ? '수요 지수' : '인구'}{' '}
                구간입니다. 지도 안의 장소만 보거나 전체 목록을 살펴보세요.
              </p>
              {heatmap.data &&
                (visiblePlaces.length ? (
                  <ol>
                    {visiblePlaces.map((place) => {
                      const point = demandPoint(place, selectedOffset)
                      const range =
                        metric === 'surge' ? point.range : point.populationRange
                      const missing = metric === 'population' && point.population === null
                      return (
                        <li key={place.id}>
                          <button
                            aria-pressed={selectedId === place.id}
                            aria-controls="v2-place-detail"
                            onClick={() => selectPlace(place.id)}
                            data-missing={missing}
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
                                {range === null
                                  ? '데이터 없음'
                                  : range === 'high'
                                    ? '높음'
                                    : range === 'moderate'
                                      ? '보통'
                                      : '낮음'}
                              </small>
                            </span>
                            <b>
                              {missing ? (
                                '인구 데이터 없음'
                              ) : (
                                <>
                                  {metric === 'surge'
                                    ? point.surgeIndex
                                    : point.population!.toLocaleString('ko-KR')}
                                  <small>{metric === 'surge' ? ' / 100' : '명'}</small>
                                </>
                              )}
                            </b>
                            <span aria-hidden="true">›</span>
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <div className="v2-demand-empty">
                    <p>이 지도 범위와 검색어에 맞는 장소가 없어요.</p>
                    <button onClick={showAll}>검색 초기화 · 전체 장소 보기</button>
                  </div>
                ))}
            </section>
          </section>
          <EventTimeline
            events={visibleEvents}
            places={lookupPlaces}
            type={eventType}
            onTypeChange={setEventType}
            onSelect={selectPlace}
            metadata={events.data ?? undefined}
            server
            loading={events.loading}
            error={events.error}
            onRetry={() => setEventsRetry((value) => value + 1)}
          />
        </div>
        {detail.data ? (
          <PlaceDetails
            place={detail.data}
            metric={metric}
            offset={selectedOffset}
            events={detail.data.events.filter((event) => Date.parse(event.endsAt) >= now)}
            metadata={detail.data}
            routeDisabled
          />
        ) : (
          <aside
            id="v2-place-detail"
            className="v2-place-details"
            aria-label="장소 상세 예측"
            data-api-section="detail"
            data-freshness="unknown"
          >
            <h2>장소 상세 예측</h2>
            {detail.loading ? (
              <p role="status">장소 상세를 불러오는 중이에요…</p>
            ) : detail.error ? (
              <RequestError
                error={detail.error}
                retry={() => setDetailRetry((value) => value + 1)}
                name="장소 상세 다시 시도"
              />
            ) : (
              <p className="v2-demand-empty">목록에서 장소를 선택해 주세요.</p>
            )}
          </aside>
        )}
      </div>
    </main>
  )
}
