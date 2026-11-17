import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import { cellToBoundary } from 'h3-js'
import 'leaflet/dist/leaflet.css'
import { assetUrl } from '../../utils/assets'
import { forecastSourceLabel, formatWon } from '../../services/forecast'
import type { ForecastMetric, RankedForecastZone } from '../../types/forecast'
import type { FreshnessStatus } from '../../utils/freshness'

interface ForecastMapProps {
  zones: RankedForecastZone[]
  metric: ForecastMetric
  freshness: FreshnessStatus
  selectedId?: string
  onSelect: (id: string) => void
  position: {
    lat: number
    lng: number
  } | null
}

interface ForecastLayer {
  polygon: L.Polygon
  rank: number
  selected: boolean
  tooltip: HTMLSpanElement
  tooltipText: string
  popupWarning?: HTMLElement
}

export function forecastColor(rank: number, count: number): string {
  const colors = ['#e04412', '#ef6b32', '#f49350', '#f9b879', '#fcd6a7']
  return colors[
    Math.min(
      colors.length - 1,
      Math.floor(((rank - 1) / Math.max(count, 1)) * colors.length),
    )
  ]
}

function updateLayerFreshness(layers: ForecastLayer[], freshness: FreshnessStatus) {
  for (const layer of layers) {
    layer.polygon.setStyle({
      color: layer.selected ? (freshness === 'fresh' ? '#6b250c' : '#374151') : '#ffffff',
      weight: layer.selected ? 4 : 2,
      fillColor:
        freshness === 'fresh' ? forecastColor(layer.rank, layers.length) : '#6b7280',
      fillOpacity: layer.selected ? 0.78 : 0.62,
    })
    layer.tooltip.textContent = `${layer.tooltipText}${
      freshness === 'stale'
        ? ' · 오래된 예측'
        : freshness === 'unknown'
          ? ' · 생성 시각 확인 불가'
          : ''
    }`
    layer.polygon.getTooltip()?.update()
    if (layer.popupWarning) {
      layer.popupWarning.hidden = freshness === 'fresh'
      layer.popupWarning.textContent =
        freshness === 'stale'
          ? '생성 후 20분 이상 지난 예측입니다.'
          : freshness === 'unknown'
            ? '예측 생성 시각을 확인할 수 없습니다.'
            : ''
      // Recalculate an open popup's size without reopening a dismissed popup.
      layer.polygon.getPopup()?.update()
    }
  }
}

export default function ForecastMap({
  zones,
  metric,
  selectedId,
  onSelect,
  position,
  freshness,
}: ForecastMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)
  const forecastLayersRef = useRef<ForecastLayer[]>([])
  const freshnessRef = useRef(freshness)
  const locationLayer = useRef<L.CircleMarker | null>(null)
  const hasFit = useRef(false)
  const onSelectRef = useRef(onSelect)
  const [tileStatus, setTileStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  )

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    if (!container.current) return
    const map = L.map(container.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      minZoom: 10,
      maxZoom: 18,
    }).setView([37.499, 127.036], 13)
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)
    layersRef.current = L.layerGroup().addTo(map)
    let loaded = false
    let alive = true
    const fallbackTimer = window.setTimeout(() => {
      if (alive && !loaded) setTileStatus('unavailable')
    }, 7000)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
    tiles.on('tileload', () => {
      loaded = true
      if (alive) setTileStatus('ready')
    })
    tiles.on('tileerror', () => {
      if (alive && !loaded) setTileStatus('unavailable')
    })
    tiles.addTo(map)
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container.current)
    return () => {
      alive = false
      window.clearTimeout(fallbackTimer)
      observer.disconnect()
      map.remove()
      mapRef.current = null
      layersRef.current = null
      forecastLayersRef.current = []
      locationLayer.current = null
      hasFit.current = false
    }
  }, [])

  useEffect(() => {
    freshnessRef.current = freshness
    // Preserve focused marker DOM and the user's popup state as the data ages.
    updateLayerFreshness(forecastLayersRef.current, freshness)
  }, [freshness])

  useEffect(() => {
    const map = mapRef.current
    const layers = layersRef.current
    if (!map || !layers) return
    layers.clearLayers()
    forecastLayersRef.current = []
    if (!zones.length) return
    if (!hasFit.current) {
      map.fitBounds(
        L.latLngBounds(zones.map((zone) => [zone.lat, zone.lng] as L.LatLngTuple)),
        { padding: [44, 65], maxZoom: 13 },
      )
      hasFit.current = true
    }
    for (const zone of zones) {
      const selected = zone.id === selectedId
      const polygon = L.polygon(cellToBoundary(zone.h3Index)).addTo(layers)
      const tooltip = document.createElement('span')
      const tooltipText = `${zone.name} · ${
        metric === 'hourly'
          ? formatWon(zone.current.netHourly)
          : `${zone.current.passengers}명`
      }`
      const forecastLayer: ForecastLayer = {
        polygon,
        rank: zone.rank,
        selected,
        tooltip,
        tooltipText,
      }
      forecastLayersRef.current.push(forecastLayer)
      polygon.bindTooltip(tooltip, { direction: 'top' })
      polygon.on('click', () => onSelectRef.current(zone.id))
      if (zone.rank === 1) {
        const marker = L.marker([zone.lat, zone.lng], {
          icon: L.divIcon({
            className: 'forecast-top-marker',
            html: '<span>1</span>',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          title: `추천 1위 ${zone.name}`,
          keyboard: true,
        }).addTo(layers)
        marker.getElement()?.setAttribute('aria-label', `추천 1위 ${zone.name}`)
        marker.on('click', () => onSelectRef.current(zone.id))
      }
      if (selected) {
        const popup = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent = `${
          zone.rank === 1 ? '추천 1위 · ' : `${zone.rank}위 · `
        }${zone.name}`
        const value = document.createElement('p')
        value.textContent =
          metric === 'hourly'
            ? `예상 순시급 ${formatWon(zone.current.netHourly)}`
            : `예상 승객 수 ${zone.current.passengers}명/시간`
        const source = document.createElement('small')
        source.textContent = forecastSourceLabel(zone.provenance)
        const warning = document.createElement('small')
        warning.hidden = true
        forecastLayer.popupWarning = warning
        popup.append(title, value, source, warning)
        polygon
          .bindPopup(popup, { autoPan: false, className: 'forecast-popup' })
          .openPopup([zone.lat, zone.lng])
      }
    }
    updateLayerFreshness(forecastLayersRef.current, freshnessRef.current)
  }, [zones, selectedId, metric])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    locationLayer.current?.remove()
    if (position) {
      locationLayer.current = L.circleMarker([position.lat, position.lng], {
        radius: 7,
        color: '#fff',
        weight: 3,
        fillColor: '#2563eb',
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip('내 위치')
      map.panTo([position.lat, position.lng], { animate: false })
    }
  }, [position])

  return (
    <div className="forecast-map-frame">
      <div
        ref={container}
        role="region"
        className={`forecast-leaflet ${
          tileStatus === 'unavailable' ? 'is-unavailable' : ''
        }`}
        aria-label="서울 지역별 예상 수입 지도. 방향키로 이동하고 아래 지역 목록에서 선택할 수 있습니다."
        aria-describedby="forecast-freshness"
      />
      {tileStatus === 'unavailable' && (
        <div className="forecast-map-fallback" role="status">
          <img src={assetUrl('5b961.png')} alt="서울 강남 일대 참고 지도" />
          <p>
            배경 지도를 불러오지 못했어요.
            <br />
            아래 지역 목록에서 예측을 확인해 주세요.
          </p>
        </div>
      )}
      {tileStatus === 'loading' && (
        <span className="forecast-tile-loading" role="status">
          배경 지도 불러오는 중…
        </span>
      )}
      <div
        className="forecast-legend"
        aria-label={
          freshness === 'fresh'
            ? '색이 진할수록 선택한 지표의 예상 값이 높습니다'
            : '회색은 오래되었거나 생성 시각을 확인할 수 없는 예측입니다'
        }
      >
        <span>{metric === 'hourly' ? '예상 순시급' : '예상 승객 수'}</span>
        {freshness === 'fresh' ? (
          <div>
            <small>낮음</small>
            <i />
            <small>높음</small>
          </div>
        ) : (
          <p className="forecast-legend-unavailable">
            {freshness === 'stale'
              ? '오래된 예측 · 회색 표시'
              : '생성 시각 확인 불가 · 회색 표시'}
          </p>
        )}
      </div>
      {tileStatus === 'unavailable' && (
        <a
          className="forecast-fallback-attribution"
          href="https://www.openstreetmap.org/copyright"
        >
          온라인 지도 © OpenStreetMap contributors
        </a>
      )}
    </div>
  )
}
