import { cellToLatLng, getResolution, isValidCell, latLngToCell } from 'h3-js'
import { apiRequest, isDemoMode } from './api.ts'
import type {
  ForecastApiZone,
  ForecastDeclaredSource,
  ForecastProvenance,
  ForecastSourceMetadata,
  ForecastSummaryProvenance,
  ForecastHorizon,
  ForecastMetric,
  ForecastPoint,
  ForecastResponse,
  ForecastZone,
  RankedForecastZone,
} from '../types/forecast.ts'

const horizons: ForecastHorizon[] = [0, 30, 60]

const locations = [
  {
    name: '강남역',
    lat: 37.4979,
    lng: 127.0276,
    revenue: [39000, 36000, 31000],
    passengers: [64, 58, 43],
    fuel: 3500,
    idle: 3500,
    reason:
      '업무·상업 시설이 밀집한 구역으로, 예시 데이터에서 현재 승객 수요가 높습니다.',
  },
  {
    name: '교대역',
    lat: 37.4935,
    lng: 127.0146,
    revenue: [35000, 37000, 34000],
    passengers: [49, 55, 48],
    fuel: 3100,
    idle: 3900,
    reason:
      '지하철 환승과 주변 업무 시설을 고려한 예시 수요입니다. 연료비 부담이 상대적으로 낮습니다.',
  },
  {
    name: '신논현역',
    lat: 37.5045,
    lng: 127.0254,
    revenue: [34000, 39000, 42000],
    passengers: [56, 69, 82],
    fuel: 3600,
    idle: 4400,
    reason:
      '상업 시설 방문 수요가 늘어나는 상황을 가정했습니다. 이후 시간대의 승객 수요가 증가합니다.',
  },
  {
    name: '역삼역',
    lat: 37.5006,
    lng: 127.0365,
    revenue: [32000, 35500, 38000],
    passengers: [43, 51, 64],
    fuel: 3300,
    idle: 3700,
    reason:
      '업무 시설에서 출발하는 이동 수요를 가정했습니다. 30분 이후의 수입이 증가하는 예시입니다.',
  },
  {
    name: '선릉역',
    lat: 37.5045,
    lng: 127.049,
    revenue: [31500, 34500, 36500],
    passengers: [42, 54, 66],
    fuel: 3000,
    idle: 4000,
    reason:
      '환승역과 업무 시설이 만나는 구역입니다. 시간대별 승객 수요가 꾸준히 증가하는 예시입니다.',
  },
  {
    name: '삼성역',
    lat: 37.5089,
    lng: 127.0631,
    revenue: [36500, 43000, 46000],
    passengers: [68, 86, 78],
    fuel: 4200,
    idle: 4300,
    reason:
      '전시·상업 시설 방문이 늘어나는 상황을 가정했습니다. 높은 예상 매출과 이동 비용을 함께 비교하세요.',
  },
  {
    name: '양재역',
    lat: 37.4845,
    lng: 127.0341,
    revenue: [29500, 31500, 33000],
    passengers: [38, 46, 53],
    fuel: 2900,
    idle: 3600,
    reason:
      '주거·업무 지역 간 이동 수요를 가정했습니다. 다른 구역보다 예상 비용이 낮은 편입니다.',
  },
]

/** Deterministic Seoul fixtures, never represented as live predictions. */
export function createDemoForecast(
  metric: ForecastMetric,
  horizon: ForecastHorizon,
): ForecastResponse {
  return {
    generatedAt: new Date().toISOString(),
    metric,
    horizon,
    provenance: 'local-demo',
    zones: locations.map((location) => {
      const h3Index = latLngToCell(location.lat, location.lng, 8)
      const [lat, lng] = cellToLatLng(h3Index)
      return {
        id: h3Index,
        h3Index,
        name: location.name,
        lat,
        lng,
        reason: location.reason,
        provenance: 'local-demo',
        geometrySource: 'provided',
        trend: horizons.map((minutes, index) => {
          const fuelCost = location.fuel + index * 200
          const idleCost = location.idle + index * 150
          const grossRevenue = location.revenue[index]
          return {
            minutes,
            grossRevenue,
            fuelCost,
            idleCost,
            netHourly: grossRevenue - fuelCost - idleCost,
            passengers: location.passengers[index],
          }
        }),
      }
    }),
  }
}

export function rankForecastZones(
  zones: ForecastZone[],
  metric: ForecastMetric,
  horizon: ForecastHorizon,
): RankedForecastZone[] {
  return zones
    .map((zone) => ({
      ...zone,
      current: zone.trend.find((point) => point.minutes === horizon),
    }))
    .filter((zone): zone is ForecastZone & { current: ForecastPoint } =>
      Boolean(zone.current),
    )
    .sort((left, right) => {
      const score =
        metric === 'hourly'
          ? right.current.netHourly - left.current.netHourly
          : right.current.passengers - left.current.passengers
      return score || left.id.localeCompare(right.id)
    })
    .map((zone, index) => ({ ...zone, rank: index + 1 }))
}

const knownServerMockZones = new Set(['gangnam', 'gyodae'])
const supportedSources = new Set<ForecastDeclaredSource>([
  'demo',
  'mock',
  'model',
  'live',
  'unknown',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readSourceMetadata(value: Record<string, unknown>): ForecastSourceMetadata {
  if (
    (value.source !== undefined &&
      !supportedSources.has(value.source as ForecastDeclaredSource)) ||
    (value.demo !== undefined && typeof value.demo !== 'boolean')
  )
    throw new Error('예측 데이터의 출처 표시 형식을 확인할 수 없습니다.')
  const source = value.source as ForecastDeclaredSource | undefined
  const demo = value.demo as boolean | undefined
  if (
    ((source === 'demo' || source === 'mock') && demo === false) ||
    (source === 'model' && demo === true)
  )
    throw new Error('예측 데이터의 출처 표시가 서로 일치하지 않습니다.')
  return { source, demo }
}

function sourceProvenance(metadata: ForecastSourceMetadata): ForecastProvenance {
  if (metadata.demo === true || metadata.source === 'demo' || metadata.source === 'mock')
    return 'server-demo'
  if (metadata.source === 'model') return 'server-model'
  // A live connection or demo:false does not establish that a model produced the data.
  return 'server-unspecified'
}

/**
 * Accept only the two explicit mock markers shipped by backend/data/mock_zones.py.
 * All other server geometry must already be a valid resolution-8 H3 cell.
 * Zone source declarations override response defaults; the summary reports mixtures.
 */
export function normalizeForecastResponse(
  input: unknown,
  transport: 'local-demo' | 'server' = 'server',
): ForecastResponse {
  if (
    !isRecord(input) ||
    typeof input.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(input.generatedAt)) ||
    (input.metric !== 'hourly' && input.metric !== 'passengers') ||
    !horizons.includes(input.horizon as ForecastHorizon) ||
    !Array.isArray(input.zones)
  )
    throw new Error('예측 데이터 형식을 확인할 수 없습니다.')
  const responseMetadata = readSourceMetadata(input)
  const ids = new Set<string>()
  const zones: ForecastZone[] = input.zones.map((raw: unknown) => {
    if (!isRecord(raw)) throw new Error('지역 예측 데이터 형식을 확인할 수 없습니다.')
    const zone = raw as unknown as ForecastApiZone
    if (
      typeof zone.id !== 'string' ||
      zone.id.trim() === '' ||
      ids.has(zone.id) ||
      typeof zone.name !== 'string' ||
      zone.name.trim() === '' ||
      typeof zone.reason !== 'string' ||
      typeof zone.h3Index !== 'string' ||
      !Number.isFinite(zone.lat) ||
      Math.abs(zone.lat) > 90 ||
      !Number.isFinite(zone.lng) ||
      Math.abs(zone.lng) > 180 ||
      !Array.isArray(zone.trend) ||
      zone.trend.length !== horizons.length
    )
      throw new Error('지역 예측 데이터 형식을 확인할 수 없습니다.')
    ids.add(zone.id)
    const ownMetadata = readSourceMetadata(raw)
    const metadata =
      ownMetadata.source !== undefined || ownMetadata.demo !== undefined
        ? ownMetadata
        : responseMetadata
    const knownMock =
      knownServerMockZones.has(zone.id) && zone.h3Index === `mock-${zone.id}`
    let h3Index = zone.h3Index
    let geometrySource: ForecastZone['geometrySource'] = 'provided'
    let provenance =
      transport === 'local-demo' ? 'local-demo' : sourceProvenance(metadata)
    if (knownMock && transport === 'server') {
      if (metadata.demo === false || metadata.source === 'model') {
        throw new Error('서버 예시 구역과 데이터 출처 표시가 서로 일치하지 않습니다.')
      }
      h3Index = latLngToCell(zone.lat, zone.lng, 8)
      geometrySource = 'server-demo-coordinates'
      provenance = 'server-demo'
    } else if (!isValidCell(h3Index) || getResolution(h3Index) !== 8) {
      throw new Error('지역 예측 데이터의 H3 구역을 확인할 수 없습니다.')
    }
    const trend = horizons.map((minutes) => {
      const matching = zone.trend.filter((point) => point && point.minutes === minutes)
      const point = matching[0]
      if (
        matching.length !== 1 ||
        ![
          point.grossRevenue,
          point.fuelCost,
          point.idleCost,
          point.netHourly,
          point.passengers,
        ].every(Number.isFinite) ||
        [point.grossRevenue, point.fuelCost, point.idleCost, point.passengers].some(
          (value) => value < 0,
        )
      )
        throw new Error('시간대별 예측 데이터를 확인할 수 없습니다.')
      return {
        minutes,
        grossRevenue: point.grossRevenue,
        fuelCost: point.fuelCost,
        idleCost: point.idleCost,
        netHourly: point.netHourly,
        passengers: point.passengers,
      }
    })
    return {
      id: zone.id,
      name: zone.name,
      lat: zone.lat,
      lng: zone.lng,
      h3Index,
      reason: zone.reason,
      trend,
      provenance,
      geometrySource,
      ...metadata,
    }
  })
  const sources = new Set(zones.map((zone) => zone.provenance))
  const provenance: ForecastSummaryProvenance =
    sources.size > 1
      ? 'mixed'
      : (zones[0]?.provenance ??
        (transport === 'local-demo' ? 'local-demo' : sourceProvenance(responseMetadata)))
  return {
    generatedAt: input.generatedAt,
    metric: input.metric,
    horizon: input.horizon as ForecastHorizon,
    zones,
    provenance,
    ...responseMetadata,
  }
}

export function forecastSourceLabel(provenance: ForecastSummaryProvenance): string {
  return {
    'local-demo': '로컬 데모 · 예시 데이터',
    'server-demo': '서버 예시 데이터',
    'server-model': '서버 표기: 모델 예측',
    'server-unspecified': '서버 제공 데이터 · 출처 미확인',
    mixed: '서버 데이터 · 출처 혼합',
  }[provenance]
}

export function forecastSourceNotice(provenance: ForecastSummaryProvenance): string {
  return {
    'local-demo': '로컬 시연용 데이터입니다. 실제 수요·수익을 나타내지 않습니다.',
    'server-demo': '서버에서 받은 예시 데이터입니다. 실제 수요·수익을 나타내지 않습니다.',
    'server-model':
      '서버가 모델 예측으로 표시한 데이터입니다. 실제 수익을 보장하지 않습니다.',
    'server-unspecified': '서버가 제공한 데이터이며, 예측의 출처는 확인되지 않았습니다.',
    mixed:
      '출처가 서로 다른 데이터가 함께 표시됩니다. 각 구역의 출처 표시를 확인해 주세요.',
  }[provenance]
}

export async function getForecast(
  metric: ForecastMetric,
  horizon: ForecastHorizon,
  signal?: AbortSignal,
): Promise<ForecastResponse> {
  const query = new URLSearchParams({
    metric,
    horizon: String(horizon),
    resolution: '8',
  })
  const transport = isDemoMode() ? 'local-demo' : 'server'
  const response = await apiRequest<unknown>(
    `/forecast/zones?${query}`,
    { method: 'GET', signal },
    () => createDemoForecast(metric, horizon),
  )
  const normalized = normalizeForecastResponse(response, transport)
  if (normalized.metric !== metric || normalized.horizon !== horizon) {
    throw new Error('요청한 지표·시간대와 예측 응답이 일치하지 않습니다.')
  }
  return normalized
}

export function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}
