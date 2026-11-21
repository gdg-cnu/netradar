import { getFreshnessTimestamp } from '../../utils/freshness'
import type {
  ServerAlertsResponse,
  ServerBounds,
  ServerConfig,
  ServerDemandAlert,
  ServerDemandEvent,
  ServerDemandMetric,
  ServerDemandOffset,
  ServerDemandPoint,
  ServerEventsResponse,
  ServerEventType,
  ServerHeatmapPlace,
  ServerHeatmapResponse,
  ServerPlaceDetail,
} from '../types/serverDemand'

export const SERVER_DEMAND_TIMEOUT_MS = 12_000
export type ServerDemandErrorKind =
  'configuration' | 'request' | 'http' | 'network' | 'timeout' | 'response'

export class ServerDemandError extends Error {
  constructor(
    message: string,
    readonly kind: ServerDemandErrorKind,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'ServerDemandError'
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const id = (value: unknown): value is string =>
  text(value) && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const integer = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value) && value >= 0
const index = (value: unknown): value is number => integer(value) && value <= 100
const latitude = (value: unknown): value is number =>
  finite(value) && Math.abs(value) <= 90
const longitude = (value: unknown): value is number =>
  finite(value) && Math.abs(value) <= 180
const offset = (value: unknown): value is ServerDemandOffset =>
  value === 0 || value === 30 || value === 60
const metric = (value: unknown): value is ServerDemandMetric =>
  value === 'surge' || value === 'population'
const range = (value: unknown) =>
  value === 'low' || value === 'moderate' || value === 'high'
const eventType = (value: unknown): value is ServerEventType =>
  value === 'airport' || value === 'concert' || value === 'last_train'
const date = (value: unknown): value is string =>
  typeof value === 'string' && getFreshnessTimestamp(value) !== null
const uniqueIds = (items: { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length
const metadata = (value: Record<string, unknown>) =>
  date(value.generatedAt) && (value.source === 'mock' || value.source === 'model')

function isPoint(value: unknown): value is ServerDemandPoint {
  return (
    record(value) &&
    offset(value.offset) &&
    index(value.surgeIndex) &&
    range(value.range) &&
    (value.population === null
      ? value.populationRange === null
      : integer(value.population) && range(value.populationRange))
  )
}

function isPolygon(value: unknown): boolean {
  if (
    !Array.isArray(value) ||
    value.length < 4 ||
    !value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        longitude(point[0]) &&
        latitude(point[1]),
    )
  )
    return false
  const first = value[0] as [number, number]
  const last = value[value.length - 1] as [number, number]
  if (first[0] !== last[0] || first[1] !== last[1]) return false
  if (new Set(value.slice(0, -1).map((point) => `${point[0]},${point[1]}`)).size < 3)
    return false
  // Reject a closed but collinear ring that cannot represent a visible area.
  return (
    value
      .slice(1)
      .reduce(
        (area, point, position) =>
          area +
          (value[position][0] - first[0]) * (point[1] - first[1]) -
          (point[0] - first[0]) * (value[position][1] - first[1]),
        0,
      ) !== 0
  )
}

export function isServerHeatmapPlace(value: unknown): value is ServerHeatmapPlace {
  return (
    record(value) &&
    id(value.id) &&
    text(value.name) &&
    ['seoul_rtd', 'airport', 'venue'].includes(value.type as string) &&
    latitude(value.lat) &&
    longitude(value.lng) &&
    isPolygon(value.polygon) &&
    Array.isArray(value.points) &&
    value.points.length === 3 &&
    value.points.every(isPoint) &&
    new Set(value.points.map((point) => point.offset)).size === 3
  )
}

export function isServerHeatmapResponse(value: unknown): value is ServerHeatmapResponse {
  return (
    record(value) &&
    metadata(value) &&
    metric(value.metric) &&
    offset(value.offset) &&
    Array.isArray(value.places) &&
    value.places.every(isServerHeatmapPlace) &&
    uniqueIds(value.places)
  )
}

export function isServerDemandEvent(value: unknown): value is ServerDemandEvent {
  return (
    record(value) &&
    id(value.id) &&
    id(value.placeId) &&
    eventType(value.type) &&
    text(value.title) &&
    date(value.peakAt) &&
    date(value.endsAt) &&
    Date.parse(value.peakAt) <= Date.parse(value.endsAt) &&
    (value.expectedExits === null || integer(value.expectedExits)) &&
    text(value.source)
  )
}

export function isServerPlaceDetail(value: unknown): value is ServerPlaceDetail {
  if (!record(value) || !isServerHeatmapPlace(value) || !metadata(value)) return false
  return (
    Array.isArray(value.reasons) &&
    value.reasons.every(text) &&
    Array.isArray(value.taxiStands) &&
    value.taxiStands.every(
      (stand: unknown) =>
        record(stand) && text(stand.name) && typeof stand.description === 'string',
    ) &&
    Array.isArray(value.events) &&
    value.events.every(isServerDemandEvent) &&
    uniqueIds(value.events) &&
    value.events.every((event: ServerDemandEvent) => event.placeId === value.id)
  )
}

export function isServerEventsResponse(value: unknown): value is ServerEventsResponse {
  return (
    record(value) &&
    metadata(value) &&
    Array.isArray(value.events) &&
    value.events.every(isServerDemandEvent) &&
    uniqueIds(value.events)
  )
}

function isAlert(value: unknown): value is ServerDemandAlert {
  return (
    record(value) &&
    id(value.id) &&
    id(value.placeId) &&
    text(value.reason) &&
    integer(value.travelMinutes) &&
    value.travelMinutes <= 60 &&
    index(value.surgeIndexAtArrival) &&
    date(value.recommendedDepartureAt) &&
    date(value.arrivalAt) &&
    date(value.peakStart) &&
    date(value.peakEnd) &&
    Date.parse(value.peakStart) <= Date.parse(value.peakEnd) &&
    Date.parse(value.arrivalAt) <= Date.parse(value.peakEnd)
  )
}

export function isServerAlertsResponse(value: unknown): value is ServerAlertsResponse {
  if (
    !record(value) ||
    !metadata(value) ||
    !Array.isArray(value.alerts) ||
    value.alerts.length > 3 ||
    !value.alerts.every(isAlert) ||
    !uniqueIds(value.alerts)
  )
    return false
  const generated = Date.parse(value.generatedAt as string)
  return value.alerts.every(
    (alert: ServerDemandAlert) =>
      Date.parse(alert.arrivalAt) === generated + alert.travelMinutes * 60_000 &&
      Date.parse(alert.recommendedDepartureAt) >= generated &&
      Date.parse(alert.peakStart) <= generated + 60 * 60_000,
  )
}

export function isServerConfig(value: unknown): value is ServerConfig {
  if (!record(value) || !record(value.detourRatios)) return false
  const { little, normal, much } = value.detourRatios
  return (
    index(little) &&
    index(normal) &&
    index(much) &&
    little <= normal &&
    normal <= much &&
    integer(value.maxStops) &&
    value.maxStops > 0 &&
    Array.isArray(value.offsets) &&
    value.offsets.length === 3 &&
    value.offsets.every(offset) &&
    new Set(value.offsets).size === 3
  )
}

function boundsQuery(bounds: ServerBounds): string {
  if (
    !record(bounds) ||
    !longitude(bounds.west) ||
    !longitude(bounds.east) ||
    !latitude(bounds.south) ||
    !latitude(bounds.north) ||
    bounds.west > bounds.east ||
    bounds.south > bounds.north
  )
    throw new ServerDemandError('지도 범위를 확인해 주세요.', 'request')
  return [bounds.west, bounds.south, bounds.east, bounds.north].join(',')
}

function baseAddress(value: string | undefined): string {
  try {
    if (!value?.trim()) throw new Error()
    const url = new URL(value.trim())
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error()
    return url.href.replace(/\/+$/, '')
  } catch {
    throw new ServerDemandError(
      'API 서버 주소가 설정되지 않았거나 올바르지 않습니다.',
      'configuration',
    )
  }
}

const aborted = () => new DOMException('Request aborted', 'AbortError')

/** Inject only the base/transport for isolated tests; production always uses the configured public API. */
export function createServerDemandClient(
  options: { baseUrl?: string; fetcher?: typeof fetch } = {},
) {
  async function request<T>(
    path: string,
    signal: AbortSignal | undefined,
    valid: (value: unknown) => value is T,
  ): Promise<T> {
    if (signal?.aborted) throw aborted()
    const base = baseAddress(options.baseUrl ?? import.meta.env?.VITE_API_BASE_URL)
    const controller = new AbortController()
    const abort = () => controller.abort()
    let timedOut = false
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, SERVER_DEMAND_TIMEOUT_MS)
    try {
      const response = await (options.fetcher ?? globalThis.fetch)(`${base}/${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (controller.signal.aborted) throw aborted()
      if (!response.ok)
        throw new ServerDemandError(
          response.status === 404
            ? '서버에서 요청한 정보를 찾을 수 없습니다. (404)'
            : `서버 요청을 처리하지 못했습니다. 다시 시도해 주세요. (${response.status})`,
          'http',
          response.status,
        )
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new ServerDemandError(
          '서버 응답을 읽을 수 없습니다. 다시 시도해 주세요.',
          'response',
          response.status,
        )
      }
      if (controller.signal.aborted) throw aborted()
      if (!valid(payload))
        throw new ServerDemandError(
          '서버 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.',
          'response',
          response.status,
        )
      return payload
    } catch (error) {
      if (signal?.aborted) throw aborted()
      if (timedOut)
        throw new ServerDemandError(
          '서버 응답 시간이 초과되었습니다. 다시 시도해 주세요.',
          'timeout',
        )
      if (error instanceof ServerDemandError) throw error
      throw new ServerDemandError(
        '서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.',
        'network',
      )
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  return {
    async getServerHeatmap({
      metric: selectedMetric,
      offset: selectedOffset,
      bounds,
      signal,
    }: {
      metric: ServerDemandMetric
      offset: ServerDemandOffset
      bounds?: ServerBounds
      signal?: AbortSignal
    }): Promise<ServerHeatmapResponse> {
      if (!metric(selectedMetric) || !offset(selectedOffset))
        throw new ServerDemandError('예측 지표와 시점을 확인해 주세요.', 'request')
      const query = new URLSearchParams({
        metric: selectedMetric,
        offset: String(selectedOffset),
      })
      if (bounds) query.set('bbox', boundsQuery(bounds))
      const response = await request(`heatmap?${query}`, signal, isServerHeatmapResponse)
      if (response.metric !== selectedMetric || response.offset !== selectedOffset)
        throw new ServerDemandError(
          '서버가 요청한 지표·시점과 다른 예측을 반환했습니다.',
          'response',
        )
      return response
    },
    async getServerPlaceDetail(
      placeId: string,
      signal?: AbortSignal,
    ): Promise<ServerPlaceDetail> {
      if (!id(placeId))
        throw new ServerDemandError('장소를 다시 선택해 주세요.', 'request')
      let encoded: string
      try {
        encoded = encodeURIComponent(placeId)
      } catch {
        throw new ServerDemandError('장소 ID를 확인해 주세요.', 'request')
      }
      const response = await request(`places/${encoded}`, signal, isServerPlaceDetail)
      if (response.id !== placeId)
        throw new ServerDemandError(
          '서버가 선택한 장소와 다른 상세 정보를 반환했습니다.',
          'response',
        )
      return response
    },
    async getServerEvents({
      type,
      bounds,
      from,
      to,
      signal,
    }: {
      type?: ServerEventType
      bounds?: ServerBounds
      from?: string
      to?: string
      signal?: AbortSignal
    } = {}): Promise<ServerEventsResponse> {
      if (
        (type !== undefined && !eventType(type)) ||
        (from !== undefined && !date(from)) ||
        (to !== undefined && !date(to)) ||
        (from !== undefined && to !== undefined && Date.parse(from) >= Date.parse(to))
      )
        throw new ServerDemandError('이벤트 유형과 조회 기간을 확인해 주세요.', 'request')
      const query = new URLSearchParams()
      if (type) query.set('type', type)
      if (from) query.set('from', from)
      if (to) query.set('to', to)
      if (bounds) query.set('bbox', boundsQuery(bounds))
      return request(
        `events${query.size ? `?${query}` : ''}`,
        signal,
        isServerEventsResponse,
      )
    },
    async getServerAlerts({
      lat,
      lng,
      signal,
    }: {
      lat: number
      lng: number
      signal?: AbortSignal
    }): Promise<ServerAlertsResponse> {
      if (!latitude(lat) || !longitude(lng))
        throw new ServerDemandError('출발 위치 좌표를 확인해 주세요.', 'request')
      const query = new URLSearchParams({ lat: String(lat), lng: String(lng) })
      return request(`alerts/top?${query}`, signal, isServerAlertsResponse)
    },
    getServerConfig(signal?: AbortSignal): Promise<ServerConfig> {
      return request('config', signal, isServerConfig)
    },
  }
}

export const {
  getServerHeatmap,
  getServerPlaceDetail,
  getServerEvents,
  getServerAlerts,
  getServerConfig,
} = createServerDemandClient()
