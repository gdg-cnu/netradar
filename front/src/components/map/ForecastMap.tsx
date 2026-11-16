import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import { cellToBoundary } from 'h3-js'
import 'leaflet/dist/leaflet.css'
import { assetUrl } from '../../utils/assets'
import { forecastSourceLabel, formatWon } from '../../services/forecast'
import type { ForecastMetric, RankedForecastZone } from '../../types/forecast'

interface ForecastMapProps {
  zones: RankedForecastZone[]
  metric: ForecastMetric
  selectedId?: string
  onSelect: (id: string) => void
  position: {
    lat: number
    lng: number
  } | null
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

export default function ForecastMap({
  zones,
  metric,
  selectedId,
  onSelect,
  position,
}: ForecastMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)
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
      locationLayer.current = null
      hasFit.current = false
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layers = layersRef.current
    if (!map || !layers) return
    layers.clearLayers()
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
      const polygon = L.polygon(cellToBoundary(zone.h3Index), {
        color: selected ? '#6b250c' : '#ffffff',
        weight: selected ? 4 : 2,
        fillColor: forecastColor(zone.rank, zones.length),
        fillOpacity: selected ? 0.78 : 0.62,
      }).addTo(layers)
      const tooltip = document.createElement('span')
      tooltip.textContent = `${zone.name} · ${
        metric === 'hourly'
          ? formatWon(zone.current.netHourly)
          : `${zone.current.passengers}명`
      }`
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
        popup.append(title, value, source)
        polygon
          .bindPopup(popup, { autoPan: false, className: 'forecast-popup' })
          .openPopup([zone.lat, zone.lng])
      }
    }
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
        aria-label="색이 진할수록 선택한 지표의 예상 값이 높습니다"
      >
        <span>{metric === 'hourly' ? '예상 순시급' : '예상 승객 수'}</span>
        <div>
          <small>낮음</small>
          <i />
          <small>높음</small>
        </div>
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
