export type ForecastMetric = 'hourly' | 'passengers'
export type ForecastHorizon = 0 | 30 | 60

export interface ForecastPoint {
  minutes: ForecastHorizon
  grossRevenue: number
  fuelCost: number
  idleCost: number
  netHourly: number
  passengers: number
}

export interface ForecastZone {
  id: string
  name: string
  lat: number
  lng: number
  h3Index: string
  reason: string
  trend: ForecastPoint[]
}

export interface ForecastResponse {
  generatedAt: string
  metric: ForecastMetric
  horizon: ForecastHorizon
  zones: ForecastZone[]
}

export interface RankedForecastZone extends ForecastZone {
  rank: number
  current: ForecastPoint
}
