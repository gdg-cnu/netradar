import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { FreshnessStatus } from '../../../utils/freshness'
import { demandPoint, rangeColor } from '../../services/demand'
import type { Bounds, DemandMetric, DemandOffset, DemandPlace } from '../../types/demand'

type PlaceLayer = { polygon: L.Polygon; color: string; selected: boolean }

function updateColors(layers: PlaceLayer[], freshness: FreshnessStatus) {
  for (const layer of layers)
    layer.polygon.setStyle({
      fillColor: freshness === 'fresh' ? layer.color : '#6b7280',
      color: layer.selected ? (freshness === 'fresh' ? '#7c3215' : '#374151') : '#fff',
      fillOpacity: layer.selected ? 0.8 : 0.62,
      weight: layer.selected ? 4 : 2,
    })
}

export default function DemandMap({
  places,
  metric,
  offset,
  selectedId,
  freshness,
  onSelect,
  onBoundsChange,
  position,
  focusRequest,
  resetToken,
}: {
  places: DemandPlace[]
  metric: DemandMetric
  offset: DemandOffset
  selectedId?: string
  freshness: FreshnessStatus
  onSelect: (id: string) => void
  onBoundsChange: (bounds: Bounds) => void
  position: { lat: number; lng: number } | null
  focusRequest: { id: string; token: number } | null
  resetToken: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const group = useRef<L.LayerGroup | null>(null)
  const layers = useRef<PlaceLayer[]>([])
  const location = useRef<L.CircleMarker | null>(null)
  const latestFreshness = useRef(freshness)
  const callbacks = useRef({ onSelect, onBoundsChange })
  const [tileState, setTileState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    callbacks.current = { onSelect, onBoundsChange }
  }, [onSelect, onBoundsChange])

  useEffect(() => {
    if (!container.current) return
    const instance = L.map(container.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      minZoom: 8,
      maxZoom: 18,
    }).setView([37.55, 126.97], 11)
    map.current = instance
    group.current = L.layerGroup().addTo(instance)
    L.control.zoom({ position: 'bottomright' }).addTo(instance)
    const reportBounds = () => {
      const bounds = instance.getBounds()
      callbacks.current.onBoundsChange({
        west: bounds.getWest(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
        south: bounds.getSouth(),
      })
    }
    instance.on('moveend', reportBounds)
    let active = true
    let loaded = false
    const timeout = window.setTimeout(() => {
      if (active && !loaded) setTileState('failed')
    }, 7000)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    })
    tiles.on('tileload', () => {
      loaded = true
      if (active) setTileState('ready')
    })
    tiles.on('tileerror', () => {
      if (active && !loaded) setTileState('failed')
    })
    tiles.addTo(instance)
    const observer = new ResizeObserver(() => instance.invalidateSize())
    observer.observe(container.current)
    reportBounds()
    return () => {
      active = false
      window.clearTimeout(timeout)
      observer.disconnect()
      instance.remove()
      map.current = null
      group.current = null
      layers.current = []
      location.current = null
    }
  }, [])

  useEffect(() => {
    latestFreshness.current = freshness
    updateColors(layers.current, freshness)
  }, [freshness])

  useEffect(() => {
    if (!group.current) return
    group.current.clearLayers()
    layers.current = places.map((place) => {
      const point = demandPoint(place, offset)
      const polygon = L.polygon(
        place.polygon.map(([lng, lat]) => [lat, lng] as L.LatLngTuple),
      ).addTo(group.current!)
      const tooltip = document.createElement('span')
      tooltip.textContent = `${place.name} · ${metric === 'surge' ? `수요 지수 ${point.surgeIndex}` : `예상 인구 ${point.population.toLocaleString('ko-KR')}명`} · 목업`
      polygon.bindTooltip(tooltip)
      polygon.on('click', () => callbacks.current.onSelect(place.id))
      return {
        polygon,
        selected: place.id === selectedId,
        color: rangeColor(metric === 'surge' ? point.range : point.populationRange),
      }
    })
    updateColors(layers.current, latestFreshness.current)
  }, [places, metric, offset, selectedId])

  useEffect(() => {
    if (places.length)
      map.current?.fitBounds(
        L.latLngBounds(places.map((place) => [place.lat, place.lng] as L.LatLngTuple)),
        { padding: [35, 45], maxZoom: 12 },
      )
  }, [places, resetToken])

  useEffect(() => {
    const place = places.find((item) => item.id === focusRequest?.id)
    if (place) map.current?.setView([place.lat, place.lng], 14, { animate: false })
  }, [focusRequest, places])

  useEffect(() => {
    if (!map.current) return
    location.current?.remove()
    if (position) {
      location.current = L.circleMarker([position.lat, position.lng], {
        radius: 7,
        color: '#fff',
        weight: 3,
        fillColor: '#2563eb',
        fillOpacity: 1,
      })
        .addTo(map.current)
        .bindTooltip('내 위치')
      map.current.panTo([position.lat, position.lng], { animate: false })
    }
  }, [position])

  return (
    <div className="v2-demand-map-frame">
      <div
        ref={container}
        className={`v2-demand-leaflet ${tileState === 'failed' ? 'is-unavailable' : ''}`}
        role="region"
        aria-label="장소별 수요 지도. 아래 장소 목록에서도 모든 장소를 선택할 수 있습니다."
        aria-describedby="v2-demand-freshness"
      />
      {tileState === 'loading' && (
        <span className="v2-demand-map-loading" role="status">
          배경 지도 불러오는 중…
        </span>
      )}
      {tileState === 'failed' && (
        <div className="v2-demand-map-fallback" role="status">
          <span aria-hidden="true">⌖</span>
          <strong>배경 지도를 불러오지 못했어요</strong>
          <p>아래 장소 목록과 상세 예측은 계속 이용할 수 있어요.</p>
        </div>
      )}
      <div className="v2-demand-map-legend" aria-label="예측 범례">
        <strong>{metric === 'surge' ? '수요 지수' : '예상 인구'} · 목업</strong>
        {freshness === 'fresh' ? (
          <div>
            {(['low', 'moderate', 'high'] as const).map((range, index) => (
              <span key={range}>
                <i style={{ background: rangeColor(range) }} />
                {['낮음', '보통', '높음'][index]}
              </span>
            ))}
          </div>
        ) : (
          <p>
            {freshness === 'stale'
              ? '오래된 예측 · 회색 표시'
              : '생성 시각 확인 불가 · 회색 표시'}
          </p>
        )}
      </div>
    </div>
  )
}
