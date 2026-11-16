import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { RoutePath, RoutePlan } from '../../types/route'

function tooltip(text: string) {
  const label = document.createElement('span')
  label.textContent = text
  return label
}

export default function RouteComparisonMap({ plan }: { plan: RoutePlan }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const boundsRef = useRef<L.LatLngBounds | null>(null)
  const linesRef = useRef<{ direct?: L.Polyline; recommended?: L.Polyline }>({})
  const [showDirect, setShowDirect] = useState(true)
  const [showRecommended, setShowRecommended] = useState(true)
  const [tileStatus, setTileStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  )
  const [attempt, setAttempt] = useState(0)
  const hasDirect = (plan.directPath?.length ?? 0) >= 2
  const hasRecommended = (plan.recommendedPath?.length ?? 0) >= 2

  useEffect(() => {
    if (!container.current) return
    let alive = true
    let receivedTile = false
    let failedTile = false
    setTileStatus('loading')
    const map = L.map(container.current, {
      scrollWheelZoom: false,
      zoomControl: false,
      minZoom: 2,
      maxZoom: 18,
    })
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
    tiles.on('tileload', () => {
      receivedTile = true
      if (alive && !failedTile) setTileStatus('ready')
    })
    tiles.on('tileerror', () => {
      failedTile = true
      if (alive) setTileStatus('unavailable')
    })
    tiles.addTo(map)
    const timer = window.setTimeout(() => {
      if (alive && !receivedTile) setTileStatus('unavailable')
    }, 7000)

    const direct: RoutePath = plan.directPath ?? []
    const recommended: RoutePath = plan.recommendedPath ?? []
    const lines: typeof linesRef.current = {}
    // Never manufacture a road path by connecting stops when geometry is absent.
    if (direct.length >= 2) {
      lines.direct = L.polyline(direct, {
        color: '#334155',
        weight: 6,
        opacity: 0.85,
        dashArray: '10 9',
        className: 'route-line-direct',
        interactive: false,
      }).addTo(map)
    }
    if (recommended.length >= 2) {
      lines.recommended = L.polyline(recommended, {
        color: '#e95516',
        weight: 4,
        opacity: 0.95,
        className: 'route-line-recommended',
        interactive: false,
      }).addTo(map)
    }
    linesRef.current = lines
    const origin: L.LatLngTuple = [plan.origin.lat, plan.origin.lng]
    const destination: L.LatLngTuple = [plan.destination.lat, plan.destination.lng]
    L.circleMarker(origin, {
      radius: 8,
      color: '#fff',
      weight: 3,
      fillColor: '#2563eb',
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip(tooltip('출발지'), { direction: 'top' })
    L.circleMarker(destination, {
      radius: 8,
      color: '#fff',
      weight: 3,
      fillColor: '#125d34',
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip(tooltip(`도착지: ${plan.destination.name}`), { direction: 'top' })
    for (const [index, stop] of plan.stops.entries()) {
      L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          className: 'route-stop-map-marker',
          html: `<span>${index + 1}</span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        title: `경유지 ${index + 1}: ${stop.name}`,
        keyboard: true,
      })
        .addTo(map)
        .bindTooltip(tooltip(`경유지 ${index + 1}: ${stop.name}`), { direction: 'top' })
    }
    const points: L.LatLngTuple[] = [
      origin,
      destination,
      ...direct,
      ...recommended,
      ...plan.stops.map((stop) => [stop.lat, stop.lng] as L.LatLngTuple),
    ]
    const bounds = L.latLngBounds(points)
    boundsRef.current = bounds
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15, animate: false })
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container.current)
    return () => {
      alive = false
      clearTimeout(timer)
      observer.disconnect()
      map.remove()
      mapRef.current = null
      boundsRef.current = null
      linesRef.current = {}
    }
  }, [plan, attempt])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const { direct, recommended } = linesRef.current
    if (direct) showDirect ? direct.addTo(map) : direct.remove()
    if (recommended) showRecommended ? recommended.addTo(map) : recommended.remove()
  }, [showDirect, showRecommended, plan, attempt])

  return (
    <section className="route-map-panel" aria-labelledby="route-map-title">
      <div className="route-map-heading">
        <h2 id="route-map-title">경로 비교 지도</h2>
        <button
          type="button"
          className="nr-text-button"
          onClick={() => {
            if (boundsRef.current)
              mapRef.current?.fitBounds(boundsRef.current, {
                padding: [28, 28],
                maxZoom: 15,
                animate: false,
              })
          }}
        >
          전체 경로 보기
        </button>
      </div>
      <div className="route-map-legend" role="group" aria-label="지도 경로 표시 설정">
        <label>
          <input
            type="checkbox"
            checked={hasDirect && showDirect}
            disabled={!hasDirect}
            onChange={(event) => setShowDirect(event.target.checked)}
          />
          <span className="route-line-key is-direct" aria-hidden="true" />
          직행 경로
        </label>
        <label>
          <input
            type="checkbox"
            checked={hasRecommended && showRecommended}
            disabled={!hasRecommended}
            onChange={(event) => setShowRecommended(event.target.checked)}
          />
          <span className="route-line-key is-recommended" aria-hidden="true" />
          추천 경로
        </label>
      </div>
      <div
        ref={container}
        className="route-leaflet-map"
        role="region"
        aria-label="출발지·경유지·도착지와 직행·추천 경로 지도. 방향키로 이동하고 더하기·빼기로 확대할 수 있습니다."
      />
      <div className="route-map-status" aria-live="polite">
        {tileStatus === 'loading' && <p>배경 지도를 불러오는 중이에요.</p>}
        {tileStatus === 'unavailable' && (
          <div>
            <p>
              배경 지도의 일부 또는 전체를 불러오지 못했어요. 제공된 경로선과 위치는
              표시되며, 아래 시간·거리·수익 비교와 경유지 목록은 계속 사용할 수 있어요.
            </p>
            <button
              type="button"
              className="nr-text-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              배경 지도 다시 시도
            </button>
          </div>
        )}
      </div>
      <p className="route-map-note">
        {!hasDirect && !hasRecommended
          ? '도로 경로 좌표가 없어 출발지·경유지·도착지 위치만 표시합니다. 표시된 지점 사이를 잇는 도로 경로는 제공되지 않았어요.'
          : !hasDirect || !hasRecommended
            ? `${!hasDirect ? '직행' : '추천'} 경로 좌표가 없어 해당 경로선은 표시하지 않습니다. 나머지 경로선은 서버가 전달한 좌표입니다.`
            : '점선은 직행, 주황색 실선은 추천 경로입니다. 서버가 전달한 경로 좌표만 표시하며 실제 운전 안내를 대신하지 않습니다.'}
      </p>
      <p className="route-map-locations">
        <span>● 출발지 (파랑)</span>
        <span>● 도착지 (초록)</span>
        <span>숫자: 아래 목록의 경유지 순서</span>
      </p>
    </section>
  )
}
