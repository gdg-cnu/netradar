/** Frontend-only mock contract. This is not the backend/OpenAPI contract. */
export type DemandOffset = 0 | 30 | 60
export type DemandMetric = 'surge' | 'population'
export type EventType = 'airport' | 'concert' | 'train' | 'last_train'
export type DemandRange = 'low' | 'moderate' | 'high'
/** GeoJSON order [longitude, latitude]; mock polygons are closed exterior rings. */
export type PolygonCoordinate = [number, number]
export type Bounds = { west: number; south: number; east: number; north: number }
export interface DemandPoint {
  offset: DemandOffset
  surgeIndex: number
  population: number
  range: DemandRange
  populationRange: DemandRange
}
export interface DemandPlace {
  id: string
  name: string
  type: EventType
  lat: number
  lng: number
  polygon: PolygonCoordinate[]
  points: DemandPoint[]
  reasons: string[]
  taxiStands: { name: string; description: string }[]
}
export interface DemandEvent {
  id: string
  placeId: string
  type: EventType
  title: string
  peakAt: string
  endsAt: string
  expectedExits: number
  source: string
}
export interface DemandAlert {
  id: string
  placeId: string
  reason: string
  recommendedDepartureAt: string
  arrivalAt: string
  peakStart: string
  peakEnd: string
  travelMinutes: number
  surgeIndexAtArrival: number
}
export interface DemandSnapshot {
  source: 'mock'
  generatedAt: string
  places: DemandPlace[]
  events: DemandEvent[]
  alerts: DemandAlert[]
}
