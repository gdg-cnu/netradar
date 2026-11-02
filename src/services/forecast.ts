import { cellToLatLng, getResolution, isValidCell, latLngToCell } from 'h3-js'
import { apiRequest } from './api.ts'
import type {
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

function validateForecast(response: ForecastResponse): ForecastResponse {
  const ids = new Set<string>()
  if (
    !response ||
    !Array.isArray(response.zones) ||
    !Number.isFinite(Date.parse(response.generatedAt))
  ) {
    throw new Error('예측 데이터 형식을 확인할 수 없습니다.')
  }
  for (const zone of response.zones) {
    if (
      !zone ||
      typeof zone.id !== 'string' ||
      ids.has(zone.id) ||
      typeof zone.name !== 'string' ||
      typeof zone.reason !== 'string' ||
      !isValidCell(zone.h3Index) ||
      getResolution(zone.h3Index) !== 8 ||
      !Number.isFinite(zone.lat) ||
      Math.abs(zone.lat) > 90 ||
      !Number.isFinite(zone.lng) ||
      Math.abs(zone.lng) > 180 ||
      !Array.isArray(zone.trend)
    ) {
      throw new Error('지역 예측 데이터 형식을 확인할 수 없습니다.')
    }
    ids.add(zone.id)
    for (const horizon of horizons) {
      const point = zone.trend.find((item) => item.minutes === horizon)
      if (
        !point ||
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
      ) {
        throw new Error('시간대별 예측 데이터를 확인할 수 없습니다.')
      }
    }
  }
  return response
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
  const response = await apiRequest<ForecastResponse>(
    `/forecast/zones?${query}`,
    { method: 'GET', signal },
    () => createDemoForecast(metric, horizon),
  )
  return validateForecast(response)
}

export function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}
