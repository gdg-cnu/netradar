export type ForecastMetric = 'hourly' | 'passengers'
export type ForecastHorizon = 0 | 30 | 60

/** Optional source declarations accepted by the frontend compatibility adapter. */
export type ForecastDeclaredSource = 'demo' | 'mock' | 'model' | 'live' | 'unknown'
export type ForecastProvenance =
  'local-demo' | 'server-demo' | 'server-model' | 'server-unspecified'
export type ForecastSummaryProvenance = ForecastProvenance | 'mixed'

export interface ForecastSourceMetadata {
  source?: ForecastDeclaredSource
  demo?: boolean
}

export interface ForecastPoint {
  minutes: ForecastHorizon
  grossRevenue: number
  fuelCost: number
  idleCost: number
  netHourly: number
  passengers: number
}

/** Wire fields returned by the backend; provenance is computed in the adapter. */
export interface ForecastApiZone extends ForecastSourceMetadata {
  id: string
  name: string
  lat: number
  lng: number
  h3Index: string
  reason: string
  trend: ForecastPoint[]
}

export interface ForecastZone extends ForecastApiZone {
  provenance: ForecastProvenance
  geometrySource: 'provided' | 'server-demo-coordinates'
}

export interface ForecastApiResponse extends ForecastSourceMetadata {
  generatedAt: string
  metric: ForecastMetric
  horizon: ForecastHorizon
  zones: ForecastApiZone[]
}

/** Validated frontend data, including display geometry and source classification. */
export interface ForecastResponse extends ForecastApiResponse {
  zones: ForecastZone[]
  provenance: ForecastSummaryProvenance
}

export interface RankedForecastZone extends ForecastZone {
  rank: number
  current: ForecastPoint
}
