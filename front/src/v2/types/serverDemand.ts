/** Wire DTOs for backend/schemas/demand.py; separate from local preview fixtures. */
export type ServerDemandMetric = 'surge' | 'population'
export type ServerDemandOffset = 0 | 30 | 60
export type ServerDemandRange = 'low' | 'moderate' | 'high'
export type ServerPlaceType = 'seoul_rtd' | 'airport' | 'venue'
export type ServerEventType = 'airport' | 'concert' | 'last_train'
export type ServerSource = 'mock' | 'model'
export type ServerBounds = { west: number; south: number; east: number; north: number }
export type ServerPolygonCoordinate = [longitude: number, latitude: number]

export interface ServerDemandPoint {
  offset: ServerDemandOffset
  surgeIndex: number
  population: number | null
  range: ServerDemandRange
  populationRange: ServerDemandRange | null
}

export interface ServerHeatmapPlace {
  id: string
  name: string
  type: ServerPlaceType
  lat: number
  lng: number
  polygon: ServerPolygonCoordinate[]
  points: ServerDemandPoint[]
}

export interface ServerDemandMetadata {
  generatedAt: string
  source: ServerSource
}

export interface ServerHeatmapResponse extends ServerDemandMetadata {
  metric: ServerDemandMetric
  offset: ServerDemandOffset
  places: ServerHeatmapPlace[]
}

export interface ServerTaxiStand {
  name: string
  description: string
}

export interface ServerDemandEvent {
  id: string
  placeId: string
  type: ServerEventType
  title: string
  peakAt: string
  endsAt: string
  expectedExits: number | null
  /** Human-readable event provenance, not the envelope's mock/model discriminator. */
  source: string
}

export interface ServerPlaceDetail extends ServerHeatmapPlace, ServerDemandMetadata {
  reasons: string[]
  taxiStands: ServerTaxiStand[]
  events: ServerDemandEvent[]
}

export interface ServerEventsResponse extends ServerDemandMetadata {
  events: ServerDemandEvent[]
}

export interface ServerDemandAlert {
  id: string
  placeId: string
  reason: string
  travelMinutes: number
  recommendedDepartureAt: string
  /** Arrival when departing at generatedAt, distinct from recommendedDepartureAt. */
  arrivalAt: string
  peakStart: string
  peakEnd: string
  surgeIndexAtArrival: number
}

export interface ServerAlertsResponse extends ServerDemandMetadata {
  alerts: ServerDemandAlert[]
}

export interface ServerConfig {
  detourRatios: { little: number; normal: number; much: number }
  offsets: ServerDemandOffset[]
  maxStops: number
}
